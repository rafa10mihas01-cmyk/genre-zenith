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
import { getSpotifyToken, SpotifyCircuitOpenError, setSpotifyCtx } from "../_shared/spotify.ts";
import { listPlaylistTracksRich } from "../_shared/spotify-playlist.ts";
import { requireTeamAccess } from "../_shared/auth.ts";
import {
  acquirePlaylistLock,
  finishPlaylistOperation,
  formatPlaylistError,
  releasePlaylistLock,
  lockedResponseBody,
} from "../_shared/playlist-lock.ts";
import { matchTracks, computeIdentityHash, type TrackIdentity } from "../_shared/track-matching.ts";

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
  isrc: string | null;
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
    .select("id, spotify_playlist_id, name, tracks_hash, owner_spotify_user_id")
    .eq("id", playlist_id)
    .maybeSingle();
  if (plErr) return jr({ ok: false, error: plErr.message }, 500);
  if (!pl?.spotify_playlist_id) return jr({ ok: false, error: "playlist não encontrada" }, 404);

  // Propaga contexto pras chamadas Spotify deste request (listPlaylistTracksRich etc.)
  const ownerSpotifyId: string | null = (pl as any).owner_spotify_user_id ?? null;

  // === Roteamento do app ANTES do guard ===
  // Resolve o app real do owner via spotify_user_tokens. Sem isso o guard cai em
  // getDefaultSpotifyAppId() (NexEngine 02 = is_default) e bloqueia o sync de
  // playlists que pertencem a apps saudáveis quando o default está OPEN.
  // Esta função roda em processo separado do diagnose, então o async-local ctx
  // do caller NÃO atravessa o fetch HTTP — temos que reresolver aqui.
  // Ver auditoria de 2026-06-07 (Fase 8.8.1).
  let ownerAppId: string | null = null;
  if (ownerSpotifyId) {
    const { data: tokenRows } = await supabase
      .from("spotify_user_tokens")
      .select("app_id, is_default, updated_at")
      .eq("spotify_user_id", ownerSpotifyId);
    const rows = (tokenRows ?? []) as Array<{ app_id: string | null; is_default: boolean | null; updated_at: string | null }>;
    const sorted = rows.slice().sort((a, b) => {
      const da = a.is_default ? 1 : 0;
      const db = b.is_default ? 1 : 0;
      if (da !== db) return db - da;
      return String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? ""));
    });
    ownerAppId = sorted[0]?.app_id ?? null;
  }

  setSpotifyCtx({
    appId: ownerAppId,
    playlist_id: pl.id,
    owner_id: ownerSpotifyId,
    spotify_user_id: ownerSpotifyId,
    function_name: "sync-managed-playlist-tracks",
  });

  const { count: tracksBefore } = await supabase
    .from("managed_playlist_tracks")
    .select("*", { count: "exact", head: true })
    .eq("playlist_id", pl.id);

  const lock = skipLock
    ? null
    : await acquirePlaylistLock(supabase, pl.id, "AUTO_SYNC", tracksBefore ?? null);
  if (lock && !lock.ok) return jr(lockedResponseBody(lock), 423);

  try {
    // 1) Fonte da verdade: Spotify (com ISRC via external_ids — fields default do helper já inclui)
    const token = await getSpotifyToken({ appId: ownerAppId });
    const rich = await listPlaylistTracksRich(pl.spotify_playlist_id, token, {
      max: 10000,
      fields: "items(added_at,track(id,name,duration_ms,external_ids,artists(name),album(images))),next",
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
        isrc: t.isrc,
      }));

    // 2) Hash de identidade (ISRC preferido, fallback spotify_track_id) — estável entre re-uploads
    const newHash = await computeIdentityHash(spotifyRows);

    // 3) Short-circuit por hash — economia massiva quando nada mudou.
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

    // 4) Snapshot atual do banco — agora com isrc + nome/artista/duração pra fuzzy
    const { data: dbRowsRaw, error: dbErr } = await supabase
      .from("managed_playlist_tracks")
      .select("spotify_track_id, position, isrc, track_name, artist_name, duration_ms")
      .eq("playlist_id", pl.id);
    if (dbErr) throw new Error(`load snapshot: ${dbErr.message}`);

    type DbRow = {
      spotify_track_id: string;
      position: number;
      isrc: string | null;
      track_name: string | null;
      artist_name: string | null;
      duration_ms: number | null;
    };
    const dbRows: DbRow[] = ((dbRowsRaw ?? []) as any[]).filter((r) => r.spotify_track_id);

    // 5) Resolve identidade em camadas (spotify_id → isrc → fuzzy+duration)
    const dbIdents: TrackIdentity[] = dbRows.map((r) => ({
      spotify_track_id: r.spotify_track_id,
      isrc: r.isrc,
      name: r.track_name,
      artist: r.artist_name,
      duration_ms: r.duration_ms,
    }));
    const spIdents: TrackIdentity[] = spotifyRows.map((r) => ({
      spotify_track_id: r.spotify_track_id,
      isrc: r.isrc,
      name: r.track_name,
      artist: r.artist_name,
      duration_ms: r.duration_ms,
    }));
    const { matched, unmatchedDb, unmatchedSp } = matchTracks(dbIdents, spIdents);

    // 6) Classifica ações
    const toInsert: SpotifyRow[] = unmatchedSp.map((j) => spotifyRows[j]);
    const toDeleteIds: string[] = unmatchedDb.map((i) => dbRows[i].spotify_track_id);

    // matched: pra cada par, se o spotify_track_id mudou (camada isrc/fuzzy), precisa
    // trocar o ID na linha. Se só mudou posição/metadata, basta upsert por chave nova.
    const toUpdateInPlace: SpotifyRow[] = []; // mesmo spotify_track_id, novo metadata/position
    const toRekey: { oldId: string; row: SpotifyRow; via: string; score: number }[] = []; // id mudou
    let matchedIsrc = 0, matchedFuzzy = 0;
    for (const m of matched) {
      const dbRow = dbRows[m.dbIndex];
      const spRow = spotifyRows[m.spotifyIndex];
      if (m.via === "isrc") matchedIsrc++;
      if (m.via === "fuzzy") matchedFuzzy++;
      if (dbRow.spotify_track_id === spRow.spotify_track_id) {
        // pode ter mudado posição, isrc novo (backfill) ou metadata
        if (
          dbRow.position !== spRow.position ||
          dbRow.isrc !== spRow.isrc ||
          dbRow.track_name !== spRow.track_name ||
          dbRow.artist_name !== spRow.artist_name
        ) {
          toUpdateInPlace.push(spRow);
        }
      } else {
        toRekey.push({ oldId: dbRow.spotify_track_id, row: spRow, via: m.via, score: m.score });
      }
    }

    const tracksChanged = toInsert.length + toDeleteIds.length + toUpdateInPlace.length + toRekey.length;

    // 7) Aplica delta — ordem importa pra não colidir com UNIQUE(playlist_id, spotify_track_id):
    //    a) deletes puros (saíram de verdade)
    //    b) rekeys: UPDATE spotify_track_id (+metadata) onde id antigo casa
    //    c) upserts (inserts + updates in-place)
    if (toDeleteIds.length > 0) {
      for (let i = 0; i < toDeleteIds.length; i += 500) {
        const slice = toDeleteIds.slice(i, i + 500);
        const { error } = await supabase
          .from("managed_playlist_tracks")
          .delete()
          .eq("playlist_id", pl.id)
          .in("spotify_track_id", slice);
        if (error) throw new Error(`delete: ${error.message}`);
      }
    }

    for (const rk of toRekey) {
      // Se o novo spotify_track_id já existe na playlist (deveria ser raro pós-deletes),
      // remove a linha duplicada antes do UPDATE pra não violar UNIQUE.
      await supabase
        .from("managed_playlist_tracks")
        .delete()
        .eq("playlist_id", pl.id)
        .eq("spotify_track_id", rk.row.spotify_track_id);
      const { error } = await supabase
        .from("managed_playlist_tracks")
        .update({
          spotify_track_id: rk.row.spotify_track_id,
          track_name: rk.row.track_name,
          artist_name: rk.row.artist_name,
          album_cover: rk.row.album_cover,
          position: rk.row.position,
          added_at: rk.row.added_at,
          duration_ms: rk.row.duration_ms,
          isrc: rk.row.isrc,
        })
        .eq("playlist_id", pl.id)
        .eq("spotify_track_id", rk.oldId);
      if (error) throw new Error(`rekey ${rk.oldId}→${rk.row.spotify_track_id}: ${error.message}`);
    }

    const upsertRows = [...toInsert, ...toUpdateInPlace];
    if (upsertRows.length > 0) {
      for (let i = 0; i < upsertRows.length; i += 500) {
        const slice = upsertRows.slice(i, i + 500);
        const { error } = await supabase
          .from("managed_playlist_tracks")
          .upsert(slice, { onConflict: "playlist_id,spotify_track_id" });
        if (error) throw new Error(`upsert ${i}: ${error.message}`);
      }
    }

    // 8) Atualiza metadata da playlist (hash + count)
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
        deleted: toDeleteIds.length,
        repositioned: toUpdateInPlace.length,
        rekeyed: toRekey.length,
        matched_by_isrc: matchedIsrc,
        matched_by_fuzzy: matchedFuzzy,
      },
    });
  } catch (e) {
    if (e instanceof SpotifyCircuitOpenError) {
      const blockedUntilMs = e.blockedUntil ? new Date(e.blockedUntil).getTime() : NaN;
      const retryAfter = Number.isFinite(blockedUntilMs)
        ? Math.max(1, Math.ceil((blockedUntilMs - Date.now()) / 1000))
        : Math.max(1, e.retryAfterSec || 60);
      if (lock && lock.ok) {
        await finishPlaylistOperation(supabase, lock, {
          status: "aborted",
          tracks_before: tracksBefore ?? null,
          error: `SPOTIFY_CIRCUIT_OPEN retry_after=${retryAfter}s`,
        });
      }
      return jr({
        ok: false,
        error: "SPOTIFY_CIRCUIT_OPEN",
        code: "spotify_circuit_open",
        blocked_until: e.blockedUntil,
        retry_after: retryAfter,
      }, 503);
    }
    const errMsg = formatPlaylistError(e);
    if (lock && lock.ok) {
      await finishPlaylistOperation(supabase, lock, {
        status: "failed",
        tracks_before: tracksBefore ?? null,
        error: errMsg,
      });
    }
    return jr({ ok: false, error: errMsg }, 500);
  } finally {
    if (lock && lock.ok) await releasePlaylistLock(supabase, lock);
  }
});
