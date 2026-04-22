// extract-replication-rules — Claude transforma performance_insights em REGRAS ESTRUTURADAS
// que o replicador (extract-blueprints, generate-templates) executa automaticamente.
//
// Input: insight_id (último, se omitido) — busca padroes_vencedores, recomendacoes, acoes_sugeridas
// Output: linhas em replication_rules (genre_id ou global) com active=true.
//
// POST { insight_id?: string, genre_id?: string, replace?: boolean }
import { corsHeaders } from "npm:@supabase/supabase-js/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CLAUDE_API_KEY = Deno.env.get("CLAUDE_API_KEY") ?? "";
const CLAUDE_MODEL = Deno.env.get("CLAUDE_MODEL") ?? "claude-sonnet-4-5-20250929";

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const RULE_SCHEMA = {
  type: "object",
  properties: {
    rules: {
      type: "array",
      items: {
        type: "object",
        properties: {
          rule_type: {
            type: "string",
            enum: ["naming", "tracks", "format", "structure", "avoid"],
            description: "Categoria da regra",
          },
          target: {
            type: "string",
            description:
              "Alvo específico. Ex: naming.year, naming.subgenre, naming.suffix, naming.prefix, tracks.artist_boost, format.subgenre, structure.size, avoid.words, avoid.artists",
          },
          value: {
            type: "object",
            description:
              "Valor estruturado. Ex: {year: 2026} | {subgenre: 'mandelão'} | {text: '🔥'} | {artists: ['MC X']} | {words: ['workout']} | {min: 30, max: 60}",
          },
          priority: { type: "string", enum: ["alta", "media", "baixa"] },
          confidence: { type: "string", enum: ["alta", "media", "baixa"] },
          evidence: { type: "string", description: "1 frase explicando o padrão observado" },
        },
        required: ["rule_type", "target", "value", "priority", "confidence", "evidence"],
      },
    },
  },
  required: ["rules"],
};

async function callClaude(system: string, user: string) {
  if (!CLAUDE_API_KEY) throw new Error("CLAUDE_API_KEY ausente");
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": CLAUDE_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 2000,
      system,
      messages: [{ role: "user", content: user }],
      tools: [{
        name: "extract_rules",
        description: "Extrai regras acionáveis estruturadas a partir de insights de performance.",
        input_schema: RULE_SCHEMA,
      }],
      tool_choice: { type: "tool", name: "extract_rules" },
    }),
  });
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`Claude HTTP ${resp.status}: ${t.slice(0, 300)}`);
  }
  const json = await resp.json();
  const tool = (json?.content ?? []).find((c: any) => c.type === "tool_use");
  if (!tool?.input) throw new Error("Claude não retornou tool_use");
  return tool.input;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  let body: { insight_id?: string; genre_id?: string; replace?: boolean } = {};
  try { if (req.method === "POST") body = await req.json(); } catch {}

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  // 1) Carrega insight (último ou específico)
  let insight: any;
  if (body.insight_id) {
    const { data } = await supabase.from("performance_insights")
      .select("*").eq("id", body.insight_id).maybeSingle();
    insight = data;
  } else {
    let q = supabase.from("performance_insights")
      .select("*").order("created_at", { ascending: false }).limit(1);
    if (body.genre_id) q = q.eq("genre_id", body.genre_id);
    const { data } = await q.maybeSingle();
    insight = data;
  }
  if (!insight) return jr({ ok: false, error: "no insight available" }, 404);

  const genreId = insight.genre_id ?? body.genre_id ?? null;

  // Contexto extra: nome do gênero
  let genreName: string | null = null;
  if (genreId) {
    const { data: g } = await supabase.from("genres").select("nome").eq("id", genreId).maybeSingle();
    genreName = g?.nome ?? null;
  }

  // 2) Pede ao Claude pra transformar insights → regras
  const system =
    `Você é um engenheiro de regras. Sua tarefa é converter insights de performance em REGRAS EXECUTÁVEIS para um sistema automático de replicação de playlists do Spotify.

PRINCÍPIOS:
- Cada regra deve ser CONCRETA e MÁQUINA-EXECUTÁVEL (não filosofia).
- Use prioridade ALTA apenas quando o padrão é forte e repetido.
- "padroes_vencedores" → regras com priority=alta
- "padroes_fracos" → regras avoid (priority=alta)
- "recomendacoes" + "acoes_sugeridas" → regras de naming/tracks/format
- Limite-se a 4-10 regras (qualidade > quantidade).

FORMATOS DE TARGET ACEITOS:
- naming.year   → value: {year: 2026}                     (força ano em nomes novos)
- naming.subgenre → value: {subgenre: "mandelão"}         (força subgênero no nome)
- naming.suffix  → value: {text: "🔥"} ou {text: "BR"}    (sufixo obrigatório)
- naming.prefix  → value: {text: "TOP"}                   (prefixo obrigatório)
- tracks.artist_boost → value: {artists: ["MC X","MC Y"]} (priorizar tracks desses artistas)
- format.subgenre → value: {subgenre: "mandelão"}         (forçar subgênero do blueprint)
- structure.size → value: {min: 30, max: 60}              (faixa de tracks ideal)
- avoid.words    → value: {words: ["workout","gym"]}      (proibir essas palavras no nome)
- avoid.artists  → value: {artists: ["..."]}              (excluir esses artistas)

Use APENAS esses targets. Cada regra precisa de evidência curta (1 frase).`;

  const user =
    `GÊNERO: ${genreName ?? "global"}
TOTAL ANALISADO: ${insight.total_playlists_analisadas}

INSIGHTS:
${JSON.stringify(insight.insights ?? {}, null, 2)}

RECOMENDAÇÕES:
${JSON.stringify(insight.recomendacoes ?? [], null, 2)}

AÇÕES SUGERIDAS:
${JSON.stringify(insight.acoes_sugeridas ?? [], null, 2)}

Converta isso em regras estruturadas que o replicador vai executar automaticamente.`;

  let result: any;
  try { result = await callClaude(system, user); }
  catch (e) { return jr({ error: `claude_failed: ${(e as Error).message}` }, 500); }

  const rules = Array.isArray(result?.rules) ? result.rules : [];
  if (rules.length === 0) return jr({ ok: true, inserted: 0, message: "Claude não gerou regras" });

  // 3) Se replace=true, desativa regras anteriores deste gênero
  if (body.replace) {
    await supabase.from("replication_rules")
      .update({ active: false })
      .eq("genre_id", genreId)
      .eq("active", true);
  }

  // 4) Insere novas regras (expira em 30d por padrão)
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const rows = rules.map((r: any) => ({
    genre_id: genreId,
    scope: genreId ? "genre" : "global",
    rule_type: String(r.rule_type),
    target: String(r.target),
    value: r.value ?? {},
    priority: ["alta", "media", "baixa"].includes(r.priority) ? r.priority : "media",
    confidence: ["alta", "media", "baixa"].includes(r.confidence) ? r.confidence : "media",
    evidence: r.evidence ?? null,
    source_insight_id: insight.id,
    generated_by_model: CLAUDE_MODEL,
    active: true,
    expires_at: expires,
  }));

  const { data: inserted, error: insErr } = await supabase
    .from("replication_rules").insert(rows).select("id,rule_type,target,priority");
  if (insErr) return jr({ error: insErr.message }, 500);

  await supabase.from("collection_logs").insert({
    genre_id: genreId,
    acao: "extract-replication-rules",
    status: "sucesso",
    mensagem: `Claude gerou ${inserted?.length ?? 0} regras a partir do insight ${insight.id}`,
  }).then(() => {}, () => {});

  return jr({
    ok: true,
    insight_id: insight.id,
    genre_id: genreId,
    inserted: inserted?.length ?? 0,
    rules: inserted,
    replaced: body.replace ?? false,
  });
});
