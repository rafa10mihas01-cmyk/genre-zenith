// analyze-performance — Claude interpreta métricas já calculadas e gera insights.
// POST { genre_id?: string, min_age_hours?: number }
// Claude NÃO calcula nada. Só interpreta o dataset.
import { corsHeaders } from "npm:@supabase/supabase-js/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { requireTeamAccess } from "../_shared/auth.ts";

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

const SCHEMA = {
  type: "object",
  properties: {
    classificacao: {
      type: "object",
      properties: {
        alta: { type: "array", items: { type: "string" } },
        media: { type: "array", items: { type: "string" } },
        baixa: { type: "array", items: { type: "string" } },
      },
      required: ["alta", "media", "baixa"],
    },
    insights: {
      type: "object",
      properties: {
        padroes_vencedores: { type: "array", items: { type: "string" } },
        padroes_fracos: { type: "array", items: { type: "string" } },
      },
      required: ["padroes_vencedores", "padroes_fracos"],
    },
    recomendacoes: { type: "array", items: { type: "string" } },
    acoes_sugeridas: {
      type: "array",
      items: {
        type: "object",
        properties: {
          tipo: { type: "string", enum: ["replicar", "ajustar", "pausar"] },
          playlist: { type: "string" },
          motivo: { type: "string" },
          acao: { type: "string" },
          prioridade: { type: "string", enum: ["alta", "media", "baixa"] },
        },
        required: ["tipo", "motivo", "prioridade"],
      },
    },
  },
  required: ["classificacao", "insights", "recomendacoes", "acoes_sugeridas"],
};

async function callClaude(systemPrompt: string, userPayload: any) {
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
      max_tokens: 2500,
      system: systemPrompt,
      messages: [{
        role: "user",
        content: `Analise este conjunto de playlists publicadas no Spotify e gere insights de performance.\n\nDADOS:\n${JSON.stringify(userPayload, null, 2)}`,
      }],
      tools: [{
        name: "performance_report",
        description: "Retorna um relatório estruturado de performance.",
        input_schema: SCHEMA,
      }],
      tool_choice: { type: "tool", name: "performance_report" },
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

  if (req.method !== "OPTIONS") {
    const guard = await requireTeamAccess(req);
    if (!guard.ok) return guard.resp;
  }
  let body: { genre_id?: string; min_age_hours?: number } = {};
  try { if (req.method === "POST") body = await req.json(); } catch {}

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  const minAge = body.min_age_hours ?? 24;

  const { data: dataset, error } = await supabase.rpc("get_performance_dataset", {
    p_min_age_hours: minAge,
  });
  if (error) return jr({ error: error.message }, 500);

  let rows = (dataset ?? []) as any[];
  if (body.genre_id) rows = rows.filter((r) => r.genre_id === body.genre_id);

  if (rows.length === 0) {
    // 🚨 Audit #9 A.3 — log explícito, antes era no-op silencioso
    await supabase.from("collection_logs").insert({
      acao: "analyze_performance",
      status: "alerta",
      mensagem: `dataset vazio: nenhuma playlist com idade>=${minAge}h e created_on_spotify_at preenchido`,
    }).then(() => {}, () => {});
    return jr({
      ok: true,
      empty: true,
      message: "Nenhuma playlist publicada com idade suficiente para analisar.",
    });
  }

  // C.1 — Early-exit: amostra estatística mínima para não desperdiçar Claude.
  const MIN_SAMPLE = 5;
  if (rows.length < MIN_SAMPLE) {
    // 🚨 Audit #9 A.3 — log explícito de skip por amostra insuficiente
    await supabase.from("collection_logs").insert({
      acao: "analyze_performance",
      status: "alerta",
      mensagem: `amostra insuficiente: ${rows.length}/${MIN_SAMPLE} playlists. Skip Claude.`,
    }).then(() => {}, () => {});
    return jr({
      ok: true,
      empty: true,
      reason: "amostra_insuficiente",
      message: `Apenas ${rows.length} playlist(s) com idade >= ${minAge}h. Mínimo: ${MIN_SAMPLE}. Pulando análise.`,
      total: rows.length,
    });
  }

  // Compacta payload para Claude (só dados, ele só interpreta)
  const playlists = rows.slice(0, 80).map((r) => ({
    id: r.template_id,
    nome: r.nome,
    followers_start: r.followers_start,
    followers_now: r.followers_now,
    crescimento_absoluto: r.crescimento_absoluto,
    crescimento_percentual: r.crescimento_percentual,
    tempo_horas: r.tempo_horas,
    total_tracks: r.total_tracks,
  }));

  const system =
    `Você é um analista de performance de playlists do Spotify. Você NÃO calcula métricas — elas já vêm prontas. Sua tarefa é INTERPRETAR o dataset e identificar padrões de crescimento, padrões fracos, e gerar recomendações acionáveis em PT-BR.

Regras:
- Classifique cada playlist como ALTA, MÉDIA ou BAIXA performance baseado em crescimento_percentual e tempo_horas.
- Identifique padrões de NOMES (ano, emoji, subgênero, palavras vencedoras).
- Identifique padrões de TAMANHO (faixa ideal de tracks).
- Sugira ações concretas: replicar padrão vencedor, ajustar nome de playlist específica, pausar fracas.
- Seja direto e técnico. Sem firula.`;

  // 💸 Audit #10 C.1: fallback selectivo — em 5xx/timeout, tenta haiku (mais barato)
  let result: any;
  let modelUsed = CLAUDE_MODEL;
  try {
    result = await callClaude(system, { total: rows.length, amostra: playlists });
  } catch (e) {
    const msg = (e as Error).message ?? "";
    const m = msg.match(/HTTP (\d{3})/);
    const status = m ? Number(m[1]) : null;
    // 5xx/network → fallback. 4xx (não 429) → fail fast (modelo não resolve).
    if (status === null || status >= 500 || status === 429) {
      const FALLBACK = "claude-haiku-4-5-20250514";
      console.warn(`[analyze-performance] sonnet falhou (${status ?? "net"}) — fallback ${FALLBACK}`);
      try {
        const original = (globalThis as any).__claude_model;
        (globalThis as any).__claude_model = FALLBACK;
        // re-chama com modelo override via param interno simples
        result = await callClaudeWithModel(system, { total: rows.length, amostra: playlists }, FALLBACK);
        modelUsed = FALLBACK;
      } catch (e2) {
        return jr({ error: `claude_failed_with_fallback: ${(e2 as Error).message}` }, 500);
      }
    } else {
      return jr({ error: `claude_failed: ${msg}` }, 500);
    }
  }

  // Persiste insights
  const { data: inserted, error: insErr } = await supabase
    .from("performance_insights")
    .insert({
      genre_id: body.genre_id ?? null,
      scope: body.genre_id ? "genre" : "global",
      total_playlists_analisadas: rows.length,
      insights: result.insights ?? {},
      recomendacoes: result.recomendacoes ?? [],
      acoes_sugeridas: result.acoes_sugeridas ?? [],
      classificacao: result.classificacao ?? {},
      generated_by_model: CLAUDE_MODEL,
    })
    .select()
    .single();

  if (insErr) return jr({ error: insErr.message }, 500);

  // Atualiza performance_class por playlist (alta/media/baixa)
  // 🛡️ Audit #10 A.3: whitelist por genre_id quando informado; senão valida ids contra dataset.
  const cls = result.classificacao ?? {};
  const validIds = new Set(rows.map((r) => r.template_id));
  let altaCount = 0, baixaCount = 0;
  for (const [klass, ids] of Object.entries(cls) as [string, string[]][]) {
    if (!Array.isArray(ids) || !ids.length) continue;
    const safeIds = ids.filter((id) => validIds.has(id));
    if (safeIds.length === 0) continue;
    let q = supabase
      .from("playlist_templates")
      .update({ performance_class: klass, performance_evaluated_at: new Date().toISOString() })
      .in("id", safeIds);
    if (body.genre_id) q = q.eq("genre_id", body.genre_id);
    await q;
    if (klass === "alta") altaCount = safeIds.length;
    if (klass === "baixa") baixaCount = safeIds.length;
  }

  // 🔔 Notificações de performance
  if (altaCount > 0) {
    await supabase.rpc("create_notification", {
      p_type: "info",
      p_title: altaCount === 1 ? "Playlist com alta performance 📈" : `${altaCount} playlists com alta performance 📈`,
      p_message: "Padrões vencedores identificados — prontos para replicar.",
      p_action_url: "/performance",
      p_metadata: { count: altaCount, scope: body.genre_id ? "genre" : "global" },
    }).then(() => {}, () => {});
  }
  if (baixaCount > 0) {
    await supabase.rpc("create_notification", {
      p_type: "warning",
      p_title: baixaCount === 1 ? "Playlist com baixa performance ⚠️" : `${baixaCount} playlists com baixa performance ⚠️`,
      p_message: "Recomendado ajustar nome, capa ou tracks.",
      p_action_url: "/performance",
      p_metadata: { count: baixaCount, scope: body.genre_id ? "genre" : "global" },
    }).then(() => {}, () => {});
  }

  await supabase.from("collection_logs").insert({
    acao: "analyze_performance",
    status: "ok",
    mensagem: `claude analisou ${rows.length} playlists`,
  });

  // 🔗 INSIGHTS → REGRAS ACIONÁVEIS (Claude vira decisão, não só análise)
  // Dispara extract-replication-rules em background, replace=true para refletir o estado mais recente.
  let rulesResult: any = null;
  try {
    const rulesResp = await fetch(`${SUPABASE_URL}/functions/v1/extract-replication-rules`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SERVICE_KEY}`,
      },
      body: JSON.stringify({ insight_id: inserted.id, replace: true }),
    });
    if (rulesResp.ok) rulesResult = await rulesResp.json();
  } catch (e) {
    console.error("extract-replication-rules failed:", (e as Error).message);
  }

  return jr({
    ok: true,
    insight_id: inserted.id,
    analisadas: rows.length,
    result,
    rules: rulesResult,
  });
});
