// apply-playlist-plan — executa o plano de manutenção do último diagnóstico
// via Spotify Web API, UMA AÇÃO POR VEZ, recalculando o estado real entre cada.
//
// Body: {
//   playlist_id: string (managed_playlists.id),
//   action: "remove" | "demote" | "promote" | "add" | "all",
//   limit_add?: number (default 15, max 50),
//   stream?: boolean (default true) — se true, retorna text/event-stream com
//     progresso por ação; se false, retorna JSON final ao terminar.
// }
//
// Ordem do "all": removes → promotes (topo → baixo por target) →
//   demotes (baixo → topo por target) → adds. Entre cada ação, a playlist é
//   re-listada via Spotify e os índices recalculados sobre o estado real.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { requireTeamAccess } from "../_shared/auth.ts";
import { getUserAccessToken, getSpotifyToken } from "../_shared/spotify.ts";
import {
  addPlaylistTracks,
  findPlaylistTrackIndex,
  getPlaylistMeta,
  listPlaylistTrackRefs,
  removePlaylistTracks,
  reorderPlaylistTracks,
  type PlaylistTrackRef,
} from "../_shared/spotify-playlist.ts";
import {
  acquirePlaylistLock,
  finishPlaylistOperation,
  formatPlaylistError,
  releasePlaylistLock,
  lockedResponseBody,
} from "../_shared/playlist-lock.ts";


const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

type Action = "remove" | "demote" | "promote" | "add" | "all";
type StepKind = "remove" | "promote" | "demote" | "add";

type PlanStep = {
  kind: StepKind;
  spotify_track_id: string;
  name: string | null;
  target_position?: number | null;
  source_position?: number | null;
};

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function syncManagedSnapshot(playlistId: string) {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/sync-managed-playlist-tracks`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SERVICE_KEY}`,
      apikey: SERVICE_KEY,
    },
    body: JSON.stringify({ playlist_id: playlistId, skip_lock: true }),
  });
  const txt = await r.text();
  let body: any = null;
  try { body = JSON.parse(txt); } catch { /* */ }
  return { ok: r.ok && body?.ok !== false, total: body?.total ?? null, error: body?.error ?? txt };
}

function describeStep(s: PlanStep, idx0: number): string {
  const name = s.name ?? s.spotify_track_id;
  switch (s.kind) {
    case "remove":  return `Removendo "${name}"`;
    case "promote": return `Promovendo "${name}" para #${(s.target_position ?? 0) + 1}`;
    case "demote":  return `Rebaixando "${name}" para #${(s.target_position ?? 0) + 1}`;
    case "add":     return `Adicionando "${name}"`;
  }
}

// Fase 8.3 — persiste snapshot da execução do plano (somente action="all" com payload do frontend)
async function persistExecutionSnapshot(args: {
  supabase: any;
  playlistId: string;
  executedBy: string | null;
  payload: any;
  results: any[];
}) {
  const { supabase, playlistId, executedBy, payload, results } = args;
  if (!payload || typeof payload !== "object") return;
  const baseline = payload.baseline ?? {};
  const projected = payload.projected ?? {};
  const num = (v: any) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const countOp = (kind: string) =>
    results.filter((r: any) => r.kind === kind && r.ok !== false && !r.skipped).length;

  try {
    // Supersede pendings anteriores da mesma playlist (não apaga histórico)
    await supabase
      .from("plan_execution_snapshots")
      .update({
        status: "superseded",
        evaluation_notes: "Substituído por execução posterior",
      })
      .eq("playlist_id", playlistId)
      .eq("status", "pending");

    const { error } = await supabase.from("plan_execution_snapshots").insert({
      playlist_id: playlistId,
      diagnosis_id: payload.diagnosis_id ?? null,
      executed_by: executedBy,
      baseline_benchmark_tracks:   num(baseline.benchmark_tracks),
      baseline_ratio_to_benchmark: num(baseline.ratio_to_benchmark),
      baseline_size:               Number.isFinite(baseline.size) ? Math.round(baseline.size) : null,
      baseline_saturation_avg:     num(baseline.saturation_avg),
      baseline_dominant_artists:   Number.isFinite(baseline.dominant_artists) ? Math.round(baseline.dominant_artists) : null,
      baseline_headroom_pct:       num(baseline.headroom_pct),
      projected_benchmark_delta:        num(projected.benchmark_delta),
      projected_artist_delta:           num(projected.artist_delta),
      projected_coverage_delta_pp:      num(projected.coverage_delta_pp),
      projected_saturation_delta_pp:    num(projected.saturation_delta_pp),
      projected_concentration_delta_pp: num(projected.concentration_delta_pp),
      projected_size_delta:             num(projected.size_delta),
      projected_headroom_delta_pp:      num(projected.headroom_delta_pp),
      projected_confidence:             typeof projected.confidence === "string" ? projected.confidence : null,
      ops_add:     countOp("add"),
      ops_remove:  countOp("remove"),
      ops_promote: countOp("promote"),
      ops_demote:  countOp("demote"),
      status: "pending",
    });
    if (error) console.error("[apply-playlist-plan] snapshot insert error:", error.message);
  } catch (e) {
    console.error("[apply-playlist-plan] snapshot persistence failed:", e);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const guard = await requireTeamAccess(req);
  if (!guard.ok) return guard.resp;

  let body: any;
  try { body = await req.json(); } catch { return jr({ ok: false, error: "Invalid JSON" }, 400); }
  const playlistId: string = body?.playlist_id;
  const action: Action = (body?.action ?? "all") as Action;
  const limitAdd: number = Math.max(1, Math.min(Number(body?.limit_add ?? 15), 50));
  const stream: boolean = body?.stream !== false; // default true
  const snapshotPayload: any = body?.snapshot_payload ?? null;
  const executedBy: string | null = guard.via === "user" ? (guard.userId ?? null) : null;
  if (!playlistId) return jr({ ok: false, error: "playlist_id obrigatório" }, 400);
  if (!["remove", "demote", "promote", "add", "all"].includes(action)) {
    return jr({ ok: false, error: "action inválida" }, 400);
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  // 1) Managed playlist
  const { data: pl } = await supabase
    .from("managed_playlists")
    .select("id, spotify_playlist_id, name, tracks_count, lifecycle_phase, owner_spotify_user_id")
    .eq("id", playlistId)
    .maybeSingle();
  if (!pl?.spotify_playlist_id) return jr({ ok: false, error: "playlist sem spotify_playlist_id" }, 404);

  // 2) Último diagnóstico
  const { data: diag } = await supabase
    .from("playlist_diagnoses")
    .select("id, tracks_analysis, tracks_suggestions, raw, created_at")
    .eq("playlist_id", pl.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!diag) return jr({ ok: false, error: "sem diagnóstico — rode a análise primeiro" }, 400);

  const analysis: any[] = Array.isArray(diag.tracks_analysis) ? diag.tracks_analysis : [];
  const suggestions: any[] = Array.isArray(diag.tracks_suggestions) ? diag.tracks_suggestions : [];
  const caps = (diag as any).raw?.applied_caps ?? null;

  let removeItems = analysis.filter((t) => t.status === "remove" && t.spotify_track_id)
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  let demoteItems = analysis.filter((t) => t.status === "demote" && t.spotify_track_id)
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  let promoteItems = analysis.filter((t) => t.status === "promote" && t.spotify_track_id)
    .sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0));

  if (caps) {
    if (typeof caps.recommended_remove === "number") removeItems = removeItems.slice(0, caps.recommended_remove);
    if (typeof caps.recommended_demote === "number") demoteItems = demoteItems.slice(0, caps.recommended_demote);
    if (typeof caps.recommended_promote === "number") promoteItems = promoteItems.slice(0, caps.recommended_promote);
  }
  // Bug A: capped_suggestions é o teto máximo de adições calculado pelo diagnóstico.
  // limitAdd do request nunca pode exceder esse cap.
  let effectiveLimitAdd = limitAdd;
  if (caps && typeof caps.capped_suggestions === "number") {
    effectiveLimitAdd = Math.min(limitAdd, caps.capped_suggestions);
  }
  let addItems = suggestions.filter((s) => s.spotify_track_id).slice(0, effectiveLimitAdd);

  // Net-positive enforcement
  const phase = (pl as any).lifecycle_phase ?? "seed";
  if (action === "all" || action === "add" || action === "remove") {
    const netChange = addItems.length - removeItems.length;
    if (phase !== "bloated" && netChange < 0) {
      return jr({
        ok: false,
        error: `BLOCKED: ciclo net-negativo (${netChange}) só permitido em fase 'bloated'. Fase atual: '${phase}'.`,
        phase,
        additions: addItems.length,
        removals: removeItems.length,
      }, 409);
    }
    if (phase === "bloated" && (action === "all" || action === "add")) {
      addItems = [];
    }
  }

  // Bug B: em fase bloated, respeitar max_per_day de remoções consultando playlist_adjustments.
  let bloatedRemovedToday = 0;
  let bloatedMaxPerDay: number | null = null;
  let bloatedSkippedRemoves = false;
  if (phase === "bloated" && (action === "all" || action === "remove") && removeItems.length > 0) {
    const maxPerDay = Number(caps?.max_per_day);
    if (Number.isFinite(maxPerDay) && maxPerDay > 0) {
      bloatedMaxPerDay = maxPerDay;
      const startOfDay = new Date();
      startOfDay.setUTCHours(0, 0, 0, 0);
      const { data: todayAdj } = await supabase
        .from("playlist_adjustments")
        .select("details, action_type")
        .eq("spotify_playlist_id", pl.spotify_playlist_id)
        .gte("created_at", startOfDay.toISOString());
      bloatedRemovedToday = (todayAdj ?? []).reduce((sum: number, row: any) => {
        const n = Number(row?.details?.removed_count);
        return sum + (Number.isFinite(n) ? n : 0);
      }, 0);
      const remaining = Math.max(0, maxPerDay - bloatedRemovedToday);
      if (remaining <= 0) {
        console.warn(
          `[apply-playlist-plan] bloated max_per_day atingido (${bloatedRemovedToday}/${maxPerDay}) — pulando remoções para ${pl.spotify_playlist_id}`,
        );
        removeItems = [];
        bloatedSkippedRemoves = true;
      } else if (removeItems.length > remaining) {
        console.warn(
          `[apply-playlist-plan] bloated max_per_day: cortando remoções de ${removeItems.length} para ${remaining} (já removeu ${bloatedRemovedToday}/${maxPerDay} hoje)`,
        );
        removeItems = removeItems.slice(0, remaining);
      }
    }
  }

  // 3) OAuth token do dono — fonte de verdade: managed_playlists
  let ownerId = pl.owner_spotify_user_id as string | null;
  if (!ownerId) {
    // fallback: lê do Spotify
    try {
      const appToken = await getSpotifyToken();
      const meta = await getPlaylistMeta(pl.spotify_playlist_id, appToken, { fields: "owner(id)" });
      ownerId = meta.owner_id;
    } catch { /* */ }
  }
  let token: string;
  try {
    const r = await getUserAccessToken(ownerId ?? undefined);
    token = r.token;
  } catch (e) {
    return jr({
      ok: false,
      error: ownerId
        ? `conta do dono "${ownerId}" não está conectada. Conecte em Configurações → Spotify.`
        : `nenhuma conta Spotify conectada: ${(e as Error).message}`,
    }, 412);
  }

  const spId = pl.spotify_playlist_id;

  // Lock operacional: bloqueia escritas concorrentes em managed_playlist_tracks.
  const tracksBefore = (pl as any).tracks_count ?? null;
  const lock = await acquirePlaylistLock(supabase, pl.id, "MANUAL_EDITOR", tracksBefore);
  if (!lock.ok) return jr(lockedResponseBody(lock), 423);


  // 4) Monta o plano ordenado: removes → promotes (target asc) → demotes (target desc) → adds
  const steps: PlanStep[] = [];

  const wantRemove = action === "remove" || action === "all";
  const wantPromote = action === "promote" || action === "all";
  const wantDemote = action === "demote" || action === "all";
  const wantAdd = action === "add" || action === "all";

  if (wantRemove) {
    for (const t of removeItems) {
      steps.push({
        kind: "remove",
        spotify_track_id: String(t.spotify_track_id),
        name: t.name ?? t.track_name ?? null,
        source_position: Number.isFinite(t.position) ? Number(t.position) : null,
      });
    }
  }
  if (wantPromote) {
    const sorted = [...promoteItems].sort((a, b) => {
      const ta = Number.isFinite(a.target_position) ? Number(a.target_position) : 9999;
      const tb = Number.isFinite(b.target_position) ? Number(b.target_position) : 9999;
      return ta - tb; // topo primeiro
    });
    for (const t of sorted) {
      steps.push({
        kind: "promote",
        spotify_track_id: String(t.spotify_track_id),
        name: t.name ?? t.track_name ?? null,
        target_position: Number.isFinite(t.target_position) ? Number(t.target_position) : null,
        source_position: Number.isFinite(t.position) ? Number(t.position) : null,
      });
    }
  }
  if (wantDemote) {
    const sorted = [...demoteItems].sort((a, b) => {
      const ta = Number.isFinite(a.target_position) ? Number(a.target_position) : -1;
      const tb = Number.isFinite(b.target_position) ? Number(b.target_position) : -1;
      return tb - ta; // baixo primeiro
    });
    for (const t of sorted) {
      steps.push({
        kind: "demote",
        spotify_track_id: String(t.spotify_track_id),
        name: t.name ?? t.track_name ?? null,
        target_position: Number.isFinite(t.target_position) ? Number(t.target_position) : null,
        source_position: Number.isFinite(t.position) ? Number(t.position) : null,
      });
    }
  }
  if (wantAdd) {
    for (const s of addItems) {
      steps.push({
        kind: "add",
        spotify_track_id: String(s.spotify_track_id),
        name: s.name ?? s.track_name ?? null,
        target_position: Number.isFinite(s.suggested_position) ? Number(s.suggested_position) : 0,
      });
    }
  }

  // 5) Loop sequencial com recálculo entre cada ação
  const total = steps.length;
  const results: any[] = [];
  let snapshotId: string | null = null;
  let failedAt: number | null = null;
  let fatalError: string | null = null;

  // helper que executa uma step, devolvendo um result
  async function runStep(step: PlanStep, idx0: number): Promise<any> {
    // re-fetch estado real da playlist antes de cada ação
    const currentRefs: PlaylistTrackRef[] = await listPlaylistTrackRefs(spId, token);
    const total = currentRefs.length;
    const uri = `spotify:track:${step.spotify_track_id}`;

    if (step.kind === "remove") {
      const res = await removePlaylistTracks(spId, [uri], token);
      snapshotId = res?.snapshot_id ?? snapshotId;
      return { ok: true, kind: step.kind, removed: res.removed ?? 1, snapshot_size_before: total };
    }

    if (step.kind === "add") {
      const pos = Math.max(0, Math.min(Number(step.target_position ?? 0), total));
      const res = await addPlaylistTracks(spId, [uri], token, { position: pos });
      snapshotId = res?.snapshot_id ?? snapshotId;
      return { ok: true, kind: step.kind, added_at: pos, snapshot_size_before: total };
    }

    // promote / demote
    let idx = findPlaylistTrackIndex(currentRefs, uri);
    let index_source = "track_id";
    if (idx < 0 && Number.isFinite(step.source_position)) {
      idx = Math.max(0, Math.min(Number(step.source_position), total - 1));
      index_source = "diagnosis_position";
    }
    if (idx < 0) {
      return { ok: false, kind: step.kind, skipped: "not_found_in_playlist" };
    }
    const fallback = step.kind === "promote" ? 0 : Math.max(total - 1, 0);
    let target = Number.isFinite(step.target_position) ? Number(step.target_position) : fallback;
    target = Math.max(0, Math.min(target, total - 1));
    const insertBefore = idx < target ? Math.min(target + 1, total) : target;
    if (insertBefore === idx || insertBefore === idx + 1) {
      return { ok: true, kind: step.kind, skipped: "already_at_target", from: idx, target };
    }
    const res = await reorderPlaylistTracks(
      spId,
      { range_start: idx, insert_before: insertBefore, range_length: 1 },
      token,
    );
    snapshotId = res?.snapshot_id ?? snapshotId;
    const finalIdx = insertBefore > idx ? insertBefore - 1 : insertBefore;
    return { ok: true, kind: step.kind, from: idx, to: finalIdx, target, index_source };
  }

  // ============= Branch: STREAM (SSE) vs JSON =============
  if (stream) {
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      async start(controller) {
        const send = (evt: any) => {
          try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(evt)}\n\n`)); } catch { /* */ }
        };

        send({ type: "start", total, action, playlist_id: pl.id, spotify_playlist_id: spId });

        for (let i = 0; i < steps.length; i++) {
          const step = steps[i];
          send({
            type: "step",
            index: i + 1,
            total,
            status: "running",
            kind: step.kind,
            spotify_track_id: step.spotify_track_id,
            name: step.name,
            target_position: step.target_position ?? null,
            description: describeStep(step, i),
          });
          try {
            const res = await runStep(step, i);
            results.push({ ...step, ...res });
            send({
              type: "step",
              index: i + 1,
              total,
              status: res.skipped ? "skipped" : "done",
              kind: step.kind,
              spotify_track_id: step.spotify_track_id,
              name: step.name,
              target_position: step.target_position ?? null,
              detail: res,
            });
          } catch (e) {
            const msg = formatPlaylistError(e);
            failedAt = i + 1;
            fatalError = msg;
            results.push({ ...step, ok: false, error: msg });
            send({
              type: "step",
              index: i + 1,
              total,
              status: "failed",
              kind: step.kind,
              spotify_track_id: step.spotify_track_id,
              name: step.name,
              error: msg,
            });
            break;
          }
        }

        // sync local
        let syncRes: any = null;
        try { syncRes = await syncManagedSnapshot(pl.id); } catch (e) { syncRes = { ok: false, error: String(e) }; }

        // tracks count final
        let currentCount: number | null = syncRes?.total ?? null;
        if (currentCount === null) {
          try {
            const finalRefs = await listPlaylistTrackRefs(spId, token);
            currentCount = finalRefs.length;
            await supabase.from("managed_playlists")
              .update({ tracks_count: finalRefs.length, last_metrics_at: new Date().toISOString() })
              .eq("id", pl.id);
          } catch { /* */ }
        }

        // Bug B audit: registra remoções em playlist_adjustments (fase bloated) para
        // que o cap max_per_day seja respeitado em chamadas subsequentes no mesmo dia.
        const removedExecuted = results.filter((r: any) => r.kind === "remove" && r.ok !== false && !r.skipped).length;
        if (phase === "bloated" && removedExecuted > 0) {
          await supabase.from("playlist_adjustments").insert({
            template_id: pl.id,
            spotify_playlist_id: spId,
            action_type: `apply_remove_${removedExecuted}`,
            status: fatalError ? "failed" : "success",
            before: { tracks_count: tracksBefore },
            after: { tracks_count: currentCount },
            details: {
              source: "apply-playlist-plan",
              removed_count: removedExecuted,
              max_per_day: bloatedMaxPerDay,
              removed_today_before: bloatedRemovedToday,
              skipped_due_to_cap: bloatedSkippedRemoves,
            },
            triggered_by: "manual",
          });
        }

        await supabase.from("collection_logs").insert({
          acao: "apply-playlist-plan",
          status: fatalError ? "erro" : "sucesso",
          mensagem: `${spId} (${action}): ${results.length}/${total} executadas${fatalError ? ` — FAILED@${failedAt}: ${fatalError}` : ""}`,
        });

        // Fase 8.3 — persistir snapshot do plano executado (só "all", só se houve execução real)
        if (action === "all" && snapshotPayload && results.length > 0) {
          await persistExecutionSnapshot({
            supabase,
            playlistId: pl.id,
            executedBy,
            payload: snapshotPayload,
            results,
          });
        }

        send({
          type: "complete",
          ok: !fatalError,
          executed: results.length,
          total,
          failed_at: failedAt,
          error: fatalError,
          current_tracks_count: currentCount,
          snapshot_id: snapshotId,
          sync: syncRes,
          results,
        });

        if (lock.ok) {
          await finishPlaylistOperation(supabase, lock, {
            status: fatalError ? "failed" : "success",
            tracks_before: tracksBefore,
            tracks_after: currentCount ?? null,
            tracks_changed: results.filter((r: any) => r.ok !== false && !r.skipped).length,
            error: fatalError,
          });
          await releasePlaylistLock(supabase, lock);
        }

        controller.close();
      },
    });


    return new Response(body, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
      },
    });
  }

  // ============= Branch: JSON (non-stream, compat) =============
  for (let i = 0; i < steps.length; i++) {
    try {
      const res = await runStep(steps[i], i);
      results.push({ ...steps[i], ...res });
    } catch (e) {
      const msg = formatPlaylistError(e);
      failedAt = i + 1;
      fatalError = msg;
      results.push({ ...steps[i], ok: false, error: msg });
      break;
    }
  }

  const sync = await syncManagedSnapshot(pl.id).catch((e) => ({ ok: false, error: String(e), total: null }));
  let currentCount: number | null = (sync as any)?.total ?? null;
  if (currentCount === null) {
    try {
      const finalRefs = await listPlaylistTrackRefs(spId, token);
      currentCount = finalRefs.length;
      await supabase.from("managed_playlists")
        .update({ tracks_count: finalRefs.length, last_metrics_at: new Date().toISOString() })
        .eq("id", pl.id);
    } catch { /* */ }
  }

  const removedExecutedJson = results.filter((r: any) => r.kind === "remove" && r.ok !== false && !r.skipped).length;
  if (phase === "bloated" && removedExecutedJson > 0) {
    await supabase.from("playlist_adjustments").insert({
      template_id: pl.id,
      spotify_playlist_id: spId,
      action_type: `apply_remove_${removedExecutedJson}`,
      status: fatalError ? "failed" : "success",
      before: { tracks_count: tracksBefore },
      after: { tracks_count: currentCount },
      details: {
        source: "apply-playlist-plan",
        removed_count: removedExecutedJson,
        max_per_day: bloatedMaxPerDay,
        removed_today_before: bloatedRemovedToday,
        skipped_due_to_cap: bloatedSkippedRemoves,
      },
      triggered_by: "manual",
    });
  }

  await supabase.from("collection_logs").insert({
    acao: "apply-playlist-plan",
    status: fatalError ? "erro" : "sucesso",
    mensagem: `${spId} (${action}): ${results.length}/${steps.length} executadas${fatalError ? ` — FAILED@${failedAt}: ${fatalError}` : ""}`,
  });

  if (lock.ok) {
    await finishPlaylistOperation(supabase, lock, {
      status: fatalError ? "failed" : "success",
      tracks_before: tracksBefore,
      tracks_after: currentCount ?? null,
      tracks_changed: results.filter((r: any) => r.ok !== false && !r.skipped).length,
      error: fatalError,
    });
    await releasePlaylistLock(supabase, lock);
  }

  return jr({
    ok: !fatalError,
    action,
    executed: results.length,
    total: steps.length,
    failed_at: failedAt,
    error: fatalError,
    current_tracks_count: currentCount,
    snapshot_id: snapshotId,
    sync,
    results,
  });
});

