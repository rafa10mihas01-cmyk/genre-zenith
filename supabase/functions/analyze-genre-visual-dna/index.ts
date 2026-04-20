// analyze-genre-visual-dna — extrai DNA visual das top capas do gênero via Gemini multimodal
// Salva em genre_models.insights.dna_visual
import { corsHeaders } from "npm:@supabase/supabase-js/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

const TOP_N = 8; // capas pra analisar

function j(payload: any, status = 200) {
  return new Response(JSON.stringify(payload), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const start = Date.now();

  let body: { genre_id: string };
  try { body = await req.json(); } catch { return j({ error: "Invalid JSON" }, 400); }
  if (!body.genre_id) return j({ error: "genre_id obrigatório" }, 400);
  if (!LOVABLE_API_KEY) return j({ error: "LOVABLE_API_KEY ausente" }, 500);

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    const { data: genre } = await supabase
      .from("genres").select("id,nome").eq("id", body.genre_id).single();
    if (!genre) return j({ error: "Gênero não encontrado" }, 404);

    // Pega top capas com URL válida ordenado por seguidores
    const { data: results } = await supabase
      .from("search_results")
      .select("nome_playlist,imagem_url,seguidores")
      .eq("genre_id", body.genre_id)
      .not("imagem_url", "is", null)
      .order("seguidores", { ascending: false, nullsFirst: false })
      .limit(TOP_N);

    if (!results || results.length === 0) {
      return j({ ok: false, error: "Sem capas pra analisar" }, 400);
    }

    // Filtra só URLs single-image (mosaic.scdn.co são compostas, atrapalham análise visual)
    const validCovers = results.filter(r =>
      r.imagem_url && !r.imagem_url.includes("mosaic.scdn.co")
    ).slice(0, 6);

    if (validCovers.length < 3) {
      return j({ ok: false, error: "Capas insuficientes (precisa de ≥3 single-image)" }, 400);
    }

    // Monta payload multimodal
    const userContent: any[] = [
      {
        type: "text",
        text: `Analise as ${validCovers.length} capas de playlists do gênero "${genre.nome}" abaixo e extraia o DNA VISUAL DOMINANTE.

Retorne via tool call. Seja DIRETO e baseado APENAS no que vê — sem inventar.

Para cada campo:
- cores_dominantes: 3-5 cores em hex (ex: "#FF0000") observadas como predominantes no conjunto
- estilo_dominante: ESCOLHA UMA: "fotografia", "ilustração", "tipografia", "grafite/street", "3D/render", "minimalista", "colagem", "neon/cyber", "retrô/vhs"
- uso_texto: ESCOLHA UMA: "texto grande dominante", "texto pequeno em canto", "sem texto", "texto sobre faixa colorida"
- presenca_emoji: true/false (capa visualmente sugere emojis no nome ou tem emojis grafados)
- ano_visivel: true/false (aparece "2026" ou ano qualquer na imagem)
- estrutura_visual: ESCOLHA UMA: "centralizada simétrica", "assimétrica caótica", "grade/grid", "foco em personagem", "abstrata/textura"
- atmosfera: 2-3 palavras (ex: "agressiva noturna", "luxuosa dourada", "casual descolada")
- recomendacao_criacao: 1 frase prática pro designer (ex: "Use fundo escuro + texto branco grande + acento neon")`,
      },
      ...validCovers.map(c => ({
        type: "image_url",
        image_url: { url: c.imagem_url },
      })),
    ];

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: "Você é um diretor de arte especialista em capas de playlist do Spotify. Analise imagens e extraia padrões visuais factuais." },
          { role: "user", content: userContent },
        ],
        tools: [{
          type: "function",
          function: {
            name: "extract_visual_dna",
            description: "Extrai DNA visual dominante do conjunto de capas",
            parameters: {
              type: "object",
              properties: {
                cores_dominantes: {
                  type: "array",
                  items: { type: "string", pattern: "^#[0-9A-Fa-f]{6}$" },
                  minItems: 3,
                  maxItems: 5,
                },
                estilo_dominante: { type: "string" },
                uso_texto: { type: "string" },
                presenca_emoji: { type: "boolean" },
                ano_visivel: { type: "boolean" },
                estrutura_visual: { type: "string" },
                atmosfera: { type: "string" },
                recomendacao_criacao: { type: "string" },
              },
              required: ["cores_dominantes", "estilo_dominante", "uso_texto", "presenca_emoji", "ano_visivel", "estrutura_visual", "atmosfera", "recomendacao_criacao"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "extract_visual_dna" } },
      }),
    });

    if (!aiResp.ok) {
      const errText = await aiResp.text();
      console.error("AI gateway error:", aiResp.status, errText);
      if (aiResp.status === 429) return j({ ok: false, error: "Rate limit. Aguarde 1 min." }, 429);
      if (aiResp.status === 402) return j({ ok: false, error: "Créditos esgotados no workspace Lovable AI." }, 402);
      return j({ ok: false, error: `AI HTTP ${aiResp.status}: ${errText.slice(0, 200)}` }, 500);
    }

    const aiJson = await aiResp.json();
    const toolCall = aiJson?.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall?.function?.arguments) {
      return j({ ok: false, error: "AI não retornou tool_call" }, 500);
    }

    let dna: any;
    try {
      dna = JSON.parse(toolCall.function.arguments);
    } catch (e) {
      return j({ ok: false, error: "AI retornou JSON inválido" }, 500);
    }

    // Salva em genre_models.insights.dna_visual
    const { data: model } = await supabase
      .from("genre_models")
      .select("id,insights")
      .eq("genre_id", body.genre_id)
      .maybeSingle();

    const newInsights = {
      ...(model?.insights as any ?? {}),
      dna_visual: {
        ...dna,
        capas_analisadas: validCovers.map(c => ({ nome: c.nome_playlist, url: c.imagem_url })),
        analyzed_at: new Date().toISOString(),
      },
    };

    if (model) {
      await supabase.from("genre_models")
        .update({ insights: newInsights, updated_at: new Date().toISOString() })
        .eq("id", model.id);
    } else {
      await supabase.from("genre_models")
        .insert({ genre_id: body.genre_id, insights: newInsights });
    }

    await supabase.from("collection_logs").insert({
      genre_id: body.genre_id,
      acao: "analyze-visual-dna",
      status: "sucesso",
      mensagem: `DNA visual extraído de ${validCovers.length} capas: ${dna.estilo_dominante}, ${dna.atmosfera}`,
      duracao_ms: Date.now() - start,
    });

    return j({ ok: true, dna_visual: newInsights.dna_visual });
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    console.error("analyze-genre-visual-dna error:", msg);
    await supabase.from("collection_logs").insert({
      genre_id: body.genre_id,
      acao: "analyze-visual-dna",
      status: "erro",
      mensagem: msg.slice(0, 500),
      duracao_ms: Date.now() - start,
    }).catch(() => {});
    return j({ ok: false, error: msg }, 500);
  }
});
