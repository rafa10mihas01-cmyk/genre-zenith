// playlist-brain-calc — calcula o "perfil vivo" de cada playlist própria.
// Lê dados existentes (managed_playlists, playlist_scores, snapshots, genre_models)
// e materializa em playlist_brain (1 linha por playlist) + playlist_brain_history (trend).
//
// Modos:
//  - { playlist_id: "uuid" }  → calcula 1 playlist
//  - { batch: true }          → calcula TODAS playlists ownership='own' ativas (modo cron)
//
// Auth: service_role OU user com team_access.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { requireTeamAccess } from "../_shared/auth.ts";
import { buildRoadmap, derivePhase } from "../_shared/lifecycle.ts";
import { reportCronHealth } from "../_shared/cron-health.ts";
import { logSnapshotBypass } from "../_shared/_snapshot-phase6.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CALC_VERSION = 1;

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type Signal = {
  code: string;
  severity: "low" | "medium" | "high";
  message: string;
  detected_at: string;
};

type Recommendation = {
  priority: number;
  action: string;
  reason: string;
};

/**
 * Multiplicador rough de plays/dia por seguidor.
 * Default conservador: 5% dos seguidores ativos por dia.
 * Em fase 2 (concorrentes) isso vira derivado do nicho.
 */
const DEFAULT_PLAYS_PER_FOLLOWER_DAY = 0.05;



async function calcOne(supabase: any, playlistId: string) {
  // 1. Carrega playlist canonical + managed (se existir). Aceita tanto o ID
  // canônico (`playlists.id`) quanto o ID operacional (`managed_playlists.id`),
  // porque o cockpit e os batches antigos chamam em formatos diferentes.
  let canonicalId = playlistId;
  const { data: directManaged } = await supabase
    .from("managed_playlists")
    .select("id, canonical_playlist_id, spotify_playlist_id")
    .eq("id", playlistId)
    .maybeSingle();
  if (directManaged?.canonical_playlist_id) {
    canonicalId = directManaged.canonical_playlist_id;
  } else if (directManaged?.spotify_playlist_id) {
    const { data: canonical, error: canonicalError } = await supabase
      .from("playlists")
      .upsert({
        spotify_playlist_id: directManaged.spotify_playlist_id,
        name: directManaged.spotify_playlist_id,
        ownership: "own",
        source: "managed",
        monitored: true,
        last_seen_at: new Date().toISOString(),
      }, { onConflict: "spotify_playlist_id" })
      .select("id")
      .single();
    if (canonicalError) throw new Error(`canonical playlist: ${canonicalError.message}`);
    canonicalId = canonical.id;
    await supabase
      .from("managed_playlists")
      .update({ canonical_playlist_id: canonicalId })
      .eq("id", directManaged.id);
  }

  const { data: pl, error: plErr } = await supabase
    .from("playlists")
    .select("id, spotify_playlist_id, name, ownership, followers")
    .eq("id", canonicalId)
    .maybeSingle();
  if (plErr || !pl) throw new Error(`playlist ${playlistId} não encontrada`);

  const { data: mgd } = await supabase
    .from("managed_playlists")
    .select("id, name, genre_id, tracks_count, followers, last_diagnosis_at, last_metrics_at, metadata, archived_at")
    .eq("spotify_playlist_id", pl.spotify_playlist_id)
    .maybeSingle();

  // Se a playlist está arquivada (lixeira), não calcula cérebro — ela some
  // de KPIs, Matriz, recomendações etc. Volta quando restaurada.
  if (mgd?.archived_at) {
    await supabase.from("playlist_brain").delete().eq("playlist_id", canonicalId);
    return { skipped: true, reason: "archived" };
  }

  // 2. Score atual (capacity_score, health_score etc)
  const { data: score } = await supabase
    .from("playlist_scores")
    .select("health_score, capacity_score, delivery_score, activity_score, risk_score, calculated_at")
    .eq("playlist_id", pl.id)
    .maybeSingle();

  // 3. Snapshots (séries temporais — usados pra freq_update e trend)
  const { data: snaps } = await supabase
    .from("playlist_metrics_snapshots")
    .select("followers, total_tracks, collected_at")
    .eq("spotify_playlist_id", pl.spotify_playlist_id)
    .order("collected_at", { ascending: false })
    .limit(20);

  // 4. Genre model (identidade) + benchmark do nicho (concorrentes)
  let genreModel: any = null;
  let benchmark: any = null;
  if (mgd?.genre_id) {
    const [{ data: g }, { data: bm }] = await Promise.all([
      supabase
        .from("genre_models")
        .select("nome, palavras_chave, insights")
        .eq("genre_id", mgd.genre_id)
        .maybeSingle(),
      supabase
        .from("genre_benchmarks")
        .select("sample_size, followers_p50, followers_p75, followers_p90, tracks_p50, tracks_p75, plays_per_follower_estimate, avg_growth_pct_30d, calculated_at")
        .eq("genre_id", mgd.genre_id)
        .maybeSingle(),
    ]);
    genreModel = g;
    benchmark = bm;
  }

  // ============ CÁLCULOS ============
  const now = new Date();
  const followers = pl.followers ?? mgd?.followers ?? 0;
  const tracksCount = mgd?.tracks_count ?? 0;
  const snapsArr = snaps ?? [];

  // identity
  const displayName = mgd?.name ?? pl.name ?? "";
  const nameLower = displayName.toLowerCase();
  const keywords: string[] = Array.isArray(genreModel?.palavras_chave)
    ? genreModel.palavras_chave.map((k: any) => typeof k === "string" ? k : k?.termo ?? "").filter(Boolean)
    : [];
  const matchedKw = keywords.filter((k) => nameLower.includes(k.toLowerCase()));

  const identity = {
    nicho: genreModel?.nome ?? null,
    keywords_matched: matchedKw,
    keywords_total: keywords.length,
    has_genre: !!mgd?.genre_id,
  };

  // personality
  let freqUpdateDias: number | null = null;
  if (snapsArr.length >= 2) {
    // Detecta mudança de tracks_count entre snapshots → frequência média de update
    const changes: number[] = [];
    for (let i = 0; i < snapsArr.length - 1; i++) {
      const a = snapsArr[i];
      const b = snapsArr[i + 1];
      if (a.total_tracks !== b.total_tracks) {
        const diffDays =
          (new Date(a.collected_at).getTime() - new Date(b.collected_at).getTime()) / (1000 * 60 * 60 * 24);
        if (diffDays > 0) changes.push(diffDays);
      }
    }
    if (changes.length > 0) {
      freqUpdateDias = Math.round(changes.reduce((a, b) => a + b, 0) / changes.length);
    }
  }

  const personality = {
    total_tracks: tracksCount,
    freq_update_dias: freqUpdateDias,
    snapshots_count: snapsArr.length,
  };

  // capacity_total: usa estimativa do nicho se houver, senão default
  const playsPerFollower = benchmark?.plays_per_follower_estimate ?? DEFAULT_PLAYS_PER_FOLLOWER_DAY;
  const baseCapacity = Math.round(followers * playsPerFollower);
  const capacityAdjust = score?.capacity_score ? score.capacity_score / 100 : 1;
  const capacityTotal = Math.round(baseCapacity * Math.max(0.3, capacityAdjust));

  // capacity_per_slot: precisa de série de plays — ainda null
  const capacityPerSlot: number | null = null;

  // capacity_ceiling: derivado do p90 do nicho (concorrentes)
  let capacityCeiling: number | null = null;
  let headroomPct: number | null = null;
  if (benchmark?.followers_p90 && benchmark.sample_size >= 3) {
    capacityCeiling = Math.round(benchmark.followers_p90 * playsPerFollower);
    if (capacityCeiling > 0) {
      const ratio = capacityTotal / capacityCeiling;
      headroomPct = Math.round(Math.max(0, Math.min(100, (1 - ratio) * 100)));
    }
  }

  // health_trend: por enquanto baseado em snapshots de followers
  let healthTrend: "crescendo" | "estavel" | "encolhendo" | "novo" | "sem_dados" = "sem_dados";
  if (snapsArr.length === 0) healthTrend = "sem_dados";
  else if (snapsArr.length === 1) healthTrend = "novo";
  else {
    const newest = snapsArr[0].followers;
    const oldest = snapsArr[snapsArr.length - 1].followers;
    const delta = newest - oldest;
    const pct = oldest > 0 ? (delta / oldest) * 100 : 0;
    if (pct > 2) healthTrend = "crescendo";
    else if (pct < -2) healthTrend = "encolhendo";
    else healthTrend = "estavel";
  }

  // signals
  const signals: Signal[] = [];
  const sigDate = now.toISOString();

  if (snapsArr.length === 0) {
    signals.push({
      code: "sem_snapshot",
      severity: "high",
      message: "Sem snapshot — bot não está coletando essa playlist",
      detected_at: sigDate,
    });
  } else {
    const lastSnap = new Date(snapsArr[0].collected_at);
    const daysSince = (now.getTime() - lastSnap.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSince > 7) {
      signals.push({
        code: "snapshot_atrasado",
        severity: "medium",
        message: `Último snapshot há ${Math.round(daysSince)} dias`,
        detected_at: sigDate,
      });
    }
  }

  if (!mgd?.genre_id) {
    signals.push({
      code: "sem_nicho",
      severity: "medium",
      message: "Playlist sem gênero definido — limita análise de identidade",
      detected_at: sigDate,
    });
  }

  if (!mgd?.last_diagnosis_at) {
    signals.push({
      code: "nunca_diagnosticada",
      severity: "low",
      message: "Nunca passou por diagnóstico contra o cérebro do nicho",
      detected_at: sigDate,
    });
  } else {
    const diagDays =
      (now.getTime() - new Date(mgd.last_diagnosis_at).getTime()) / (1000 * 60 * 60 * 24);
    if (diagDays > 30) {
      signals.push({
        code: "diagnostico_antigo",
        severity: "low",
        message: `Último diagnóstico há ${Math.round(diagDays)} dias`,
        detected_at: sigDate,
      });
    }
  }

  // Threshold de saúde por gênero (default 40 quando não há modelo configurado).
  let minHealthScore = 40;
  if (mgd?.genre_id) {
    const { data: gm } = await supabase
      .from("genre_models")
      .select("min_health_score")
      .eq("genre_id", mgd.genre_id)
      .maybeSingle();
    if (gm && typeof gm.min_health_score === "number") {
      minHealthScore = gm.min_health_score;
    }
  }

  if (score && score.health_score < minHealthScore) {
    signals.push({
      code: "saude_baixa",
      severity: "high",
      message: `Health score ${score.health_score}/100 — abaixo do mínimo do gênero (${minHealthScore})`,
      detected_at: sigDate,
    });
  }

  if (tracksCount > 0 && tracksCount < 30) {
    signals.push({
      code: "subpopulada",
      severity: "medium",
      message: `Só ${tracksCount} faixas — playlists do nicho costumam ter 50+`,
      detected_at: sigDate,
    });
  }

  if (keywords.length > 0 && matchedKw.length === 0) {
    signals.push({
      code: "identidade_diluida",
      severity: "medium",
      message: "Nome não reflete nenhuma palavra-chave do nicho",
      detected_at: sigDate,
    });
  }

  if (healthTrend === "encolhendo") {
    signals.push({
      code: "encolhendo",
      severity: "high",
      message: "Tendência de queda de seguidores",
      detected_at: sigDate,
    });
  }

  // === Sinais de comparação com benchmark do nicho ===
  if (mgd?.genre_id && (!benchmark || benchmark.sample_size < 3)) {
    signals.push({
      code: "sem_concorrentes",
      severity: "low",
      message: "Nicho ainda sem concorrentes mapeados — capacity_ceiling indisponível",
      detected_at: sigDate,
    });
  }
  if (benchmark && benchmark.sample_size >= 3 && benchmark.followers_p50) {
    if (followers > 0 && followers < benchmark.followers_p50 * 0.4) {
      signals.push({
        code: "muito_abaixo_da_mediana",
        severity: "medium",
        message: `${followers.toLocaleString("pt-BR")} seguidores — mediana do nicho é ${benchmark.followers_p50.toLocaleString("pt-BR")}`,
        detected_at: sigDate,
      });
    }
    if (followers >= benchmark.followers_p75) {
      signals.push({
        code: "acima_do_p75",
        severity: "low",
        message: `Top 25% do nicho (p75 = ${benchmark.followers_p75.toLocaleString("pt-BR")} seguidores)`,
        detected_at: sigDate,
      });
    }
  }
  if (benchmark?.tracks_p50 && tracksCount > 0 && tracksCount < benchmark.tracks_p50 * 0.6) {
    signals.push({
      code: "subpopulada_vs_nicho",
      severity: "medium",
      message: `${tracksCount} faixas vs mediana do nicho ${benchmark.tracks_p50}`,
      detected_at: sigDate,
    });
  }
  const recommendations: Recommendation[] = [];
  if (signals.find((s) => s.code === "sem_snapshot")) {
    recommendations.push({
      priority: 1,
      action: "Habilitar coleta automática no bot",
      reason: "Sem snapshots não é possível medir capacidade real",
    });
  }
  if (signals.find((s) => s.code === "sem_nicho")) {
    recommendations.push({
      priority: 1,
      action: "Definir gênero da playlist",
      reason: "Necessário para análise de identidade e benchmarks",
    });
  }
  if (signals.find((s) => s.code === "identidade_diluida")) {
    recommendations.push({
      priority: 2,
      action: "Revisar nome incluindo palavras-chave do nicho",
      reason: "Aumenta descobribilidade e identidade da playlist",
    });
  }
  if (signals.find((s) => s.code === "subpopulada")) {
    recommendations.push({
      priority: 2,
      action: "Adicionar faixas até atingir 50+",
      reason: "Playlists do nicho com mais faixas tendem a entregar mais",
    });
  }
  if (signals.find((s) => s.code === "saude_baixa")) {
    recommendations.push({
      priority: 1,
      action: "Aquecer playlist com músicas de tração comprovada",
      reason: "Score de saúde baixo indica baixa atividade ou entrega",
    });
  }
  if (signals.find((s) => s.code === "encolhendo")) {
    recommendations.push({
      priority: 1,
      action: "Atualizar capa e descrição + injeção de músicas virais",
      reason: "Tendência de queda precisa intervenção",
    });
  }
  if (signals.find((s) => s.code === "diagnostico_antigo" || s.code === "nunca_diagnosticada")) {
    recommendations.push({
      priority: 3,
      action: "Rodar diagnóstico contra cérebro do nicho",
      reason: "Identifica gaps de palavras-chave e sugestões de faixas",
    });
  }
  if (signals.find((s) => s.code === "subpopulada_vs_nicho")) {
    recommendations.push({
      priority: 2,
      action: `Aumentar para ~${benchmark?.tracks_p50 ?? 50} faixas`,
      reason: "Playlists do nicho com volume mediano entregam mais",
    });
  }
  if (signals.find((s) => s.code === "muito_abaixo_da_mediana")) {
    recommendations.push({
      priority: 2,
      action: "Plano de crescimento de seguidores (capa, descrição, divulgação cruzada)",
      reason: "Distância grande da mediana do nicho limita teto de entrega",
    });
  }
  if (signals.find((s) => s.code === "sem_concorrentes")) {
    recommendations.push({
      priority: 3,
      action: "Mapear concorrentes do nicho (botão sync no painel do gênero)",
      reason: "Sem amostra externa não é possível calcular teto realista",
    });
  }
  recommendations.sort((a, b) => a.priority - b.priority);

  // confidence_score (0-100) — quanto confiar nos cálculos
  let confidence = 0;
  if (snapsArr.length > 0) confidence += 25;
  if (snapsArr.length >= 5) confidence += 10;
  if (score) confidence += 15;
  if (mgd?.genre_id) confidence += 15;
  if (mgd?.last_diagnosis_at) confidence += 10;
  if (mgd) confidence += 10;
  if (benchmark && benchmark.sample_size >= 3) confidence += 15;
  confidence = Math.min(100, confidence);

  // ============ LIFECYCLE PHASE ============
  const benchmarkTracks: number | null = benchmark?.tracks_p50 ?? null;
  const { phase: phaseFromRatio, ratio: ratioToBenchmark } = derivePhase(tracksCount, benchmarkTracks);
  let lifecyclePhase: "seed" | "growth" | "mature" | "bloated" | "decline" = phaseFromRatio;

  // decline sobrescreve — 2+ snapshots consecutivos de queda em followers OU tracks
  if (snapsArr.length >= 3) {
    let fDrop = 0, tDrop = 0;
    for (let i = 0; i < Math.min(snapsArr.length - 1, 3); i++) {
      const cur = snapsArr[i], prev = snapsArr[i + 1];
      if (cur.followers != null && prev.followers != null && cur.followers < prev.followers) fDrop++;
      if (cur.total_tracks != null && prev.total_tracks != null && cur.total_tracks < prev.total_tracks) tDrop++;
    }
    if (fDrop >= 2 || tDrop >= 2) lifecyclePhase = "decline";
  }

  const growthRoadmap = buildRoadmap(tracksCount, benchmarkTracks ?? 0, lifecyclePhase);

  if (lifecyclePhase === "bloated") {
    signals.push({
      code: "acima_do_benchmark",
      severity: "medium",
      message: `${tracksCount} faixas (benchmark ${benchmarkTracks}) — modo redução ativo`,
      detected_at: sigDate,
    });
  } else if (lifecyclePhase === "decline") {
    signals.push({
      code: "fase_decline",
      severity: "high",
      message: "Queda em 2+ ciclos consecutivos — modo estrutural",
      detected_at: sigDate,
    });
  }

  if (mgd?.id) {
    await supabase
      .from("managed_playlists")
      .update({
        lifecycle_phase: lifecyclePhase,
        lifecycle_phase_updated_at: now.toISOString(),
      })
      .eq("id", mgd.id);
  }

  // ============ UPSERT ============
  const payload = {
    playlist_id: pl.id,
    identity,
    personality,
    capacity_total: capacityTotal,
    capacity_per_slot: capacityPerSlot,
    capacity_ceiling: capacityCeiling,
    headroom_pct: headroomPct,
    health_trend: healthTrend,
    signals,
    recommendations,
    confidence_score: confidence,
    last_calculated_at: now.toISOString(),
    calculation_version: CALC_VERSION,
    lifecycle_phase: lifecyclePhase,
    benchmark_tracks: benchmarkTracks,
    ratio_to_benchmark: ratioToBenchmark,
    growth_roadmap: growthRoadmap,
    metadata: {
      followers_at_calc: followers,
      score_health_at_calc: score?.health_score ?? null,
      genre_name: genreModel?.nome ?? null,
      benchmark_sample_size: benchmark?.sample_size ?? 0,
      plays_per_follower: playsPerFollower,
      tracks_count_at_calc: tracksCount,
    },
  };

  const { error: upsertErr } = await supabase
    .from("playlist_brain")
    .upsert(payload, { onConflict: "playlist_id" });
  if (upsertErr) throw new Error(`upsert playlist_brain: ${upsertErr.message}`);

  // History (1 linha por cálculo, leve)
  await supabase.from("playlist_brain_history").insert({
    playlist_id: pl.id,
    capacity_total: capacityTotal,
    capacity_per_slot: capacityPerSlot,
    health_score: score?.health_score ?? null,
    signals_count: signals.length,
    confidence_score: confidence,
  });

  return {
    playlist_id: pl.id,
    name: displayName,
    confidence_score: confidence,
    signals_count: signals.length,
    recommendations_count: recommendations.length,
    health_trend: healthTrend,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  logSnapshotBypass(req, "playlist-brain-calc");

  const guard = await requireTeamAccess(req);
  if (!guard.ok) return guard.resp;

  try {
    const body = await req.json().catch(() => ({}));
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    // Modo single
    if (body?.playlist_id) {
      const result = await calcOne(supabase, body.playlist_id);
      return jr({ ok: true, mode: "single", result });
    }

    // Modo batch (cron)
    if (body?.batch === true) {
      const startedAt = Date.now();
      try {
        const { data: managedRows, error: mErr } = await supabase
          .from("managed_playlists")
          .select("id, canonical_playlist_id, spotify_playlist_id, archived_at")
          .is("archived_at", null);
        if (mErr) throw new Error(mErr.message);

        const list = (managedRows ?? []).map((row: any) => ({
          id: row.canonical_playlist_id ?? row.id,
        }));

        const limit = Math.min(body?.limit ?? 200, 500);
        const subset = (list ?? []).slice(0, limit);

        const results: any[] = [];
        const errors: any[] = [];
        const CONCURRENCY = 8;
        for (let i = 0; i < subset.length; i += CONCURRENCY) {
          const chunk = subset.slice(i, i + CONCURRENCY);
          const settled = await Promise.allSettled(chunk.map((p) => calcOne(supabase, p.id)));
          settled.forEach((s, idx) => {
            if (s.status === "fulfilled") results.push(s.value);
            else errors.push({ playlist_id: chunk[idx].id, error: s.reason?.message ?? String(s.reason) });
          });
        }
        await reportCronHealth(supabase, {
          job_name: "playlist-brain-calc",
          status: errors.length > 0 ? "partial" : "ok",
          startedAt,
          metrics: { processed: results.length, errors_count: errors.length, total: subset.length },
        });
        return jr({
          ok: true,
          mode: "batch",
          processed: results.length,
          errors_count: errors.length,
          errors: errors.slice(0, 10),
        });
      } catch (e) {
        await reportCronHealth(supabase, {
          job_name: "playlist-brain-calc",
          status: "error",
          startedAt,
          message: (e as Error).message,
        });
        throw e;
      }
    }

    return jr({ ok: false, error: "informe playlist_id ou batch:true" }, 400);
  } catch (e) {
    return jr({ ok: false, error: (e as Error).message }, 500);
  }
});
