// genre-confidence-calc — calcula confidence multi-gênero pra uma ou todas as playlists.
//
// Fonte de verdade = comportamento do ecossistema NexEngine.
// Spotify entra apenas como sinal secundário (~10%).
//
// Fontes de evidência (todas ponderadas por recência via recencyWeight):
//   - search_terms que descobriram a playlist (search_results.term_id -> genre_id)
//   - tracks recorrentes do nicho (search_tracks por result_id da playlist)
//   - artistas dominantes (derivado das mesmas search_tracks)
//   - SEO do título (matching contra genres.palavras_chave / genre_models)
//
// Modos:
//   { playlist_id: "uuid" }    -> calcula 1 playlist
//   { batch: true, limit: N }  -> calcula playlists ownership='own' (default 200, max 500)
//   { batch: "all", limit: N } -> calcula TODAS playlists (próprias + externas)
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { requireTeamAccess } from "../_shared/auth.ts";
import { recencyWeight, normalize } from "../_shared/recency.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Pesos por fonte (somam ~1.0). Spotify fica de fora aqui na fase 1 — entra na fase 5+.
const W = {
  search_terms: 0.35,
  tracks_recurrence: 0.30,
  artists_dominance: 0.15,
  seo_title: 0.20,
};

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type GenreSeed = { id: string; nome: string; palavras_chave: any };

async function loadGenres(sb: any): Promise<GenreSeed[]> {
  const { data } = await sb.from("genres").select("id, nome, palavras_chave");
  return (data ?? []) as GenreSeed[];
}

function tokenize(s: string | null | undefined): string[] {
  if (!s) return [];
  return s.toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/).filter(t => t.length >= 3);
}

function genreKeywords(g: GenreSeed): string[] {
  const out: string[] = [g.nome?.toLowerCase()].filter(Boolean) as string[];
  const kw = g.palavras_chave;
  if (Array.isArray(kw)) {
    for (const k of kw) {
      if (typeof k === "string") out.push(k.toLowerCase());
      else if (k && typeof k === "object" && typeof k.termo === "string") out.push(k.termo.toLowerCase());
    }
  }
  return Array.from(new Set(out)).filter(Boolean);
}

async function calcOne(sb: any, playlistId: string, genres: GenreSeed[]) {
  // 1. Playlist canonical
  const { data: pl, error: plErr } = await sb
    .from("playlists")
    .select("id, spotify_playlist_id, name, genre_id, followers")
    .eq("id", playlistId)
    .maybeSingle();
  if (plErr || !pl) throw new Error(`playlist ${playlistId} não encontrada`);

  const now = new Date();
  // Score acumulado por genre_id, e evidência detalhada
  const scoreByGenre = new Map<string, number>();
  const evidByGenre = new Map<string, any>();
  const bump = (gid: string, val: number, key: string, detail: any) => {
    if (!gid || val <= 0) return;
    scoreByGenre.set(gid, (scoreByGenre.get(gid) ?? 0) + val);
    const ev = evidByGenre.get(gid) ?? {};
    ev[key] = detail;
    evidByGenre.set(gid, ev);
  };

  // === Fonte A: search_results que apontam pra essa playlist ===
  // Procura por spotify_playlist_id (mais confiável que nome).
  const { data: results } = await sb
    .from("search_results")
    .select("id, genre_id, term_id, coletado_em, last_seen_at, seguidores")
    .eq("spotify_playlist_id", pl.spotify_playlist_id);

  const resultIds: string[] = [];
  let searchTermsTotal = 0;
  const searchTermsByGenre = new Map<string, number>();
  for (const r of (results ?? [])) {
    resultIds.push(r.id);
    if (!r.genre_id) continue;
    const w = recencyWeight(r.last_seen_at ?? r.coletado_em, now);
    searchTermsByGenre.set(r.genre_id, (searchTermsByGenre.get(r.genre_id) ?? 0) + w);
    searchTermsTotal += w;
  }
  if (searchTermsTotal > 0) {
    for (const [gid, v] of searchTermsByGenre) {
      bump(gid, W.search_terms * (v / searchTermsTotal), "search_terms", {
        weighted_hits: Number(v.toFixed(3)), total_weighted: Number(searchTermsTotal.toFixed(3)),
      });
    }
  }

  // === Fonte B: tracks recorrentes do nicho ===
  // Pega tracks dessa playlist e olha em quantos search_results (de outros gêneros)
  // a mesma spotify_track_id aparece. Quanto mais recorrente num gênero, mais peso.
  let tracksTotal = 0;
  const tracksByGenre = new Map<string, number>();
  if (resultIds.length > 0) {
    const { data: myTracks } = await sb
      .from("search_tracks")
      .select("spotify_track_id, coletado_em")
      .in("result_id", resultIds)
      .not("spotify_track_id", "is", null)
      .limit(200);

    const trackIds = Array.from(new Set((myTracks ?? []).map((t: any) => t.spotify_track_id).filter(Boolean)));
    if (trackIds.length > 0) {
      // Conta recorrência ponderada por gênero
      const { data: recur } = await sb
        .from("search_tracks")
        .select("genre_id, spotify_track_id, coletado_em")
        .in("spotify_track_id", trackIds);

      for (const t of (recur ?? [])) {
        if (!t.genre_id) continue;
        const w = recencyWeight(t.coletado_em, now);
        tracksByGenre.set(t.genre_id, (tracksByGenre.get(t.genre_id) ?? 0) + w);
        tracksTotal += w;
      }
    }
  }
  if (tracksTotal > 0) {
    for (const [gid, v] of tracksByGenre) {
      bump(gid, W.tracks_recurrence * (v / tracksTotal), "tracks_recurrence", {
        weighted_hits: Number(v.toFixed(3)), total_weighted: Number(tracksTotal.toFixed(3)),
      });
    }
  }

  // === Fonte C: artistas dominantes === (derivado das mesmas tracks)
  if (resultIds.length > 0) {
    const { data: myArtists } = await sb
      .from("search_tracks")
      .select("artista, coletado_em")
      .in("result_id", resultIds)
      .limit(200);
    const artistSet = Array.from(new Set((myArtists ?? []).map((t: any) => (t.artista ?? "").trim().toLowerCase()).filter(Boolean)));
    if (artistSet.length > 0) {
      // Quantos artistas únicos meus aparecem em search_tracks de cada gênero
      const { data: artRecur } = await sb
        .from("search_tracks")
        .select("genre_id, artista, coletado_em")
        .in("artista", artistSet);

      const artistsByGenre = new Map<string, number>();
      let artistsTotal = 0;
      for (const t of (artRecur ?? [])) {
        if (!t.genre_id) continue;
        const w = recencyWeight(t.coletado_em, now);
        artistsByGenre.set(t.genre_id, (artistsByGenre.get(t.genre_id) ?? 0) + w);
        artistsTotal += w;
      }
      if (artistsTotal > 0) {
        for (const [gid, v] of artistsByGenre) {
          bump(gid, W.artists_dominance * (v / artistsTotal), "artists_dominance", {
            weighted_hits: Number(v.toFixed(3)), unique_artists: artistSet.length,
          });
        }
      }
    }
  }

  // === Fonte D: SEO do título ===
  const nameTokens = new Set(tokenize(pl.name));
  if (nameTokens.size > 0) {
    let seoTotal = 0;
    const seoByGenre = new Map<string, number>();
    for (const g of genres) {
      let matches = 0;
      for (const kw of genreKeywords(g)) {
        // match por inclusão de token ou de substring no nome inteiro
        if (nameTokens.has(kw)) matches += 2;
        else if ((pl.name ?? "").toLowerCase().includes(kw)) matches += 1;
      }
      if (matches > 0) {
        seoByGenre.set(g.id, matches);
        seoTotal += matches;
      }
    }
    if (seoTotal > 0) {
      for (const [gid, v] of seoByGenre) {
        bump(gid, W.seo_title * (v / seoTotal), "seo_title", { match_strength: v });
      }
    }
  }

  // === Normaliza scores pra confidence (0..1) ===
  // Soma total dos pesos coletados é o denominador; cada gênero vira sua fatia.
  let totalScore = 0;
  for (const v of scoreByGenre.values()) totalScore += v;

  const entries = Array.from(scoreByGenre.entries())
    .map(([gid, raw]) => ({
      gid,
      confidence: totalScore > 0 ? raw / totalScore : 0,
      raw_score: raw,
    }))
    .filter(e => e.confidence > 0.01)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 8); // no máximo top 8 gêneros por playlist

  // Define o primary genre
  // - Se houver candidato com confidence >= 0.25, vira primary
  // - Senão mantém o genre_id atual da playlist (fallback)
  const topCandidate = entries[0];
  let primaryGid: string | null = null;
  if (topCandidate && topCandidate.confidence >= 0.25) primaryGid = topCandidate.gid;
  else primaryGid = pl.genre_id ?? topCandidate?.gid ?? null;

  // === Persistência ===
  // Apaga linhas anteriores dessa playlist pra não acumular gêneros mortos
  await sb.from("playlist_genres").delete().eq("playlist_id", pl.id);

  if (entries.length > 0) {
    const rows = entries.map(e => ({
      playlist_id: pl.id,
      genre_id: e.gid,
      confidence: Number(e.confidence.toFixed(4)),
      source: "auto_confidence_v1",
      evidence: {
        raw_score: Number(e.raw_score.toFixed(4)),
        signals: evidByGenre.get(e.gid) ?? {},
        weights: W,
      },
      is_primary: e.gid === primaryGid,
      calculated_at: now.toISOString(),
    }));
    const { error: insErr } = await sb.from("playlist_genres").insert(rows);
    if (insErr) throw new Error(`insert playlist_genres: ${insErr.message}`);
  }

  return {
    playlist_id: pl.id,
    name: pl.name,
    primary_genre_id: primaryGid,
    candidates: entries.map(e => ({ genre_id: e.gid, confidence: Number(e.confidence.toFixed(4)) })),
    total_candidates: entries.length,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const guard = await requireTeamAccess(req);
  if (!guard.ok) return guard.resp;

  try {
    const body = await req.json().catch(() => ({}));
    const sb = createClient(SUPABASE_URL, SERVICE_KEY);
    const genres = await loadGenres(sb);

    if (body?.playlist_id) {
      const result = await calcOne(sb, body.playlist_id, genres);
      return jr({ ok: true, mode: "single", result });
    }

    if (body?.batch) {
      const limit = Math.min(body?.limit ?? 200, 500);
      let q = sb.from("playlists").select("id");
      if (body.batch !== "all") q = q.eq("ownership", "own");
      const { data: list, error: lErr } = await q.limit(limit);
      if (lErr) throw new Error(lErr.message);

      const results: any[] = [];
      const errors: any[] = [];
      const CONCURRENCY = 4;
      const subset = list ?? [];
      for (let i = 0; i < subset.length; i += CONCURRENCY) {
        const chunk = subset.slice(i, i + CONCURRENCY);
        const settled = await Promise.allSettled(chunk.map((p: any) => calcOne(sb, p.id, genres)));
        settled.forEach((s, idx) => {
          if (s.status === "fulfilled") results.push(s.value);
          else errors.push({ playlist_id: chunk[idx].id, error: s.reason?.message ?? String(s.reason) });
        });
      }
      return jr({
        ok: true, mode: "batch",
        processed: results.length, errors_count: errors.length,
        errors: errors.slice(0, 10),
        sample: results.slice(0, 5),
      });
    }

    return jr({ ok: false, error: "informe playlist_id ou batch:true" }, 400);
  } catch (e) {
    return jr({ ok: false, error: (e as Error).message }, 500);
  }
});
