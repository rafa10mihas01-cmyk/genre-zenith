// learn-from-winners — Onda 4 (Autoaprendizado)
//
// Para cada gênero ativo:
//   1) Seleciona "winners" (winner_score >= MIN, não-duplicados, enriched)
//   2) Extrai keywords recorrentes (nome + descrição) → tokens normalizados
//   3) Extrai artistas recorrentes (search_tracks vinculados aos winners)
//   4) Atualiza genre_models.palavras_chave e musicas_recorrentes
//      (preservando entries lockadas em insights.learning.locked_keywords/artists)
//   5) Atualiza insights.learning com metadados de proveniência
//
// Acionamento:
//   - POST manual: { genre_id?, min_winner?, top_keywords?, top_artists? }
//   - Cron via x-cron-secret

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { reportCronHealth } from "../_shared/cron-health.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Stopwords PT/EN/ES + termos de playlist genéricos
const STOPWORDS = new Set<string>([
  "a","o","e","de","do","da","dos","das","em","no","na","nos","nas","um","uma","uns","umas",
  "para","por","com","sem","que","como","mais","menos","muito","pouco","top","best","mix",
  "the","of","and","for","in","on","at","is","to","from","with","by","or","an","this","that",
  "playlist","playlists","oficial","official","2024","2025","2026","2023","spotify","music",
  "musicas","música","músicas","songs","song","feat","ft","la","el","las","los","y","es",
  "hits","hit","new","novas","novo","novas","melhores","melhor","tudo","só","you","your",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(t => t.length >= 3 && t.length <= 24 && !STOPWORDS.has(t) && !/^\d+$/.test(t));
}

function normalizeArtist(a: string): string {
  return a.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

interface LearnStats {
  genre_id: string;
  slug: string;
  winners: number;
  keywords_top: { value: string; count: number }[];
  artists_top: { artista: string; count: number }[];
  updated: boolean;
  reason?: string;
}

async function learnGenre(
  supabase: any,
  genreId: string,
  opts: { minWinner: number; topKeywords: number; topArtists: number; minWinnersRequired: number },
): Promise<LearnStats> {
  const { data: genre } = await supabase.from("genres").select("slug,nome").eq("id", genreId).maybeSingle();
  const slug = (genre?.slug ?? "?") as string;

  const { data: winners } = await supabase
    .from("search_results")
    .select("id, nome_playlist, descricao, winner_score")
    .eq("genre_id", genreId)
    .gte("winner_score", opts.minWinner)
    .is("duplicate_of", null)
    .not("enriched_at", "is", null)
    .order("winner_score", { ascending: false })
    .limit(300);

  const winnerList = winners ?? [];
  if (winnerList.length < opts.minWinnersRequired) {
    return { genre_id: genreId, slug, winners: winnerList.length, keywords_top: [], artists_top: [], updated: false, reason: `insufficient_winners(<${opts.minWinnersRequired})` };
  }

  // 1) Keywords — token frequency
  const kwCount = new Map<string, number>();
  for (const w of winnerList) {
    const hay = `${w.nome_playlist ?? ""} ${w.descricao ?? ""}`;
    const seen = new Set<string>();
    for (const tok of tokenize(hay)) {
      if (seen.has(tok)) continue; // 1x por playlist
      seen.add(tok);
      kwCount.set(tok, (kwCount.get(tok) ?? 0) + 1);
    }
  }
  // exige ocorrência em >= 10% dos winners ou min 3
  const minOcc = Math.max(3, Math.floor(winnerList.length * 0.10));
  const keywordsTop = [...kwCount.entries()]
    .filter(([_, c]) => c >= minOcc)
    .sort((a, b) => b[1] - a[1])
    .slice(0, opts.topKeywords)
    .map(([value, count]) => ({ value, count }));

  // 2) Artists — via search_tracks
  const winnerIds = winnerList.map(w => w.id);
  const { data: tracks } = await supabase
    .from("search_tracks")
    .select("artista, nome_musica, spotify_track_id")
    .in("result_id", winnerIds)
    .limit(20000);

  const artistCount = new Map<string, number>();
  const trackCount = new Map<string, { nome_musica: string; artista: string; count: number; spotify_track_id: string | null }>();
  for (const t of tracks ?? []) {
    if (!t.artista) continue;
    for (const part of String(t.artista).split(/[,&]| feat\.?| ft\.?/i)) {
      const norm = normalizeArtist(part);
      if (norm.length < 2) continue;
      artistCount.set(norm, (artistCount.get(norm) ?? 0) + 1);
    }
    // top tracks recorrentes
    const key = `${t.spotify_track_id ?? `${t.nome_musica}::${t.artista}`}`;
    const cur = trackCount.get(key);
    if (cur) cur.count++;
    else trackCount.set(key, { nome_musica: t.nome_musica, artista: t.artista, count: 1, spotify_track_id: t.spotify_track_id ?? null });
  }
  const artistsTop = [...artistCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, opts.topArtists)
    .map(([artista, count]) => ({ artista, count }));

  const recurrentTracks = [...trackCount.values()]
    .filter(t => t.count >= 2)
    .sort((a, b) => b.count - a.count)
    .slice(0, 50);

  // 3) Load current model + locked entries
  const { data: existing } = await supabase
    .from("genre_models")
    .select("palavras_chave, musicas_recorrentes, insights")
    .eq("genre_id", genreId)
    .maybeSingle();

  const lockedKw: string[] = ((existing?.insights as any)?.learning?.locked_keywords ?? []).map((s: string) => s.toLowerCase());
  const lockedArt: string[] = ((existing?.insights as any)?.learning?.locked_artists ?? []).map((s: string) => s.toLowerCase());

  // 4) Merge: preserva lockados + adiciona aprendidos
  const finalKeywords = [
    ...lockedKw.map(v => ({ value: v, count: 0, locked: true })),
    ...keywordsTop.filter(k => !lockedKw.includes(k.value)).map(k => ({ ...k, source: "wave4" as const })),
  ];
  const finalArtists = (() => {
    // mantemos musicas_recorrentes como recurrent tracks; artistas alimentam só a learning meta + ctx
    const out = recurrentTracks.map(t => ({ nome_musica: t.nome_musica, artista: t.artista, ocorrencias: t.count, spotify_track_id: t.spotify_track_id, source: "wave4" }));
    return out;
  })();

  const insightsBase = (existing?.insights as any) ?? {};
  const newInsights = {
    ...insightsBase,
    learning: {
      ...(insightsBase.learning ?? {}),
      last_learned_at: new Date().toISOString(),
      source: "wave4-learn-from-winners",
      winners_count: winnerList.length,
      min_winner_score: opts.minWinner,
      top_artists: artistsTop,
      locked_keywords: lockedKw,
      locked_artists: lockedArt,
    },
  };

  // Não sobrescreve se aprendeu 0 keywords E 0 tracks recorrentes (provavelmente ruído)
  if (finalKeywords.length === 0 && finalArtists.length === 0) {
    return { genre_id: genreId, slug, winners: winnerList.length, keywords_top: [], artists_top: artistsTop, updated: false, reason: "no_signal" };
  }

  // Snapshot ANTES de aplicar (para diff/revert)
  try {
    await supabase.from("learning_snapshots").insert({
      genre_id: genreId,
      source: "wave4-learn-from-winners",
      winners_count: winnerList.length,
      min_winner_score: opts.minWinner,
      keywords: finalKeywords,
      artists: finalArtists,
      tracks: recurrentTracks,
      insights: { top_artists: artistsTop, prev_keywords: existing?.palavras_chave ?? [], prev_tracks: existing?.musicas_recorrentes ?? [] },
    });
  } catch (e) { console.warn("[learn] snapshot skipped:", (e as Error).message); }

  const { error } = await supabase.from("genre_models").upsert({
    genre_id: genreId,
    palavras_chave: finalKeywords,
    musicas_recorrentes: finalArtists,
    insights: newInsights,
    ultima_analise: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }, { onConflict: "genre_id" });

  if (error) {
    return { genre_id: genreId, slug, winners: winnerList.length, keywords_top: keywordsTop, artists_top: artistsTop, updated: false, reason: error.message };
  }

  return { genre_id: genreId, slug, winners: winnerList.length, keywords_top: keywordsTop, artists_top: artistsTop, updated: true };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

  try {
    let body: any = {};
    if (req.method === "POST") { try { body = await req.json(); } catch { /* */ } }

    const minWinner = Number(body.min_winner ?? 65);
    const topKeywords = Math.min(Number(body.top_keywords ?? 40), 100);
    const topArtists = Math.min(Number(body.top_artists ?? 30), 100);
    const minWinnersRequired = Math.max(3, Number(body.min_winners_required ?? 5));

    let genreIds: string[];
    if (body.genre_id) genreIds = [body.genre_id];
    else {
      const { data } = await supabase.from("genres").select("id").eq("ativo", true);
      genreIds = (data ?? []).map((g: any) => g.id);
    }

    const results: LearnStats[] = [];
    for (const gid of genreIds) {
      try {
        results.push(await learnGenre(supabase, gid, { minWinner, topKeywords, topArtists, minWinnersRequired }));
      } catch (e) {
        results.push({ genre_id: gid, slug: "?", winners: 0, keywords_top: [], artists_top: [], updated: false, reason: (e as Error).message });
      }
    }

    const updated = results.filter(r => r.updated).length;
    try {
      await supabase.from("discovery_wave1_reports").insert({
        wave: "wave4-learn-from-winners",
        stats: { min_winner: minWinner, top_keywords: topKeywords, top_artists: topArtists, updated, by_genre: results },
      });
    } catch (e) { console.warn("[learn] report skipped:", (e as Error).message); }

    return new Response(JSON.stringify({ ok: true, updated, total: results.length, by_genre: results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[learn] fatal", e);
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
