// ============================================================================
// FASE 5 — Executor (DUAL WRITE) do Playlist Occupancy Engine.
//
// Responsabilidades:
//   - Drena planos prontos (`status='ready'`, `mode IN ('DUAL_WRITE','PRIMARY')`,
//     `executor_status='pending'`) reservados via `fn_occupancy_claim_executable_plans`.
//   - Aplica as operações no Spotify (REMOVE, REPOSITION, INSERT, REPLACE).
//   - Atualiza status de cada op (`op_status`, `executed_at`, `error`, `attempts`).
//   - Marca o plano como `executed`, `partial` ou `failed` com `executor_stats`.
//   - Nunca recalcula plano. Toda decisão pertence ao Occupancy Engine.
//   - Token: OAuth do owner (preferencial) → Client Credentials (fallback).
//
// Body opcional: { limit?: number }
// ============================================================================
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getAppToken, getUserToken, setSpotifyCtx } from "../_shared/spotify-client.ts";
import {
  addPlaylistTracks,
  removePlaylistTracks,
  reorderPlaylistTracks,
  replacePlaylistTracks,
  listPlaylistTrackRefs,
  type PlaylistTrackRef,
} from "../_shared/spotify-playlist.ts";
import { backoffSecondsForAttempt } from "../_shared/playlist-queue.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const jr = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const toUri = (id: string) =>
  id.startsWith("spotify:track:") ? id : `spotify:track:${id}`;

type Op = {
  id: string;
  op_type: "REMOVE" | "REPOSITION" | "INSERT" | "REPLACE";
  spotify_track_id: string;
  classification: string | null;
  from_position: number | null;
  to_position: number | null;
  reason: string | null;
};

type PlanRow = {
  plan_id: string;
  managed_playlist_id: string;
  mode: string;
  ops_count: number;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  // Hard guard: nunca executa em SHADOW. Lê flag direto pra evitar race.
  const { data: flagRow } = await supabase
    .from("system_flags")
    .select("occupancy_engine_mode")
    .limit(1)
    .maybeSingle();
  const flag = String(flagRow?.occupancy_engine_mode ?? "shadow").toLowerCase();
  if (flag !== "dual_write" && flag !== "primary") {
    return jr({ ok: true, skipped: true, reason: "engine_mode_shadow", flag });
  }

  let limit = 5;
  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    if (typeof body?.limit === "number") {
      limit = Math.max(1, Math.min(25, body.limit));
    }
  } catch (_) { /* noop */ }

  const t0 = Date.now();
  const { data: claimed, error: claimErr } = await supabase.rpc(
    "fn_occupancy_claim_executable_plans",
    { p_limit: limit },
  );
  if (claimErr) return jr({ ok: false, error: claimErr.message }, 500);

  const plans = (claimed ?? []) as PlanRow[];
  const results: any[] = [];

  for (const plan of plans) {
    const r = await executePlan(supabase, plan).catch((e) => ({
      plan_id: plan.plan_id,
      executor_status: "failed",
      error: e?.message ?? String(e),
    }));
    results.push(r);
  }

  return jr({
    ok: true,
    mode: flag,
    claimed: plans.length,
    duration_ms: Date.now() - t0,
    results,
  });
});

async function executePlan(supabase: any, plan: PlanRow) {
  const planId = plan.plan_id;
  const playlistId = plan.managed_playlist_id;

  // 1. Carrega contexto da playlist (spotify_id + owner_spotify_user_id)
  const { data: pl, error: plErr } = await supabase
    .from("managed_playlists")
    .select("id, spotify_playlist_id, owner_spotify_user_id, name, operational_status, execution_mode")
    .eq("id", playlistId)
    .maybeSingle();
  if (plErr || !pl?.spotify_playlist_id) {
    return await finalize(supabase, planId, "failed", {
      stage: "load_playlist",
      error: plErr?.message ?? "playlist_not_found",
    });
  }
  if (pl.operational_status === "do_not_operate" || pl.execution_mode === "MANUAL_ONLY") {
    return await finalize(supabase, planId, "skipped", {
      stage: "guard",
      reason: "playlist_manual_or_blocked",
    });
  }

  // 2. Carrega ops
  const { data: opsData, error: opsErr } = await supabase
    .from("occupancy_plan_ops")
    .select("id, op_type, spotify_track_id, classification, from_position, to_position, reason")
    .eq("plan_id", planId)
    .order("created_at", { ascending: true });
  if (opsErr) {
    return await finalize(supabase, planId, "failed", {
      stage: "load_ops",
      error: opsErr.message,
    });
  }
  const ops = (opsData ?? []) as Op[];
  if (ops.length === 0) {
    return await finalize(supabase, planId, "executed", { stage: "noop", ops_total: 0 });
  }

  // 3. Token híbrido (OAuth → CC)
  const ownerSpotifyId: string | null = pl.owner_spotify_user_id ?? null;
  setSpotifyCtx({
    appId: null,
    playlist_id: pl.id,
    owner_id: ownerSpotifyId,
    spotify_user_id: ownerSpotifyId,
    function_name: "occupancy-executor",
  });

  let token: string;
  let tokenSource: "oauth" | "app" = "app";
  try {
    if (ownerSpotifyId) {
      try {
        const userTok = await getUserToken(ownerSpotifyId);
        token = userTok.token;
        tokenSource = "oauth";
      } catch (_e) {
        token = await getAppToken();
      }
    } else {
      token = await getAppToken();
    }
  } catch (e: any) {
    return await finalize(supabase, planId, "failed", {
      stage: "token",
      error: e?.message ?? String(e),
    });
  }

  const stats = {
    token_source: tokenSource,
    ops_total: ops.length,
    removed: 0,
    repositioned: 0,
    inserted: 0,
    replaced: 0,
    skipped: 0,
    errors: 0,
    local_writes: 0,
    local_write_errors: 0,
    last_snapshot_id: null as string | null,
  };

  // === LOCAL STATE (Option A — dual write) ===========================
  // Carrega o estado local atual da playlist para mutarmos em memória
  // após cada operação executada com sucesso no Spotify e persistir as
  // alterações em managed_playlist_tracks. Sem isto, post_executor_sync
  // dispara rebuilds redundantes baseados em estado stale.
  type LocalRow = {
    id: string | null;
    spotify_track_id: string;
    position: number;
  };
  const localState: LocalRow[] = await loadLocalState(supabase, playlistId);

  // 4. Ordem: REMOVE → REPOSITION → REPLACE → INSERT
  const removes = ops.filter((o) => o.op_type === "REMOVE");
  const repositions = ops.filter((o) => o.op_type === "REPOSITION");
  const replaces = ops.filter((o) => o.op_type === "REPLACE");
  const inserts = ops.filter((o) => o.op_type === "INSERT");

  // ----- REMOVE (bulk) -----
  if (removes.length > 0) {
    const ids = removes.map((o) => o.spotify_track_id);
    const uris = ids.map(toUri);
    try {
      const r = await removePlaylistTracks(pl.spotify_playlist_id, uris, token);
      if (r.snapshot_id) stats.last_snapshot_id = r.snapshot_id;
      stats.removed = removes.length;
      await markOps(supabase, removes.map((o) => o.id), "done", null);
      // local mirror
      try {
        await applyLocalRemove(supabase, playlistId, localState, ids);
        stats.local_writes += ids.length;
      } catch (e: any) {
        stats.local_write_errors += ids.length;
        console.error("local_remove_failed", e?.message ?? e);
      }
    } catch (e: any) {
      stats.errors += removes.length;
      await markOps(supabase, removes.map((o) => o.id), "error", e?.message ?? String(e));
    }
  }

  // Após remove, posições mudaram. Re-listamos pra reposicionar e inserir corretamente.
  let refs: PlaylistTrackRef[] = [];
  if (repositions.length > 0 || inserts.length > 0 || replaces.length > 0) {
    try {
      refs = await listPlaylistTrackRefs(pl.spotify_playlist_id, token);
    } catch (e: any) {
      const pending = [...repositions, ...inserts, ...replaces].map((o) => o.id);
      stats.errors += pending.length;
      await markOps(supabase, pending, "error", `refresh_refs_failed: ${e?.message ?? e}`);
      return await finalize(supabase, planId, "partial", stats);
    }
  }

  const findIdx = (id: string): number => {
    const uri = toUri(id);
    for (let i = 0; i < refs.length; i++) {
      if (refs[i].uri === uri || refs[i].id === id || refs[i].linked_from_uri === uri) return i;
    }
    return -1;
  };

  // ----- REPOSITION -----
  const sortedRepos = [...repositions].sort(
    (a, b) => (a.to_position ?? 0) - (b.to_position ?? 0),
  );
  for (const op of sortedRepos) {
    const cur = findIdx(op.spotify_track_id);
    if (cur < 0) {
      stats.skipped++;
      await markOps(supabase, [op.id], "skipped", "track_not_in_playlist");
      continue;
    }
    const target = Math.max(0, Math.min(refs.length, op.to_position ?? cur));
    if (cur === target) {
      stats.skipped++;
      await markOps(supabase, [op.id], "skipped", "already_in_position");
      continue;
    }
    try {
      const r = await reorderPlaylistTracks(
        pl.spotify_playlist_id,
        { range_start: cur, insert_before: target },
        token,
      );
      if (r.snapshot_id) stats.last_snapshot_id = r.snapshot_id;
      stats.repositioned++;
      await markOps(supabase, [op.id], "done", null);
      // local mirror
      try {
        await applyLocalReposition(supabase, playlistId, localState, op.spotify_track_id, target);
        stats.local_writes += 1;
      } catch (e: any) {
        stats.local_write_errors += 1;
        console.error("local_reposition_failed", e?.message ?? e);
      }
      try {
        refs = await listPlaylistTrackRefs(pl.spotify_playlist_id, token);
      } catch (_e) { /* mantém refs antigas */ }
    } catch (e: any) {
      stats.errors++;
      await markOps(supabase, [op.id], "error", e?.message ?? String(e));
    }
  }

  // ----- REPLACE (substitui playlist inteira pela URI única) -----
  for (const op of replaces) {
    try {
      const r = await replacePlaylistTracks(
        pl.spotify_playlist_id,
        [toUri(op.spotify_track_id)],
        token,
      );
      if (r.snapshot_id) stats.last_snapshot_id = r.snapshot_id;
      stats.replaced++;
      await markOps(supabase, [op.id], "done", null);
      try {
        await applyLocalReplace(supabase, playlistId, localState, op.spotify_track_id);
        stats.local_writes += 1;
      } catch (e: any) {
        stats.local_write_errors += 1;
        console.error("local_replace_failed", e?.message ?? e);
      }
    } catch (e: any) {
      stats.errors++;
      await markOps(supabase, [op.id], "error", e?.message ?? String(e));
    }
  }

  // ----- INSERT -----
  const sortedInserts = [...inserts].sort(
    (a, b) => (a.to_position ?? 0) - (b.to_position ?? 0),
  );
  for (const op of sortedInserts) {
    const uri = toUri(op.spotify_track_id);
    const pos = typeof op.to_position === "number" ? op.to_position : undefined;
    try {
      const r = await addPlaylistTracks(pl.spotify_playlist_id, [uri], token, { position: pos });
      if (r.snapshot_id) stats.last_snapshot_id = r.snapshot_id;
      stats.inserted++;
      await markOps(supabase, [op.id], "done", null);
      try {
        await applyLocalInsert(
          supabase,
          playlistId,
          localState,
          op.spotify_track_id,
          typeof pos === "number" ? pos : localState.length,
        );
        stats.local_writes += 1;
      } catch (e: any) {
        stats.local_write_errors += 1;
        console.error("local_insert_failed", e?.message ?? e);
      }
    } catch (e: any) {
      stats.errors++;
      await markOps(supabase, [op.id], "error", e?.message ?? String(e));
    }
  }

  const okCount = stats.removed + stats.repositioned + stats.inserted + stats.replaced;
  const finalStatus =
    stats.errors === 0 && okCount + stats.skipped === ops.length
      ? "executed"
      : okCount > 0
      ? "partial"
      : "failed";

  // Sob a regra event-driven (overflow gradual revogado), o dual-write local
  // já mantém managed_playlist_tracks convergente. Não enfileiramos rebuild
  // pós-execução — isso reintroduziria loops sem evento real.


  return await finalize(supabase, planId, finalStatus, stats);
}

// ============================================================================
// Local state helpers (Option A — dual write em managed_playlist_tracks)
// ============================================================================

async function loadLocalState(
  supabase: any,
  playlistId: string,
): Promise<Array<{ id: string | null; spotify_track_id: string; position: number }>> {
  const { data, error } = await supabase
    .from("managed_playlist_tracks")
    .select("id, spotify_track_id, position")
    .eq("playlist_id", playlistId)
    .order("position", { ascending: true });
  if (error) throw new Error(`load_local_state: ${error.message}`);
  return (data ?? []).map((r: any) => ({
    id: r.id,
    spotify_track_id: r.spotify_track_id,
    position: r.position,
  }));
}

async function resequenceLocal(
  supabase: any,
  playlistId: string,
  localState: Array<{ id: string | null; spotify_track_id: string; position: number }>,
) {
  // Atualiza apenas as linhas cuja posição mudou em relação ao índice.
  const updates: Array<Promise<unknown>> = [];
  for (let i = 0; i < localState.length; i++) {
    const row = localState[i];
    if (row.position !== i) {
      row.position = i;
      if (row.id) {
        updates.push(
          supabase
            .from("managed_playlist_tracks")
            .update({ position: i })
            .eq("id", row.id),
        );
      } else {
        updates.push(
          supabase
            .from("managed_playlist_tracks")
            .update({ position: i })
            .eq("playlist_id", playlistId)
            .eq("spotify_track_id", row.spotify_track_id),
        );
      }
    }
  }
  if (updates.length > 0) await Promise.all(updates);
}

async function applyLocalRemove(
  supabase: any,
  playlistId: string,
  localState: Array<{ id: string | null; spotify_track_id: string; position: number }>,
  trackIds: string[],
) {
  const idSet = new Set(trackIds);
  // 1. Delete físico
  const { error } = await supabase
    .from("managed_playlist_tracks")
    .delete()
    .eq("playlist_id", playlistId)
    .in("spotify_track_id", trackIds);
  if (error) throw new Error(`delete: ${error.message}`);
  // 2. Estado em memória
  for (let i = localState.length - 1; i >= 0; i--) {
    if (idSet.has(localState[i].spotify_track_id)) localState.splice(i, 1);
  }
  // 3. Resequenciar posições
  await resequenceLocal(supabase, playlistId, localState);
}

async function applyLocalInsert(
  supabase: any,
  playlistId: string,
  localState: Array<{ id: string | null; spotify_track_id: string; position: number }>,
  trackId: string,
  position: number,
) {
  const idx = Math.max(0, Math.min(localState.length, position));
  // Se já existir, é deduplicação — não dupla. Apenas reposiciona.
  const existing = localState.findIndex((r) => r.spotify_track_id === trackId);
  if (existing >= 0) {
    const [row] = localState.splice(existing, 1);
    localState.splice(idx > existing ? idx - 1 : idx, 0, row);
    await resequenceLocal(supabase, playlistId, localState);
    return;
  }
  // Shift posições >= idx em memória
  localState.splice(idx, 0, { id: null, spotify_track_id: trackId, position: idx });
  // Insert no banco (metadata virá via post_executor_sync)
  const nowIso = new Date().toISOString();
  const { data: ins, error } = await supabase
    .from("managed_playlist_tracks")
    .insert({
      playlist_id: playlistId,
      spotify_track_id: trackId,
      position: idx,
      snapshot_at: nowIso,
      added_at: nowIso,
    })
    .select("id")
    .maybeSingle();
  if (error) throw new Error(`insert: ${error.message}`);
  if (ins?.id) localState[idx].id = ins.id;
  await resequenceLocal(supabase, playlistId, localState);
}

async function applyLocalReposition(
  supabase: any,
  playlistId: string,
  localState: Array<{ id: string | null; spotify_track_id: string; position: number }>,
  trackId: string,
  insertBefore: number,
) {
  const cur = localState.findIndex((r) => r.spotify_track_id === trackId);
  if (cur < 0) return; // nada a fazer localmente
  const target = Math.max(0, Math.min(localState.length, insertBefore));
  if (cur === target) return;
  const [row] = localState.splice(cur, 1);
  const insertIdx = cur < target ? target - 1 : target;
  localState.splice(insertIdx, 0, row);
  await resequenceLocal(supabase, playlistId, localState);
}

async function applyLocalReplace(
  supabase: any,
  playlistId: string,
  localState: Array<{ id: string | null; spotify_track_id: string; position: number }>,
  trackId: string,
) {
  // Spotify replacePlaylistTracks substitui o conteúdo inteiro pelas URIs passadas.
  // Aqui sempre passamos uma única URI, então o resultado local é: 1 faixa só.
  const { error: delErr } = await supabase
    .from("managed_playlist_tracks")
    .delete()
    .eq("playlist_id", playlistId);
  if (delErr) throw new Error(`replace_delete: ${delErr.message}`);
  localState.length = 0;
  const nowIso = new Date().toISOString();
  const { data: ins, error } = await supabase
    .from("managed_playlist_tracks")
    .insert({
      playlist_id: playlistId,
      spotify_track_id: trackId,
      position: 0,
      snapshot_at: nowIso,
      added_at: nowIso,
    })
    .select("id")
    .maybeSingle();
  if (error) throw new Error(`replace_insert: ${error.message}`);
  localState.push({ id: ins?.id ?? null, spotify_track_id: trackId, position: 0 });
}

async function markOps(
  supabase: any,
  ids: string[],
  status: "done" | "error" | "skipped",
  error: string | null,
) {
  if (ids.length === 0) return;
  const patch: any = {
    op_status: status,
    executed_at: new Date().toISOString(),
    error,
  };
  // attempts++ atomicamente via RPC seria ideal; aqui basta marcar.
  await supabase.from("occupancy_plan_ops").update(patch).in("id", ids);
}

async function finalize(
  supabase: any,
  planId: string,
  status: "executed" | "partial" | "failed" | "skipped",
  stats: Record<string, unknown>,
) {
  await supabase
    .from("occupancy_plans")
    .update({
      executor_status: status,
      executed_at: new Date().toISOString(),
      executor_stats: stats,
      spotify_snapshot_id: (stats as any).last_snapshot_id ?? null,
      executor_error: status === "failed" ? (stats as any).error ?? null : null,
    })
    .eq("id", planId);
  return { plan_id: planId, executor_status: status, stats };
}
