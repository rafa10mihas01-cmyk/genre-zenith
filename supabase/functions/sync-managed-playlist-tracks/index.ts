// sync-managed-playlist-tracks — Sincroniza managed_playlist_tracks com Spotify
// usando SYNC INCREMENTAL (delta) em vez de delete-all + insert-all.
//
// Fluxo:
//   1. Lista faixas atuais do Spotify (rich).
//   2. Calcula hash determinístico (SHA-1 dos spotify_track_ids ordenados).
//   3. Compara com managed_playlists.tracks_hash. Se igual → skip, zero writes.
//   4. Senão, carrega snapshot atual do banco.
//   5. Diff: inserts (novas), deletes (saíram), updates (mudaram de posição).
//   6. Aplica só o delta.
//   7. Atualiza tracks_hash + tracks_count + last_metrics_at.
//
// Body: { playlist_id: uuid, skip_lock?: boolean, force?: boolean }
//   - skip_lock: usado por funções internas (apply-playlist-plan) que já seguram o lock.
//   - force: ignora o hash match e força recálculo do delta (útil pra backfill / debug).
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getSpotifyToken } from "../_shared/spotify.ts";
import { listPlaylistTracksRich } from "../_shared/spotify-playlist.ts";
import { requireTeamAccess } from "../_shared/auth.ts";
import {
  acquirePlaylistLock,
  finishPlaylistOperation,
  releasePlaylistLock,
  lockedResponseBody,
  computeTracksHash,
} from "../_shared/playlist-lock.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type SpotifyRow = {
  playlist_id: string;
  spotify_track_id: string;
  track_name: string | null;
  artist_name: string | null;
  album_cover: string | null;
  position: number;
  added_at: string | null;
  duration_ms: number | null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const guard = await requireTeamAccess(req);
  if (!guard.ok) return guard.resp;

  let body: any;
  try { body = await req.json(); } catch { return jr({ ok: false, error: "Invalid JSON" }, 400); }
  const playlist_id = String(body?.playlist_id ?? "").trim();
  const skipLock = body?.skip_lock === true;
  const force = body?.force === true;
  if (!playlist_id) return jr({ ok: false, error: "playlist_id obrigatório" }, 400);

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: pl, error: plErr } = await supabase
    .from("managed_playlists")
    .select("id, spotify_playlist_id, name, tracks_hash")
    .eq("id", playlist_id)
    .maybeSingle();
  if (plErr) return jr({ ok: false, error: plErr.message }, 500);
  if (!pl?.spotify_playlist_id) return jr({ ok: false, error: "playlist não encontrada" }, 404);

  const { count: tracksBefore } = await supabase
    .from("managed_playlist_tracks")
    .select("*", { count: "exact", head: true })
    .eq("playlist_id", pl.id);

  const lock = skipLock
    ? null
    : await acquirePlaylistLock(supabase, pl.id, "AUTO_SYNC", tracksBefore ?? null);
  if (lock && !lock.ok) return jr(lockedResponseBody(lock), 423);

  try {
    // 1) Fonte da verdade: Spotify
    const token = await getSpotifyToken();
    const rich = await listPlaylistTracksRich(pl.spotify_playlist_id, token, {
      max: 10000,
      fields: "items(added_at,track(id,name,duration_ms,artists(name),album(images))),next",
    });
    const spotifyRows: SpotifyRow[] = rich
      .filter((t) => t.spotify_track_id)
      .map((t) => ({
        playlist_id: pl.id,
        spotify_track_id: t.spotify_track_id as string,
        track_name: t.name || null,
        artist_name: t.artists || null,
        album_cover: t.album_cover,
        position: t.position - 1, // listPlaylistTracksRich é 1-based; tabela é 0-based
        added_at: t.added_at,
        duration_ms: t.duration_ms,
      }));

    const orderedIds = spotifyRows.map((r) => r.spotify_track_id);
    const newHash = await computeTracksHash(orderedIds);

    // 2) Short-circuit por hash — economia massiva quando nada mudou.
    if (!force && pl.tracks_hash && pl.tracks_hash === newHash) {
      if (lock && lock.ok) {
        await finishPlaylistOperation(supabase, lock, {
          status: "success",
          tracks_before: tracksBefore ?? null,
          tracks_after: spotifyRows.length,
          tracks_changed: 0,
        });
      }
      return jr({
        ok: true,
        total: spotifyRows.length,
        skipped: true,
        reason: "hash_match",
        tracks_changed: 0,
      });
    }

    // 3) Snapshot atual do banco
    const { data: dbRowsRaw, error: dbErr } = await supabase
      .from("managed_playlist_tracks")
      .select("spotify_track_id, position")
      .eq("playlist_id", pl.id);
    if (dbErr) throw new Error(`load snapshot: ${dbErr.message}`);

    const dbMap = new Map<string, number>(); // track_id -> position
    for (const r of (dbRowsRaw ?? []) as Array<{ spotify_track_id: string; position: number }>) {
      if (r.spotify_track_id) dbMap.set(r.spotify_track_id, r.position);
    }

    // 4) Calcula delta
    const spotifyIdSet = new Set(orderedIds);
    const toInsert: SpotifyRow[] = [];
    const toUpdate: SpotifyRow[] = []; // mudou de posição (ou faltou metadata)
    for (const row of spotifyRows) {
      if (!dbMap.has(row.spotify_track_id)) {
        toInsert.push(row);
      } else if (dbMap.get(row.spotify_track_id) !== row.position) {
        toUpdate.push(row);
      }
    }
    const toDelete: string[] = [];
    for (const id of dbMap.keys()) {
      if (!spotifyIdSet.has(id)) toDelete.push(id);
    }

    const tracksChanged = toInsert.length + toUpdate.length + toDelete.length;

    // 5) Aplica delta. UPDATE de position pode colidir com UNIQUE durante shuffle, então usamos
    //    upsert por (playlist_id, spotify_track_id), que é a chave única, e a position vira coluna livre.
    //    Como não há UNIQUE em position, isso é seguro.
    if (toDelete.length > 0) {
      for (let i = 0; i < toDelete.length; i += 500) {
        const slice = toDelete.slice(i, i + 500);
        const { error } = await supabase
          .from("managed_playlist_tracks")
          .delete()
          .eq("playlist_id", pl.id)
          .in("spotify_track_id", slice);
        if (error) throw new Error(`delete: ${error.message}`);
      }
    }

    // INSERT + UPDATE via upsert único (mesmo conjunto de colunas).
    const upsertRows = [...toInsert, ...toUpdate];
    if (upsertRows.length > 0) {
      for (let i = 0; i < upsertRows.length; i += 500) {
        const slice = upsertRows.slice(i, i + 500);
        const { error } = await supabase
          .from("managed_playlist_tracks")
          .upsert(slice, { onConflict: "playlist_id,spotify_track_id" });
        if (error) throw new Error(`upsert ${i}: ${error.message}`);
      }
    }

    // 6) Atualiza metadata da playlist (hash + count)
    await supabase
      .from("managed_playlists")
      .update({
        tracks_count: spotifyRows.length,
        tracks_hash: newHash,
        last_metrics_at: new Date().toISOString(),
      })
      .eq("id", pl.id);

    if (lock && lock.ok) {
      await finishPlaylistOperation(supabase, lock, {
        status: "success",
        tracks_before: tracksBefore ?? null,
        tracks_after: spotifyRows.length,
        tracks_changed: tracksChanged,
      });
    }
    return jr({
      ok: true,
      total: spotifyRows.length,
      tracks_changed: tracksChanged,
      delta: {
        inserted: toInsert.length,
        deleted: toDelete.length,
        repositioned: toUpdate.length,
      },
    });
  } catch (e) {
    if (lock && lock.ok) {
      await finishPlaylistOperation(supabase, lock, {
        status: "failed",
        tracks_before: tracksBefore ?? null,
        error: (e as Error).message,
      });
    }
    return jr({ ok: false, error: (e as Error).message }, 500);
  } finally {
    if (lock && lock.ok) await releasePlaylistLock(supabase, lock);
  }
});
