// generate-cover-variations — gera 4 variações de capa estilo Spotify profissional.
//
// Padrão visual FIXO (não varia por template):
//   • Fundo simples: gradiente diagonal 2 cores
//   • Nome da playlist em destaque (grande, central, bold)
//   • Subtexto opcional menor (extraído do cover_brief)
//   • SEM rostos humanos, SEM cenas complexas, SEM poluição visual
//   • Tipografia bold sans-serif, alto contraste
//
// Variação = APENAS paleta de cor (mesma estrutura).
//
// POST { template_id: string, custom_prompt?: string }
// → { ok, variations: [{ index, url }] }
import { corsHeaders } from "npm:@supabase/supabase-js/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

const MODEL = "google/gemini-3-pro-image-preview"; // melhor legibilidade de texto

// 4 paletas — estrutura idêntica, só muda cor. Geram diversidade visual previsível.
const PALETTES = [
  {
    name: "spotify-green",
    description: "vibrant Spotify green gradient from #1DB954 (top-left) to #0d6b30 (bottom-right)",
    text: "white text with very subtle dark shadow for readability",
  },
  {
    name: "deep-purple",
    description: "deep purple gradient from #7b2cbf (top-left) to #2d0a4e (bottom-right)",
    text: "bright white text with subtle glow",
  },
  {
    name: "vibrant-orange",
    description: "warm vibrant gradient from #ff6b35 (top-left) to #c2410c (bottom-right)",
    text: "white text with subtle dark outline",
  },
  {
    name: "midnight-blue",
    description: "deep night blue gradient from #1e3a8a (top-left) to #0c1733 (bottom-right)",
    text: "bright white text with subtle blue glow",
  },
];

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * Extrai subtexto curto a partir do cover_brief.
 * Pega 2-4 palavras temáticas, em maiúsculas, sem pontuação.
 * Ex: "Capa em tons terrosos com violão evocando nostalgia" → "TONS NOSTÁLGICOS"
 * Se não houver brief útil, devolve null (sem subtexto).
 */
function extractSubtext(brief: string | null | undefined): string | null {
  if (!brief || typeof brief !== "string") return null;
  const cleaned = brief
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (cleaned.length < 8) return null;

  // palavras-chave temáticas comuns que viram subtexto bom
  const themeWords = [
    "nostálgico", "nostálgica", "nostalgia",
    "romântico", "romântica", "romance",
    "festa", "balada", "agitado", "agitada",
    "sertanejo", "sertaneja", "raiz",
    "modão", "sofrência",
    "verão", "viagem",
    "clássicos", "clássicas", "atemporais",
    "novidades", "lançamentos",
    "top", "hits", "melhores",
    "relax", "calmo", "calma",
  ];
  const tokens = cleaned.split(" ");
  const matched = tokens.filter((t) => themeWords.includes(t));
  let phrase: string;
  if (matched.length >= 2) {
    phrase = matched.slice(0, 3).join(" ");
  } else if (matched.length === 1) {
    phrase = matched[0];
  } else {
    // fallback: pega 2 primeiras palavras significativas (length > 4)
    const meaningful = tokens.filter((t) => t.length > 4);
    if (meaningful.length === 0) return null;
    phrase = meaningful.slice(0, 2).join(" ");
  }
  const upper = phrase.toUpperCase().trim();
  return upper.length > 0 && upper.length <= 28 ? upper : null;
}

function buildPrompt(template: any, palette: typeof PALETTES[number], customPrompt?: string): string {
  if (customPrompt && customPrompt.trim().length > 10) return customPrompt.trim();

  const name = (template.name ?? "PLAYLIST").toString().trim().toUpperCase();
  const subtext = extractSubtext(template.cover_brief);

  const textBlock = subtext
    ? `Two text elements:\n  • Main title: "${name}" — large, bold, centered, sans-serif, takes ~70% width\n  • Subtitle: "${subtext}" — smaller (about 35% of title size), centered, placed below the title, same font family, slightly lower opacity`
    : `One text element:\n  • Title: "${name}" — large, bold, centered, sans-serif, takes ~75% width`;

  return [
    "Professional Spotify-style playlist cover, square format 1:1, high quality.",
    "",
    "BACKGROUND:",
    `Simple smooth ${palette.description}. No textures, no patterns, no images, no objects.`,
    "",
    "TEXT (MUST BE PERFECTLY LEGIBLE):",
    textBlock,
    `${palette.text}. Use a strong modern bold sans-serif font (Helvetica Bold, Inter Black, or Montserrat ExtraBold style).`,
    "Spelling MUST be exactly as written above. No typos, no extra letters, no decorations on the text.",
    "",
    "COMPOSITION:",
    "Centered layout with comfortable padding. Clean, minimal, modern. High contrast. Easily readable on a small mobile thumbnail (64x64).",
    "",
    "STRICTLY FORBIDDEN:",
    "No human faces, no human bodies, no people, no portraits, no characters.",
    "No complex scenes, no landscapes, no instruments, no musical notes, no logos, no icons.",
    "No additional text beyond the title (and subtitle if specified). No watermarks, no signatures, no decorative elements.",
    "No gradients with more than 2 colors. No noise, no grain, no vignette.",
  ].join("\n");
}

async function generateOne(prompt: string): Promise<string> {
  const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      modalities: ["image", "text"],
    }),
  });
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`AI ${resp.status}: ${t.slice(0, 200)}`);
  }
  const data = await resp.json();
  const dataUrl = data?.choices?.[0]?.message?.images?.[0]?.image_url?.url;
  if (!dataUrl || !dataUrl.startsWith("data:image/")) {
    throw new Error("Resposta sem imagem");
  }
  return dataUrl;
}

function dataUrlToBytes(dataUrl: string): { bytes: Uint8Array; contentType: string } {
  const match = dataUrl.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
  if (!match) throw new Error("data URL inválida");
  const contentType = match[1];
  const b64 = match[2];
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { bytes, contentType };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jr({ error: "POST only" }, 405);

  let body: { template_id?: string; custom_prompt?: string };
  try { body = await req.json(); } catch { return jr({ error: "invalid json" }, 400); }
  if (!body.template_id) return jr({ error: "template_id required" }, 400);

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: tpl, error: tplErr } = await supabase
    .from("playlist_templates").select("*").eq("id", body.template_id).maybeSingle();
  if (tplErr || !tpl) return jr({ error: "template not found" }, 404);

  const ts = Date.now();
  const variations: { index: number; url: string; palette?: string }[] = [];

  // 🧹 Cleanup: remove variações antigas do storage antes de gerar novas
  try {
    const { data: oldFiles } = await supabase.storage.from("playlist-covers").list(tpl.id);
    if (oldFiles && oldFiles.length > 0) {
      const paths = oldFiles.map((f) => `${tpl.id}/${f.name}`);
      await supabase.storage.from("playlist-covers").remove(paths);
    }
  } catch (e) { console.warn("cleanup falhou:", e); }

  // Gera 1 variação por paleta — em paralelo
  const prompts = PALETTES.map((p) => buildPrompt(tpl, p, body.custom_prompt));
  const results = await Promise.allSettled(prompts.map((p) => generateOne(p)));

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status !== "fulfilled") {
      console.error(`variação ${i} (${PALETTES[i].name}) falhou:`, r.reason);
      continue;
    }
    try {
      const { bytes, contentType } = dataUrlToBytes(r.value);
      const ext = contentType.split("/")[1].replace("+xml", "");
      const path = `${tpl.id}/${ts}-${i}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("playlist-covers")
        .upload(path, bytes, { contentType, upsert: true });
      if (upErr) { console.error("upload err:", upErr); continue; }
      const { data: pub } = supabase.storage.from("playlist-covers").getPublicUrl(path);
      variations.push({ index: i, url: pub.publicUrl, palette: PALETTES[i].name });
    } catch (e) {
      console.error("processing err:", e);
    }
  }

  if (variations.length === 0) {
    return jr({ ok: false, error: "Nenhuma variação foi gerada com sucesso" }, 500);
  }

  await supabase.from("playlist_templates").update({
    cover_variations: variations,
    cover_generated_at: new Date().toISOString(),
  }).eq("id", tpl.id);

  return jr({
    ok: true,
    variations,
    palettes_used: variations.map((v) => v.palette),
    subtext_extracted: extractSubtext(tpl.cover_brief),
  });
});
