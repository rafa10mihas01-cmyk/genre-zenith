// Wave 3 — Detecta o resultado real de cada sugestão.
// 1. Para cada recommendation_feedback com ação humana (converted_to_deal, removal_requested, visto),
//    cruza com track_playlist_fit e com curator_playlists pra ver se a faixa entrou/saiu da playlist.
// 2. Quando a mudança bate com o recommendation_kind, registra detected_at e captura streams_before_28d.
// 3. Após 28 dias do detected_at, calcula streams_after_28d e dá veredito.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { reportCronHealth } from "../_shared/cron-health.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Feedback = {
  fit_id: string;
  action: string;
};
type Fit = {
  id: string;
  spotify_track_id: string;
  spotify_playlist_id: string;
  recommendation_kind: "adicionar" | "remover" | "manter";
  already_present: boolean;
};
type Outcome = {
  id: string;
  fit_id: string;
  outcome_kind: string;
  detected_at: string | null;
  streams_before_28d: number | null;
  streams_after_28d: number | null;
  verdict: string | null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const startedAt = Date.now();
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  try {
    // 1. Carrega feedbacks acionáveis
    const { data: feedbacks } = await supabase
      .from("recommendation_feedback")
      .select("fit_id, action")
      .in("action", ["converted_to_deal", "removal_requested", "visto"]);
    const fb = (feedbacks ?? []) as Feedback[];
    if (fb.length === 0) {
      await reportCronHealth(supabase, { job_name: "detect-recommendation-outcomes", status: "ok", startedAt, metrics: { considered: 0 } });
      return new Response(JSON.stringify({ ok: true, considered: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const fitIds = Array.from(new Set(fb.map((f) => f.fit_id))).filter(Boolean);
    const { data: fits } = await supabase
      .from("track_playlist_fit")
      .select("id, spotify_track_id, spotify_playlist_id, recommendation_kind, already_present")
      .in("id", fitIds as any);
    const fitMap = new Map<string, Fit>();
    for (const f of (fits ?? []) as Fit[]) fitMap.set(f.id, f);

    // 2. Carrega outcomes existentes
    const { data: outcomes } = await supabase
      .from("recommendation_outcome")
      .select("id, fit_id, outcome_kind, detected_at, streams_before_28d, streams_after_28d, verdict")
      .in("fit_id", fitIds as any);
    const outcomeMap = new Map<string, Outcome>();
    for (const o of (outcomes ?? []) as Outcome[]) outcomeMap.set(o.fit_id, o);

    // 3. Snapshot atual: pra cada (track, playlist) verifica presença atual
    const pairs = fitIds
      .map((id) => fitMap.get(id))
      .filter(Boolean)
      .map((f) => ({ track: f!.spotify_track_id, playlist: f!.spotify_playlist_id }));
    const trackIds = Array.from(new Set(pairs.map((p) => p.track)));
    const playlistIds = Array.from(new Set(pairs.map((p) => p.playlist)));

    // curator_playlists.song_id -> spotify_track_id via curator_deal_songs
    const presence = new Set<string>(); // "trackId|playlistId"
    if (playlistIds.length && trackIds.length) {
      const { data: cps } = await supabase
        .from("v_curator_playlists_operational")
        .select("song_id, spotify_playlist_id")
        .in("spotify_playlist_id", playlistIds as any);
      const songIds = Array.from(new Set((cps ?? []).map((r: any) => r.song_id).filter(Boolean)));
      const songToTrack = new Map<string, string>();
      if (songIds.length) {
        const { data: songs } = await supabase
          .from("curator_deal_songs")
          .select("id, spotify_track_id")
          .in("id", songIds as any);
        for (const s of (songs ?? []) as any[]) {
          if (s.spotify_track_id) songToTrack.set(s.id, s.spotify_track_id);
        }
      }
      for (const r of (cps ?? []) as any[]) {
        const t = songToTrack.get(r.song_id);
        if (t) presence.add(`${t}|${r.spotify_playlist_id}`);
      }
    }

    // 4. Streams atuais via track_ecosystem_score
    const { data: scores } = await supabase
      .from("track_ecosystem_score")
      .select("spotify_track_id, streams_28d")
      .in("spotify_track_id", trackIds as any);
    const streamsMap = new Map<string, number>();
    for (const s of (scores ?? []) as any[]) streamsMap.set(s.spotify_track_id, Number(s.streams_28d ?? 0));

    const now = new Date();
    let detected = 0;
    let verdicts = 0;
    const upserts: any[] = [];

    for (const fitId of fitIds) {
      const fit = fitMap.get(fitId);
      if (!fit) continue;
      const ex = outcomeMap.get(fitId);
      const presentNow = presence.has(`${fit.spotify_track_id}|${fit.spotify_playlist_id}`);
      const wasPresent = fit.already_present;
      const currentStreams = streamsMap.get(fit.spotify_track_id) ?? null;

      // Detecção: ação coincide com mudança de presença
      let outcome_kind = ex?.outcome_kind ?? "pending";
      let detected_at = ex?.detected_at ?? null;
      let streams_before_28d = ex?.streams_before_28d ?? null;

      if (!detected_at) {
        if (fit.recommendation_kind === "adicionar" && presentNow && !wasPresent) {
          outcome_kind = "added";
          detected_at = now.toISOString();
          streams_before_28d = currentStreams;
          detected++;
        } else if (fit.recommendation_kind === "remover" && !presentNow && wasPresent) {
          outcome_kind = "removed";
          detected_at = now.toISOString();
          streams_before_28d = currentStreams;
          detected++;
        }
      }

      // Veredito após 28 dias
      let streams_after_28d = ex?.streams_after_28d ?? null;
      let verdict = ex?.verdict ?? null;
      if (detected_at && !verdict) {
        const ageDays = (now.getTime() - new Date(detected_at).getTime()) / 86400_000;
        if (ageDays >= 28) {
          streams_after_28d = currentStreams;
          const before = streams_before_28d ?? 0;
          const after = streams_after_28d ?? 0;
          const delta = before > 0 ? ((after - before) / before) * 100 : null;
          if (fit.recommendation_kind === "adicionar") {
            verdict = (delta ?? 0) > 5 ? "acertou" : (delta ?? 0) < -5 ? "errou" : "inconclusivo";
          } else if (fit.recommendation_kind === "remover") {
            // Pra remover, "acertou" se streams da faixa caíam e curador liberou slot.
            // Sem benchmark de slot ainda → marca inconclusivo.
            verdict = "inconclusivo";
          } else {
            verdict = "inconclusivo";
          }
          verdicts++;
        }
      }

      const impact_delta_pct = streams_before_28d && streams_before_28d > 0 && streams_after_28d != null
        ? ((streams_after_28d - streams_before_28d) / streams_before_28d) * 100
        : null;

      upserts.push({
        ...(ex?.id ? { id: ex.id } : {}),
        fit_id: fitId,
        outcome_kind,
        detected_at,
        streams_before_28d,
        streams_after_28d,
        impact_delta_pct,
        verdict,
      });
    }

    if (upserts.length > 0) {
      const { error } = await supabase
        .from("recommendation_outcome")
        .upsert(upserts, { onConflict: "fit_id" });
      if (error) throw error;
    }

    await reportCronHealth(supabase, {
      job_name: "detect-recommendation-outcomes",
      status: "ok",
      startedAt,
      metrics: { considered: fb.length, detected, verdicts, upserts: upserts.length },
    });
    return new Response(JSON.stringify({
      ok: true,
      considered: fb.length,
      detected,
      verdicts,
      upserts: upserts.length,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    await reportCronHealth(supabase, { job_name: "detect-recommendation-outcomes", status: "error", startedAt, message: String(e) });
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
