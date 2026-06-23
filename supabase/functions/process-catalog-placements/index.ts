// process-catalog-placements — Worker definitivo da fila do catálogo.
//
// FASE 6.C.4 — corrigido para eliminar consumo desnecessário da Spotify API:
//
//   1) Pré-flight do Circuit Breaker: antes de qualquer chamada Spotify,
//      consulta spotify_circuit_breaker do app vinculado ao owner. Se aberto,
//      marca o placement como `waiting_circuit_breaker` com scheduled_for =
//      blocked_until (sem chamar Spotify, sem incrementar attempts no claim).
//
//   2) Pré-check local: usa managed_playlist_tracks (cópia local mantida pelo
//      sync-managed-playlist-tracks) como fonte primária do anti-duplicidade.
//      Só vai à Spotify quando a faixa NÃO está no cache local.
//
//   3) Confirmação substituída por write-through local: ao receber snapshot_id
//      do POST, upsertamos a faixa em managed_playlist_tracks. O periodic sync
//      reconcilia eventuais ghost_adds em segundo plano. Eliminamos o GET de
//      confirmação que era a maior fonte de tráfego.
//
//   4) Sem reset de attempts. O caminho circuit_open antigo (attempts-1) virou
//      transição para waiting_circuit_breaker preservando attempts. O claim
//      também não incrementa attempts ao destravar uma linha desse estado.
//
//   5) Toda chamada/decisão recebe um correlation_id e é registrada com
//      `source` (local_hit, local_miss, cache_hit, spotify, waiting_*) no
//      execution_log para auditoria.
//
// Body opcional: { limit?: number }  (default 200, máx 500 — bate com claim cap)
// Não usa SELECT direto em catalog_placements WHERE status='pending'.

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  addPlaylistTracks,
} from "../_shared/spotify-playlist.ts";
import { getUserToken } from "../_shared/spotify-client.ts";
import { backoffSecondsForAttempt } from "../_shared/playlist-queue.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function trim(s: string | null | undefined, max = 480): string | null {
  if (s == null) return null;
  const str = String(s);
  return str.length > max ? str.slice(0, max) : str;
}

type ClaimedRow = {
  id: string;
  catalog_track_id: string;
  managed_playlist_id: string;
  position: number | null;
  attempts: number;
  max_attempts: number;
};

type Enriched = ClaimedRow & {
  spotify_playlist_id: string;
  owner_spotify_user_id: string | null;
  tracks_count: number | null;
  spotify_track_id: string;
  spotify_uri: string | null;
  track_name: string | null;
};

type Outcome = "active" | "already_present" | "retry" | "failed";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jr({ ok: false, error: "method_not_allowed" }, 405);

  const startedAt = Date.now();
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty body allowed */ }
  const rawLimit = Number(body?.limit ?? 200);
  const limit = Number.isFinite(rawLimit) ? Math.min(500, Math.max(1, Math.floor(rawLimit))) : 200;

  const workerId = `proc-cat-${crypto.randomUUID().slice(0, 8)}`;

  // 1) Claim atômico
  const { data: claimed, error: claimErr } = await sb.rpc(
    "claim_next_catalog_placements",
    { _worker: workerId, _limit: limit },
  );
  if (claimErr) {
    return jr({ ok: false, error: "claim_failed", message: claimErr.message }, 500);
  }

  const claimedRows: ClaimedRow[] = (claimed ?? []).map((r: any) => ({
    id: r.id,
    catalog_track_id: r.catalog_track_id,
    managed_playlist_id: r.managed_playlist_id,
    position: r.position,
    attempts: r.attempts ?? 1,
    max_attempts: r.max_attempts ?? 5,
  }));

  if (claimedRows.length === 0) {
    return jr({
      ok: true,
      worker_id: workerId,
      claimed: 0,
      processed: 0,
      active: 0,
      already_present: 0,
      retry: 0,
      failed: 0,
      circuit_open: 0,
      waiting_circuit_breaker: 0,
      local_hits: 0,
      spotify_calls: 0,
      duration_ms: Date.now() - startedAt,
    });
  }

  // 2) Enrich — busca playlists + tracks em duas queries IN (sem N+1).
  const trackIds = Array.from(new Set(claimedRows.map((r) => r.catalog_track_id)));
  const playlistIds = Array.from(new Set(claimedRows.map((r) => r.managed_playlist_id)));

  const [{ data: tracks, error: trackErr }, { data: playlists, error: plErr }] = await Promise.all([
    sb.from("catalog_tracks")
      .select("id, spotify_track_id, spotify_uri, track_name")
      .in("id", trackIds),
    sb.from("managed_playlists")
      .select("id, spotify_playlist_id, owner_spotify_user_id, tracks_count")
      .in("id", playlistIds),
  ]);
  if (trackErr || plErr) {
    // Não conseguimos enriquecer — devolve o claim pra fila pra próxima rodada.
    await sb.from("catalog_placements")
      .update({ status: "pending", locked_at: null, locked_by: null, lease_expires_at: null })
      .in("id", claimedRows.map((r) => r.id));
    return jr({
      ok: false,
      error: "enrich_failed",
      message: trackErr?.message ?? plErr?.message,
    }, 500);
  }

  const trackMap = new Map<string, any>();
  for (const t of tracks ?? []) trackMap.set(t.id, t);
  const plMap = new Map<string, any>();
  for (const p of playlists ?? []) plMap.set(p.id, p);

  const enriched: Enriched[] = [];
  const invalid: ClaimedRow[] = [];
  for (const r of claimedRows) {
    const t = trackMap.get(r.catalog_track_id);
    const p = plMap.get(r.managed_playlist_id);
    if (!t?.spotify_track_id || !p?.spotify_playlist_id) {
      invalid.push(r);
      continue;
    }
    enriched.push({
      ...r,
      spotify_playlist_id: p.spotify_playlist_id,
      owner_spotify_user_id: p.owner_spotify_user_id ?? null,
      tracks_count: typeof p.tracks_count === "number" ? p.tracks_count : null,
      spotify_track_id: t.spotify_track_id,
      spotify_uri: t.spotify_uri ?? null,
      track_name: typeof t.track_name === "string" ? t.track_name : null,
    });
  }


  // Inválidos (sem track/playlist no banco) → fatal direto.
  for (const r of invalid) {
    await sb.from("catalog_placements").update({
      status: "failed",
      last_error_code: "enrich_missing",
      removed_reason: "managed_playlist ou catalog_track ausente no enrich",
      locked_at: null, locked_by: null, lease_expires_at: null,
    }).eq("id", r.id);
    await sb.from("catalog_placement_execution_log").insert({
      placement_id: r.id,
      catalog_track_id: r.catalog_track_id,
      managed_playlist_id: r.managed_playlist_id,
      outcome: "failed",
      error_code: "enrich_missing",
      error_message: "managed_playlist ou catalog_track ausente",
    });
  }

  // ──────────────────────────────────────────────────────────────────────
  // Caches por execução
  // ──────────────────────────────────────────────────────────────────────

  // Token cache por owner (refresh sob demanda em 401).
  const tokenCache = new Map<string, string>();
  async function tokenFor(ownerId: string | null): Promise<string> {
    const key = ownerId ?? "__default__";
    const cached = tokenCache.get(key);
    if (cached) return cached;
    const r = await getUserToken(ownerId ?? undefined);
    tokenCache.set(key, r.token);
    return r.token;
  }

  // Mapa owner → app_id (consulta única em spotify_user_tokens).
  const ownerAppCache = new Map<string, string | null>();
  async function appIdForOwner(ownerId: string | null): Promise<string | null> {
    const key = ownerId ?? "__default__";
    if (ownerAppCache.has(key)) return ownerAppCache.get(key) ?? null;
    if (!ownerId) { ownerAppCache.set(key, null); return null; }
    const { data } = await sb
      .from("spotify_user_tokens")
      .select("app_id")
      .eq("spotify_user_id", ownerId)
      .maybeSingle();
    const v = (data?.app_id as string | null) ?? null;
    ownerAppCache.set(key, v);
    return v;
  }

  // Cache do estado do breaker por app_id (consulta única por execução).
  type BreakerState = { open: boolean; blocked_until: string | null };
  const breakerCache = new Map<string, BreakerState>();
  async function breakerStateFor(appId: string | null): Promise<BreakerState> {
    const key = appId ?? "__global__";
    if (breakerCache.has(key)) return breakerCache.get(key)!;
    if (!appId) {
      const v = { open: false, blocked_until: null };
      breakerCache.set(key, v);
      return v;
    }
    const { data } = await sb
      .from("spotify_circuit_breaker")
      .select("status, blocked_until")
      .eq("app_id", appId)
      .maybeSingle();
    const blockedFuture =
      !!data?.blocked_until && new Date(data.blocked_until).getTime() > Date.now();
    const isOpen = data?.status === "open" || blockedFuture;
    const v: BreakerState = {
      open: !!isOpen,
      blocked_until: data?.blocked_until ?? null,
    };
    breakerCache.set(key, v);
    return v;
  }

  // Pré-check local: managed_playlist_tracks (fonte canônica mantida pelo sync).
  async function localPlaylistHasTrack(
    managedPlaylistId: string,
    spotifyTrackId: string,
  ): Promise<boolean> {
    const { data, error } = await sb
      .from("managed_playlist_tracks")
      .select("id")
      .eq("playlist_id", managedPlaylistId)
      .eq("spotify_track_id", spotifyTrackId)
      .limit(1)
      .maybeSingle();
    if (error) {
      // Erro de leitura local NÃO bloqueia — cai pro Spotify como fallback.
      return false;
    }
    return !!data;
  }

  // Write-through: registra a faixa adicionada na cópia local.
  async function persistLocal(
    managedPlaylistId: string,
    spotifyTrackId: string,
  ): Promise<void> {
    // position omitido propositalmente (há UNIQUE em (playlist_id, position)).
    // O sync-managed-playlist-tracks reconcilia ordem/posição em ciclo próprio.
    await sb
      .from("managed_playlist_tracks")
      .upsert(
        {
          playlist_id: managedPlaylistId,
          spotify_track_id: spotifyTrackId,
          added_at: new Date().toISOString(),
        },
        { onConflict: "playlist_id,spotify_track_id", ignoreDuplicates: true },
      )
      .then(() => {}, () => {});
  }

  // Métricas (também viram payload do response).
  let cntActive = 0;
  let cntAlready = 0;
  let cntRetry = 0;
  let cntFailed = invalid.length;
  let cntCircuit = 0;        // legado: chamadas que receberam SpotifyCircuitOpenError
  let cntWaiting = 0;        // novo: placements desviados pelo pré-flight
  let cntLocalHits = 0;      // pré-check local resolveu sem ir à Spotify
  let cntSpotifyCalls = 0;   // POSTs efetivos enviados à Spotify
  let cntSkipped = 0;        // condição recuperável → retry automático futuro

  // Classifica erro como retry transitório, skip recuperável ou fatal definitivo.
  // ETAPA 1 — Robustez: nunca marca `failed` quando há possibilidade de recuperação.
  function classify(err: any): {
    kind: "retry" | "fatal" | "circuit" | "skip";
    code: string;
    skipReason?: string;
    skipDelaySec?: number;
  } {
    const status: number | null = typeof err?.status === "number" ? err.status : null;
    const name = err?.name as string | undefined;
    const msg = String(err?.message ?? err ?? "");
    const msgLow = msg.toLowerCase();

    if (name === "SpotifyCircuitOpenError") return { kind: "circuit", code: "spotify_circuit_open" };
    if (name === "SpotifyAuthInvalidError") {
      return { kind: "skip", code: "spotify_auth_invalid", skipReason: "owner_token_invalid", skipDelaySec: 3600 };
    }
    // Owner sem token Spotify conectado — recuperável quando reconectar.
    // Owner sem token Spotify conectado — recuperável quando reconectar.
    if (msgLow.includes("nenhuma conta spotify") || msgLow.includes("no spotify account") || msgLow.includes("no refresh token")) {
      return { kind: "skip", code: "owner_token_missing", skipReason: "owner_token_missing", skipDelaySec: 3600 };
    }
    // Refresh do refresh_token falhou (revogado/expirado) — recuperável após reconexão.
    if (msgLow.includes("spotify refresh ") || msgLow.includes("invalid_grant")) {
      return { kind: "skip", code: "spotify_refresh_failed", skipReason: "owner_token_invalid", skipDelaySec: 3600 };
    }
    if (status === 429) return { kind: "retry", code: "spotify_429" };
    if (status != null && status >= 500 && status < 600) return { kind: "retry", code: `spotify_${status}` };
    // 400 Index out of bounds → posição estourada (tracks_count desatualizado).
    if (status === 400 && msgLow.includes("index out of bounds")) {
      return { kind: "skip", code: "spotify_position_oob", skipReason: "position_out_of_bounds", skipDelaySec: 300 };
    }
    if (status === 400) return { kind: "fatal", code: "spotify_400" };
    // 401 — token inválido após refresh; recuperável após reconexão.
    if (status === 401) {
      return { kind: "skip", code: "spotify_401", skipReason: "owner_token_invalid", skipDelaySec: 1800 };
    }
    // 403 — owner perdeu permissão. Recuperável.
    if (status === 403) {
      return { kind: "skip", code: "spotify_403", skipReason: "owner_forbidden", skipDelaySec: 3600 };
    }
    // 404 — playlist arquivada/removida no Spotify. Recuperável se voltar.
    if (status === 404) {
      return { kind: "skip", code: "spotify_404", skipReason: "playlist_unavailable", skipDelaySec: 6 * 3600 };
    }
    if (msgLow.includes("timeout") || msgLow.includes("network") || msgLow.includes("fetch failed")) {
      return { kind: "retry", code: "network_error" };
    }
    return { kind: "fatal", code: status ? `spotify_${status}` : "exception" };
  }

  // Desvia o placement para waiting_circuit_breaker.
  // - scheduled_for = blocked_until do app (com fallback de 15min).
  // - attempts NÃO é alterado (claim também respeita esse estado).
  async function markWaitingCircuit(
    p: Enriched,
    appId: string | null,
    blockedUntil: string | null,
    correlationId: string,
    retryAfterSec?: number | null,
  ) {
    cntCircuit++;
    cntWaiting++;
    const fallbackMs = (retryAfterSec && retryAfterSec > 0 ? retryAfterSec : 15 * 60) * 1000;
    const resumeAt =
      blockedUntil ?? new Date(Date.now() + fallbackMs).toISOString();
    await sb.from("catalog_placements").update({
      status: "waiting_circuit_breaker",
      scheduled_for: resumeAt,
      last_error_code: "circuit_breaker_open",
      locked_at: null, locked_by: null, lease_expires_at: null,
    }).eq("id", p.id);
    await sb.from("catalog_placement_execution_log").insert({
      placement_id: p.id,
      catalog_track_id: p.catalog_track_id,
      managed_playlist_id: p.managed_playlist_id,
      spotify_playlist_id: p.spotify_playlist_id,
      spotify_track_id: p.spotify_track_id,
      position: p.position,
      outcome: "skipped",
      error_code: "waiting_circuit_breaker",
      error_message: trim(
        `source=preflight_breaker app=${appId ?? "none"} ` +
        `blocked_until=${blockedUntil ?? "n/a"} resume_at=${resumeAt} ` +
        `attempts_preserved=${p.attempts} corr=${correlationId}`,
      ),
    });
  }

  async function markRetry(
    p: Enriched,
    code: string,
    msg: string | null,
    correlationId: string,
    snapshotId: string | null = null,
  ) {
    // Se já bateu max_attempts, vira fatal.
    if (p.attempts >= p.max_attempts) {
      await markFailed(p, code, msg ?? "max_attempts_reached", correlationId, snapshotId);
      return;
    }
    const backoffSec = backoffSecondsForAttempt(p.attempts);
    const scheduledFor = new Date(Date.now() + backoffSec * 1000).toISOString();
    await sb.from("catalog_placements").update({
      status: "retry",
      scheduled_for: scheduledFor,
      last_error_code: code,
      locked_at: null, locked_by: null, lease_expires_at: null,
    }).eq("id", p.id);
    await sb.from("catalog_placement_execution_log").insert({
      placement_id: p.id,
      catalog_track_id: p.catalog_track_id,
      managed_playlist_id: p.managed_playlist_id,
      spotify_playlist_id: p.spotify_playlist_id,
      spotify_track_id: p.spotify_track_id,
      position: p.position,
      outcome: "skipped",
      error_code: code,
      error_message: trim(`source=spotify retry in ${backoffSec}s: ${msg ?? ""} corr=${correlationId}`),
      snapshot_id: snapshotId,
    });
    cntRetry++;
  }

  async function markFailed(
    p: Enriched,
    code: string,
    msg: string | null,
    correlationId: string,
    snapshotId: string | null = null,
  ) {
    await sb.from("catalog_placements").update({
      status: "failed",
      last_error_code: code,
      removed_reason: trim(`${code}: ${msg ?? ""}`),
      locked_at: null, locked_by: null, lease_expires_at: null,
    }).eq("id", p.id);
    await sb.from("catalog_placement_execution_log").insert({
      placement_id: p.id,
      catalog_track_id: p.catalog_track_id,
      managed_playlist_id: p.managed_playlist_id,
      spotify_playlist_id: p.spotify_playlist_id,
      spotify_track_id: p.spotify_track_id,
      position: p.position,
      outcome: "failed",
      error_code: code,
      error_message: trim(`source=spotify ${msg ?? ""} corr=${correlationId}`),
      snapshot_id: snapshotId,
    });
    cntFailed++;
  }

  async function markSkipped(
    p: Enriched,
    code: string,
    reason: string,
    delaySec: number,
    msg: string | null,
    correlationId: string,
  ) {
    cntSkipped++;
    const resumeAt = new Date(Date.now() + Math.max(60, delaySec) * 1000).toISOString();
    // skip não consome tentativa: devolve o increment feito no claim.
    await sb.from("catalog_placements").update({
      status: "skipped",
      skip_reason: reason,
      skipped_at: new Date().toISOString(),
      scheduled_for: resumeAt,
      last_error_code: code,
      attempts: Math.max(0, (p.attempts ?? 1) - 1),
      locked_at: null, locked_by: null, lease_expires_at: null,
    }).eq("id", p.id);
    await sb.from("catalog_placement_execution_log").insert({
      placement_id: p.id,
      catalog_track_id: p.catalog_track_id,
      managed_playlist_id: p.managed_playlist_id,
      spotify_playlist_id: p.spotify_playlist_id,
      spotify_track_id: p.spotify_track_id,
      position: p.position,
      outcome: "skipped",
      error_code: code,
      error_message: trim(
        `source=skip reason=${reason} resume_at=${resumeAt} ` +
        `attempts_refunded=true (${p.attempts}→${Math.max(0, (p.attempts ?? 1) - 1)}) ` +
        `${msg ?? ""} corr=${correlationId}`,
      ),
    });
  }

  async function markActive(
    p: Enriched,
    outcome: Outcome,
    source: "local_hit" | "spotify_post" | "local_post_writethrough",
    correlationId: string,
    snapshotId: string | null = null,
  ) {
    await sb.from("catalog_placements").update({
      status: "active",
      added_at: new Date().toISOString(),
      last_error_code: null,
      locked_at: null, locked_by: null, lease_expires_at: null,
    }).eq("id", p.id);
    await sb.from("catalog_placement_execution_log").insert({
      placement_id: p.id,
      catalog_track_id: p.catalog_track_id,
      managed_playlist_id: p.managed_playlist_id,
      spotify_playlist_id: p.spotify_playlist_id,
      spotify_track_id: p.spotify_track_id,
      position: p.position,
      outcome,
      error_message: trim(`source=${source} corr=${correlationId}`),
      snapshot_id: snapshotId,
    });
    if (outcome === "already_present") cntAlready++;
    else cntActive++;
  }

  // ──────────────────────────────────────────────────────────────────────
  // 3) Loop principal
  // ──────────────────────────────────────────────────────────────────────
  for (const p of enriched) {
    const correlationId = crypto.randomUUID().slice(0, 8);
    const uri = p.spotify_uri ?? `spotify:track:${p.spotify_track_id}`;

    // ── ETAPA 2 homologação: dry-run por marcador __LOADTEST__ ────────────
    // Faixas de teste de carga executam o pipeline completo (claim, lease,
    // execution_log, status) mas substituem a chamada ao Spotify por uma
    // simulação. Nenhum efeito colateral em playlists reais.
    if (p.track_name && p.track_name.startsWith("__LOADTEST__")) {
      await markActive(p, "active", "spotify_post", correlationId, "simulated");
      continue;
    }

    try {
      // 3.1) Pré-flight Circuit Breaker (sem chamada Spotify).
      const appId = await appIdForOwner(p.owner_spotify_user_id);
      const breaker = await breakerStateFor(appId);
      if (breaker.open) {
        await markWaitingCircuit(p, appId, breaker.blocked_until, correlationId);
        continue;
      }

      // 3.2) Pré-check local (managed_playlist_tracks).
      if (await localPlaylistHasTrack(p.managed_playlist_id, p.spotify_track_id)) {
        cntLocalHits++;
        await markActive(p, "already_present", "local_hit", correlationId);
        continue;
      }

      // 3.3) Não está no cache local → autoriza chamada Spotify.
      const token = await tokenFor(p.owner_spotify_user_id);

      const insertOpts: { position?: number } = {};
      if (typeof p.position === "number" && p.position >= 0) {
        // Clampa contra tracks_count conhecido (sem GET pré-listagem).
        const safeMax = typeof p.tracks_count === "number" ? p.tracks_count : p.position;
        insertOpts.position = Math.min(p.position, Math.max(0, safeMax));
      }

      const addRes = await addPlaylistTracks(p.spotify_playlist_id, [uri], token, insertOpts);
      cntSpotifyCalls++;

      // 3.4) Write-through local: faixa já está no Spotify, espelha localmente
      //      para que próximos placements na mesma playlist resolvam em local_hit.
      //      Eventual ghost_add será reconciliado pelo sync periódico.
      await persistLocal(p.managed_playlist_id, p.spotify_track_id);

      await markActive(p, "active", "spotify_post", correlationId, addRes.snapshot_id ?? null);
    } catch (e: any) {
      const cls = classify(e);
      const { kind, code } = cls;
      const msg = trim(e?.message ?? String(e));

      if (kind === "circuit") {
        // Spotify devolveu erro do breaker (race com pré-flight). Mesmo tratamento.
        const appId = await appIdForOwner(p.owner_spotify_user_id);
        const breaker = await breakerStateFor(appId);
        const retryAfter = typeof e?.retryAfterSec === "number" ? e.retryAfterSec : null;
        await markWaitingCircuit(p, appId, breaker.blocked_until, correlationId, retryAfter);
      } else if (kind === "retry") {
        await markRetry(p, code, msg, correlationId);
      } else if (kind === "skip") {
        await markSkipped(
          p,
          code,
          cls.skipReason ?? "recoverable",
          cls.skipDelaySec ?? 1800,
          msg,
          correlationId,
        );
        if ((code === "spotify_401" || code === "spotify_auth_invalid") && p.owner_spotify_user_id) {
          tokenCache.delete(p.owner_spotify_user_id);
        }
      } else {
        await markFailed(p, code, msg, correlationId);
      }
    }
  }

  const processed = enriched.length + invalid.length;
  return jr({
    ok: true,
    worker_id: workerId,
    claimed: claimedRows.length,
    processed,
    active: cntActive,
    already_present: cntAlready,
    retry: cntRetry,
    failed: cntFailed,
    skipped: cntSkipped,
    circuit_open: cntCircuit,
    waiting_circuit_breaker: cntWaiting,
    local_hits: cntLocalHits,
    spotify_calls: cntSpotifyCalls,
    duration_ms: Date.now() - startedAt,
  });
});
