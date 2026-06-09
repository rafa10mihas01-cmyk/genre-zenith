// Wave 2 — Track ↔ Playlist Fit
// Heurística determinística. Não executa nada. Só popula `track_playlist_fit`.
// POST {} ou {mode:"full"} → recalcula tudo em batches
// POST {mode:"batch", offset, limit} → janela explícita
// POST {mode:"single", spotify_track_id} → recalcula para uma faixa
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Momentum = "forte" | "subindo" | "estavel" | "caindo" | "saturada" | "sem_dados";
type Health = "aquecida" | "estavel" | "esfriando" | "saturada" | "subutilizada" | "sem_dados";

type TrackScore = {
  spotify_track_id: string;
  track_name: string | null;
  artist_name: string | null;
  momentum_class: Momentum;
  streams_7d: number;
  streams_28d: number;
  growth_28d_pct: number | null;
  confidence: number;
};

type PlaylistScore = {
  spotify_playlist_id: string;
  playlist_kind: "curator" | "managed";
  playlist_name: string | null;
  curator_name: string | null;
  health_class: Health;
  followers: number;
  streams_28d: number;
  confidence: number;
};

const MAX_FITS_PER_TRACK = 8;
const MIN_FIT_SCORE = 40;

function classifyRecommendation(opts: {
  alreadyPresent: boolean;
  momentum: Momentum;
  health: Health;
}): "adicionar" | "remover" | "manter" | null {
  const { alreadyPresent, momentum, health } = opts;
  if (!alreadyPresent) {
    if ((momentum === "subindo" || momentum === "forte") &&
        (health === "aquecida" || health === "estavel")) return "adicionar";
    return null;
  }
  // já presente
  if (momentum === "saturada" && (health === "esfriando" || health === "saturada")) return "remover";
  if (momentum === "caindo" && health === "esfriando") return "remover";
  if (momentum === "estavel" && health === "estavel") return "manter";
  if ((momentum === "subindo" || momentum === "forte") && health === "aquecida") return "manter";
  return null;
}

function scoreFit(opts: {
  reasons: string[];
  trackConf: number;
  playlistConf: number;
  momentum: Momentum;
  health: Health;
  alreadyPresent: boolean;
  kind: "adicionar" | "remover" | "manter";
}): number {
  let s = 50;
  const { reasons, momentum, health, kind } = opts;
  if (reasons.includes("genre_match")) s += 20;
  if (reasons.includes("curador_aceita_estilo")) s += 10;
  if (reasons.includes("playlist_aquecida")) s += 8;
  if (reasons.includes("momentum_alinhado")) s += 10;
  if (reasons.includes("gap_de_repertorio")) s += 8;
  if (kind === "remover") s -= 5; // remover é mais delicado, exige sinal claro
  if (momentum === "forte") s += 5;
  if (health === "aquecida" && kind === "adicionar") s += 5;
  return Math.max(0, Math.min(100, Math.round(s)));
}

async function fetchAll<T>(
  supabase: ReturnType<typeof createClient>,
  table: string,
  selectExpr: string,
  pageSize = 1000,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < 200000; from += pageSize) {
    const { data, error } = await supabase.from(table).select(selectExpr).range(from, from + pageSize - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    const arr = (data ?? []) as T[];
    out.push(...arr);
    if (arr.length < pageSize) break;
  }
  return out;
}

async function processForTracks(
  supabase: ReturnType<typeof createClient>,
  trackIds: string[],
): Promise<{ ok: number; failed: number; written: number; errors: string[] }> {
  if (trackIds.length === 0) return { ok: 0, failed: 0, written: 0, errors: [] };

  // 1) Carrega track_ecosystem_score para esses tracks
  const { data: trackRows, error: tErr } = await supabase
    .from("track_ecosystem_score")
    .select("spotify_track_id, track_name, artist_name, momentum_class, streams_7d, streams_28d, growth_28d_pct, confidence")
    .in("spotify_track_id", trackIds);
  if (tErr) return { ok: 0, failed: trackIds.length, written: 0, errors: [tErr.message] };
  const tracks = (trackRows ?? []) as TrackScore[];
  if (tracks.length === 0) return { ok: 0, failed: 0, written: 0, errors: [] };

  // 2) Carrega TODAS as playlist scores (universo de candidatos)
  const playlistRows = await fetchAll<PlaylistScore>(
    supabase, "playlist_ecosystem_score",
    "spotify_playlist_id, playlist_kind, playlist_name, curator_name, health_class, followers, streams_28d, confidence",
  );
  const playlistsByOwner = new Map<string, PlaylistScore[]>();
  for (const p of playlistRows) {
    const key = (p.curator_name ?? "_") + "|" + (p.playlist_kind);
    if (!playlistsByOwner.has(key)) playlistsByOwner.set(key, []);
    playlistsByOwner.get(key)!.push(p);
  }

  // 3) Genre map: spotify_track_id → Set<genre_id>
  const genreByTrack = new Map<string, Set<string>>();
  {
    const { data } = await supabase
      .from("search_tracks")
      .select("spotify_track_id, genre_id")
      .in("spotify_track_id", trackIds);
    for (const r of (data ?? []) as any[]) {
      if (!r.spotify_track_id || !r.genre_id) continue;
      const set = genreByTrack.get(r.spotify_track_id) ?? new Set<string>();
      set.add(r.genre_id);
      genreByTrack.set(r.spotify_track_id, set);
    }
  }

  // 4) Presença: para cada track, em quais playlists ela já está (curator_playlists)
  //    e quais curators a aceitaram alguma vez.
  // curator_playlists.song_id → curator_deal_songs.id → spotify_track_id
  const presentMap = new Map<string, Set<string>>(); // track → Set<spotify_playlist_id>
  const acceptedByCurator = new Map<string, Set<string>>(); // track → Set<curator_name>
  {
    // primeiro: pegar todos os deal_songs desses tracks
    const { data: dealSongs } = await supabase
      .from("curator_deal_songs")
      .select("id, spotify_track_id")
      .in("spotify_track_id", trackIds);
    const songIdToTrack = new Map<string, string>();
    for (const r of (dealSongs ?? []) as any[]) {
      if (r.id && r.spotify_track_id) songIdToTrack.set(r.id, r.spotify_track_id);
    }
    const songIds = Array.from(songIdToTrack.keys());
    if (songIds.length > 0) {
      // pagina por chunks de 500 ids
      for (let i = 0; i < songIds.length; i += 500) {
        const chunk = songIds.slice(i, i + 500);
        const { data: cps } = await supabase
          .from("v_curator_playlists_operational")
          .select("song_id, spotify_playlist_id, spotify_owner_name")
          .in("song_id", chunk)
          .not("spotify_playlist_id", "is", null);
        for (const r of (cps ?? []) as any[]) {
          const trackId = songIdToTrack.get(r.song_id);
          if (!trackId) continue;
          if (r.spotify_playlist_id) {
            const set = presentMap.get(trackId) ?? new Set<string>();
            set.add(r.spotify_playlist_id);
            presentMap.set(trackId, set);
          }
          if (r.spotify_owner_name) {
            const set = acceptedByCurator.get(trackId) ?? new Set<string>();
            set.add(r.spotify_owner_name);
            acceptedByCurator.set(trackId, set);
          }
        }
      }
    }
  }

  // 5) Genre dominante por playlist: pega 1 amostra de search_tracks por playlist via tracks já presentes
  //    Heurística leve: para cada playlist consideramos seus genre_ids derivados das tracks nossas presentes.
  const genreByPlaylist = new Map<string, Set<string>>();
  for (const [trackId, plSet] of presentMap.entries()) {
    const gset = genreByTrack.get(trackId);
    if (!gset) continue;
    for (const pid of plSet) {
      const dest = genreByPlaylist.get(pid) ?? new Set<string>();
      for (const g of gset) dest.add(g);
      genreByPlaylist.set(pid, dest);
    }
  }

  // 6) Para cada track, gerar candidatos
  const upserts: any[] = [];
  for (const t of tracks) {
    const trackGenres = genreByTrack.get(t.spotify_track_id) ?? new Set<string>();
    const present = presentMap.get(t.spotify_track_id) ?? new Set<string>();
    const acceptedCurators = acceptedByCurator.get(t.spotify_track_id) ?? new Set<string>();

    const candidates: any[] = [];

    for (const p of playlistRows) {
      if (p.playlist_kind !== "curator") continue; // managed não temos vínculo de track ainda
      if (p.health_class === "sem_dados") continue;
      const alreadyPresent = present.has(p.spotify_playlist_id);
      const reasons: string[] = [];
      const pGenres = genreByPlaylist.get(p.spotify_playlist_id) ?? new Set<string>();
      let genreOverlap = false;
      for (const g of trackGenres) { if (pGenres.has(g)) { genreOverlap = true; break; } }
      if (genreOverlap) reasons.push("genre_match");
      if (p.curator_name && acceptedCurators.has(p.curator_name)) reasons.push("curador_aceita_estilo");
      if (p.health_class === "aquecida") reasons.push("playlist_aquecida");
      if ((t.momentum_class === "subindo" || t.momentum_class === "forte") &&
          (p.health_class === "aquecida" || p.health_class === "estavel")) reasons.push("momentum_alinhado");
      if (!alreadyPresent && genreOverlap && p.health_class === "aquecida") reasons.push("gap_de_repertorio");

      const kind = classifyRecommendation({
        alreadyPresent,
        momentum: t.momentum_class,
        health: p.health_class,
      });
      if (!kind) continue;
      // exigir pelo menos uma razão concreta
      if (reasons.length === 0) continue;

      const fit_score = scoreFit({
        reasons,
        trackConf: t.confidence ?? 0,
        playlistConf: p.confidence ?? 0,
        momentum: t.momentum_class,
        health: p.health_class,
        alreadyPresent,
        kind,
      });
      if (fit_score < MIN_FIT_SCORE) continue;

      const confidence = Math.min(t.confidence ?? 0, p.confidence ?? 0);

      candidates.push({
        spotify_track_id: t.spotify_track_id,
        spotify_playlist_id: p.spotify_playlist_id,
        playlist_kind: p.playlist_kind,
        fit_score,
        fit_reason: reasons,
        recommendation_kind: kind,
        evidence: {
          track: {
            name: t.track_name, artist: t.artist_name,
            momentum: t.momentum_class,
            streams_7d: t.streams_7d, streams_28d: t.streams_28d,
            growth_28d_pct: t.growth_28d_pct, confidence: t.confidence,
          },
          playlist: {
            name: p.playlist_name, curator: p.curator_name,
            health: p.health_class, followers: p.followers,
            streams_28d: p.streams_28d, confidence: p.confidence,
          },
          shared_genres: Array.from(trackGenres).filter((g) => pGenres.has(g)),
        },
        already_present: alreadyPresent,
        confidence: Math.round(confidence * 100) / 100,
        calculated_at: new Date().toISOString(),
      });
    }

    // top-N por fit_score
    candidates.sort((a, b) => b.fit_score - a.fit_score);
    upserts.push(...candidates.slice(0, MAX_FITS_PER_TRACK));
  }

  // 7) Limpar antigos desses tracks e inserir novos (estratégia "reset por track")
  let written = 0;
  const errs: string[] = [];
  {
    const { error: delErr } = await supabase
      .from("track_playlist_fit")
      .delete()
      .in("spotify_track_id", trackIds);
    if (delErr) errs.push(`delete: ${delErr.message}`);
  }
  if (upserts.length > 0) {
    // insere em chunks de 500
    for (let i = 0; i < upserts.length; i += 500) {
      const chunk = upserts.slice(i, i + 500);
      const { error: insErr } = await supabase.from("track_playlist_fit").insert(chunk);
      if (insErr) errs.push(`insert: ${insErr.message}`);
      else written += chunk.length;
    }
  }

  return { ok: tracks.length, failed: trackIds.length - tracks.length, written, errors: errs.slice(0, 5) };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const mode = body?.mode ?? "full";

    if (mode === "single") {
      const tid = body?.spotify_track_id;
      if (!tid) {
        return new Response(JSON.stringify({ error: "spotify_track_id required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const result = await processForTracks(supabase, [tid]);
      return new Response(JSON.stringify({ mode, ...result }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Lista distinct track ids de track_ecosystem_score (universo)
    const allTracks: string[] = [];
    const seen = new Set<string>();
    const PAGE = 1000;
    for (let from = 0; from < 100000; from += PAGE) {
      const { data, error } = await supabase
        .from("track_ecosystem_score")
        .select("spotify_track_id")
        .order("spotify_track_id", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) break;
      const arr = (data ?? []) as any[];
      if (arr.length === 0) break;
      for (const r of arr) {
        if (r.spotify_track_id && !seen.has(r.spotify_track_id)) {
          seen.add(r.spotify_track_id);
          allTracks.push(r.spotify_track_id);
        }
      }
      if (arr.length < PAGE) break;
    }

    const offset = Number(body?.offset ?? 0);
    const limit = Math.min(Number(body?.limit ?? 25), 50);
    const slice = allTracks.slice(offset, offset + limit);

    const result = await processForTracks(supabase, slice);

    const processed_to = offset + slice.length;
    const has_more = processed_to < allTracks.length;
    return new Response(JSON.stringify({
      mode: body?.mode ?? "full",
      total: allTracks.length,
      offset, limit, processed_to, has_more,
      ...result,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
