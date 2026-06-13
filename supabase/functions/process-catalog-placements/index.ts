// process-catalog-placements — Esteira de execução real dos placements.
//
// Consome `catalog_placements` em status 'pending' e efetiva no Spotify
// usando os helpers canônicos de `_shared/spotify-playlist.ts`.
//
// Body (todos opcionais):
//   { catalog_track_id?: uuid, batch_id?: uuid, limit?: number }
//
// Comportamento:
//   - Agrupa placements por owner do Spotify (1 token por dono).
//   - Para cada placement:
//       1) Lista refs atuais (cache por playlist na mesma execução).
//       2) Se a faixa já existe → status='active', added_at=now() (sem POST).
//       3) Caso contrário → addPlaylistTracks(playlistId, [uri], { position }).
//       4) Reconsulta a playlist e confirma presença antes de marcar active.
//       5) Em qualquer erro (401/403/404/429/etc) → status='failed' +
//          removed_reason, log de auditoria e segue.
//   - Sempre grava em `catalog_placement_execution_log`.

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  addPlaylistTracks,
  findPlaylistTrackIndex,
  listPlaylistTrackRefs,
  type PlaylistTrackRef,
} from "../_shared/spotify-playlist.ts";
import { getUserToken } from "../_shared/spotify-client.ts";

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

type PendingPlacement = {
  id: string;
  catalog_track_id: string;
  managed_playlist_id: string;
  position: number | null;
  spotify_playlist_id: string;
  owner_spotify_user_id: string | null;
  spotify_track_id: string;
  spotify_uri: string | null;
  track_name: string;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jr({ ok: false, error: "method_not_allowed" }, 405);

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* allow empty body */ }
  const catalogTrackId = typeof body?.catalog_track_id === "string" ? body.catalog_track_id : null;
  const batchId = typeof body?.batch_id === "string" ? body.batch_id : null;
  const rawLimit = Number(body?.limit ?? 1000);
  const limit = Number.isFinite(rawLimit) ? Math.min(2000, Math.max(1, Math.floor(rawLimit))) : 1000;

  // Seleciona placements pending com tudo que precisamos (sem N+1).
  let q = sb
    .from("catalog_placements")
    .select(`
      id,
      catalog_track_id,
      managed_playlist_id,
      position,
      managed_playlists!inner(spotify_playlist_id, owner_spotify_user_id),
      catalog_tracks!inner(spotify_track_id, spotify_uri, track_name)
    `)
    .eq("status", "pending")
    .order("managed_playlist_id", { ascending: true })
    .limit(limit);
  if (catalogTrackId) q = q.eq("catalog_track_id", catalogTrackId);
  if (batchId) q = q.eq("distribution_batch_id", batchId);

  const { data: rows, error: selErr } = await q;
  if (selErr) return jr({ ok: false, error: "select_failed", message: selErr.message }, 500);

  const pending: PendingPlacement[] = (rows ?? []).map((r: any) => ({
    id: r.id,
    catalog_track_id: r.catalog_track_id,
    managed_playlist_id: r.managed_playlist_id,
    position: r.position,
    spotify_playlist_id: r.managed_playlists?.spotify_playlist_id,
    owner_spotify_user_id: r.managed_playlists?.owner_spotify_user_id ?? null,
    spotify_track_id: r.catalog_tracks?.spotify_track_id,
    spotify_uri: r.catalog_tracks?.spotify_uri ?? null,
    track_name: r.catalog_tracks?.track_name ?? "",
  })).filter((p) => p.spotify_playlist_id && p.spotify_track_id);

  if (pending.length === 0) {
    return jr({ ok: true, processed: 0, active: 0, already_present: 0, failed: 0 });
  }

  // Cache de token por owner — refresh sob demanda em 401.
  const tokenCache = new Map<string, string>();
  async function tokenFor(ownerId: string | null): Promise<string> {
    const key = ownerId ?? "__default__";
    const cached = tokenCache.get(key);
    if (cached) return cached;
    const r = await getUserToken(ownerId ?? undefined);
    tokenCache.set(key, r.token);
    return r.token;
  }

  // Cache de refs por playlist (limpa quando inserimos).
  const refsCache = new Map<string, PlaylistTrackRef[]>();
  async function getRefs(playlistId: string, token: string, force = false): Promise<PlaylistTrackRef[]> {
    if (!force) {
      const cached = refsCache.get(playlistId);
      if (cached) return cached;
    }
    const refs = await listPlaylistTrackRefs(playlistId, token);
    refsCache.set(playlistId, refs);
    return refs;
  }

  let cntActive = 0;
  let cntAlready = 0;
  let cntFailed = 0;

  for (const p of pending) {
    const uri = p.spotify_uri ?? `spotify:track:${p.spotify_track_id}`;
    const logBase = {
      placement_id: p.id,
      catalog_track_id: p.catalog_track_id,
      managed_playlist_id: p.managed_playlist_id,
      spotify_playlist_id: p.spotify_playlist_id,
      spotify_track_id: p.spotify_track_id,
      position: p.position,
    };

    try {
      const token = await tokenFor(p.owner_spotify_user_id);

      // 1) Verificação anti-duplicidade
      let refs = await getRefs(p.spotify_playlist_id, token);
      if (findPlaylistTrackIndex(refs, p.spotify_track_id) >= 0) {
        await sb.from("catalog_placements")
          .update({ status: "active", added_at: new Date().toISOString() })
          .eq("id", p.id);
        await sb.from("catalog_placement_execution_log").insert({
          ...logBase,
          outcome: "already_present",
        });
        cntAlready++;
        continue;
      }

      // 2) Insere na posição salva (sem recalcular). Se a posição estourar
      //    o tamanho atual da playlist (caso clássico após catálogo
      //    propagar pra playlists menores), clampa pra refs.length —
      //    equivalente a "no fim", que é o comportamento desejado pra
      //    catálogo de fundo. Spotify devolve 400 "Index out of bounds"
      //    quando position > tracks_total.
      const insertOpts: { position?: number } = {};
      if (typeof p.position === "number" && p.position >= 0) {
        insertOpts.position = Math.min(p.position, refs.length);
      }
      const addRes = await addPlaylistTracks(p.spotify_playlist_id, [uri], token, insertOpts);

      // 3) Confirma reconsultando
      refs = await getRefs(p.spotify_playlist_id, token, true);
      if (findPlaylistTrackIndex(refs, p.spotify_track_id) < 0) {
        await sb.from("catalog_placements")
          .update({ status: "failed", removed_reason: "spotify_add_not_reflected" })
          .eq("id", p.id);
        await sb.from("catalog_placement_execution_log").insert({
          ...logBase,
          outcome: "failed",
          error_code: "not_reflected",
          error_message: "Spotify aceitou o POST mas a faixa não apareceu na listagem subsequente.",
          snapshot_id: addRes.snapshot_id ?? null,
        });
        cntFailed++;
        continue;
      }

      await sb.from("catalog_placements")
        .update({ status: "active", added_at: new Date().toISOString() })
        .eq("id", p.id);
      await sb.from("catalog_placement_execution_log").insert({
        ...logBase,
        outcome: "active",
        snapshot_id: addRes.snapshot_id ?? null,
      });
      cntActive++;
    } catch (e: any) {
      // Status do erro pode vir como e.status (SpotifyApiError) ou e.name
      const status: number | null = typeof e?.status === "number" ? e.status : null;
      const code = status
        ? `spotify_${status}`
        : (e?.name === "SpotifyAuthInvalidError" ? "spotify_auth_invalid"
        : e?.name === "SpotifyCircuitOpenError" ? "spotify_circuit_open"
        : "exception");
      const msg = trim(e?.message ?? String(e));

      // Erros TRANSITÓRIOS — mantém placement em 'pending' pra retry futuro.
      // Não polui o status definitivo, mas registra no log de auditoria.
      const isTransient =
        status === 429 ||
        status === 500 || status === 502 || status === 503 || status === 504 ||
        code === "spotify_circuit_open";

      if (isTransient) {
        await sb.from("catalog_placement_execution_log").insert({
          ...logBase,
          outcome: "skipped",
          error_code: code,
          error_message: msg,
        });
        // não conta como failed nem active — fica pendente
        continue;
      }

      await sb.from("catalog_placements")
        .update({ status: "failed", removed_reason: trim(`${code}: ${msg}`, 480) })
        .eq("id", p.id);
      await sb.from("catalog_placement_execution_log").insert({
        ...logBase,
        outcome: "failed",
        error_code: code,
        error_message: msg,
      });
      cntFailed++;

      // Em 401 o token está morto — invalida cache pra que próximos retries
      // forcem novo refresh (getUserToken já roda refresh interno).
      if (status === 401 && p.owner_spotify_user_id) {
        tokenCache.delete(p.owner_spotify_user_id);
      }
    }
  }

  return jr({
    ok: true,
    processed: pending.length,
    active: cntActive,
    already_present: cntAlready,
    failed: cntFailed,
  });
});
