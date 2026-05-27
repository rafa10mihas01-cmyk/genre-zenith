// analyze-genre-visual-dna — extrai DNA visual das top capas do gênero via Gemini multimodal
// Modo global: { genre_id }                        → salva em insights.dna_visual
// Modo segmentado: { genre_id, subgenero_slug }    → salva em insights.dna_visual_subgeneros[slug]
import { corsHeaders } from "npm:@supabase/supabase-js/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { requireTeamAccess } from "../_shared/auth.ts";
import { getSpotifyToken } from "../_shared/spotify.ts";

import { deprecationGate } from "../_shared/_deprecation.ts";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

const TOP_N = 8; // capas pra analisar
const MIN_COVERS = 3;

function j(payload: any, status = 200) {
  return new Response(JSON.stringify(payload), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

Deno.serve(async (req) => {
  const __dep = await deprecationGate(req, "analyze-genre-visual-dna");
  if (__dep) return __dep;
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "OPTIONS") {
    const guard = await requireTeamAccess(req);
    if (!guard.ok) return guard.resp;
  }
  const start = Date.now();

  let body: { genre_id: string; subgenero_slug?: string };
  try { body = await req.json(); } catch { return j({ error: "Invalid JSON" }, 400); }
  if (!body.genre_id) return j({ error: "genre_id obrigatório" }, 400);
  if (!LOVABLE_API_KEY) return j({ error: "LOVABLE_API_KEY ausente" }, 500);

  const subgeneroSlug = body.subgenero_slug?.toLowerCase().trim() || null;
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    const { data: genre } = await supabase
      .from("genres").select("id,nome").eq("id", body.genre_id).single();
    if (!genre) return j({ error: "Gênero não encontrado" }, 404);

    // ============ SELEÇÃO DE CAPAS ============
    let results: { nome_playlist: string; imagem_url: string; seguidores: number | null; descricao?: string | null }[] = [];
    let subgeneroNome: string | null = null;

    if (subgeneroSlug) {
      // Modo segmentado: filtra playlists cujo nome OU descrição contenha o slug do subgênero.
      // Pega bem mais (até 60) pra ter pool depois do filtro single-image.
      const { data: pool } = await supabase
        .from("search_results")
        .select("nome_playlist,imagem_url,seguidores,descricao")
        .eq("genre_id", body.genre_id)
        .not("imagem_url", "is", null)
        .order("seguidores", { ascending: false, nullsFirst: false })
        .limit(60);

      const filtered = (pool ?? []).filter(r => {
        const cloud = new Set([
          ...tokenize(r.nome_playlist ?? ""),
          ...tokenize((r as any).descricao ?? ""),
        ]);
        return cloud.has(subgeneroSlug);
      });

      // Tenta resgatar nome "bonito" do subgênero a partir do genre_models
      const { data: model } = await supabase
        .from("genre_models")
        .select("insights")
        .eq("genre_id", body.genre_id)
        .maybeSingle();
      const subs = (model?.insights as any)?.subgeneros ?? [];
      const found = subs.find((s: any) =>
        String(s.slug ?? "").toLowerCase() === subgeneroSlug ||
        String(s.nome ?? "").toLowerCase() === subgeneroSlug,
      );
      subgeneroNome = found?.nome ?? subgeneroSlug;

      results = filtered.slice(0, TOP_N);
      if (results.length < MIN_COVERS) {
        return j({
          ok: false,
          error: `Subgênero "${subgeneroSlug}" tem apenas ${results.length} playlists com capa (mínimo ${MIN_COVERS}).`,
        }, 400);
      }
    } else {
      // Modo global
      const { data } = await supabase
        .from("search_results")
        .select("nome_playlist,imagem_url,seguidores")
        .eq("genre_id", body.genre_id)
        .not("imagem_url", "is", null)
        .order("seguidores", { ascending: false, nullsFirst: false })
        .limit(TOP_N);
      results = data ?? [];
    }

    if (!results || results.length === 0) {
      return j({ ok: false, error: "Sem capas pra analisar" }, 400);
    }

    // Filtra só URLs single-image (mosaic.scdn.co são compostas, atrapalham análise visual)
    const validCovers = results.filter(r =>
      r.imagem_url && !r.imagem_url.includes("mosaic.scdn.co")
    ).slice(0, 6);

    if (validCovers.length < MIN_COVERS) {
      return j({ ok: false, error: `Capas insuficientes (precisa de ≥${MIN_COVERS} single-image)` }, 400);
    }

    // ============ PROMPT ============
    const escopo = subgeneroSlug
      ? `subgênero "${subgeneroNome}" dentro do gênero "${genre.nome}"`
      : `gênero "${genre.nome}"`;

    const userContent: any[] = [
      {
        type: "text",
        text: `Analise as ${validCovers.length} capas de playlists do ${escopo} abaixo e extraia o DNA VISUAL DOMINANTE.

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

    // ============ SALVAR (preserva DNA global se for sub, e vice-versa) ============
    const dnaPayload = {
      ...dna,
      capas_analisadas: validCovers.map(c => ({ nome: c.nome_playlist, url: c.imagem_url })),
      analyzed_at: new Date().toISOString(),
      ...(subgeneroSlug ? { subgenero_slug: subgeneroSlug, subgenero_nome: subgeneroNome } : {}),
    };

    // Helper: merge seguro lendo insights frescos do DB (evita race com analyze-genre)
    async function safeMergeAndPersist(): Promise<{ ok: boolean; error?: string; verified?: any }> {
      const { data: model, error: readErr } = await supabase
        .from("genre_models")
        .select("id,insights")
        .eq("genre_id", body.genre_id)
        .maybeSingle();
      if (readErr) return { ok: false, error: `read failed: ${readErr.message}` };

      const prevInsights = (model?.insights as any) ?? {};
      const prevSubMap = (prevInsights.dna_visual_subgeneros && typeof prevInsights.dna_visual_subgeneros === "object")
        ? prevInsights.dna_visual_subgeneros
        : {};

      // Estrutura garantida: dna_visual_subgeneros sempre existe como objeto (nunca null)
      const newInsights = {
        ...prevInsights,
        dna_visual: subgeneroSlug ? (prevInsights.dna_visual ?? null) : dnaPayload,
        dna_visual_subgeneros: subgeneroSlug
          ? { ...prevSubMap, [subgeneroSlug]: dnaPayload }
          : prevSubMap,
      };

      const writeRes = model
        ? await supabase.from("genre_models")
            .update({ insights: newInsights, updated_at: new Date().toISOString() })
            .eq("id", model.id)
        : await supabase.from("genre_models")
            .insert({ genre_id: body.genre_id, insights: newInsights });

      if (writeRes.error) return { ok: false, error: `write failed: ${writeRes.error.message}` };

      // Read-back verification: confirma que o DB realmente persistiu
      const { data: verify, error: verifyErr } = await supabase
        .from("genre_models")
        .select("insights")
        .eq("genre_id", body.genre_id)
        .maybeSingle();
      if (verifyErr || !verify) return { ok: false, error: `verify failed: ${verifyErr?.message ?? "no row"}` };

      const v = verify.insights as any;
      const persisted = subgeneroSlug
        ? v?.dna_visual_subgeneros?.[subgeneroSlug]?.analyzed_at === dnaPayload.analyzed_at
        : v?.dna_visual?.analyzed_at === dnaPayload.analyzed_at;

      if (!persisted) return { ok: false, error: "read-back mismatch (analyzed_at não bateu)" };
      return { ok: true, verified: v };
    }

    // Tenta persistir com 1 retry (cobre race condition com analyze-genre rodando em paralelo)
    let persistResult = await safeMergeAndPersist();
    if (!persistResult.ok) {
      console.warn("[visual-dna] 1ª tentativa falhou, retry em 500ms:", persistResult.error);
      await new Promise(r => setTimeout(r, 500));
      persistResult = await safeMergeAndPersist();
    }

    if (!persistResult.ok) {
      const errMsg = `Persistência falhou após retry: ${persistResult.error}`;
      console.error("[visual-dna] PERSIST FAIL:", errMsg);
      await supabase.from("collection_logs").insert({
        genre_id: body.genre_id,
        acao: "analyze-visual-dna",
        status: "erro",
        mensagem: errMsg,
        duracao_ms: Date.now() - start,
      });
      return j({ ok: false, error: errMsg }, 500);
    }

    // Confirmação explícita pós-write
    const v = persistResult.verified;
    const subKeysCount = v?.dna_visual_subgeneros ? Object.keys(v.dna_visual_subgeneros).length : 0;
    const escopoLog = subgeneroSlug ? `[sub:${subgeneroSlug}] ` : "[global] ";
    const persistMsg = `${escopoLog}DNA visual PERSISTIDO ✓ (${validCovers.length} capas, estilo=${dna.estilo_dominante}, atmosfera=${dna.atmosfera}) | dna_visual=${!!v?.dna_visual} | subgeneros_count=${subKeysCount}`;
    console.log("[visual-dna]", persistMsg);

    await supabase.from("collection_logs").insert({
      genre_id: body.genre_id,
      acao: "analyze-visual-dna",
      status: "sucesso",
      mensagem: persistMsg,
      duracao_ms: Date.now() - start,
    });

    return j({
      ok: true,
      scope: subgeneroSlug ? "subgenero" : "global",
      subgenero_slug: subgeneroSlug,
      dna_visual: dnaPayload,
      persisted: true,
      verified: {
        has_dna_visual: !!v?.dna_visual,
        subgeneros_persisted: subKeysCount,
        subgeneros_keys: v?.dna_visual_subgeneros ? Object.keys(v.dna_visual_subgeneros) : [],
      },
    });
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
