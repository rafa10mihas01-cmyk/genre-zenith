// blind-classify-playlists — Fase 2.3: prova cega do classificador baseado em comportamento.
// Lê SOMENTE: genre_reference_artists/tracks/playlists (Fase 2.2), managed_playlists, managed_playlist_tracks.
// NÃO lê nome/descrição/genre_id/keywords/léxico para decidir. genre_id é usado apenas pra
// (a) montar amostra estratificada e (b) comparar predito vs cadastrado no final.
// Escreve em: dna_blind_test_runs, dna_blind_test_playlists. Nenhuma outra escrita.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const TARGET_GENRES = ["sertanejo","funk","trap","forró","pagode","pop"];
const SAMPLE_PER_GENRE = 50;
const ANCHOR_MIN_PURITY = 60;          // artistas/tracks com purity_pct >= 60 contam
const BLACKLIST_GENRES_PRESENT = 3;    // artistas em >=3 gêneros = ambíguos (descartados)
const MIN_SIGNALS = 3;                 // mínimo de sinais (artistas+tracks ancorados) p/ classificar

function norm(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().normalize("NFD")
    .replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9 ]+/g," ")
    .replace(/\s+/g," ").trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  // Run mais recente da Fase 2.2
  const { data: runRow } = await supabase
    .from("genre_reference_runs")
    .select("id").order("started_at",{ascending:false}).limit(1).maybeSingle();
  const refRunId = runRow?.id;
  if (!refRunId) {
    return new Response(JSON.stringify({error:"no_reference_run"}), {status:400, headers:{...corsHeaders,"Content-Type":"application/json"}});
  }

  // Carrega referência: artistas (com authority + purity + ambiguidade)
  const { data: refArtistsRaw } = await supabase
    .from("genre_reference_artists")
    .select("artist_norm, genre_id, genre_name, purity_pct, authority_score, genres_present")
    .eq("run_id", refRunId);

  // Index: artist_norm -> [{genre_id, score, purity, ambiguous}]
  const artistIdx = new Map<string, {genre_id:string; genre_name:string; score:number; purity:number; ambiguous:boolean}[]>();
  const ambiguousArtists = new Set<string>();
  for (const r of refArtistsRaw ?? []) {
    const an = (r as any).artist_norm as string;
    if ((r as any).genres_present >= BLACKLIST_GENRES_PRESENT) ambiguousArtists.add(an);
    const arr = artistIdx.get(an) ?? [];
    arr.push({
      genre_id: (r as any).genre_id,
      genre_name: (r as any).genre_name,
      score: Number((r as any).authority_score) || 0,
      purity: Number((r as any).purity_pct) || 0,
      ambiguous: (r as any).genres_present >= BLACKLIST_GENRES_PRESENT,
    });
    artistIdx.set(an, arr);
  }

  // Tracks-âncora indexadas por spotify_track_id (mais confiável)
  const { data: refTracksRaw } = await supabase
    .from("genre_reference_tracks")
    .select("spotify_track_id, genre_id, genre_name, purity_pct, authority_score")
    .eq("run_id", refRunId)
    .not("spotify_track_id","is",null);
  const trackIdx = new Map<string, {genre_id:string; genre_name:string; score:number; purity:number}[]>();
  for (const r of refTracksRaw ?? []) {
    const id = (r as any).spotify_track_id as string;
    if (!id) continue;
    const arr = trackIdx.get(id) ?? [];
    arr.push({
      genre_id:(r as any).genre_id, genre_name:(r as any).genre_name,
      score:Number((r as any).authority_score)||0,
      purity:Number((r as any).purity_pct)||0,
    });
    trackIdx.set(id, arr);
  }

  // Genres lookup
  const { data: genresData } = await supabase.from("genres").select("id, nome").eq("ativo", true);
  const genreByName = new Map((genresData??[]).map((g:any)=>[g.nome, g.id as string]));
  const genreById = new Map((genresData??[]).map((g:any)=>[g.id as string, g.nome as string]));

  // Cria run de teste
  const { data: testRunRow } = await supabase
    .from("dna_blind_test_runs")
    .insert({ reference_run_id: refRunId, target_genres: TARGET_GENRES, sample_per_genre: SAMPLE_PER_GENRE })
    .select("id").single();
  const testRunId = testRunRow!.id as string;

  // Amostra estratificada: até 50 playlists por gênero (preferindo as com mais tracks)
  const sample: {id:string; cadastrado:string}[] = [];
  for (const gname of TARGET_GENRES) {
    const gid = genreByName.get(gname);
    if (!gid) continue;
    const { data: pls } = await supabase
      .from("managed_playlists")
      .select("id, tracks_count")
      .eq("genre_id", gid)
      .order("tracks_count",{ascending:false, nullsFirst:false})
      .limit(SAMPLE_PER_GENRE);
    for (const p of pls ?? []) sample.push({ id:(p as any).id, cadastrado:gname });
  }

  const totals = {
    sampled: sample.length, classified: 0, unclassifiable: 0,
    correct: 0, wrong: 0,
    per_genre: {} as Record<string,{total:number;correct:number;wrong:number;unclassifiable:number}>,
    confusion: {} as Record<string,Record<string,number>>,
  };
  for (const g of TARGET_GENRES) {
    totals.per_genre[g] = { total:0, correct:0, wrong:0, unclassifiable:0 };
    totals.confusion[g] = {};
  }

  // Classifica em paralelo (lotes de 20)
  const BATCH = 20;
  for (let i=0; i<sample.length; i+=BATCH) {
    const slice = sample.slice(i, i+BATCH);
    await Promise.all(slice.map(async (s) => {
      totals.per_genre[s.cadastrado].total++;
      const { data: tracks } = await supabase
        .from("managed_playlist_tracks")
        .select("spotify_track_id, track_name, artist_name")
        .eq("playlist_id", s.id);
      const trackRows = tracks ?? [];

      const votes = new Map<string, number>(); // genre_id -> score
      const supportingArtists: Record<string,{artist:string;score:number}[]> = {};
      const supportingTracks: Record<string,{track:string;artist:string;score:number}[]> = {};
      let artistSignals = 0, trackSignals = 0, ambiguousHits = 0;
      const seenArtists = new Set<string>();

      for (const t of trackRows) {
        // Track-âncora (spotify_track_id)
        const tid = (t as any).spotify_track_id as string|null;
        if (tid && trackIdx.has(tid)) {
          for (const e of trackIdx.get(tid)!) {
            if (e.purity < ANCHOR_MIN_PURITY) continue;
            votes.set(e.genre_id, (votes.get(e.genre_id)??0) + e.score * 1.5);
            (supportingTracks[e.genre_name] ??= []).push({
              track:(t as any).track_name, artist:(t as any).artist_name, score:e.score,
            });
            trackSignals++;
          }
        }
        // Artistas (split por vírgula)
        const raw = (t as any).artist_name as string|null;
        if (!raw) continue;
        for (const part of raw.split(/[,;&]| feat\.? | ft\.? /i)) {
          const an = norm(part);
          if (!an || seenArtists.has(an)) continue;
          seenArtists.add(an);
          if (ambiguousArtists.has(an)) { ambiguousHits++; continue; }
          const entries = artistIdx.get(an);
          if (!entries) continue;
          for (const e of entries) {
            if (e.ambiguous) continue;
            if (e.purity < ANCHOR_MIN_PURITY) continue;
            votes.set(e.genre_id, (votes.get(e.genre_id)??0) + e.score);
            (supportingArtists[e.genre_name] ??= []).push({ artist: part.trim(), score:e.score });
            artistSignals++;
          }
        }
      }

      const totalSignals = artistSignals + trackSignals;
      const sorted = Array.from(votes.entries()).sort((a,b)=>b[1]-a[1]);
      const top = sorted[0]; const runner = sorted[1];
      const topScore = top?.[1] ?? 0;
      const sumScore = sorted.reduce((a,b)=>a+b[1],0);
      const confidence = sumScore>0 ? Math.round((topScore/sumScore)*1000)/10 : 0;

      let unclassifiable = false; let reason: string|null = null;
      if (totalSignals < MIN_SIGNALS) { unclassifiable=true; reason="insufficient_signals"; }
      else if (!top) { unclassifiable=true; reason="no_anchor_votes"; }

      const predictedGenreId = unclassifiable ? null : top![0];
      const predictedGenreName = predictedGenreId ? genreById.get(predictedGenreId) ?? null : null;
      const runnerGenreName = runner ? genreById.get(runner[0]) ?? null : null;
      const runnerScore = runner?.[1] ?? 0;
      const margin = topScore>0 ? Math.round(((topScore-runnerScore)/topScore)*1000)/10 : 0;

      let correct: boolean|null = null;
      if (unclassifiable) {
        totals.unclassifiable++; totals.per_genre[s.cadastrado].unclassifiable++;
      } else {
        totals.classified++;
        correct = predictedGenreName === s.cadastrado;
        if (correct) { totals.correct++; totals.per_genre[s.cadastrado].correct++; }
        else { totals.wrong++; totals.per_genre[s.cadastrado].wrong++; }
        const pred = predictedGenreName ?? "—";
        totals.confusion[s.cadastrado][pred] = (totals.confusion[s.cadastrado][pred]??0)+1;
      }

      // Motivos prováveis dos erros
      const errorReasons: string[] = [];
      if (!unclassifiable && correct===false) {
        if (artistSignals === 0) errorReasons.push("no_anchor_artists");
        if (ambiguousHits > artistSignals) errorReasons.push("excess_ambiguous_artists");
        if (margin < 15) errorReasons.push("low_margin_hybrid");
        if (sorted.length >= 3 && (sorted[2][1]/(topScore||1)) > 0.5) errorReasons.push("multi_genre_mix");
      }

      // Top supports
      const slim = (m:Record<string,{artist?:string;track?:string;score:number}[]>) => {
        const out: Record<string, any[]> = {};
        for (const k of Object.keys(m)) {
          out[k] = m[k].sort((a:any,b:any)=>b.score-a.score).slice(0,10);
        }
        return out;
      };

      await supabase.from("dna_blind_test_playlists").insert({
        run_id: testRunId,
        playlist_id: s.id,
        cadastrado_genre_name: s.cadastrado,
        predicted_genre_id: predictedGenreId,
        predicted_genre_name: predictedGenreName,
        runner_up_genre_name: runnerGenreName,
        confidence_pct: confidence,
        margin_pct: margin,
        tracks_total: trackRows.length,
        artist_signals: artistSignals,
        track_signals: trackSignals,
        ambiguous_hits: ambiguousHits,
        unclassifiable,
        unclassifiable_reason: reason,
        is_correct: correct,
        error_reasons: errorReasons,
        votes: Object.fromEntries(sorted.map(([gid,v])=>[genreById.get(gid)??gid, Math.round(v*100)/100])),
        supporting_artists: slim(supportingArtists),
        supporting_tracks: slim(supportingTracks),
      });
    }));
  }

  const accuracy = totals.classified>0 ? Math.round((totals.correct/totals.classified)*1000)/10 : 0;

  await supabase.from("dna_blind_test_runs").update({
    finished_at: new Date().toISOString(),
    totals, accuracy_pct: accuracy,
  }).eq("id", testRunId);

  return new Response(JSON.stringify({ run_id: testRunId, accuracy_pct: accuracy, ...totals }), {
    headers: { ...corsHeaders, "Content-Type":"application/json" },
  });
});
