// spotify-enrichment-worker — drena spotify_enrichment_queue.
//
// Cron 1×/min (ou disparo manual via POST). Cada execução reserva até N jobs
// via claim_spotify_enrichment_jobs() (FOR UPDATE SKIP LOCKED) e os processa
// com GET /v1/tracks/{id} ou /v1/artists/{id} (single-path).
//
// Política:
//   200       → upsert cache, status=done
//   404       → fetch_status='not_found', status=done
//   403       → status=skipped_forbidden (24h backoff via scheduled_for)
//   429       → não consome attempt (decrementa), reagenda com retry-after
//   5xx/other → attempts++, scheduled_for = now() + backoff exponencial
//
// Concorrência baixa (2 in-flight, ~150ms stall) pra ficar Spotify-friendly.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  SpotifyCircuitOpenError,
  setSpotifyBreakerContext,
  installSpotifyCircuitFetchGuard,
} from "../_shared/spotify-client.ts";
import { ccFetch } from "../_shared/catalog-gateway.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WORKER_ID = `spotify-enrichment-worker#${crypto.randomUUID().slice(0, 8)}`;

// Garante guard global no fetch (já tolerante a múltiplas chamadas).
installSpotifyCircuitFetchGuard();

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type Job = {
  id: string;
  kind: "track" | "artist";
  ref_id: string;
  attempts: number;
  max_attempts: number;
};

// Defaults conservadores — Spotify Web API tolera ~10 req/s sustentado por app.
// Rodamos bem abaixo disso para nunca disparar 429 em volume normal.
const BATCH = Number(Deno.env.get("ENRICH_WORKER_BATCH") ?? 10);
const CONCURRENCY = Number(Deno.env.get("ENRICH_WORKER_CONCURRENCY") ?? 1);
const STALL_MS = Number(Deno.env.get("ENRICH_WORKER_STALL_MS") ?? 400);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // CRÍTICO: marca este loop como contexto "enrichment". Qualquer 429 daqui
  // abre o breaker ('app_x','enrichment') e NÃO afeta sync/bot/execução.
  setSpotifyBreakerContext("enrichment");

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  // Claim
  const { data: jobs, error: claimErr } = await sb.rpc("claim_spotify_enrichment_jobs", {
    _worker: WORKER_ID,
    _limit: BATCH,
  });
  if (claimErr) return jr({ ok: false, error: claimErr.message }, 500);
  const list = (jobs ?? []) as Job[];
  if (list.length === 0) return jr({ ok: true, claimed: 0, processed: 0 });

  // Fase 17-B.2: tokens vêm do Catalog Gateway (pool CC NexEngine 05/10).
  // ccFetch lida com aquisição/refresh de token internamente.

  const results = { done: 0, not_found: 0, forbidden: 0, retry: 0, failed: 0 };

  let i = 0;
  async function next() {
    while (i < list.length) {
      const idx = i++;
      const job = list[idx];
      try {
        const r = await processJob(sb, job);
        (results as any)[r] = ((results as any)[r] ?? 0) + 1;
      } catch (e) {
        if (e instanceof SpotifyCircuitOpenError) {
          // circuit aberto → libera todos os restantes
          await releaseJobs(sb, [job.id, ...list.slice(i).map((j) => j.id)], "circuit_open");
          i = list.length;
          break;
        }
        await failJob(sb, job, String((e as Error)?.message ?? e));
        results.failed++;
      }
      if (STALL_MS > 0) await new Promise((r) => setTimeout(r, STALL_MS));
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, list.length) }, () => next()));

  return jr({ ok: true, worker: WORKER_ID, claimed: list.length, ...results });
});

async function processJob(sb: any, job: Job): Promise<"done" | "not_found" | "forbidden" | "retry" | "failed"> {
  const url = job.kind === "track"
    ? `https://api.spotify.com/v1/tracks/${job.ref_id}`
    : `https://api.spotify.com/v1/artists/${job.ref_id}`;
  const r = await ccFetch(url, "spotify-enrichment-worker", job.ref_id);

  if (r.status === 200) {
    const j = await r.json();
    if (job.kind === "track") await upsertTrack(sb, job.ref_id, j);
    else await upsertArtist(sb, job.ref_id, j);
    await sb.from("spotify_enrichment_queue").update({ status: "done", done_at: new Date().toISOString(), last_error: null }).eq("id", job.id);
    return "done";
  }

  if (r.status === 404) {
    if (job.kind === "track") {
      await sb.from("spotify_track_cache").upsert({
        spotify_track_id: job.ref_id, fetch_status: "not_found", enriched_at: new Date().toISOString(),
      });
    } else {
      await sb.from("spotify_artist_cache").upsert({
        spotify_artist_id: job.ref_id, fetch_status: "not_found", enriched_at: new Date().toISOString(),
      });
    }
    await sb.from("spotify_enrichment_queue").update({ status: "done", done_at: new Date().toISOString(), last_error: "not_found" }).eq("id", job.id);
    return "not_found";
  }

  if (r.status === 403) {
    // Backoff longo (24h)
    await sb.from("spotify_enrichment_queue").update({
      status: "pending",
      scheduled_for: new Date(Date.now() + 24 * 3600_000).toISOString(),
      last_error: "403_forbidden",
    }).eq("id", job.id);
    return "forbidden";
  }

  if (r.status === 429) {
    const ra = Number(r.headers.get("retry-after") ?? 60);
    await sb.from("spotify_enrichment_queue").update({
      status: "pending",
      attempts: Math.max(0, job.attempts - 1), // não consome attempt
      scheduled_for: new Date(Date.now() + (ra + 5) * 1000).toISOString(),
      last_error: `429_retry_${ra}s`,
    }).eq("id", job.id);
    return "retry";
  }

  // outras falhas
  await failJob(sb, job, `http_${r.status}`);
  return "failed";
}

async function failJob(sb: any, job: Job, err: string) {
  if (job.attempts >= job.max_attempts) {
    await sb.from("spotify_enrichment_queue").update({
      status: "failed", done_at: new Date().toISOString(), last_error: err,
    }).eq("id", job.id);
  } else {
    const backoff = Math.min(3600, 30 * Math.pow(2, job.attempts)) * 1000;
    await sb.from("spotify_enrichment_queue").update({
      status: "pending",
      scheduled_for: new Date(Date.now() + backoff).toISOString(),
      last_error: err,
    }).eq("id", job.id);
  }
}

async function releaseJobs(sb: any, ids: string[], err: string) {
  if (!ids.length) return;
  await sb.from("spotify_enrichment_queue").update({
    status: "pending",
    attempts: 0,  // não conta esta tentativa
    scheduled_for: new Date(Date.now() + 60_000).toISOString(),
    last_error: err,
  }).in("id", ids);
}

async function upsertTrack(sb: any, id: string, j: any) {
  await sb.from("spotify_track_cache").upsert({
    spotify_track_id: id,
    name: j?.name ?? null,
    isrc: j?.external_ids?.isrc ?? null,
    album_id: j?.album?.id ?? null,
    release_date: parseDate(j?.album?.release_date),
    duration_ms: j?.duration_ms ?? null,
    explicit: j?.explicit ?? null,
    popularity: typeof j?.popularity === "number" ? j.popularity : null,
    artist_ids: Array.isArray(j?.artists) ? j.artists.map((a: any) => a?.id).filter(Boolean) : [],
    fetch_status: "ok",
    fetch_error: null,
    enriched_at: new Date().toISOString(),
    popularity_refreshed_at: new Date().toISOString(),
    raw: j,
  });

  // Auto-enqueue artist_ids ainda não cacheados
  const artistIds: string[] = Array.isArray(j?.artists) ? j.artists.map((a: any) => a?.id).filter(Boolean) : [];
  if (artistIds.length) {
    const { data: existing } = await sb
      .from("spotify_artist_cache")
      .select("spotify_artist_id")
      .in("spotify_artist_id", artistIds);
    const have = new Set((existing ?? []).map((r: any) => r.spotify_artist_id));
    const missing = artistIds.filter((a) => !have.has(a));
    if (missing.length) {
      const rows = missing.map((ref_id) => ({ kind: "artist", ref_id, reason: "track_dep", priority: 5, status: "pending" }));
      await sb.from("spotify_enrichment_queue").insert(rows).then(() => {}, () => {});
    }
  }
}

async function upsertArtist(sb: any, id: string, j: any) {
  const now = new Date().toISOString();
  await sb.from("spotify_artist_cache").upsert({
    spotify_artist_id: id,
    name: j?.name ?? null,
    genres: Array.isArray(j?.genres) ? j.genres.map((g: any) => String(g).toLowerCase()) : [],
    popularity: typeof j?.popularity === "number" ? j.popularity : null,
    followers: typeof j?.followers?.total === "number" ? j.followers.total : null,
    image_url: j?.images?.[0]?.url ?? null,
    fetch_status: "ok",
    fetch_error: null,
    enriched_at: now,
    refreshed_at: now,
    genres_refreshed_at: now,
    raw: j,
  });
}


function parseDate(s: any): string | null {
  if (!s || typeof s !== "string") return null;
  // Spotify pode mandar YYYY, YYYY-MM, YYYY-MM-DD
  if (/^\d{4}$/.test(s)) return `${s}-01-01`;
  if (/^\d{4}-\d{2}$/.test(s)) return `${s}-01`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return null;
}
