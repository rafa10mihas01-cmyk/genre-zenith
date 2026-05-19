// seo-experiment-suggest — gera 1 sugestão de experimento SEO para uma playlist
// Body: { playlist_id: string, field?: 'name'|'description' }
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { requireTeamAccess } from "../_shared/auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

const MIN_DAYS_BETWEEN = 14;

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const guard = await requireTeamAccess(req);
  if (!guard.ok) return guard.resp;

  try {
    const body = await req.json().catch(() => ({}));
    const playlistId: string = body?.playlist_id;
    const requestedField: "name" | "description" | undefined = body?.field;
    if (!playlistId) return jr({ ok: false, error: "playlist_id obrigatório" }, 400);

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: pl, error } = await supabase
      .from("managed_playlists")
      .select("id, name, description, genre_id, lifecycle_stage")
      .eq("id", playlistId)
      .maybeSingle();
    if (error || !pl) return jr({ ok: false, error: error?.message ?? "not found" }, 404);
    if (pl.lifecycle_stage === "onboarding") {
      return jr({ ok: false, error: "Playlist em onboarding — finalize a padronização primeiro." }, 409);
    }

    // Bloqueia se já houver experimento ativo
    const { data: active } = await supabase
      .from("playlist_seo_experiments")
      .select("id, status, applied_at")
      .eq("playlist_id", playlistId)
      .in("status", ["proposed", "active"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (active) {
      return jr({ ok: false, error: "Já existe experimento em andamento", existing: active }, 409);
    }

    // Respeita janela mínima desde o último completed
    const { data: lastCompleted } = await supabase
      .from("playlist_seo_experiments")
      .select("measured_at, applied_at")
      .eq("playlist_id", playlistId)
      .eq("status", "completed")
      .order("measured_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lastCompleted?.measured_at) {
      const days = (Date.now() - new Date(lastCompleted.measured_at).getTime()) / 86_400_000;
      if (days < MIN_DAYS_BETWEEN) {
        return jr({ ok: false, error: `Aguarde ${Math.ceil(MIN_DAYS_BETWEEN - days)}d antes de novo experimento.` }, 429);
      }
    }

    // Lições do nicho (padrões com avg_delta_pct positivo, não testados ainda)
    let bestPattern: any = null;
    if (pl.genre_id) {
      const { data: lessons } = await supabase
        .from("seo_genre_lessons")
        .select("pattern_key, pattern_label, field, avg_delta_pct, samples_count, positive_count")
        .eq("genre_id", pl.genre_id)
        .gte("samples_count", 1)
        .order("avg_delta_pct", { ascending: false })
        .limit(20);
      const { data: tested } = await supabase
        .from("playlist_seo_experiments")
        .select("pattern_key")
        .eq("playlist_id", playlistId)
        .not("pattern_key", "is", null);
      const testedKeys = new Set((tested ?? []).map((t: any) => t.pattern_key));
      bestPattern = (lessons ?? []).find((l: any) => !testedKeys.has(l.pattern_key)) ?? null;
    }

    // Nicho
    let genreName: string | null = null;
    if (pl.genre_id) {
      const { data: g } = await supabase.from("genres").select("nome").eq("id", pl.genre_id).maybeSingle();
      genreName = (g as any)?.nome ?? null;
    }

    // Escolha do campo a testar (privilegia o que o operador pediu; senão alterna por heurística simples)
    const field: "name" | "description" =
      requestedField ?? (bestPattern?.field ?? (pl.description && pl.description.length > 60 ? "name" : "description"));

    const current = field === "name" ? (pl.name ?? "") : (pl.description ?? "");

    // Gera sugestão via Lovable AI Gateway
    const system = [
      `Você é editor sênior do Spotify, nicho "${genreName ?? "música brasileira"}".`,
      `Sua missão: propor UMA micro-mudança no ${field === "name" ? "TÍTULO" : "DESCRIÇÃO"} de uma playlist editorial para testar impacto em SEO interno do Spotify.`,
      bestPattern
        ? `O padrão a aplicar é: "${bestPattern.pattern_label}" (key: ${bestPattern.pattern_key}). Esse padrão historicamente teve delta médio ${Number(bestPattern.avg_delta_pct).toFixed(2)}% em ${bestPattern.samples_count} amostras.`
        : `Não há padrão histórico ainda — proponha um padrão claro e específico (ex.: "adicionar palavra-chave do nicho no início", "encurtar para foco editorial", "incluir verbo de ação"). NUNCA use emojis.`,
      `Regras: NUNCA emojis. NUNCA maiúsculas artificiais. Português brasileiro. Soar como editor humano real.`,
      field === "name" ? `Título máximo 40 caracteres.` : `Descrição entre 60 e 180 caracteres.`,
      `Mudança deve ser SUTIL (não reescrever do zero). Mantenha a identidade da playlist.`,
      ``,
      `Retorne APENAS JSON: {"version_after":"...","pattern_key":"...","pattern_label":"...","reasoning":"..."}`,
    ].join("\n");

    const userPayload = {
      campo: field,
      versao_atual: current,
      nicho: genreName,
      nome_playlist: pl.name,
      descricao_playlist: pl.description,
    };

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: system },
          { role: "user", content: JSON.stringify(userPayload) },
        ],
        response_format: { type: "json_object" },
        temperature: 0.7,
      }),
    });

    if (aiResp.status === 429) return jr({ ok: false, error: "Limite de requisições atingido. Tente novamente em alguns minutos." }, 429);
    if (aiResp.status === 402) return jr({ ok: false, error: "Créditos da IA esgotados — adicione créditos no workspace." }, 402);
    if (!aiResp.ok) return jr({ ok: false, error: `AI gateway ${aiResp.status}` }, 500);

    const aiJson = await aiResp.json();
    const raw = aiJson?.choices?.[0]?.message?.content;
    if (!raw) return jr({ ok: false, error: "Resposta vazia da IA" }, 500);

    let parsed: any;
    try { parsed = JSON.parse(raw); } catch { return jr({ ok: false, error: "JSON inválido da IA" }, 500); }

    const versionAfter = String(parsed.version_after ?? "").trim();
    if (!versionAfter || versionAfter === current) {
      return jr({ ok: false, error: "IA não gerou mudança válida" }, 422);
    }

    const patternKey = String(parsed.pattern_key ?? bestPattern?.pattern_key ?? `adhoc_${Date.now()}`).slice(0, 60);
    const patternLabel = String(parsed.pattern_label ?? bestPattern?.pattern_label ?? "Sugestão pontual").slice(0, 120);
    const reasoning = String(parsed.reasoning ?? "").slice(0, 500);

    const { data: created, error: insErr } = await supabase
      .from("playlist_seo_experiments")
      .insert({
        playlist_id: pl.id,
        genre_id: pl.genre_id,
        field,
        pattern_key: patternKey,
        pattern_label: patternLabel,
        version_before: current,
        version_after: versionAfter,
        reasoning,
        suggestion_source: "ai",
        status: "proposed",
      })
      .select("*")
      .single();
    if (insErr) return jr({ ok: false, error: insErr.message }, 500);

    return jr({ ok: true, experiment: created });
  } catch (e) {
    return jr({ ok: false, error: (e as Error).message }, 500);
  }
});
