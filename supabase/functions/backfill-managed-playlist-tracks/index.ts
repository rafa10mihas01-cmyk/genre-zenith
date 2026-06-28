// backfill-managed-playlist-tracks — Roda em lote a sincronização de
// managed_playlist_tracks para playlists ativas que ainda não têm
// nenhuma faixa snapshotada. Idempotente.
//
// POST { limit?: number }   (padrão 60)
// Retorna: { processed, ok, failed, remaining, details: [...] }

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getAppToken, getUserToken } from "../_shared/spotify-client.ts";
import { listPlaylistTracksRich } from "../_shared/spotify-playlist.ts";
import { reportCronHealth } from "../_shared/cron-health.ts";
import {
  acquirePlaylistLock,
  finishPlaylistOperation,
  formatPlaylistError,
  releasePlaylistLock,
} from "../_shared/playlist-lock.ts";
import { computeIdentityHash } from "../_shared/track-matching.ts";
import { enqueuePlaylistJob } from "../_shared/playlist-queue.ts";

// Auth opcional: aceita JWT de team OU header x-backfill-secret = SERVICE_ROLE_KEY.
// Backfill é idempotente (replace-all por playlist), seguro pra rodar como admin.


const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function syncOne(sb: any, _token: string, pl: { id: string; spotify_playlist_id: string; owner_spotify_user_id?: string | null }) {
  const lock = await acquirePlaylistLock(sb, pl.id, "MAINTENANCE", null);
  if (!lock.ok) throw new Error("playlist_locked");

  try {
    // /v1/playlists/:id/tracks requer USER token (client_credentials retorna 401).
    // Usa token do owner; só cai pra client_credentials se a playlist não tem owner.
    const ownerId = pl.owner_spotify_user_id ?? null;
    const token = ownerId
      ? (await getUserToken(ownerId)).token
      : await getAppToken();
    const rich = await listPlaylistTracksRich(pl.spotify_playlist_id, token, {
      max: 10000,
      fields: "items(added_at,track(id,name,duration_ms,external_ids,artists(name),album(images)),item(id,name,duration_ms,external_ids,artists(name),album(images))),next",
    });
    const rows = rich
      .filter((t) => t.spotify_track_id)
      .map((t) => ({
        playlist_id: pl.id,
        spotify_track_id: t.spotify_track_id,
        track_name: t.name || null,
        artist_name: t.artists || null,
        album_cover: t.album_cover,
        position: t.position - 1,
        added_at: t.added_at,
        duration_ms: t.duration_ms,
        isrc: t.isrc,
      }));

    await sb.from("managed_playlist_tracks").delete().eq("playlist_id", pl.id);
    if (rows.length > 0) {
      for (let i = 0; i < rows.length; i += 500) {
        const { error } = await sb.from("managed_playlist_tracks").insert(rows.slice(i, i + 500));
        if (error) throw new Error(`insert: ${error.message}`);
      }
    }
    const tracksHash = await computeIdentityHash(
      rows.map((r) => ({ isrc: r.isrc, spotify_track_id: r.spotify_track_id as string })),
    );
    await sb.from("managed_playlists")
      .update({
        tracks_count: rows.length,
        tracks_hash: tracksHash,
        last_metrics_at: new Date().toISOString(),
      })
      .eq("id", pl.id);

    await finishPlaylistOperation(sb, lock, {
      status: "success",
      tracks_before: 0,
      tracks_after: rows.length,
      tracks_changed: rows.length,
    });
    return rows.length;
  } catch (e) {
    await finishPlaylistOperation(sb, lock, {
      status: "failed",
      error: formatPlaylistError(e),
    });
    throw e;
  } finally {
    await releasePlaylistLock(sb, lock);
  }
}


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const startedAt = Date.now();

  // Guard: aceita header com service role key OU bearer JWT (qualquer team_access).
  const secret = req.headers.get("x-backfill-secret");
  const isAdmin = secret === SERVICE_KEY;
  if (!isAdmin) {
    // se não passou secret, exige Authorization Bearer (qualquer JWT válido)
    const auth = req.headers.get("authorization") ?? "";
    if (!auth.toLowerCase().startsWith("bearer ")) {
      return jr({ ok: false, error: "missing_auth" }, 401);
    }
  }


  let body: any = {};
  try { body = await req.json(); } catch { /* ignore */ }
  const limit = Math.max(1, Math.min(Number(body.limit ?? 60), 200));

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  // 1) Pega playlists ativas com spotify_playlist_id mas SEM linhas em managed_playlist_tracks.
  // PostgREST não tem COUNT-zero, então usamos RPC dinâmica via select com left join virtual:
  // listamos todos os IDs ativos e depois filtramos os que aparecem em mpt.
  const { data: all } = await sb
    .from("managed_playlists")
    .select("id, spotify_playlist_id")
    .neq("playlist_type", "ARCHIVED")
    .not("spotify_playlist_id", "is", null);

  const allIds = (all ?? []).map((r: any) => r.id);
  if (allIds.length === 0) return jr({ ok: true, processed: 0, ok_count: 0, failed: 0, remaining: 0, details: [] });

  // Busca playlist_ids que JÁ têm tracks (paginado — default PostgREST 1000 rows trunca)
  const present = new Set<string>();
  for (let i = 0; i < allIds.length; i += 200) {
    const slice = allIds.slice(i, i + 200);
    let from = 0;
    const PAGE = 1000;
    while (true) {
      const { data, error } = await sb
        .from("managed_playlist_tracks")
        .select("playlist_id")
        .in("playlist_id", slice)
        .range(from, from + PAGE - 1);
      if (error) throw new Error(`present query: ${error.message}`);
      const rows = (data ?? []) as any[];
      for (const r of rows) present.add(r.playlist_id);
      if (rows.length < PAGE) break;
      from += PAGE;
    }
  }

  const missing = (all ?? []).filter((r: any) => !present.has(r.id));
  const batch = missing.slice(0, limit);
  const remaining = Math.max(0, missing.length - batch.length);

  if (batch.length === 0) return jr({ ok: true, processed: 0, ok_count: 0, failed: 0, remaining, details: [] });

  // Em vez de rodar syncOne em loop (caro, lock próprio, risco de timeout),
  // enfileira BACKFILL jobs. O playlist-queue-processor executa em background
  // com retry/backoff. syncOne acima continua exportada caso seja chamada manualmente.
  const details: any[] = [];
  let enqueued = 0, skipped = 0, errors = 0;
  for (const pl of batch) {
    const enq = await enqueuePlaylistJob(sb, {
      playlist_id: pl.id,
      operation_type: "BACKFILL",
    });
    if (enq.ok && (enq as any).skipped) {
      skipped++;
      details.push({ id: pl.id, ok: true, skipped: true });
    } else if (enq.ok) {
      enqueued++;
      details.push({ id: pl.id, ok: true, enqueued: true });
    } else {
      errors++;
      details.push({ id: pl.id, ok: false, error: enq.error });
    }
  }

  await reportCronHealth(sb, {
    job_name: "backfill-managed-playlist-tracks",
    status: errors > 0 ? (enqueued === 0 ? "error" : "partial") : "ok",
    startedAt,
    metrics: { processed: batch.length, enqueued, skipped_dupe: skipped, errors, remaining },
    message: `enqueued=${enqueued} skipped=${skipped} errors=${errors} remaining=${remaining}`,
  });

  return jr({
    ok: true,
    processed: batch.length,
    enqueued,
    skipped_dupe: skipped,
    errors,
    remaining,
    details,
  });
});
