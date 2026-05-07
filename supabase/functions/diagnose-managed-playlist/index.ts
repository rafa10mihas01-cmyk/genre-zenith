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
    if (pl.genre_id) {
      const { data: m } = await supabase
        .from("genre_models")
        .select("palavras_chave, padroes_nome, musicas_recorrentes, insights")
        .eq("genre_id", pl.genre_id)
        .maybeSingle();
      model = m;
    }

    // Análise simples baseada em keywords — sem chamada de IA cara
    const nameLower = (pl.name ?? "").toLowerCase();
    const keywords: string[] = Array.isArray(model?.palavras_chave)
      ? model.palavras_chave.map((k: any) => (typeof k === "string" ? k : k?.termo ?? "")).filter(Boolean)
      : [];
    const missing = keywords.filter((k) => !nameLower.includes(k.toLowerCase())).slice(0, 8);
    const present = keywords.filter((k) => nameLower.includes(k.toLowerCase()));
    const score = keywords.length > 0
      ? Math.round((present.length / Math.min(keywords.length, 5)) * 100)
      : null;

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
        name_reasons: missing.map((k) => ({ type: "missing_keyword", value: k })),
        tracks_suggestions: tracksSuggestions,
        cover_suggestion: model?.insights?.cover ?? {},
        raw: { model_present: !!model },
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
