// enrich-playlist-dna — FASE 2 do DNA.
//
// READ-ONLY em managed_playlists/tracks. Escreve só em:
//   - playlist_dna (colunas de enriquecimento adicionadas na migration)
//   - playlist_dna_lexicon_proposals
//   - playlist_dna_quality_runs
//
// O que faz:
//  1) Cruza com search_tracks → top artistas/tracks do nicho por dominant_genre_id
//  2) Calcula niche_adherence_score e internal_concentration_score
//  3) Detecta conflitos de nome×DNA (nome bate sub de outro gênero)
//  4) Bucketiza confiança (high ≥70, mid 50-70, low <50)
//  5) Gera proposta de keywords novas por subgênero (não aplica, só sugere)
//  6) Persiste snapshot do run com top 50 puras / híbridas / confusas
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const TOP_NICHE_ARTISTS = 15;
const TOP_NICHE_TRACKS = 15;
const LEX_PROPOSALS_PER_SUB = 20;
const STOPWORDS = new Set([
  "a","o","as","os","e","de","do","da","dos","das","em","no","na","nos","nas",
  "por","para","pra","pro","um","uma","uns","umas","com","que","se","sem","mais",
  "feat","ft","remix","mix","ao","vivo","oficial","official","video","clipe",
  "the","of","and","to","in","on","you","my","your","i","is","it","me","we",
  "la","el","les","les","lo","x","2026","2025","2024","2023","2022",
  "music","musica","som","song","track","mc","dj","prod","beat","beats",
]);
const MIN_TOKEN_LEN = 3;

function norm(s: string | null | undefined): string {
  return (s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function tokens(s: string): string[] {
  return norm(s).split(" ").filter((t) => t.length >= MIN_TOKEN_LEN && !STOPWORDS.has(t));
}
function round(n: number | null, d = 2): number | null {
  if (n == null || !isFinite(n)) return null;
  const k = Math.pow(10, d);
  return Math.round(n * k) / k;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  const startedAt = new Date().toISOString();

  // ── Carregar referências ───────────────────────────────────────────────
  const [{ data: genres }, { data: subgenresRaw }, { data: searchTracks }] = await Promise.all([
    supabase.from("genres").select("id, nome").eq("ativo", true),
    supabase.from("subgenres").select("id, nome, parent_genre_id, palavras_chave").eq("ativo", true),
    supabase.from("search_tracks").select("genre_id, artista, spotify_track_id, nome_musica, popularity").limit(2000),
  ]);
  const genreById = new Map((genres ?? []).map((g: any) => [g.id, g.nome as string]));
  const subgenres = (subgenresRaw ?? []).map((s: any) => ({
    id: s.id as string,
    nome: s.nome as string,
    parent_genre_id: s.parent_genre_id as string,
    keywords: Array.isArray(s.palavras_chave) ? s.palavras_chave.map((k: any) => norm(String(k))).filter(Boolean) : [],
  }));
  const subgenresByParent = new Map<string, typeof subgenres>();
  for (const s of subgenres) {
    const arr = subgenresByParent.get(s.parent_genre_id) ?? [];
    arr.push(s); subgenresByParent.set(s.parent_genre_id, arr);
  }

  // ── Nicho por gênero (top artistas/tracks do search_tracks) ────────────
  const nicheArtistsByGenre = new Map<string, Map<string, { name: string; count: number }>>();
  const nicheTracksByGenre = new Map<string, Map<string, { id: string; title: string; artist: string; count: number; pop: number }>>();
  for (const st of searchTracks ?? []) {
    if (!st.genre_id) continue;
    if (st.artista) {
      const an = norm(st.artista);
      if (an) {
        const m = nicheArtistsByGenre.get(st.genre_id) ?? new Map();
        const prev = m.get(an);
        m.set(an, { name: st.artista.trim(), count: (prev?.count ?? 0) + 1 });
        nicheArtistsByGenre.set(st.genre_id, m);
      }
    }
    if (st.spotify_track_id) {
      const m = nicheTracksByGenre.get(st.genre_id) ?? new Map();
      const prev = m.get(st.spotify_track_id);
      m.set(st.spotify_track_id, {
        id: st.spotify_track_id,
        title: st.nome_musica ?? prev?.title ?? "",
        artist: st.artista ?? prev?.artist ?? "",
        count: (prev?.count ?? 0) + 1,
        pop: Math.max(prev?.pop ?? 0, Number(st.popularity ?? 0)),
      });
      nicheTracksByGenre.set(st.genre_id, m);
    }
  }
  function topNicheArtists(genreId: string | null) {
    if (!genreId) return [];
    const m = nicheArtistsByGenre.get(genreId);
    if (!m) return [];
    return Array.from(m.values()).sort((a, b) => b.count - a.count).slice(0, TOP_NICHE_ARTISTS);
  }
  function topNicheTracks(genreId: string | null) {
    if (!genreId) return [];
    const m = nicheTracksByGenre.get(genreId);
    if (!m) return [];
    return Array.from(m.values()).sort((a, b) => (b.count - a.count) || (b.pop - a.pop)).slice(0, TOP_NICHE_TRACKS);
  }

  // ── Cobertura por gênero (quantos artistas únicos no nicho) ────────────
  const coverageByGenre: Record<string, { artists: number; tracks: number; genre_name: string }> = {};
  for (const [gid, m] of nicheArtistsByGenre.entries()) {
    coverageByGenre[gid] = {
      artists: m.size,
      tracks: nicheTracksByGenre.get(gid)?.size ?? 0,
      genre_name: genreById.get(gid) ?? "—",
    };
  }

  // ── Playlists classificadas ────────────────────────────────────────────
  const { data: dnaRows } = await supabase
    .from("playlist_dna")
    .select("playlist_id, classification, classification_confidence, dominant_genre_id, dominant_genre_name, dominant_subgenre_id, top_artists, tracks_analyzed, tracks_matched, purity_score, subgenre_distribution");
  const dnaByPlaylist = new Map((dnaRows ?? []).map((r: any) => [r.playlist_id, r]));

  const playlistIds = (dnaRows ?? []).filter((r: any) => r.classification !== "Insuficiente").map((r: any) => r.playlist_id);

  // Carrega meta das playlists
  const { data: playlistsMeta } = await supabase
    .from("managed_playlists")
    .select("id, name, description, followers, playlist_type")
    .in("id", playlistIds);
  const metaById = new Map((playlistsMeta ?? []).map((p: any) => [p.id, p]));

  // Carrega tracks de todas as classificadas (em lotes via .in)
  // Para escalar, vamos paginar por playlist_id.
  const tracksByPlaylist = new Map<string, Array<{ artist: string; track: string }>>();
  const PAGE = 80;
  for (let i = 0; i < playlistIds.length; i += PAGE) {
    const chunk = playlistIds.slice(i, i + PAGE);
    const { data: rows } = await supabase
      .from("managed_playlist_tracks")
      .select("playlist_id, artist_name, track_name")
      .in("playlist_id", chunk);
    for (const r of rows ?? []) {
      const arr = tracksByPlaylist.get(r.playlist_id) ?? [];
      arr.push({ artist: r.artist_name ?? "", track: r.track_name ?? "" });
      tracksByPlaylist.set(r.playlist_id, arr);
    }
  }

  // ── Acumular tokens por subgênero pra propor keywords ──────────────────
  const tokenFreqBySub = new Map<string, Map<string, { freq: number; playlists: Set<string> }>>();

  const buckets = { high: 0, mid: 0, low: 0 };
  let conflitos = 0;

  type KwMap = { subgenre: typeof subgenres[number]; kw: string };
  const allSubKeywords: KwMap[] = [];
  for (const sg of subgenres) for (const kw of sg.keywords) if (kw) allSubKeywords.push({ subgenre: sg, kw });

  const updates: Array<{ playlist_id: string; patch: Record<string, unknown> }> = [];

  for (const dna of dnaRows ?? []) {
    if (dna.classification === "Insuficiente") continue;
    const meta = metaById.get(dna.playlist_id);
    const tracks = tracksByPlaylist.get(dna.playlist_id) ?? [];
    const totalTracks = tracks.length || dna.tracks_analyzed || 0;

    const nicheArtists = topNicheArtists(dna.dominant_genre_id);
    const nicheTracks = topNicheTracks(dna.dominant_genre_id);
    const nicheArtistSet = new Set(nicheArtists.map((a) => norm(a.name)));

    let adherenceHits = 0;
    for (const t of tracks) if (nicheArtistSet.has(norm(t.artist))) adherenceHits++;
    const nicheAdherence = totalTracks > 0 ? round((adherenceHits / totalTracks) * 100, 2) : 0;

    const topArr: any[] = Array.isArray(dna.top_artists) ? dna.top_artists : [];
    const top3 = topArr.slice(0, 3).reduce((s, a) => s + (Number(a.count) || 0), 0);
    const internalConcentration = totalTracks > 0 ? round((top3 / totalTracks) * 100, 2) : 0;

    const subDist = (dna.subgenre_distribution ?? {}) as Record<string, number>;
    const nicheTopSubs = Object.entries(subDist)
      .sort(([, a], [, b]) => (b as number) - (a as number))
      .slice(0, 5)
      .map(([sid, pct]) => ({
        subgenre_id: sid,
        subgenre_name: subgenres.find((s) => s.id === sid)?.nome ?? null,
        pct: Number(pct),
      }));

    const nameNorm = norm(meta?.name ?? "");
    let conflict: any = null;
    if (nameNorm && dna.dominant_genre_id) {
      for (const { subgenre, kw } of allSubKeywords) {
        if (subgenre.parent_genre_id === dna.dominant_genre_id) continue;
        if (kw.length < 4) continue;
        if (nameNorm.includes(kw)) {
          conflict = {
            type: "name_vs_dna_genre",
            name_keyword: kw,
            name_indicates_subgenre: subgenre.nome,
            name_indicates_genre: genreById.get(subgenre.parent_genre_id) ?? null,
            dna_indicates_genre: dna.dominant_genre_name,
          };
          break;
        }
      }
    }
    if (conflict) conflitos++;

    const conf = Number(dna.classification_confidence ?? 0);
    let bucket: "high" | "mid" | "low";
    if (conf >= 70) bucket = "high";
    else if (conf >= 50) bucket = "mid";
    else bucket = "low";
    buckets[bucket]++;

    updates.push({
      playlist_id: dna.playlist_id,
      patch: {
        niche_top_artists: nicheArtists,
        niche_top_tracks: nicheTracks,
        niche_top_subgenres: nicheTopSubs,
        niche_adherence_score: nicheAdherence,
        internal_concentration_score: internalConcentration,
        name_conflict: conflict,
        confidence_bucket: bucket,
        enriched_at: new Date().toISOString(),
      },
    });

    if (dna.dominant_subgenre_id) {
      const m = tokenFreqBySub.get(dna.dominant_subgenre_id) ?? new Map();
      for (const t of tracks) {
        for (const tok of [...tokens(t.artist), ...tokens(t.track)]) {
          const prev = m.get(tok);
          if (prev) { prev.freq++; prev.playlists.add(dna.playlist_id); }
          else m.set(tok, { freq: 1, playlists: new Set([dna.playlist_id]) });
        }
      }
      tokenFreqBySub.set(dna.dominant_subgenre_id, m);
    }
  }

  // Aplica updates em paralelo (chunks de 25)
  const UPD_CHUNK = 25;
  for (let i = 0; i < updates.length; i += UPD_CHUNK) {
    const slice = updates.slice(i, i + UPD_CHUNK);
    await Promise.all(slice.map((u) =>
      supabase.from("playlist_dna").update(u.patch).eq("playlist_id", u.playlist_id)
    ));
  }


  // ── Propor keywords novas ──────────────────────────────────────────────
  const runIdForProposals = crypto.randomUUID();
  // Limpa propostas anteriores deste run só (idempotência: cada run é novo)
  let proposedCount = 0;
  const proposals: any[] = [];
  for (const [subId, freqMap] of tokenFreqBySub.entries()) {
    const sg = subgenres.find((s) => s.id === subId);
    if (!sg) continue;
    const existing = new Set(sg.keywords);
    const sorted = Array.from(freqMap.entries())
      .filter(([tok, v]) => v.playlists.size >= 2 && !existing.has(tok))
      .sort(([, a], [, b]) => (b.freq - a.freq))
      .slice(0, LEX_PROPOSALS_PER_SUB);
    for (const [tok, v] of sorted) {
      proposals.push({
        run_id: runIdForProposals,
        subgenre_id: sg.id,
        subgenre_name: sg.nome,
        parent_genre_id: sg.parent_genre_id,
        parent_genre_name: genreById.get(sg.parent_genre_id) ?? null,
        proposed_keyword: tok,
        frequency: v.freq,
        distinct_playlists: v.playlists.size,
        already_existing: false,
      });
      proposedCount++;
    }
  }
  // Insert em chunks
  for (let i = 0; i < proposals.length; i += 500) {
    await supabase.from("playlist_dna_lexicon_proposals").insert(proposals.slice(i, i + 500));
  }

  // ── Top 50 listas ──────────────────────────────────────────────────────
  // Re-fetch enriched DNA pra montar rankings
  const { data: enriched } = await supabase
    .from("playlist_dna")
    .select("playlist_id, classification, classification_confidence, niche_adherence_score, purity_score, internal_concentration_score, name_conflict, dominant_genre_name, dominant_subgenre_name, tracks_analyzed, tracks_matched")
    .neq("classification", "Insuficiente");

  const rowsForRanking = (enriched ?? []).map((r: any) => ({
    ...r,
    name: metaById.get(r.playlist_id)?.name ?? null,
    followers: metaById.get(r.playlist_id)?.followers ?? null,
  }));

  const topPure = [...rowsForRanking]
    .sort((a, b) => (b.niche_adherence_score ?? 0) - (a.niche_adherence_score ?? 0) || (b.purity_score ?? 0) - (a.purity_score ?? 0))
    .slice(0, 50)
    .map((r) => ({
      playlist_id: r.playlist_id, name: r.name, followers: r.followers,
      genre: r.dominant_genre_name, subgenre: r.dominant_subgenre_name,
      niche_adherence: r.niche_adherence_score, purity: r.purity_score,
      confidence: r.classification_confidence,
    }));

  const topHybrid = [...rowsForRanking]
    .filter((r) => r.classification === "Hibrida")
    .sort((a, b) => (b.tracks_analyzed ?? 0) - (a.tracks_analyzed ?? 0))
    .slice(0, 50)
    .map((r) => ({
      playlist_id: r.playlist_id, name: r.name, followers: r.followers,
      genre: r.dominant_genre_name, purity: r.purity_score,
      tracks: r.tracks_analyzed, matched: r.tracks_matched, confidence: r.classification_confidence,
    }));

  const topConfused = [...rowsForRanking]
    .filter((r) => r.name_conflict)
    .sort((a, b) => (b.followers ?? 0) - (a.followers ?? 0))
    .slice(0, 50)
    .map((r) => ({
      playlist_id: r.playlist_id, name: r.name, followers: r.followers,
      dna_genre: r.dominant_genre_name, conflict: r.name_conflict,
      confidence: r.classification_confidence, niche_adherence: r.niche_adherence_score,
    }));

  const confiavel = buckets.high;
  const fraco = buckets.low;

  const currentKwCount = subgenres.reduce((acc, s) => acc + s.keywords.length, 0);

  const { data: insuf } = await supabase
    .from("playlist_dna")
    .select("playlist_id", { count: "exact", head: false })
    .eq("classification", "Insuficiente");

  const { data: runRow } = await supabase.from("playlist_dna_quality_runs").insert({
    id: runIdForProposals, // reusa pra ligar com lex proposals
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    total_playlists: (dnaRows ?? []).length,
    total_classified: rowsForRanking.length,
    bucket_high: buckets.high,
    bucket_mid: buckets.mid,
    bucket_low: buckets.low,
    confiavel,
    fraco,
    conflitos,
    insufficient_no_tracks: insuf?.length ?? 0,
    lexicon_keywords_current: currentKwCount,
    lexicon_keywords_proposed: proposedCount,
    coverage_by_genre: coverageByGenre,
    top_pure: topPure,
    top_hybrid: topHybrid,
    top_confused: topConfused,
    notes: {
      thresholds: { high: 70, mid: 50, low: 0 },
      niche_source: "search_tracks",
      proposals_per_sub: LEX_PROPOSALS_PER_SUB,
      min_distinct_playlists_for_proposal: 2,
    },
  }).select("id").single();

  return new Response(JSON.stringify({
    run_id: runRow?.id ?? runIdForProposals,
    total_playlists: (dnaRows ?? []).length,
    total_classified: rowsForRanking.length,
    buckets, conflitos,
    lexicon_keywords_current: currentKwCount,
    lexicon_keywords_proposed: proposedCount,
    insufficient_no_tracks: insuf?.length ?? 0,
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
