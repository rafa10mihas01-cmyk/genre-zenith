// compute-playlist-dna — analisa tracks de cada managed_playlist e grava DNA.
// READ-ONLY em managed_playlists/tracks. Só escreve em playlist_dna e playlist_dna_runs.
//
// Sinais (ordem de importância, conforme contrato):
//   1) Tracks da playlist (token match contra subgenres.palavras_chave)
//   2) Artistas da playlist (mesmo matcher, somado)
//   3) Distribuição agregada de gêneros (após votos por track)
//   4) Idade das músicas (avg/median)
//   5) Nome da playlist (tiebreaker)
//   6) Descrição da playlist (tiebreaker)
//
// Classificação:
//   - Insuficiente: < MIN_TRACKS analisáveis
//   - Nicho:      pureza >= 70 E unique_artist_ratio >= 0.5
//   - Tematica:   pureza >= 50 E unique_artist_ratio <  0.4  (poucos artistas dominando)
//   - Tendencia:  idade média < 90 dias E pureza < 60       (rotação alta, sem genero forte)
//   - Hibrida:    fallback
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { logSnapshotBypass } from "../_shared/_snapshot-phase6.ts";
// Auth: gated by Supabase platform auth (verify_jwt=false globally, but the
// Functions gateway still requires a valid project key). Read-only on source
// tables, writes apenas em playlist_dna / playlist_dna_runs.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const MIN_TRACKS = 5;
const BATCH = 50;

type Subgenre = {
  id: string;
  nome: string;
  parent_genre_id: string;
  keywords: string[];
};
type Genre = { id: string; nome: string };

function norm(s: string | null | undefined): string {
  return (s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function median(nums: number[]): number | null {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function round(n: number | null, d = 2): number | null {
  if (n == null || !isFinite(n)) return null;
  const k = Math.pow(10, d);
  return Math.round(n * k) / k;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  logSnapshotBypass(req, "compute-playlist-dna");

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  let scope: "all" | "active" | "archived" = "all";
  let limit: number | null = null;
  let playlistIds: string[] | null = null;
  try {
    const body = await req.json().catch(() => ({}));
    if (body?.scope === "active" || body?.scope === "archived") scope = body.scope;
    if (typeof body?.limit === "number" && body.limit > 0) limit = body.limit;
    if (Array.isArray(body?.playlist_ids) && body.playlist_ids.length) playlistIds = body.playlist_ids;
  } catch { /* ignore */ }

  // Carrega genres + subgenres (com keywords normalizadas)
  const [{ data: genresData }, { data: subgenresData }] = await Promise.all([
    supabase.from("genres").select("id, nome").eq("ativo", true),
    supabase.from("subgenres").select("id, nome, parent_genre_id, palavras_chave").eq("ativo", true),
  ]);
  const genres: Genre[] = (genresData ?? []) as Genre[];
  const genreById = new Map(genres.map((g) => [g.id, g]));
  const subgenres: Subgenre[] = (subgenresData ?? []).map((s: any) => ({
    id: s.id,
    nome: s.nome,
    parent_genre_id: s.parent_genre_id,
    keywords: Array.isArray(s.palavras_chave)
      ? s.palavras_chave.map((k: any) => norm(String(k))).filter(Boolean)
      : [],
  }));

  // Inicia run
  const { data: runRow } = await supabase
    .from("playlist_dna_runs")
    .insert({ scope, total_candidates: 0 })
    .select("id")
    .single();
  const runId = runRow?.id as string;

  // Lista playlists alvo
  let q = supabase
    .from("managed_playlists")
    .select("id, name, description, genre_id, archived_at, playlist_type")
    .order("imported_at", { ascending: true });
  if (scope === "active") q = q.neq("playlist_type", "ARCHIVED");
  if (scope === "archived") q = q.eq("playlist_type", "ARCHIVED");
  if (playlistIds) q = q.in("id", playlistIds);
  if (limit) q = q.limit(limit);

  const { data: playlists, error: plErr } = await q;
  if (plErr) {
    await supabase.from("playlist_dna_runs").update({
      finished_at: new Date().toISOString(), failed: 1,
      notes: { error: plErr.message },
    }).eq("id", runId);
    return new Response(JSON.stringify({ error: plErr.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const totals = {
    candidates: playlists?.length ?? 0,
    processed: 0,
    insufficient: 0,
    nicho: 0,
    tematica: 0,
    tendencia: 0,
    hibrida: 0,
    failed: 0,
  };

  const now = Date.now();

  for (let i = 0; i < (playlists ?? []).length; i += BATCH) {
    const slice = (playlists ?? []).slice(i, i + BATCH);
    await Promise.all(slice.map(async (pl: any) => {
      try {
        const { data: tracks } = await supabase
          .from("managed_playlist_tracks")
          .select("track_name, artist_name, added_at")
          .eq("playlist_id", pl.id);

        const trackRows = tracks ?? [];
        if (trackRows.length < MIN_TRACKS) {
          totals.insufficient++;
          await supabase.from("playlist_dna").upsert({
            playlist_id: pl.id,
            tracks_analyzed: trackRows.length,
            tracks_matched: 0,
            classification: "Insuficiente",
            classification_confidence: 0,
            classification_reasons: [{ type: "insufficient_tracks", count: trackRows.length, min: MIN_TRACKS }],
            computed_at: new Date().toISOString(),
            genre_distribution: {},
            subgenre_distribution: {},
            top_artists: [],
            unique_artists_count: new Set(trackRows.map((t: any) => norm(t.artist_name)).filter(Boolean)).size,
          }, { onConflict: "playlist_id" });
          return;
        }

        // === Per-track classification ===
        const genreVotes = new Map<string, number>();
        const subgenreVotes = new Map<string, number>();
        const artistCount = new Map<string, { name: string; count: number }>();
        const ages: number[] = [];
        let matched = 0;

        for (const t of trackRows) {
          const haystack = norm(`${t.artist_name ?? ""} ${t.track_name ?? ""}`);
          // 1) Track + Artist token match: tenta cada subgenre, escolhe primeiro hit forte
          let trackSubId: string | null = null;
          for (const sg of subgenres) {
            for (const kw of sg.keywords) {
              if (kw && haystack.includes(kw)) { trackSubId = sg.id; break; }
            }
            if (trackSubId) break;
          }
          if (trackSubId) {
            matched++;
            subgenreVotes.set(trackSubId, (subgenreVotes.get(trackSubId) ?? 0) + 1);
            const parent = subgenres.find((s) => s.id === trackSubId)!.parent_genre_id;
            genreVotes.set(parent, (genreVotes.get(parent) ?? 0) + 1);
          }
          // Artist counts
          const an = norm(t.artist_name);
          if (an) {
            const prev = artistCount.get(an);
            artistCount.set(an, { name: (t.artist_name as string).trim(), count: (prev?.count ?? 0) + 1 });
          }
          // Idade
          if (t.added_at) {
            const ageDays = (now - new Date(t.added_at).getTime()) / (1000 * 60 * 60 * 24);
            if (isFinite(ageDays) && ageDays >= 0) ages.push(ageDays);
          }
        }

        // Fallback: se nada matchou e a playlist tem genre_id, usa pelo menos pra dominante
        const reasons: any[] = [];
        if (matched === 0 && pl.genre_id) {
          genreVotes.set(pl.genre_id, trackRows.length);
          reasons.push({ type: "fallback_playlist_genre_id", genre_id: pl.genre_id });
        }

        // Name + description tiebreaker (sinal fraco)
        const meta = norm(`${pl.name ?? ""} ${pl.description ?? ""}`);
        for (const sg of subgenres) {
          for (const kw of sg.keywords) {
            if (kw && meta.includes(kw)) {
              subgenreVotes.set(sg.id, (subgenreVotes.get(sg.id) ?? 0) + 0.5);
              genreVotes.set(sg.parent_genre_id, (genreVotes.get(sg.parent_genre_id) ?? 0) + 0.5);
              reasons.push({ type: "name_or_desc_hint", subgenre_id: sg.id, kw });
              break;
            }
          }
        }

        const totalGenreVotes = Array.from(genreVotes.values()).reduce((a, b) => a + b, 0);
        const totalSubVotes = Array.from(subgenreVotes.values()).reduce((a, b) => a + b, 0);

        const genreDist: Record<string, number> = {};
        let domGenreId: string | null = null; let domGenrePct = 0;
        for (const [gid, v] of genreVotes.entries()) {
          const pct = totalGenreVotes ? (v / totalGenreVotes) * 100 : 0;
          genreDist[gid] = round(pct, 2)!;
          if (pct > domGenrePct) { domGenrePct = pct; domGenreId = gid; }
        }
        const subDist: Record<string, number> = {};
        let domSubId: string | null = null; let domSubPct = 0;
        for (const [sid, v] of subgenreVotes.entries()) {
          const pct = totalSubVotes ? (v / totalSubVotes) * 100 : 0;
          subDist[sid] = round(pct, 2)!;
          if (pct > domSubPct) { domSubPct = pct; domSubId = sid; }
        }

        const uniqueArtists = artistCount.size;
        const topArtists = Array.from(artistCount.values())
          .sort((a, b) => b.count - a.count).slice(0, 10);

        const avgAge = ages.length ? ages.reduce((a, b) => a + b, 0) / ages.length : null;
        const medAge = median(ages);

        const matchRatio = matched / trackRows.length;
        const purity = round(domGenrePct, 2) ?? 0;
        const uniqueRatio = uniqueArtists / trackRows.length;

        // === Classification ===
        let cls: "Nicho" | "Tematica" | "Tendencia" | "Hibrida" = "Hibrida";
        if (purity >= 70 && uniqueRatio >= 0.5) cls = "Nicho";
        else if (purity >= 50 && uniqueRatio < 0.4) cls = "Tematica";
        else if (avgAge != null && avgAge < 90 && purity < 60) cls = "Tendencia";

        reasons.push({
          type: "scores",
          purity, unique_ratio: round(uniqueRatio, 3),
          avg_age_days: round(avgAge, 1), median_age_days: round(medAge, 1),
          match_ratio: round(matchRatio, 3),
        });

        // Confiança: coverage (quantas tracks matchearam) * pureza
        const confidence = round(Math.min(100, matchRatio * 100 * (purity / 100) * 1.5 + matchRatio * 25), 1) ?? 0;

        const domGenreName = domGenreId ? genreById.get(domGenreId)?.nome ?? null : null;
        const domSubName = domSubId ? subgenres.find((s) => s.id === domSubId)?.nome ?? null : null;

        await supabase.from("playlist_dna").upsert({
          playlist_id: pl.id,
          dominant_genre_id: domGenreId,
          dominant_genre_name: domGenreName,
          dominant_genre_pct: round(domGenrePct, 2),
          dominant_subgenre_id: domSubId,
          dominant_subgenre_name: domSubName,
          dominant_subgenre_pct: round(domSubPct, 2),
          genre_distribution: genreDist,
          subgenre_distribution: subDist,
          top_artists: topArtists,
          unique_artists_count: uniqueArtists,
          tracks_analyzed: trackRows.length,
          tracks_matched: matched,
          avg_track_age_days: round(avgAge, 1),
          median_track_age_days: round(medAge, 1),
          purity_score: purity,
          classification: cls,
          classification_confidence: confidence,
          classification_reasons: reasons,
          computed_at: new Date().toISOString(),
        }, { onConflict: "playlist_id" });

        totals.processed++;
        if (cls === "Nicho") totals.nicho++;
        else if (cls === "Tematica") totals.tematica++;
        else if (cls === "Tendencia") totals.tendencia++;
        else totals.hibrida++;
      } catch (e: any) {
        totals.failed++;
        console.error("dna_failed", pl.id, e?.message ?? e);
      }
    }));
  }

  await supabase.from("playlist_dna_runs").update({
    finished_at: new Date().toISOString(),
    total_candidates: totals.candidates,
    processed: totals.processed,
    insufficient: totals.insufficient,
    nicho: totals.nicho,
    tematica: totals.tematica,
    tendencia: totals.tendencia,
    hibrida: totals.hibrida,
    failed: totals.failed,
  }).eq("id", runId);

  return new Response(JSON.stringify({ run_id: runId, ...totals }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
