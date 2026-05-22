// learning-audit — Painel de Auditoria do Aprendizado (Wave 4)
// GET ?genre_id=...
// Retorna:
//   - genre, current model + locked
//   - keywords/artists/tracks com origem, ocorrência, status (locked)
//   - winners que ensinaram cada keyword (top 10 contribuidores por kw)
//   - diff vs último snapshot (added/removed)
//   - drift signals (heurísticas)
//   - history últimos 10 runs
//   - top winners do gênero

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { requireTeamAccess } from "../_shared/auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function tokenize(text: string): string[] {
  return text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(t => t.length >= 3);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const guard = await requireTeamAccess(req);
  if (!guard.ok) return guard.resp;
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);


  try {
    const url = new URL(req.url);
    const genreId = url.searchParams.get("genre_id");

    // Lista de gêneros sempre (para sidebar)
    const { data: allGenres } = await supabase
      .from("genres")
      .select("id, slug, nome, ativo")
      .eq("ativo", true)
      .order("nome");

    // Stats por gênero (count winners + última análise)
    const genresWithStats = [];
    for (const g of allGenres ?? []) {
      const { count: winners } = await supabase
        .from("search_results")
        .select("*", { count: "exact", head: true })
        .eq("genre_id", g.id)
        .gte("winner_score", 65)
        .is("duplicate_of", null);
      const { data: model } = await supabase
        .from("genre_models")
        .select("ultima_analise, insights")
        .eq("genre_id", g.id)
        .maybeSingle();
      genresWithStats.push({
        ...g,
        winners_count: winners ?? 0,
        last_learned_at: (model?.insights as any)?.learning?.last_learned_at ?? model?.ultima_analise ?? null,
      });
    }

    if (!genreId) {
      return new Response(JSON.stringify({ ok: true, genres: genresWithStats }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Detalhe do gênero
    const { data: genre } = await supabase.from("genres").select("id, slug, nome").eq("id", genreId).maybeSingle();
    const { data: model } = await supabase
      .from("genre_models")
      .select("palavras_chave, musicas_recorrentes, insights, ultima_analise")
      .eq("genre_id", genreId)
      .maybeSingle();

    const learning = (model?.insights as any)?.learning ?? {};
    const lockedKw: string[] = (learning.locked_keywords ?? []).map((s: string) => String(s).toLowerCase());
    const lockedArt: string[] = (learning.locked_artists ?? []).map((s: string) => String(s).toLowerCase());

    // Top winners do gênero (para contribuição)
    const { data: winners } = await supabase
      .from("search_results")
      .select("id, nome_playlist, descricao, spotify_url, spotify_playlist_id, seguidores, winner_score, owner_id, owner_type")
      .eq("genre_id", genreId)
      .gte("winner_score", 65)
      .is("duplicate_of", null)
      .order("winner_score", { ascending: false })
      .limit(100);

    const winnerList = winners ?? [];

    // Para cada keyword aprendida, descobre quais winners contêm
    const keywords = (model?.palavras_chave as any[] ?? []).map((kEntry: any) => {
      const value = typeof kEntry === "string" ? kEntry : (kEntry.value ?? kEntry.keyword ?? "");
      const count = typeof kEntry === "string" ? 0 : (kEntry.count ?? 0);
      const source = typeof kEntry === "string" ? "manual" : (kEntry.source ?? (kEntry.locked ? "manual" : "manual"));
      const locked = lockedKw.includes(String(value).toLowerCase()) || !!kEntry?.locked;
      const valLower = String(value).toLowerCase();
      const contributors = winnerList
        .filter(w => `${w.nome_playlist ?? ""} ${w.descricao ?? ""}`.toLowerCase().includes(valLower))
        .slice(0, 10)
        .map(w => ({ id: w.id, name: w.nome_playlist, winner_score: w.winner_score, url: w.spotify_url }));
      // confiança: cobertura nos winners (0..100)
      const coverage = winnerList.length > 0 ? Math.round((contributors.length / Math.min(10, winnerList.length)) * 100) : 0;
      // drift signals
      const driftSignals: string[] = [];
      if (count <= 1 && !locked && source === "wave4") driftSignals.push("baixa ocorrência");
      if (value && value.length <= 3) driftSignals.push("token curto");
      if (/^\d+$/.test(String(value))) driftSignals.push("numérico");
      return {
        value,
        count,
        source,
        locked,
        coverage,
        contributors,
        drift_signals: driftSignals,
      };
    }).sort((a, b) => Number(b.locked) - Number(a.locked) || (b.count - a.count));

    // Artistas (a partir de insights.learning.top_artists + locked)
    const topArtists = (learning.top_artists ?? []) as { artista: string; count: number }[];
    const allArtistKeys = new Set<string>([
      ...topArtists.map(a => a.artista.toLowerCase()),
      ...lockedArt,
    ]);
    const artists = [...allArtistKeys].map(a => {
      const found = topArtists.find(t => t.artista.toLowerCase() === a);
      return {
        artista: found?.artista ?? a,
        count: found?.count ?? 0,
        source: found ? "wave4" : "manual",
        locked: lockedArt.includes(a),
      };
    }).sort((x, y) => Number(y.locked) - Number(x.locked) || (y.count - x.count));

    // Tracks recorrentes
    const tracks = (model?.musicas_recorrentes as any[] ?? []).map((t: any) => ({
      nome_musica: t.nome_musica ?? t.musica ?? "",
      artista: t.artista ?? "",
      ocorrencias: t.ocorrencias ?? t.count ?? 0,
      spotify_track_id: t.spotify_track_id ?? null,
      source: t.source ?? "wave4",
    }));

    // Snapshots — últimos 2 para diff
    const { data: snaps } = await supabase
      .from("learning_snapshots")
      .select("id, snapshot_at, winners_count, keywords, artists, tracks, insights")
      .eq("genre_id", genreId)
      .order("snapshot_at", { ascending: false })
      .limit(10);

    let diff = null;
    if (snaps && snaps.length >= 1) {
      // diff = current vs prev_keywords/prev_tracks gravados no snapshot mais recente
      const last = snaps[0];
      const prevKw = ((last.insights as any)?.prev_keywords ?? []).map((k: any) => typeof k === "string" ? k : k.value).filter(Boolean);
      const curKw = keywords.map(k => k.value);
      const addedKw = curKw.filter(k => !prevKw.includes(k));
      const removedKw = prevKw.filter((k: string) => !curKw.includes(k));
      const prevTracks = ((last.insights as any)?.prev_tracks ?? []).map((t: any) => t.spotify_track_id ?? `${t.nome_musica}::${t.artista}`);
      const curTracks = tracks.map(t => t.spotify_track_id ?? `${t.nome_musica}::${t.artista}`);
      diff = {
        last_run_at: last.snapshot_at,
        added_keywords: addedKw,
        removed_keywords: removedKw,
        emerging_tracks: curTracks.filter(t => !prevTracks.includes(t)).length,
      };
    }

    // Histórico — runs Wave 4 (últimas 10)
    const { data: history } = await supabase
      .from("discovery_wave1_reports")
      .select("id, created_at, stats")
      .eq("wave", "wave4-learn-from-winners")
      .order("created_at", { ascending: false })
      .limit(10);

    const historyForGenre = (history ?? []).map(h => {
      const byGenre = (h.stats as any)?.by_genre ?? [];
      const own = byGenre.find((b: any) => b.genre_id === genreId);
      return {
        id: h.id,
        created_at: h.created_at,
        winners: own?.winners ?? 0,
        keywords_added: own?.keywords_top?.length ?? 0,
        updated: !!own?.updated,
        reason: own?.reason ?? null,
      };
    });

    // Drift global do gênero
    const driftCount = keywords.filter(k => k.drift_signals.length > 0).length;
    const driftRatio = keywords.length > 0 ? driftCount / keywords.length : 0;
    const driftAlert = driftRatio > 0.4 ? "alto" : driftRatio > 0.2 ? "médio" : "baixo";

    // Top winners (já temos)
    const topWinners = winnerList.slice(0, 15).map(w => ({
      id: w.id,
      nome: w.nome_playlist,
      winner_score: w.winner_score,
      seguidores: w.seguidores,
      url: w.spotify_url,
      owner: w.owner_id,
    }));

    return new Response(JSON.stringify({
      ok: true,
      genres: genresWithStats,
      genre,
      ultima_analise: model?.ultima_analise ?? null,
      learning_meta: learning,
      keywords,
      artists,
      tracks,
      diff,
      history: historyForGenre,
      drift: { ratio: driftRatio, alert: driftAlert, count: driftCount, total: keywords.length },
      top_winners: topWinners,
      total_winners: winnerList.length,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("[learning-audit] fatal", e);
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
