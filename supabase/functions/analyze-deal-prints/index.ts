// analyze-deal-prints — recebe múltiplos prints + a lista de playlists cadastradas
// no deal e usa Lovable AI (Gemini multimodal) para casar cada playlist com o
// número de plays correspondente nos prints. Também devolve um total agregado.
//
// Body: {
//   images: { base64: string, mime_type: string }[],   // até 40
//   playlists: string[],                                // nomes cadastrados
//   mode: "baseline" | "update"
// }
//
// Resp: {
//   ok: true,
//   matches: { playlist_name: string, plays: number | null, found: boolean, source_index: number | null }[],
//   total_plays: number,
//   not_found: string[],
//   raw: string
// } | { ok: false, error: string }
import { createClient } from "npm:@supabase/supabase-js@2";
import { recordMetric } from "../_shared/ops-metrics.ts";
import { requireTeamAccess } from "../_shared/auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function j(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const MAX_IMAGES = 40;
const MAX_BASE64_LEN = 14_000_000; // ~10MB cada
const BASELINE_IMAGE_CHUNK_SIZE = 4;
const UPDATE_PLAYLIST_CHUNK_SIZE = 25;

const jsonObjectInstruction =
  `Regra obrigatória: responda somente com UM objeto JSON válido começando em { e terminando em }. ` +
  `Não use markdown, não use bloco de código, não escreva explicações.`;

type ImageInput = { base64: string; mime_type: string };
type AiItem = {
  playlist_name?: string;
  plays?: number | string | null;
  found?: boolean;
  source_index?: number | null;
};
type ParsedAiResponse = { items?: AiItem[] };

function buildImageParts(images: ImageInput[]) {
  return images.map((img) => ({
    type: "image_url" as const,
    image_url: { url: `data:${img.mime_type};base64,${img.base64}` },
  }));
}

function parsePlays(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? Math.round(value) : null;
  const onlyDigits = String(value).replace(/\D/g, "");
  if (!onlyDigits) return null;
  const parsed = Number(onlyDigits);
  return Number.isFinite(parsed) ? parsed : null;
}

function stripJsonEnvelope(raw: string): string {
  return raw
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .replace(/^\s*'''(?:json)?\s*/i, "")
    .replace(/\s*'''\s*$/i, "")
    .trim();
}

function firstBalancedJsonObject(raw: string): string | null {
  const text = stripJsonEnvelope(raw);
  const start = text.indexOf("{");
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") depth += 1;
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }

  return null;
}

function extractCompleteObjectsFromItems(raw: string): AiItem[] {
  const text = stripJsonEnvelope(raw);
  const itemsStart = text.indexOf("[");
  if (itemsStart < 0) return [];

  const objects: AiItem[] = [];
  let depth = 0;
  let objectStart = -1;
  let inString = false;
  let escaped = false;

  for (let i = itemsStart; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") {
      if (depth === 0) objectStart = i;
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0 && objectStart >= 0) {
        try {
          objects.push(JSON.parse(text.slice(objectStart, i + 1)) as AiItem);
        } catch {
          // ignora objeto individual inválido
        }
        objectStart = -1;
      }
    }
  }

  return objects;
}

function parseAiJson(raw: string): ParsedAiResponse {
  const balanced = firstBalancedJsonObject(raw);
  const candidates = [balanced, stripJsonEnvelope(raw)].filter(Boolean) as string[];

  for (const candidate of candidates) {
    const cleaned = candidate
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
      .replace(/,\s*}/g, "}")
      .replace(/,\s*]/g, "]")
      .trim();
    try {
      return JSON.parse(cleaned) as ParsedAiResponse;
    } catch {
      // tenta o próximo candidato
    }
  }

  const recoveredItems = extractCompleteObjectsFromItems(raw);
  if (recoveredItems.length > 0) return { items: recoveredItems };

  throw new Error("IA não retornou JSON válido");
}

function buildPrompt(mode: "baseline" | "update", imagesCount: number, playlists: string[]) {
  if (mode === "baseline") {
    return `${jsonObjectInstruction}\n\n` +
      `Você está analisando ${imagesCount} screenshot(s) do Spotify for Artists. ` +
      `Para CADA print, identifique a playlist e o número de streams/plays mostrado. ` +
      `Retorne no formato exato:\n` +
      `{"items":[{"playlist_name":"nome exato como no print","plays":12345,"source_index":0}]}\n\n` +
      `- "source_index" = índice local 0-based do print neste lote.\n` +
      `- "plays" = inteiro, sem pontos ou vírgulas.\n` +
      `- Inclua somente playlists realmente visíveis nos prints deste lote.\n` +
      `- Se houver muitas linhas, ainda assim retorne um JSON completo e fechado.`;
  }

  const playlistList = playlists.map((p, i) => `${i + 1}. "${p}"`).join("\n");
  return `${jsonObjectInstruction}\n\n` +
    `Você está analisando ${imagesCount} screenshot(s) do Spotify for Artists. ` +
    `Estas são as playlists já cadastradas neste lote:\n${playlistList}\n\n` +
    `Sua missão: para CADA playlist da lista acima, procure-a nos prints (o nome pode aparecer ` +
    `parcial, abreviado ou com pequenas variações de capitalização/acentos) e extraia o número ` +
    `de streams/plays atual mostrado ao lado dela. Se uma playlist da lista NÃO aparecer em ` +
    `nenhum print, retorne plays=null e found=false.\n\n` +
    `Retorne no formato exato:\n` +
    `{"items":[{"playlist_name":"nome EXATO da lista cadastrada","plays":12345,"found":true,"source_index":0}]}\n\n` +
    `- Use exatamente os nomes da lista cadastrada em "playlist_name".\n` +
    `- "source_index" = índice 0-based do print onde encontrou (ou null se não encontrou).\n` +
    `- "plays" = inteiro sem pontos/vírgulas (ou null se não encontrou).`;
}

async function callAi(images: ImageInput[], mode: "baseline" | "update", playlists: string[]) {
  const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      temperature: 0,
      max_tokens: 8192,
      messages: [
        {
          role: "user",
          content: [
            ...buildImageParts(images),
            { type: "text", text: buildPrompt(mode, images.length, playlists) },
          ],
        },
      ],
    }),
  });

  if (!resp.ok) {
    const txt = await resp.text();
    if (resp.status === 429) throw new Error("Limite de uso atingido. Tente em alguns minutos.");
    if (resp.status === 402) throw new Error("Créditos de IA esgotados.");
    console.error("[analyze-deal-prints] gateway error", resp.status, txt);
    throw new Error("Falha ao analisar imagens");
  }

  const data = await resp.json();
  const raw: string = data?.choices?.[0]?.message?.content ?? "";
  return { raw, parsed: parseAiJson(raw) };
}

function normalizeItems(items: AiItem[], sourceOffset = 0) {
  return items
    .filter((it) => typeof it.playlist_name === "string" && it.playlist_name!.trim().length > 0)
    .map((it) => {
      const sourceIndex = typeof it.source_index === "number" ? it.source_index + sourceOffset : null;
      const plays = parsePlays(it.plays);
      return {
        playlist_name: String(it.playlist_name).trim(),
        plays,
        found: it.found !== false && plays != null,
        source_index: sourceIndex,
      };
    });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return j({ ok: false, error: "Method not allowed" }, 405);
  const t0 = Date.now();

  const guard = await requireTeamAccess(req);
  if (!guard.ok) return guard.resp;

  if (!LOVABLE_API_KEY) return j({ ok: false, error: "LOVABLE_API_KEY ausente" }, 500);

  let body: { images?: ImageInput[]; playlists?: string[]; mode?: string };
  try {
    body = await req.json();
  } catch {
    return j({ ok: false, error: "Invalid JSON" }, 400);
  }
  const images = Array.isArray(body.images) ? body.images : [];
  const playlists = Array.isArray(body.playlists)
    ? body.playlists.map((s) => String(s).trim()).filter((s) => s.length > 0)
    : [];
  const mode = body.mode === "baseline" ? "baseline" : "update";

  if (images.length === 0) return j({ ok: false, error: "Envie pelo menos uma imagem" }, 400);
  if (images.length > MAX_IMAGES) {
    return j({ ok: false, error: `Máximo de ${MAX_IMAGES} prints por envio` }, 400);
  }
  for (const img of images) {
    if (!img?.base64 || !img?.mime_type) {
      return j({ ok: false, error: "image_base64 e mime_type são obrigatórios" }, 400);
    }
    if (!/^image\//.test(img.mime_type)) {
      return j({ ok: false, error: "mime_type inválido" }, 400);
    }
    if (img.base64.length > MAX_BASE64_LEN) {
      return j({ ok: false, error: "imagem muito grande (máx ~10MB)" }, 413);
    }
  }
  if (mode === "update" && playlists.length === 0) {
    return j({ ok: false, error: "Lista de playlists do deal está vazia" }, 400);
  }

  try {
    let raw = "";
    let matches: Array<{
      playlist_name: string;
      plays: number | null;
      found: boolean;
      source_index: number | null;
    }> = [];

    if (mode === "baseline") {
      for (let i = 0; i < images.length; i += BASELINE_IMAGE_CHUNK_SIZE) {
        const imageChunk = images.slice(i, i + BASELINE_IMAGE_CHUNK_SIZE);
        const result = await callAi(imageChunk, "baseline", []);
        raw += `${raw ? "\n\n" : ""}[prints ${i}-${i + imageChunk.length - 1}]\n${result.raw.slice(0, 4000)}`;
        matches.push(...normalizeItems(Array.isArray(result.parsed.items) ? result.parsed.items : [], i));
      }
    } else {
      const map = new Map<string, { playlist_name: string; plays: number | null; found: boolean; source_index: number | null }>();
      for (const p of playlists) {
        map.set(p.toLowerCase(), {
          playlist_name: p,
          plays: null,
          found: false,
          source_index: null,
        });
      }

      for (let i = 0; i < playlists.length; i += UPDATE_PLAYLIST_CHUNK_SIZE) {
        const playlistChunk = playlists.slice(i, i + UPDATE_PLAYLIST_CHUNK_SIZE);
        const result = await callAi(images, "update", playlistChunk);
        raw += `${raw ? "\n\n" : ""}[playlists ${i}-${i + playlistChunk.length - 1}]\n${result.raw.slice(0, 4000)}`;
        const normalized = normalizeItems(Array.isArray(result.parsed.items) ? result.parsed.items : []);

        for (const it of normalized) {
          const name = it.playlist_name.trim();
          if (!name) continue;
          const key = name.toLowerCase();
          const target = map.get(key);
          if (target) {
            target.plays = it.plays;
            target.found = it.found;
            target.source_index = it.source_index;
            continue;
          }

          const fuzzy = playlistChunk.find(
            (p) =>
              p.toLowerCase().includes(name.toLowerCase()) ||
              name.toLowerCase().includes(p.toLowerCase()),
          );
          if (fuzzy) {
            const t = map.get(fuzzy.toLowerCase());
            if (t && !t.found) {
              t.plays = it.plays;
              t.found = it.found;
              t.source_index = it.source_index;
            }
          }
        }
      }

      matches = Array.from(map.values());
    }

    const total_plays = matches.reduce(
      (acc, m) => acc + (m.plays != null && m.found ? m.plays : 0),
      0,
    );
    const not_found = matches.filter((m) => !m.found).map((m) => m.playlist_name);

    recordMetric(supabase, {
      scope: "ocr",
      operation: "analyze-deal-prints",
      status: "success",
      duration_ms: Date.now() - t0,
      metadata: {
        mode,
        images: images.length,
        playlists: playlists.length,
        matches: matches.length,
        not_found: not_found.length,
      },
    });
    return j({ ok: true, matches, total_plays, not_found, raw: raw.slice(0, 20_000) });
  } catch (e) {
    console.error("[analyze-deal-prints] exception", e);
    recordMetric(supabase, {
      scope: "ocr",
      operation: "analyze-deal-prints",
      status: "error",
      duration_ms: Date.now() - t0,
      metadata: {
        mode,
        images: images.length,
        error: e instanceof Error ? e.message.slice(0, 240) : String(e).slice(0, 240),
      },
    });
    return j({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});
