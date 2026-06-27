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
  // Lê também os limites de rate limit interno (por execução = por minuto).
  const { data: flagRow } = await supabase
    .from("system_flags")
    .select("occupancy_engine_mode, catalog_executor_per_minute_limit, occupancy_executor_per_minute_limit")
    .limit(1)
    .maybeSingle();
  const flag = String(flagRow?.occupancy_engine_mode ?? "shadow").toLowerCase();
  if (flag !== "dual_write" && flag !== "primary") {
    return jr({ ok: true, skipped: true, reason: "engine_mode_shadow", flag });
  }

  // ── RATE LIMIT INTERNO ─────────────────────────────────────────────────────
  // O executor roda a cada 1 minuto via cron. Para evitar rajadas (ex.: drenar
  // 327 backlog num único tick após virada de dia ou aumento de cota), cada
  // execução processa no máximo N placements / M planos. O backlog é drenado
  // de forma constante ao longo do dia, respeitando também o cap diário
  // global (`catalog_max_daily_distributions`).
  const PLAN_PER_MIN_DEFAULT = 5;
  const PLACEMENTS_PER_MIN_DEFAULT = 10;
  const planPerMin = Math.max(
    1,
    Math.min(25, Number((flagRow as any)?.occupancy_executor_per_minute_limit ?? PLAN_PER_MIN_DEFAULT)),
  );
  const placementsPerMin = Math.max(
    1,
    Math.min(50, Number((flagRow as any)?.catalog_executor_per_minute_limit ?? PLACEMENTS_PER_MIN_DEFAULT)),
  );

  // Override manual permitido apenas via body — útil pra debug/replays
  // pontuais. Continua limitado ao teto absoluto pra impedir uso indevido.
  let limit = planPerMin;
  let placementsLimit = placementsPerMin;
  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    if (typeof body?.limit === "number") {
      limit = Math.max(1, Math.min(25, body.limit));
    }
    if (typeof body?.placements_limit === "number") {
      placementsLimit = Math.max(1, Math.min(50, body.placements_limit));
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

  // ── ETAPA 2 — Consumir catalog_placements (pending/retry) diretamente.
  // O executor passa a ser a ÚNICA fonte da transição pending → active.
  // Respeita OAuth, circuit breaker, pacing (scheduled_for) e a quota diária
  // já compartilhada via fn_occupancy_claim_executable_plans /
  // claim_next_catalog_placements (mesma janela em system_flags).
  // O `placementsLimit` é o teto POR EXECUÇÃO (rate limit interno), não por dia.
  const placementsReport = await runCatalogPlacements(supabase, placementsLimit)
    .catch((e) => ({ ok: false, error: e?.message ?? String(e) }));

  return jr({
    ok: true,
    mode: flag,
    claimed: plans.length,
    duration_ms: Date.now() - t0,
    rate_limit: { plan_per_min: limit, placements_per_min: placementsLimit },
    results,
    placements: placementsReport,
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

// ============================================================================
// ETAPA 2 — Catalog Placements runner (pending → Spotify → active).
//
// Fonte ÚNICA da transição pending → active. NÃO existe componente intermediário.
// Reusa claim_next_catalog_placements (mesma quota diária global). Aplica:
//   - Pré-flight circuit breaker (sem chamada Spotify).
//   - Pré-check local (managed_playlist_tracks).
//   - OAuth do owner (com getUserToken) — sem fallback CC para escrita privada.
//   - Política normal de retry / skip / failed (sem dupla criação).
//   - Write-through local após sucesso.
// ============================================================================

type CPRow = {
  id: string;
  catalog_track_id: string;
  managed_playlist_id: string;
  position: number | null;
  attempts: number;
  max_attempts: number;
};

type CPEnriched = CPRow & {
  spotify_playlist_id: string;
  owner_spotify_user_id: string | null;
  tracks_count: number | null;
  spotify_track_id: string;
  spotify_uri: string | null;
};

function _trim(s: string | null | undefined, max = 480): string | null {
  if (s == null) return null;
  const str = String(s);
  return str.length > max ? str.slice(0, max) : str;
}

async function runCatalogPlacements(sb: any, limit: number) {
  const workerId = `occ-exec-cp-${crypto.randomUUID().slice(0, 8)}`;
  const t0 = Date.now();

  const { data: claimed, error: claimErr } = await sb.rpc(
    "claim_next_catalog_placements",
    { _worker: workerId, _limit: limit },
  );
  if (claimErr) return { ok: false, error: `claim_failed: ${claimErr.message}` };

  const rows: CPRow[] = (claimed ?? []).map((r: any) => ({
    id: r.id,
    catalog_track_id: r.catalog_track_id,
    managed_playlist_id: r.managed_playlist_id,
    position: r.position,
    attempts: r.attempts ?? 1,
    max_attempts: r.max_attempts ?? 5,
  }));

  if (rows.length === 0) {
    return { ok: true, worker_id: workerId, claimed: 0, duration_ms: Date.now() - t0 };
  }

  const trackIds = Array.from(new Set(rows.map((r) => r.catalog_track_id)));
  const playlistIds = Array.from(new Set(rows.map((r) => r.managed_playlist_id)));

  const [{ data: tracks, error: tErr }, { data: playlists, error: pErr }] = await Promise.all([
    sb.from("catalog_tracks")
      .select("id, spotify_track_id, spotify_uri")
      .in("id", trackIds),
    sb.from("managed_playlists")
      .select("id, spotify_playlist_id, owner_spotify_user_id, tracks_count, operational_status, execution_mode")
      .in("id", playlistIds),
  ]);

  if (tErr || pErr) {
    await sb.from("catalog_placements")
      .update({ status: "pending", locked_at: null, locked_by: null, lease_expires_at: null })
      .in("id", rows.map((r) => r.id));
    return { ok: false, error: `enrich_failed: ${tErr?.message ?? pErr?.message}` };
  }

  const tMap = new Map<string, any>();
  for (const t of tracks ?? []) tMap.set(t.id, t);
  const pMap = new Map<string, any>();
  for (const p of playlists ?? []) pMap.set(p.id, p);

  const enriched: CPEnriched[] = [];
  let cntInvalid = 0;
  let cntPlaylistBlocked = 0;

  for (const r of rows) {
    const t = tMap.get(r.catalog_track_id);
    const p = pMap.get(r.managed_playlist_id);
    if (!t?.spotify_track_id || !p?.spotify_playlist_id) {
      // BLINDAGEM: dados inconsistentes não voltam para a fila.
      cntInvalid++;
      await sb.from("catalog_placements").update({
        status: "blocked",
        skip_reason: "enrich_missing",
        skipped_at: new Date().toISOString(),
        last_error_code: "enrich_missing",
        removed_reason: "blocked: enrich_missing (catalog_track ou managed_playlist ausente)",
        locked_at: null, locked_by: null, lease_expires_at: null,
      }).eq("id", r.id);
      continue;
    }
    if (p.operational_status === "do_not_operate" || p.execution_mode === "MANUAL_ONLY" || p.execution_mode === "DISABLED") {
      // BLINDAGEM: playlist não operável → bloqueio definitivo.
      // Não deve voltar à fila enquanto execution_mode/operational_status não mudar.
      cntPlaylistBlocked++;
      await sb.from("catalog_placements").update({
        status: "blocked",
        skip_reason: "playlist_not_operable",
        skipped_at: new Date().toISOString(),
        last_error_code: "playlist_not_operable",
        removed_reason: `blocked: playlist_not_operable (op=${p.operational_status} mode=${p.execution_mode})`,
        locked_at: null, locked_by: null, lease_expires_at: null,
      }).eq("id", r.id);
      continue;
    }
    enriched.push({
      ...r,
      spotify_playlist_id: p.spotify_playlist_id,
      owner_spotify_user_id: p.owner_spotify_user_id ?? null,
      tracks_count: typeof p.tracks_count === "number" ? p.tracks_count : null,
      spotify_track_id: t.spotify_track_id,
      spotify_uri: t.spotify_uri ?? null,
    });
  }

  // Caches por execução.
  const tokenCache = new Map<string, string>();
  async function tokenFor(ownerId: string | null): Promise<string> {
    const key = ownerId ?? "__default__";
    const cached = tokenCache.get(key);
    if (cached) return cached;
    if (!ownerId) {
      // Sem owner → sem OAuth → fallback CC só funciona para playlist própria do app.
      const tok = await getAppToken();
      tokenCache.set(key, tok);
      return tok;
    }
    const r = await getUserToken(ownerId);
    tokenCache.set(key, r.token);
    return r.token;
  }

  const ownerAppCache = new Map<string, string | null>();
  async function appIdForOwner(ownerId: string | null): Promise<string | null> {
    const key = ownerId ?? "__default__";
    if (ownerAppCache.has(key)) return ownerAppCache.get(key) ?? null;
    if (!ownerId) { ownerAppCache.set(key, null); return null; }
    const { data } = await sb.from("spotify_user_tokens")
      .select("app_id").eq("spotify_user_id", ownerId).maybeSingle();
    const v = (data?.app_id as string | null) ?? null;
    ownerAppCache.set(key, v);
    return v;
  }

  type BreakerState = { open: boolean; blocked_until: string | null };
  const breakerCache = new Map<string, BreakerState>();
  async function breakerFor(appId: string | null): Promise<BreakerState> {
    const key = appId ?? "__global__";
    if (breakerCache.has(key)) return breakerCache.get(key)!;
    if (!appId) { const v = { open: false, blocked_until: null }; breakerCache.set(key, v); return v; }
    const { data } = await sb.from("spotify_circuit_breaker")
      .select("status, blocked_until").eq("app_id", appId).maybeSingle();
    const blockedFuture = !!data?.blocked_until && new Date(data.blocked_until).getTime() > Date.now();
    const v: BreakerState = {
      open: data?.status === "open" || blockedFuture,
      blocked_until: data?.blocked_until ?? null,
    };
    breakerCache.set(key, v);
    return v;
  }

  async function localHas(playlistId: string, trackId: string): Promise<boolean> {
    const { data, error } = await sb.from("managed_playlist_tracks")
      .select("id").eq("playlist_id", playlistId).eq("spotify_track_id", trackId)
      .limit(1).maybeSingle();
    if (error) return false;
    return !!data;
  }

  async function persistLocal(playlistId: string, trackId: string, _position?: number | null) {
    // IMPORTANTE: Não gravar mais posição estimada. O executor apenas registra a
    // existência local da track (para deduplicação rápida). A coluna `position`
    // permanece NULL e só é preenchida pelo `sync-managed-playlist-tracks`, que
    // confirma a posição real no Spotify. (Decisão de 27/06 — eliminar divergência
    // observada entre posição estimada e posição real.)
    await sb.from("managed_playlist_tracks")
      .upsert({
        playlist_id: playlistId,
        spotify_track_id: trackId,
        added_at: new Date().toISOString(),
      }, { onConflict: "playlist_id,spotify_track_id", ignoreDuplicates: true })
      .then(() => {}, () => {});
    return null;
  }

  function classify(err: any): { kind: "retry" | "fatal" | "circuit" | "skip"; code: string; skipReason?: string; skipDelaySec?: number } {
    const status: number | null = typeof err?.status === "number" ? err.status : null;
    const name = err?.name as string | undefined;
    const msg = String(err?.message ?? err ?? "");
    const low = msg.toLowerCase();
    if (name === "SpotifyCircuitOpenError") return { kind: "circuit", code: "spotify_circuit_open" };
    if (name === "SpotifyAuthInvalidError") return { kind: "skip", code: "spotify_auth_invalid", skipReason: "owner_token_invalid", skipDelaySec: 3600 };
    if (low.includes("nenhuma conta spotify") || low.includes("no spotify account") || low.includes("no refresh token")) {
      return { kind: "skip", code: "owner_token_missing", skipReason: "blocked_owner_token", skipDelaySec: 6 * 3600 };
    }
    if (low.includes("spotify refresh ") || low.includes("invalid_grant")) {
      return { kind: "skip", code: "spotify_refresh_failed", skipReason: "owner_token_invalid", skipDelaySec: 3600 };
    }
    if (status === 429) return { kind: "retry", code: "spotify_429" };
    if (status != null && status >= 500 && status < 600) return { kind: "retry", code: `spotify_${status}` };
    if (status === 400 && low.includes("index out of bounds")) {
      return { kind: "skip", code: "spotify_position_oob", skipReason: "position_out_of_bounds", skipDelaySec: 300 };
    }
    if (status === 400) return { kind: "fatal", code: "spotify_400" };
    if (status === 401) return { kind: "skip", code: "spotify_401", skipReason: "owner_token_invalid", skipDelaySec: 1800 };
    if (status === 403) return { kind: "skip", code: "spotify_403", skipReason: "owner_forbidden", skipDelaySec: 3600 };
    if (status === 404) return { kind: "skip", code: "spotify_404", skipReason: "playlist_unavailable", skipDelaySec: 6 * 3600 };
    if (low.includes("timeout") || low.includes("network") || low.includes("fetch failed")) return { kind: "retry", code: "network_error" };
    return { kind: "fatal", code: status ? `spotify_${status}` : "exception" };
  }

  let cntActive = 0, cntAlready = 0, cntRetry = 0, cntFailed = 0;
  let cntCircuit = 0, cntSkipped = 0, cntBlocked = 0, cntSpotify = 0, cntLocalHit = 0;

  // BLINDAGEM: códigos de erro PERMANENTES — não recuperáveis sem ação humana
  // (regularizar OAuth do dono, alterar execution_mode, corrigir dados).
  // Para esses códigos, cada tentativa CONTA e ao atingir max_attempts o
  // placement é definitivamente marcado como `blocked` e sai da fila.
  const PERMANENT_ERROR_CODES = new Set([
    "owner_token_missing",
    "spotify_401",
    "spotify_auth_invalid",
    "spotify_refresh_failed",
    "blocked_owner_token",
  ]);

  async function logExec(p: CPEnriched, outcome: string, code: string | null, snapId: string | null, msg: string | null) {
    await sb.from("catalog_placement_execution_log").insert({
      placement_id: p.id,
      catalog_track_id: p.catalog_track_id,
      managed_playlist_id: p.managed_playlist_id,
      spotify_playlist_id: p.spotify_playlist_id,
      spotify_track_id: p.spotify_track_id,
      position: p.position,
      outcome,
      error_code: code,
      error_message: _trim(msg),
      snapshot_id: snapId,
    });
  }

  async function markActive(p: CPEnriched, source: string, snap: string | null, usedPos: number | null) {
    let finalPos = usedPos;
    if (finalPos == null && typeof p.tracks_count === "number") finalPos = p.tracks_count;
    const upd: Record<string, unknown> = {
      status: "active",
      added_at: new Date().toISOString(),
      last_error_code: null,
      locked_at: null, locked_by: null, lease_expires_at: null,
    };
    if (finalPos !== null) upd.position = finalPos;
    await sb.from("catalog_placements").update(upd).eq("id", p.id);
    await logExec(p, source === "local_hit" ? "already_present" : "active", null, snap, `source=${source} pos=${finalPos ?? "?"}`);
    if (source === "local_hit") cntAlready++; else cntActive++;
  }

  async function markRetry(p: CPEnriched, code: string, msg: string | null) {
    if (p.attempts >= p.max_attempts) {
      await markFailed(p, code, msg ?? "max_attempts_reached");
      return;
    }
    const sec = backoffSecondsForAttempt(p.attempts);
    await sb.from("catalog_placements").update({
      status: "retry",
      scheduled_for: new Date(Date.now() + sec * 1000).toISOString(),
      last_error_code: code,
      locked_at: null, locked_by: null, lease_expires_at: null,
    }).eq("id", p.id);
    await logExec(p, "skipped", code, null, `retry in ${sec}s: ${msg ?? ""}`);
    cntRetry++;
  }

  async function markFailed(p: CPEnriched, code: string, msg: string | null) {
    await sb.from("catalog_placements").update({
      status: "failed",
      last_error_code: code,
      removed_reason: _trim(`${code}: ${msg ?? ""}`),
      locked_at: null, locked_by: null, lease_expires_at: null,
    }).eq("id", p.id);
    await logExec(p, "failed", code, null, msg);
    cntFailed++;
  }

  async function markBlocked(p: CPEnriched, code: string, reason: string, msg: string | null) {
    cntBlocked++;
    await sb.from("catalog_placements").update({
      status: "blocked",
      skip_reason: reason,
      skipped_at: new Date().toISOString(),
      last_error_code: code,
      removed_reason: _trim(`blocked after ${p.attempts}/${p.max_attempts} attempts: ${code} ${msg ?? ""}`),
      locked_at: null, locked_by: null, lease_expires_at: null,
    }).eq("id", p.id);
    await logExec(p, "failed", code, null, `BLOCKED reason=${reason} attempts=${p.attempts}/${p.max_attempts} ${msg ?? ""}`);
  }

  async function markSkipped(p: CPEnriched, code: string, reason: string, delaySec: number, msg: string | null) {
    const isPermanent = PERMANENT_ERROR_CODES.has(code);

    // BLINDAGEM — erros permanentes:
    //   - INCREMENTAM attempts (em vez de decrementar como antes, o que
    //     gerava loops infinitos: claim 'skipped' não incrementa, e o
    //     decremento mantinha attempts congelado, fazendo a playlist
    //     consumir cota indefinidamente, ex.: incidente 25/06 / BIA FRAZZO).
    //   - Ao atingir max_attempts, vão para `blocked` e saem da fila.
    if (isPermanent) {
      const nextAttempts = (p.attempts ?? 1) + 1;
      if (nextAttempts >= p.max_attempts) {
        await markBlocked(p, code, reason, msg);
        return;
      }
      cntSkipped++;
      await sb.from("catalog_placements").update({
        status: "skipped",
        skip_reason: reason,
        skipped_at: new Date().toISOString(),
        scheduled_for: new Date(Date.now() + Math.max(60, delaySec) * 1000).toISOString(),
        last_error_code: code,
        attempts: nextAttempts,
        locked_at: null, locked_by: null, lease_expires_at: null,
      }).eq("id", p.id);
      await logExec(p, "skipped", code, null, `permanent reason=${reason} attempts=${nextAttempts}/${p.max_attempts} ${msg ?? ""}`);
      return;
    }

    // Erros transitórios mantidos no comportamento atual (não consomem
    // tentativa — voltam a ser claimados após `delaySec`).
    cntSkipped++;
    await sb.from("catalog_placements").update({
      status: "skipped",
      skip_reason: reason,
      skipped_at: new Date().toISOString(),
      scheduled_for: new Date(Date.now() + Math.max(60, delaySec) * 1000).toISOString(),
      last_error_code: code,
      attempts: Math.max(0, (p.attempts ?? 1) - 1),
      locked_at: null, locked_by: null, lease_expires_at: null,
    }).eq("id", p.id);
    await logExec(p, "skipped", code, null, `reason=${reason} ${msg ?? ""}`);
  }

  async function markWaitingCircuit(p: CPEnriched, blockedUntil: string | null) {
    cntCircuit++;
    const resumeAt = blockedUntil ?? new Date(Date.now() + 15 * 60 * 1000).toISOString();
    await sb.from("catalog_placements").update({
      status: "waiting_circuit_breaker",
      scheduled_for: resumeAt,
      last_error_code: "circuit_breaker_open",
      locked_at: null, locked_by: null, lease_expires_at: null,
    }).eq("id", p.id);
    await logExec(p, "skipped", "waiting_circuit_breaker", null, `blocked_until=${blockedUntil ?? "n/a"} resume_at=${resumeAt}`);
  }

  for (const p of enriched) {
    try {
      // Pré-flight breaker
      const appId = await appIdForOwner(p.owner_spotify_user_id);
      const br = await breakerFor(appId);
      if (br.open) { await markWaitingCircuit(p, br.blocked_until); continue; }

      // Pré-check local
      if (await localHas(p.managed_playlist_id, p.spotify_track_id)) {
        cntLocalHit++;
        const { data: row } = await sb.from("managed_playlist_tracks")
          .select("position").eq("playlist_id", p.managed_playlist_id)
          .eq("spotify_track_id", p.spotify_track_id).maybeSingle();
        await markActive(p, "local_hit", null, typeof row?.position === "number" ? row.position : null);
        continue;
      }

      // Spotify INSERT
      setSpotifyCtx({
        appId: null,
        playlist_id: p.managed_playlist_id,
        owner_id: p.owner_spotify_user_id,
        spotify_user_id: p.owner_spotify_user_id,
        function_name: "occupancy-executor:cp",
      });
      const token = await tokenFor(p.owner_spotify_user_id);

      const uri = p.spotify_uri ?? `spotify:track:${p.spotify_track_id}`;
      const insertOpts: { position?: number } = {};
      if (typeof p.position === "number" && p.position >= 0) {
        const safeMax = typeof p.tracks_count === "number" ? p.tracks_count : p.position;
        insertOpts.position = Math.min(p.position, Math.max(0, safeMax));
      }
      const addRes = await addPlaylistTracks(p.spotify_playlist_id, [uri], token, insertOpts);
      cntSpotify++;

      await persistLocal(p.managed_playlist_id, p.spotify_track_id);
      // position fica NULL em catalog_placements; será preenchida pelo sync subsequente
      await markActive(p, "spotify_post", addRes.snapshot_id ?? null, null);
    } catch (e: any) {
      const cls = classify(e);
      const msg = _trim(e?.message ?? String(e));
      if (cls.kind === "circuit") {
        const appId = await appIdForOwner(p.owner_spotify_user_id);
        const br = await breakerFor(appId);
        await markWaitingCircuit(p, br.blocked_until);
      } else if (cls.kind === "retry") {
        await markRetry(p, cls.code, msg);
      } else if (cls.kind === "skip") {
        await markSkipped(p, cls.code, cls.skipReason ?? "recoverable", cls.skipDelaySec ?? 1800, msg);
        if ((cls.code === "spotify_401" || cls.code === "spotify_auth_invalid") && p.owner_spotify_user_id) {
          tokenCache.delete(p.owner_spotify_user_id);
        }
      } else {
        await markFailed(p, cls.code, msg);
      }
    }
  }

  return {
    ok: true,
    worker_id: workerId,
    claimed: rows.length,
    invalid: cntInvalid,
    playlist_blocked: cntPlaylistBlocked,
    active: cntActive,
    already_present: cntAlready,
    retry: cntRetry,
    failed: cntFailed,
    skipped: cntSkipped,
    blocked: cntBlocked,
    waiting_circuit_breaker: cntCircuit,
    local_hits: cntLocalHit,
    spotify_calls: cntSpotify,
    duration_ms: Date.now() - t0,
  };
}
