// genre-insights — gera resumo executivo via Lovable AI a partir do modelo de um gênero
import { corsHeaders } from "npm:@supabase/supabase-js/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { requireTeamAccess } from "../_shared/auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

interface AIInsights {
  resumo: string;
  tendencias: string[];
  oportunidades_seo: string[];
  sugestoes_nomes: string[];
  generated_at: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "OPTIONS") {
    const guard = await requireTeamAccess(req);
    if (!guard.ok) return guard.resp;
  }
  const start = Date.now();

  let body: { genre_id: string };
  try { body = await req.json(); } catch {
    return j({ ok: false, error: "Invalid JSON" }, 400);
  }
  if (!body.genre_id) return j({ ok: false, error: "genre_id obrigatório" }, 400);
  if (!LOVABLE_API_KEY) return j({ ok: false, error: "LOVABLE_API_KEY não configurada" });

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    const [{ data: genre }, { data: model }] = await Promise.all([
      supabase.from("genres").select("nome").eq("id", body.genre_id).single(),
      supabase.from("genre_models").select("*").eq("genre_id", body.genre_id).maybeSingle(),
    ]);
    if (!genre) return j({ ok: false, error: "Gênero não encontrado" });
    if (!model) return j({ ok: false, error: "Modelo não gerado. Execute analyze-genre primeiro." });

    const palavras = (model.palavras_chave as any[] ?? []).slice(0, 20);
    const padroes = (model.padroes_nome as any[] ?? []).slice(0, 15);
    const playlists = (model.playlists_dominantes as any[] ?? []).slice(0, 10);
    const musicas = (model.musicas_recorrentes as any[] ?? []).slice(0, 15);
    const insights = (model.insights as any) ?? {};

    const prompt = `Analise os dados de SEO do gênero musical "${genre.nome}" no Spotify e responda em JSON.

ESTATÍSTICAS:
- Playlists analisadas: ${insights.total_playlists_analisadas ?? 0}
- Tracks analisadas: ${insights.total_tracks_analisadas ?? 0}
- Média de seguidores: ${insights.media_seguidores ?? 0}
- Tracks únicas: ${insights.diversidade_tracks ?? 0}

TOP PALAVRAS-CHAVE: ${palavras.map(p => `${p.value}(${p.count})`).join(", ")}
TOP BIGRAMAS: ${padroes.map(p => `"${p.value}"(${p.count})`).join(", ")}
PLAYLISTS DOMINANTES: ${playlists.map(p => `"${p.nome}" (${p.seguidores} seg.)`).join(" | ")}
MÚSICAS RECORRENTES: ${musicas.map(m => `${m.nome}—${m.artista}(×${m.count})`).join(" | ")}

Responda APENAS um JSON válido com este formato exato:
{
  "resumo": "2-3 frases descrevendo o panorama SEO deste gênero",
  "tendencias": ["3-5 tendências observadas nos títulos e padrões"],
  "oportunidades_seo": ["3-5 oportunidades concretas de SEO para criar playlists deste gênero"],
  "sugestoes_nomes": ["5-7 sugestões criativas de nomes de playlist otimizados para descoberta"]
}`;

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: "Você é um especialista em SEO de playlists do Spotify. Responde sempre em português brasileiro e SEMPRE em JSON válido, sem markdown, sem comentários." },
          { role: "user", content: prompt },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (aiResp.status === 429) return j({ ok: false, error: "Limite de requisições da IA atingido. Tente em alguns instantes." });
    if (aiResp.status === 402) return j({ ok: false, error: "Créditos da IA insuficientes. Adicione créditos no workspace Lovable." });
    if (!aiResp.ok) {
      const txt = await aiResp.text();
      return j({ ok: false, error: `IA ${aiResp.status}: ${txt.slice(0, 300)}` });
    }

    const aiJson = await aiResp.json();
    const content: string = aiJson?.choices?.[0]?.message?.content ?? "{}";
    let parsed: Partial<AIInsights>;
    try { parsed = JSON.parse(content); }
    catch { return j({ ok: false, error: "IA retornou formato inválido", raw: content.slice(0, 500) }); }

    const ai: AIInsights = {
      resumo: typeof parsed.resumo === "string" ? parsed.resumo : "",
      tendencias: Array.isArray(parsed.tendencias) ? parsed.tendencias.filter(s => typeof s === "string") : [],
      oportunidades_seo: Array.isArray(parsed.oportunidades_seo) ? parsed.oportunidades_seo.filter(s => typeof s === "string") : [],
      sugestoes_nomes: Array.isArray(parsed.sugestoes_nomes) ? parsed.sugestoes_nomes.filter(s => typeof s === "string") : [],
      generated_at: new Date().toISOString(),
    };

    const newInsights = { ...insights, ai };
    await supabase.from("genre_models").update({ insights: newInsights }).eq("genre_id", body.genre_id);

    await supabase.from("collection_logs").insert({
      genre_id: body.genre_id,
      acao: "genre-insights",
      status: "sucesso",
      mensagem: `Resumo IA gerado (${ai.tendencias.length} tendências, ${ai.sugestoes_nomes.length} sugestões)`,
      duracao_ms: Date.now() - start,
    });

    return j({ ok: true, ai });
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    console.error("genre-insights error", msg);
    await supabase.from("collection_logs").insert({
      genre_id: body.genre_id,
      acao: "genre-insights",
      status: "erro",
      mensagem: msg.slice(0, 500),
      duracao_ms: Date.now() - start,
    });
    return j({ ok: false, error: msg });
  }
});

function j(payload: any, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
