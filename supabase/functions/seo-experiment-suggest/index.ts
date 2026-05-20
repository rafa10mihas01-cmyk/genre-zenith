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

    // Detecta DNA da playlist atual para a IA espelhar (não impor estética estrangeira)
    const dnaSource = `${pl.name ?? ""} ${pl.description ?? ""}`;
    const emojiRegex = /[\p{Extended_Pictographic}\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu;
    const dnaEmojis = (dnaSource.match(emojiRegex) ?? []).slice(0, 6);
    const letters = dnaSource.replace(/[^A-Za-zÀ-ÿ]/g, "");
    const upperRatio = letters.length ? letters.replace(/[^A-ZÀ-Ý]/g, "").length / letters.length : 0;
    const usesCaps = upperRatio > 0.5;
    const usesEmojis = dnaEmojis.length > 0;
    const dnaSummary = [
      `caixa: ${usesCaps ? "CAIXA ALTA dominante" : upperRatio > 0.2 ? "mista" : "minúscula"}`,
      `emojis observados: ${usesEmojis ? dnaEmojis.join(" ") : "nenhum"}`,
      `tom atual do nome: "${pl.name ?? ""}"`,
      `tom atual da descrição: "${pl.description ?? ""}"`,
    ].join(" | ");

    // Gera sugestão via Lovable AI Gateway
    const system = [
      `Você é um CURADOR BRASILEIRO de playlists independentes de ALTO CTR no Spotify — não é editor corporativo, não é editor gringo, não é RapCaviar.`,
      `Sua referência são playlists virais brasileiras do nicho "${genreName ?? "música brasileira popular"}": títulos com impacto, chamada direta, emoção real, energia popular BR.`,
      `Missão: propor UMA evolução no ${field === "name" ? "TÍTULO" : "DESCRIÇÃO"} dessa playlist mantendo o DNA dela.`,
      ``,
      `DNA atual da playlist (ESPELHE, não substitua):`,
      dnaSummary,
      ``,
      `REGRAS DE ESTILO (obrigatórias):`,
      `1. Espelhe o DNA: se já usa CAIXA ALTA, continue em CAIXA ALTA; se usa emoji, continue usando emoji; se é minúscula editorial, mantenha minúscula.`,
      `2. EMOJIS são LIBERADOS e estratégicos (1 a 3, no máximo 4). Use para gerar atenção e CTR — não é proibido, é ferramenta. Proibido: spam visual, 5+ emojis seguidos, emoji infantil aleatório.`,
      `3. CAIXA ALTA é PERMITIDA quando é coerente com o nicho e dá impacto (ex.: "FUNK MANDELÃO 2025 🔥", "SÓ PEDRADA PRA SOFRER 💔").`,
      `4. Tom: humano, emocional, popular, musical, brasileiro de verdade. Chamada direta ("COLOCA NO ALEATÓRIO", "PRA OUVIR NO CARRO", "SOFRENDO COM ESTILO"). Pode usar gíria do nicho quando natural.`,
      `5. PROIBIDO: tom frio editorial Spotify global, lowercase forçado quando o DNA é caixa alta, linguagem corporativa, "curadoria selecionada", "uma seleção de", "vibes" genérico, spam cringe de internet, hashtag, @, link.`,
      `6. Mantenha keywords do nicho (SEO continua importante) — só que de forma NATURAL dentro do tom popular BR.`,
      `7. Mudança SUTIL: não reescreva do zero. Evolua o que já existe preservando identidade.`,
      ``,
      bestPattern
        ? `Padrão histórico do nicho a aplicar: "${bestPattern.pattern_label}" (key: ${bestPattern.pattern_key}, delta médio ${Number(bestPattern.avg_delta_pct).toFixed(2)}% em ${bestPattern.samples_count} amostras). Aplique respeitando o DNA acima.`
        : `Sem padrão histórico — proponha um padrão claro e específico coerente com o universo de playlists BR de alto CTR (ex.: "adicionar emoji emocional no fim", "trocar palavra fria por palavra de impacto", "incluir chamada direta").`,
      ``,
      field === "name"
        ? `LIMITE TÍTULO: máximo 45 caracteres (contando emojis).`
        : `LIMITE DESCRIÇÃO: entre 40 e 180 caracteres. Pode (e deve, quando combinar com o DNA) terminar com 1-2 emojis emocionais.`,
      ``,
      `Retorne APENAS JSON válido: {"version_after":"...","pattern_key":"...","pattern_label":"...","reasoning":"..."}`,
      `O campo "reasoning" deve explicar em 1 frase por que essa mudança bate com o DNA da playlist e com playlists BR virais do nicho.`,
    ].join("\n");

    const userPayload = {
      campo: field,
      versao_atual: current,
      nicho: genreName,
      nome_playlist: pl.name,
      descricao_playlist: pl.description,
      dna_detectado: {
        usa_caixa_alta: usesCaps,
        usa_emojis: usesEmojis,
        emojis_encontrados: dnaEmojis,
        razao_maiusculas: Number(upperRatio.toFixed(2)),
      },
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
