// ai_service — serviço central de IA para o módulo Cérebro
// Suporta múltiplos providers (Claude, Lovable AI). Provider é configurável.
// Regras: nunca decide score, nunca toca banco, nunca busca dados externos.

export type AiProvider = "claude" | "lovable";

const DEFAULT_PROVIDER: AiProvider =
  (Deno.env.get("AI_PROVIDER") as AiProvider) || "claude";

const CLAUDE_API_KEY = Deno.env.get("CLAUDE_API_KEY") ?? "";
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY") ?? "";

const CLAUDE_MODEL = Deno.env.get("CLAUDE_MODEL") ?? "claude-sonnet-4-5-20250929";
const LOVABLE_MODEL = Deno.env.get("LOVABLE_AI_MODEL") ?? "google/gemini-2.5-flash";

// ─────────────────────────────────────────────────────────────
// CHAT BACKEND ABSTRATO
// Recebe system + user + JSON schema (opcional) e devolve string JSON ou texto.
// ─────────────────────────────────────────────────────────────
type ChatOpts = {
  system: string;
  user: string;
  jsonSchema?: { name: string; schema: any };
  maxTokens?: number;
  provider?: AiProvider;
};

async function chat(opts: ChatOpts): Promise<string> {
  const provider = opts.provider ?? DEFAULT_PROVIDER;
  if (provider === "claude") return chatClaude(opts);
  return chatLovable(opts);
}

async function chatClaude({ system, user, jsonSchema, maxTokens = 1500 }: ChatOpts): Promise<string> {
  if (!CLAUDE_API_KEY) throw new Error("CLAUDE_API_KEY ausente");

  const body: any = {
    model: CLAUDE_MODEL,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: user }],
  };

  if (jsonSchema) {
    // Claude: tool_use forçado garante saída estruturada
    body.tools = [{
      name: jsonSchema.name,
      description: `Return structured ${jsonSchema.name}.`,
      input_schema: jsonSchema.schema,
    }];
    body.tool_choice = { type: "tool", name: jsonSchema.name };
  }

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": CLAUDE_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`Claude HTTP ${resp.status}: ${txt.slice(0, 300)}`);
  }
  const json = await resp.json();
  if (jsonSchema) {
    const tool = (json?.content ?? []).find((c: any) => c.type === "tool_use");
    if (!tool?.input) throw new Error("Claude não retornou tool_use");
    return JSON.stringify(tool.input);
  }
  const text = (json?.content ?? []).find((c: any) => c.type === "text")?.text ?? "";
  return text;
}

async function chatLovable({ system, user, jsonSchema, maxTokens = 1500 }: ChatOpts): Promise<string> {
  if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY ausente");

  const body: any = {
    model: LOVABLE_MODEL,
    max_tokens: maxTokens,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  };

  if (jsonSchema) {
    body.tools = [{
      type: "function",
      function: {
        name: jsonSchema.name,
        description: `Return structured ${jsonSchema.name}.`,
        parameters: jsonSchema.schema,
      },
    }];
    body.tool_choice = { type: "function", function: { name: jsonSchema.name } };
  } else {
    body.response_format = { type: "json_object" };
  }

  const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`Lovable AI HTTP ${resp.status}: ${txt.slice(0, 300)}`);
  }
  const json = await resp.json();
  if (jsonSchema) {
    const tc = json?.choices?.[0]?.message?.tool_calls?.[0];
    if (!tc?.function?.arguments) throw new Error("Lovable AI não retornou tool_call");
    return tc.function.arguments;
  }
  return json?.choices?.[0]?.message?.content ?? "";
}

// ─────────────────────────────────────────────────────────────
// MÉTODO A — classifySubgenre
// Classifica subgênero de até 20 playlists num batch.
// ─────────────────────────────────────────────────────────────
export type SubgenreInput = {
  id: string;
  nome: string;
  descricao?: string;
  top_tracks?: { nome: string; artista: string }[];
};
export type SubgenreOutput = {
  id: string;
  subgenero: string | null;
  confidence: "alta" | "media" | "baixa";
  justificativa: string;
};

export async function classifySubgenre(
  genreName: string,
  knownSubgenres: string[],
  playlists: SubgenreInput[],
  provider?: AiProvider,
): Promise<SubgenreOutput[]> {
  if (playlists.length === 0) return [];
  const batchSize = 15;
  const results: SubgenreOutput[] = [];

  for (let i = 0; i < playlists.length; i += batchSize) {
    const batch = playlists.slice(i, i + batchSize);
    const userPayload = {
      genero_principal: genreName,
      subgeneros_conhecidos: knownSubgenres,
      playlists: batch.map(p => ({
        id: p.id,
        nome: p.nome,
        descricao: (p.descricao ?? "").slice(0, 200),
        top_tracks: (p.top_tracks ?? []).slice(0, 8),
      })),
    };

    const raw = await chat({
      provider,
      system: `Você é um especialista em música brasileira (${genreName}). Sua tarefa é classificar playlists em subgêneros. Use APENAS os subgêneros conhecidos fornecidos. Se nenhum encaixar, retorne null. Seja conservador: marque "baixa" quando incerto.`,
      user: `Classifique cada playlist abaixo em um subgênero da lista conhecida.\n\nDADOS:\n${JSON.stringify(userPayload, null, 2)}`,
      jsonSchema: {
        name: "classify_playlists",
        schema: {
          type: "object",
          properties: {
            classifications: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  subgenero: { type: ["string", "null"] },
                  confidence: { type: "string", enum: ["alta", "media", "baixa"] },
                  justificativa: { type: "string", maxLength: 200 },
                },
                required: ["id", "subgenero", "confidence", "justificativa"],
              },
            },
          },
          required: ["classifications"],
        },
      },
    });

    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.classifications)) results.push(...parsed.classifications);
    } catch (e) {
      console.error("classifySubgenre parse error:", e);
    }
  }

  return results;
}

// ─────────────────────────────────────────────────────────────
// MÉTODO B — generateBriefing
// Gera regras de nome, capa, descrição e subgênero pra um card.
// ─────────────────────────────────────────────────────────────
export type BriefingCardInput = {
  formato: string;
  nome_base: string;
  genero: string;
  subgenero?: string | null;
  keywords: { value: string; peso: number }[];
  top_tracks: { nome: string; artista: string }[];
  artistas: string[];
  playlists_referencia: string[];
  dna_visual?: any;
};
export type BriefingCardOutput = {
  nome: string;
  regras_nome: string[];
  capa_instrucao: string;
  descricao: string;
  subgenero: string | null;
  regras_obrigatorias: string[];
};

export async function generateBriefing(
  card: BriefingCardInput,
  provider?: AiProvider,
): Promise<BriefingCardOutput> {
  const raw = await chat({
    provider,
    maxTokens: 800,
    system: `Você é um diretor criativo de playlists do Spotify para o gênero ${card.genero} no Brasil. Gera regras CURTAS, acionáveis e fiéis ao formato detectado. Nunca invente conceitos fora das keywords. Resposta SEMPRE em português BR.`,
    user: `Gere o briefing pra esta playlist:\n${JSON.stringify(card, null, 2)}\n\nRegras:\n- nome: 3-6 palavras, máximo 1 emoji, soa natural\n- regras_nome: 2-4 bullets curtos\n- capa_instrucao: 1 frase prática pro designer (use o DNA visual se houver)\n- descricao: 1-2 frases pro Spotify (≤150 chars)\n- subgenero: confirma ou retorna null\n- regras_obrigatorias: 2-4 bullets do que NÃO fazer`,
    jsonSchema: {
      name: "generate_briefing",
      schema: {
        type: "object",
        properties: {
          nome: { type: "string" },
          regras_nome: { type: "array", items: { type: "string" } },
          capa_instrucao: { type: "string" },
          descricao: { type: "string" },
          subgenero: { type: ["string", "null"] },
          regras_obrigatorias: { type: "array", items: { type: "string" } },
        },
        required: ["nome", "regras_nome", "capa_instrucao", "descricao", "subgenero", "regras_obrigatorias"],
      },
    },
  });

  return JSON.parse(raw);
}

// ─────────────────────────────────────────────────────────────
// MÉTODO C — validate
// Valida coerência de um card. Usado APENAS em low-confidence ou expansao.
// ─────────────────────────────────────────────────────────────
export type ValidateInput = {
  genero: string;
  subgenero: string | null;
  formato: string;
  keywords: string[];
  top_tracks: { nome: string; artista: string }[];
};
export type ValidateOutput = {
  status: "coerente" | "incoerente";
  ajuste?: { subgenero?: string | null; nome_sugerido?: string };
  motivo: string;
};

export async function validate(
  card: ValidateInput,
  provider?: AiProvider,
): Promise<ValidateOutput> {
  const raw = await chat({
    provider,
    maxTokens: 400,
    system: `Você valida coerência de classificação musical (${card.genero}). Responda se o subgênero, formato e tracks combinam. Se incoerente, sugira ajuste.`,
    user: `Valide:\n${JSON.stringify(card, null, 2)}`,
    jsonSchema: {
      name: "validate_card",
      schema: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["coerente", "incoerente"] },
          ajuste: {
            type: "object",
            properties: {
              subgenero: { type: ["string", "null"] },
              nome_sugerido: { type: "string" },
            },
          },
          motivo: { type: "string", maxLength: 200 },
        },
        required: ["status", "motivo"],
      },
    },
  });

  return JSON.parse(raw);
}

export function activeProvider(): AiProvider { return DEFAULT_PROVIDER; }
