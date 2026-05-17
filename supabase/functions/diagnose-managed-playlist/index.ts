// diagnose-managed-playlist — analisa uma playlist gerenciada contra o
// genre_model do gênero correspondente e gera sugestões (nome, faixas, capa).
import { corsHeaders } from "npm:@supabase/supabase-js/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { requireTeamAccess } from "../_shared/auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const guard = await requireTeamAccess(req);
  if (!guard.ok) return guard.resp;

  try {
    const body = await req.json().catch(() => ({}));
    const playlistId: string = body?.playlist_id;
    if (!playlistId) return jr({ ok: false, error: "playlist_id obrigatório" }, 400);

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: pl, error: plErr } = await supabase
      .from("managed_playlists")
      .select("*")
      .eq("id", playlistId)
      .maybeSingle();
    if (plErr || !pl) return jr({ ok: false, error: plErr?.message ?? "playlist não encontrada" }, 404);

    let model: any = null;
    let benchmark: any = null;
    let competitors: any[] = [];
    if (pl.genre_id) {
      const [{ data: m }, { data: b }, { data: comps }] = await Promise.all([
        supabase.from("genre_models")
          .select("palavras_chave, padroes_nome, musicas_recorrentes, insights")
          .eq("genre_id", pl.genre_id).maybeSingle(),
        supabase.from("genre_benchmarks")
          .select("followers_p50,followers_p75,followers_p90,tracks_p50,tracks_p75,tracks_p90,sample_size")
          .eq("genre_id", pl.genre_id).maybeSingle(),
        supabase.from("playlists")
          .select("spotify_playlist_id,name,followers,cover_url")
          .eq("genre_id", pl.genre_id)
          .eq("ownership", "external")
          .eq("monitored", true)
          .not("followers", "is", null)
          .order("followers", { ascending: false })
          .limit(10),
      ]);
      model = m;
      benchmark = b;
      competitors = (comps ?? []).map((c: any) => ({
        spotify_playlist_id: c.spotify_playlist_id,
        name: c.name,
        followers: c.followers,
        cover_url: c.cover_url,
      }));
    }

    // Normaliza keywords (shape pode ser string ou {value/termo, count})
    const nameLower = (pl.name ?? "").toLowerCase();
    const keywords: string[] = Array.isArray(model?.palavras_chave)
      ? model.palavras_chave
          .map((k: any) => (typeof k === "string" ? k : (k?.value ?? k?.termo ?? "")))
          .filter(Boolean)
      : [];
    const topKeywords = keywords.slice(0, 10);
    const present = topKeywords.filter((k) => nameLower.includes(k.toLowerCase()));
    const missing = topKeywords.filter((k) => !nameLower.includes(k.toLowerCase())).slice(0, 8);

    // name_score: % de top-keywords presentes no título (0-100)
    const score = topKeywords.length > 0
      ? Math.round((present.length / topKeywords.length) * 100)
      : null;

    const reasons: any[] = missing.map((k) => ({ type: "missing_keyword", value: k }));

    // Benchmark de tamanho (tracks)
    if (benchmark?.tracks_p50 && pl.tracks_count) {
      if (pl.tracks_count > benchmark.tracks_p90) {
        reasons.push({ type: "too_many_tracks", value: pl.tracks_count, benchmark_p90: benchmark.tracks_p90 });
      } else if (pl.tracks_count < benchmark.tracks_p50 / 2) {
        reasons.push({ type: "too_few_tracks", value: pl.tracks_count, benchmark_p50: benchmark.tracks_p50 });
      }
    }

    const tracksSuggestions = Array.isArray(model?.musicas_recorrentes)
      ? model.musicas_recorrentes.slice(0, 10)
      : [];

    const nameSuggestion = missing.length > 0
      ? `${pl.name} ${missing.slice(0, 2).map((k) => k.toUpperCase()).join(" ")}`
      : null;

    const { data: diag, error: dErr } = await supabase
      .from("playlist_diagnoses")
      .insert({
        playlist_id: pl.id,
        created_by: guard.via === "user" ? guard.userId : null,
        name_score: score,
        name_current: pl.name,
        name_suggestion: nameSuggestion,
        name_reasons: reasons,
        tracks_suggestions: tracksSuggestions,
        cover_suggestion: model?.insights?.cover ?? model?.insights?.dna_visual ?? {},
        competitors,
        raw: { model_present: !!model, benchmark, top_keywords: topKeywords, present_keywords: present },
      })
      .select()
      .single();

    if (!dErr) {
      await supabase.from("managed_playlists")
        .update({ last_diagnosis_at: new Date().toISOString() })
        .eq("id", pl.id);
    }

    return jr({ ok: true, diagnosis: diag, error: dErr?.message });
  } catch (e) {
    return jr({ ok: false, error: (e as Error).message }, 500);
  }
});
