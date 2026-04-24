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
export const IDENTIDADES_VALIDAS = [
  "festa", "sofrência", "estrada", "romântico",
  "resenha", "treino", "noite", "saudade", "fé",
] as const;
export type Identidade = typeof IDENTIDADES_VALIDAS[number];

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
  /** Nomes JÁ existentes nesse gênero — a IA NÃO pode repetir nem fazer variação trivial */
  nomes_existentes?: string[];
};
export type BriefingCardOutput = {
  nome: string;
  regras_nome: string[];
  capa_instrucao: string;
  descricao: string;
  subgenero: string | null;
  regras_obrigatorias: string[];
  // Novos campos de identidade / contexto
  identidade: Identidade;
  gatilho_emocional: string;
  momento_consumo: string;
  diferencial: string;
};

const ANO_PROIBIDO_REGEX = /\b(2024|2025|2026)\b/;

function normalizeNome(s: string): string {
  return (s || "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export async function generateBriefing(
  card: BriefingCardInput,
  provider?: AiProvider,
): Promise<BriefingCardOutput> {
  const nomesExistentes = (card.nomes_existentes ?? []).slice(0, 50);
  const nomesNorm = new Set(nomesExistentes.map(normalizeNome));

  const contextoReal = {
    genero: card.genero,
    subgenero: card.subgenero ?? null,
    formato: card.formato,
    nome_base: card.nome_base,
    keywords_top: card.keywords.slice(0, 8),
    artistas_principais: card.artistas.slice(0, 8),
    top_tracks: card.top_tracks.slice(0, 8),
    playlists_referencia: card.playlists_referencia.slice(0, 8),
    dna_visual: card.dna_visual ?? null,
    nomes_proibidos: nomesExistentes,
  };

  const permiteAno = card.formato === "ano_corrente";

  const systemPrompt = `Você é um especialista em criação de playlists virais para Spotify no Brasil, gênero ${card.genero}.

OBJETIVO: criar uma playlist com alto potencial de crescimento orgânico — nome natural, identidade clara e momento de consumo definido.

REGRAS OBRIGATÓRIAS DE NOME:
- Nome natural, atrativo e atual (NUNCA genérico tipo "Hits", "Top", "Mix" isolados)
- Máximo 60 caracteres, 3-6 palavras, no máximo 1 emoji
- Linguagem brasileira coloquial, sem clichê de marketing
- ${permiteAno ? "Pode usar ano (formato detectado: ano_corrente)" : "PROIBIDO usar 2024, 2025 ou 2026 no nome"}
- PROIBIDO repetir ou ser variação trivial dos nomes_proibidos (ex: trocar 1 palavra, plural/singular, acento)
- Criar identidade clara (festa, sofrência, estrada, romântico, resenha, treino, noite, saudade, fé)

REGRAS DE CONTEÚDO:
- Use APENAS as keywords/artistas/tracks fornecidos como base — nunca invente conceitos fora deles
- Respostas SEMPRE em português BR
- JSON estritamente válido`;

  const userPrompt = `Crie o briefing desta playlist usando o CONTEXTO REAL abaixo:

${JSON.stringify(contextoReal, null, 2)}

Campos obrigatórios:
- nome: 3-6 palavras, ≤60 chars, ≤1 emoji, NÃO pode estar em nomes_proibidos
- identidade: UMA de [${IDENTIDADES_VALIDAS.join(", ")}]
- gatilho_emocional: 1 frase do que a playlist faz o ouvinte sentir
- momento_consumo: 1 frase de quando/onde se ouve (ex: "domingo de churrasco", "estrada de madrugada")
- diferencial: 1 frase do que essa playlist tem que as outras do gênero não têm
- regras_nome: 2-4 bullets curtos
- capa_instrucao: 1 frase prática pro designer (use o dna_visual se houver)
- descricao: 1-2 frases pro Spotify (≤150 chars)
- subgenero: confirma o subgenero recebido OU retorna null
- regras_obrigatorias: 2-4 bullets do que NÃO fazer nessa playlist`;

  // Tenta até 2x se cair em ano proibido ou nome duplicado
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await chat({
      provider,
      maxTokens: 900,
      system: systemPrompt,
      user: attempt === 0
        ? userPrompt
        : `${userPrompt}\n\nTENTATIVA ANTERIOR FALHOU: ${lastErr?.message}. Gere um nome COMPLETAMENTE diferente.`,
      jsonSchema: {
        name: "generate_briefing",
        schema: {
          type: "object",
          properties: {
            nome: { type: "string", maxLength: 60 },
            identidade: { type: "string", enum: [...IDENTIDADES_VALIDAS] },
            gatilho_emocional: { type: "string", maxLength: 200 },
            momento_consumo: { type: "string", maxLength: 200 },
            diferencial: { type: "string", maxLength: 200 },
            regras_nome: { type: "array", items: { type: "string" } },
            capa_instrucao: { type: "string" },
            descricao: { type: "string", maxLength: 200 },
            subgenero: { type: ["string", "null"] },
            regras_obrigatorias: { type: "array", items: { type: "string" } },
          },
          required: [
            "nome", "identidade", "gatilho_emocional", "momento_consumo",
            "diferencial", "regras_nome", "capa_instrucao", "descricao",
            "subgenero", "regras_obrigatorias",
          ],
        },
      },
    });

    let parsed: BriefingCardOutput;
    try {
      parsed = JSON.parse(raw);
    } catch {
      lastErr = new Error("JSON inválido retornado pela IA");
      continue;
    }

    // Fallback identidade
    if (!IDENTIDADES_VALIDAS.includes(parsed.identidade as Identidade)) {
      parsed.identidade = "resenha";
    }

    // Validação de ano
    if (!permiteAno && ANO_PROIBIDO_REGEX.test(parsed.nome)) {
      lastErr = new Error("Nome inválido: contém ano proibido (2024/2025/2026)");
      if (attempt === 1) throw lastErr;
      continue;
    }

    // Anti-duplicação
    if (nomesNorm.has(normalizeNome(parsed.nome))) {
      lastErr = new Error(`Nome duplicado: "${parsed.nome}" já existe nesse gênero`);
      if (attempt === 1) throw lastErr;
      continue;
    }

    return parsed;
  }

  throw lastErr ?? new Error("generateBriefing: falha desconhecida");
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
