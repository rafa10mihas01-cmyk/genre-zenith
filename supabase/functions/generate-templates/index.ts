// generate-templates — gera N variações de playlist a partir de um blueprint.
// POST { blueprint_id: string, count?: number } → { ok, templates: [...] }
import { corsHeaders } from "npm:@supabase/supabase-js/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { loadActiveRules, rulesAsPromptBlock, enforceNamingRules, reorderTracksByRules, summarizeRules } from "../_shared/rules.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY") ?? "";

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function callLLM(system: string, user: string, schema: any, model = "google/gemini-2.5-flash") {
  const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      max_tokens: 2500,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      tools: [{
        type: "function",
        function: {
          name: "generate_templates",
          description: "Generate playlist template variations from a blueprint.",
          parameters: schema,
        },
      }],
      tool_choice: { type: "function", function: { name: "generate_templates" } },
    }),
  });
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`Lovable AI ${resp.status}: ${t.slice(0, 300)}`);
  }
  const j = await resp.json();
  const args = j?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  if (!args) throw new Error("LLM returned no tool_call");
  return JSON.parse(args);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jr({ error: "POST only" }, 405);

  let body: { blueprint_id?: string; count?: number };
  try { body = await req.json(); } catch { return jr({ error: "invalid json" }, 400); }
  const blueprintId = body.blueprint_id;
  const count = Math.min(Math.max(body.count ?? 5, 1), 10);
  if (!blueprintId) return jr({ error: "blueprint_id required" }, 400);
  if (!LOVABLE_API_KEY) return jr({ error: "LOVABLE_API_KEY not configured" }, 500);

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  const { data: bp, error: bpErr } = await supabase
    .from("playlist_blueprints").select("*").eq("id", blueprintId).maybeSingle();
  if (bpErr || !bp) return jr({ error: "blueprint not found" }, 404);

  const { data: genre } = await supabase
    .from("genres").select("id,nome,slug").eq("id", bp.genre_id).maybeSingle();

  // Faixas recorrentes do gênero como seed (top 30)
  const { data: model } = await supabase
    .from("genre_models").select("musicas_recorrentes,palavras_chave")
    .eq("genre_id", bp.genre_id).maybeSingle();
  const trackSeeds = (model?.musicas_recorrentes ?? []).slice(0, 30);
  const allKeywords = (model?.palavras_chave ?? []).slice(0, 30);

  // Já existem templates? quantos? (usa para variation_index)
  const { count: existingCount } = await supabase
    .from("playlist_templates").select("*", { count: "exact", head: true }).eq("blueprint_id", blueprintId);
  const startIdx = existingCount ?? 0;

  const schema = {
    type: "object",
    properties: {
      templates: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Nome final pronto pro Spotify (3-6 palavras, máx 1 emoji)" },
            description: { type: "string", description: "Descrição Spotify (≤150 chars)" },
            cover_brief: { type: "string", description: "Briefing 1 frase pra capa, baseado no cover_style" },
            keywords: { type: "array", items: { type: "string" }, description: "5-8 keywords da playlist" },
            track_seeds: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  nome: { type: "string" },
                  artista: { type: "string" },
                },
                required: ["nome", "artista"],
              },
              description: "10-15 faixas iniciais selecionadas das recorrentes do gênero",
            },
            regras: {
              type: "object",
              properties: {
                obrigatorio: { type: "array", items: { type: "string" } },
                evitar: { type: "array", items: { type: "string" } },
              },
            },
            replication_score: { type: "number", description: "0-100 confiança de que esta variação vai performar" },
          },
          required: ["name", "description", "cover_brief", "keywords", "track_seeds", "replication_score"],
        },
      },
    },
    required: ["templates"],
  };

  const userPayload = {
    genero: genre?.nome,
    blueprint: {
      name: bp.name,
      tier: bp.tier,
      name_pattern: bp.name_pattern,
      format: bp.format,
      mood: bp.mood,
      cover_style: bp.cover_style,
      track_dna: bp.track_dna,
      source_playlists: (bp.source_playlists ?? []).slice(0, 5).map((p: any) => p.nome),
    },
    track_pool: trackSeeds,
    keyword_pool: allKeywords,
    quantidade: count,
  };

  let llmOut: any;
  try {
    llmOut = await callLLM(
      `Você é um diretor criativo de playlists. Gere variações DISTINTAS de uma playlist seguindo o blueprint fornecido. Mantenha a essência (formato, mood, padrão de nome) mas varie ângulo/sub-tema. Use apenas faixas e keywords do pool. Resposta SEMPRE em português BR.`,
      `Gere ${count} variações para este blueprint:\n${JSON.stringify(userPayload, null, 2)}\n\nCada variação deve ser comercial, replicável e fiel ao blueprint. Atribua replication_score 0-100 baseado em força do nome, encaixe com o blueprint, e potencial.`,
      schema,
    );
  } catch (e) {
    return jr({ ok: false, error: (e as Error).message }, 500);
  }

  const list = Array.isArray(llmOut?.templates) ? llmOut.templates : [];

  // 🎯 Enriquece track_seeds com spotify_track_id quando disponível em search_tracks.
  // Lookup case-insensitive por (nome, artista) — evita N searches no Spotify depois.
  const allSeeds: Array<{ nome: string; artista: string }> = [];
  for (const t of list) {
    const seeds = Array.isArray(t.track_seeds) ? t.track_seeds : [];
    for (const s of seeds) {
      const nome = String(s?.nome ?? "").trim();
      const artista = String(s?.artista ?? "").trim();
      if (nome && artista) allSeeds.push({ nome, artista });
    }
  }
  const seedIdMap = new Map<string, string>(); // key = `${nome}|${artista}` lower
  if (allSeeds.length > 0) {
    const { data: matches } = await supabase
      .from("search_tracks")
      .select("nome_musica,artista,spotify_track_id")
      .eq("genre_id", bp.genre_id)
      .not("spotify_track_id", "is", null)
      .limit(5000);
    if (matches) {
      for (const m of matches) {
        const k = `${(m.nome_musica ?? "").toLowerCase().trim()}|${(m.artista ?? "").toLowerCase().trim()}`;
        if (!seedIdMap.has(k)) seedIdMap.set(k, m.spotify_track_id);
      }
    }
  }

  const rows = list.map((t: any, i: number) => {
    const enrichedSeeds = (Array.isArray(t.track_seeds) ? t.track_seeds : []).map((s: any) => {
      const nome = String(s?.nome ?? "").trim();
      const artista = String(s?.artista ?? "").trim();
      const k = `${nome.toLowerCase()}|${artista.toLowerCase()}`;
      const spotify_track_id = seedIdMap.get(k) ?? null;
      return { nome, artista, spotify_track_id };
    });
    return {
      blueprint_id: blueprintId,
      genre_id: bp.genre_id,
      variation_index: startIdx + i,
      name: String(t.name).slice(0, 200),
      description: t.description ?? null,
      cover_brief: t.cover_brief ?? null,
      track_seeds: enrichedSeeds,
      keywords: t.keywords ?? [],
      regras: t.regras ?? {},
      replication_score: Math.max(0, Math.min(100, Number(t.replication_score ?? 0))),
      status: "pending",
      generated_by_model: "google/gemini-2.5-flash",
    };
  });

  if (rows.length === 0) return jr({ ok: false, error: "no templates produced" }, 500);

  const { data: inserted, error: insErr } = await supabase
    .from("playlist_templates").insert(rows).select("id,name,replication_score,variation_index");
  if (insErr) return jr({ error: insErr.message }, 500);

  await supabase.from("collection_logs").insert({
    genre_id: bp.genre_id, acao: "generate-templates", status: "sucesso",
    mensagem: `${inserted?.length ?? 0} templates gerados a partir do blueprint "${bp.name}"`,
  }).then(() => {}, () => {});

  return jr({ ok: true, blueprint_id: blueprintId, templates: inserted ?? [], count: inserted?.length ?? 0 });
});
