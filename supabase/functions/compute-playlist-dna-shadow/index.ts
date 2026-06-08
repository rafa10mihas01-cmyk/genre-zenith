// compute-playlist-dna-shadow — Phase 2.1
// Reclassifica TODAS as playlists usando léxico EXPANDIDO (subgenres.palavras_chave
// + playlist_dna_lexicon_proposals) e grava em playlist_dna_shadow.
// NÃO sobrescreve playlist_dna. NÃO altera nenhuma playlist.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const MIN_TRACKS = 5;
const BATCH = 50;

type Subgenre = { id: string; nome: string; parent_genre_id: string; keywords: string[] };
type Genre = { id: string; nome: string };

const norm = (s: string | null | undefined) =>
  (s ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

const median = (n: number[]) => {
  if (!n.length) return null;
  const s = [...n].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const round = (n: number | null, d = 2) => {
  if (n == null || !isFinite(n)) return null;
  const k = Math.pow(10, d); return Math.round(n * k) / k;
};
const bucket = (c: number) => c >= 70 ? "high" : c >= 50 ? "mid" : "low";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  let scope: "all" | "active" | "archived" = "all";
  let limit: number | null = null;
  try {
    const body = await req.json().catch(() => ({}));
    if (body?.scope === "active" || body?.scope === "archived") scope = body.scope;
    if (typeof body?.limit === "number" && body.limit > 0) limit = body.limit;
  } catch { /* ignore */ }

  const [{ data: genresData }, { data: subgenresData }, { data: proposalsData }] = await Promise.all([
    supabase.from("genres").select("id, nome").eq("ativo", true),
    supabase.from("subgenres").select("id, nome, parent_genre_id, palavras_chave").eq("ativo", true),
    supabase.from("playlist_dna_lexicon_proposals").select("subgenre_id, proposed_keyword"),
  ]);

  const genres: Genre[] = (genresData ?? []) as Genre[];
  const genreById = new Map(genres.map((g) => [g.id, g]));

  const extraBySub = new Map<string, Set<string>>();
  for (const p of proposalsData ?? []) {
    const sid = (p as any).subgenre_id; const kw = norm(String((p as any).proposed_keyword));
    if (!sid || !kw) continue;
    if (!extraBySub.has(sid)) extraBySub.set(sid, new Set());
    extraBySub.get(sid)!.add(kw);
  }

  const subgenres: Subgenre[] = (subgenresData ?? []).map((s: any) => {
    const base = Array.isArray(s.palavras_chave)
      ? s.palavras_chave.map((k: any) => norm(String(k))).filter(Boolean) : [];
    const extras = extraBySub.get(s.id) ?? new Set<string>();
    const merged = new Set<string>([...base, ...extras]);
    return { id: s.id, nome: s.nome, parent_genre_id: s.parent_genre_id, keywords: Array.from(merged) };
  });

  const proposalsApplied = Array.from(extraBySub.values()).reduce((a, s) => a + s.size, 0);

  const { data: runRow } = await supabase.from("playlist_dna_shadow_runs")
    .insert({ scope, lexicon_source: "expanded", proposals_applied: proposalsApplied })
    .select("id").single();
  const runId = runRow?.id as string;

  let q = supabase.from("managed_playlists")
    .select("id, name, description, genre_id, archived_at")
    .order("imported_at", { ascending: true });
  if (scope === "active") q = q.is("archived_at", null);
  if (scope === "archived") q = q.not("archived_at", "is", null);
  if (limit) q = q.limit(limit);

  const { data: playlists, error: plErr } = await q;
  if (plErr) {
    await supabase.from("playlist_dna_shadow_runs").update({
      finished_at: new Date().toISOString(), failed: 1, notes: { error: plErr.message },
    }).eq("id", runId);
    return new Response(JSON.stringify({ error: plErr.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const totals = {
    candidates: playlists?.length ?? 0, processed: 0, insufficient: 0,
    nicho: 0, tematica: 0, tendencia: 0, hibrida: 0, failed: 0,
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
          await supabase.from("playlist_dna_shadow").insert({
            run_id: runId, playlist_id: pl.id,
            tracks_analyzed: trackRows.length, tracks_matched: 0,
            classification: "Insuficiente", classification_confidence: 0,
            confidence_bucket: "low",
            classification_reasons: [{ type: "insufficient_tracks", count: trackRows.length }],
            genre_distribution: {}, subgenre_distribution: {}, top_artists: [],
            unique_artists_count: new Set(trackRows.map((t: any) => norm(t.artist_name)).filter(Boolean)).size,
          });
          return;
        }

        const genreVotes = new Map<string, number>();
        const subgenreVotes = new Map<string, number>();
        const artistCount = new Map<string, { name: string; count: number }>();
        const ages: number[] = [];
        let matched = 0;

        for (const t of trackRows) {
          const haystack = norm(`${t.artist_name ?? ""} ${t.track_name ?? ""}`);
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
          const an = norm(t.artist_name);
          if (an) {
            const prev = artistCount.get(an);
            artistCount.set(an, { name: (t.artist_name as string).trim(), count: (prev?.count ?? 0) + 1 });
          }
          if (t.added_at) {
            const ageDays = (now - new Date(t.added_at).getTime()) / 86400000;
            if (isFinite(ageDays) && ageDays >= 0) ages.push(ageDays);
          }
        }

        const reasons: any[] = [];
        if (matched === 0 && pl.genre_id) {
          genreVotes.set(pl.genre_id, trackRows.length);
          reasons.push({ type: "fallback_playlist_genre_id", genre_id: pl.genre_id });
        }
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

        const totalG = Array.from(genreVotes.values()).reduce((a, b) => a + b, 0);
        const totalS = Array.from(subgenreVotes.values()).reduce((a, b) => a + b, 0);

        const genreDist: Record<string, number> = {};
        let domGenreId: string | null = null; let domGenrePct = 0;
        for (const [gid, v] of genreVotes.entries()) {
          const pct = totalG ? (v / totalG) * 100 : 0;
          genreDist[gid] = round(pct, 2)!;
          if (pct > domGenrePct) { domGenrePct = pct; domGenreId = gid; }
        }
        const subDist: Record<string, number> = {};
        let domSubId: string | null = null; let domSubPct = 0;
        for (const [sid, v] of subgenreVotes.entries()) {
          const pct = totalS ? (v / totalS) * 100 : 0;
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

        let cls: "Nicho" | "Tematica" | "Tendencia" | "Hibrida" = "Hibrida";
        if (purity >= 70 && uniqueRatio >= 0.5) cls = "Nicho";
        else if (purity >= 50 && uniqueRatio < 0.4) cls = "Tematica";
        else if (avgAge != null && avgAge < 90 && purity < 60) cls = "Tendencia";

        reasons.push({
          type: "scores", purity,
          unique_ratio: round(uniqueRatio, 3),
          avg_age_days: round(avgAge, 1), median_age_days: round(medAge, 1),
          match_ratio: round(matchRatio, 3),
        });

        const confidence = round(
          Math.min(100, matchRatio * 100 * (purity / 100) * 1.5 + matchRatio * 25), 1,
        ) ?? 0;
        const domGenreName = domGenreId ? genreById.get(domGenreId)?.nome ?? null : null;
        const domSubName = domSubId ? subgenres.find((s) => s.id === domSubId)?.nome ?? null : null;

        await supabase.from("playlist_dna_shadow").insert({
          run_id: runId, playlist_id: pl.id,
          dominant_genre_id: domGenreId, dominant_genre_name: domGenreName,
          dominant_genre_pct: round(domGenrePct, 2),
          dominant_subgenre_id: domSubId, dominant_subgenre_name: domSubName,
          dominant_subgenre_pct: round(domSubPct, 2),
          genre_distribution: genreDist, subgenre_distribution: subDist,
          top_artists: topArtists, unique_artists_count: uniqueArtists,
          tracks_analyzed: trackRows.length, tracks_matched: matched,
          avg_track_age_days: round(avgAge, 1), median_track_age_days: round(medAge, 1),
          purity_score: purity, classification: cls,
          classification_confidence: confidence, confidence_bucket: bucket(confidence),
          classification_reasons: reasons,
        });

        totals.processed++;
        if (cls === "Nicho") totals.nicho++;
        else if (cls === "Tematica") totals.tematica++;
        else if (cls === "Tendencia") totals.tendencia++;
        else totals.hibrida++;
      } catch (e: any) {
        totals.failed++;
        console.error("shadow_dna_failed", pl.id, e?.message ?? e);
      }
    }));
  }

  await supabase.from("playlist_dna_shadow_runs").update({
    finished_at: new Date().toISOString(),
    total_candidates: totals.candidates, processed: totals.processed,
    insufficient: totals.insufficient, nicho: totals.nicho,
    tematica: totals.tematica, tendencia: totals.tendencia,
    hibrida: totals.hibrida, failed: totals.failed,
  }).eq("id", runId);

  return new Response(JSON.stringify({ run_id: runId, proposals_applied: proposalsApplied, ...totals }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
