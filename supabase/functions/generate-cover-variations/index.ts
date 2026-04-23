// generate-cover-variations — gera 4 variações de capa estilo Spotify profissional.
//
// Distribuição híbrida de estilos (alvo por lote de 4 capas):
//   • 60% CLEAN EDITORIAL  → capa limpa, tipo Spotify oficial (default seguro)
//   • 30% VIRAL HITS TYPO  → palavra dominante gigante, peso visual forte
//   • 10% DYNAMIC          → composição assimétrica/com perspectiva
//
// Regras de mistura por lote (4 capas):
//   • mínimo 2 CLEAN
//   • máximo 1 VIRAL HITS (≈25%, próximo de 30%)
//   • DYNAMIC: 0 ou 1, sorteado (~10%)
//   • o resto completa com CLEAN
//
// Cada variação carrega: index, url, palette, style.
// Persiste em playlist_templates.cover_variations (jsonb, sem migration).
//
// POST { template_id: string, custom_prompt?: string }
// → { ok, variations: [{ index, url, palette, style }] }
import { corsHeaders } from "npm:@supabase/supabase-js/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

const MODEL = "google/gemini-3-pro-image-preview"; // melhor legibilidade de texto

// ============================================================
// PALETAS (cor) — diversidade visual previsível
// ============================================================
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

// ============================================================
// ESTILOS DE COMPOSIÇÃO
// ============================================================
type Style = "clean" | "viral" | "dynamic";

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ============================================================
// SUBTEXTO TEMÁTICO (mantido — usado pelo Clean / Dynamic)
// ============================================================
function extractSubtext(brief: string | null | undefined): string | null {
  if (!brief || typeof brief !== "string") return null;
  const cleaned = brief
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (cleaned.length < 8) return null;

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
    const meaningful = tokens.filter((t) => t.length > 4);
    if (meaningful.length === 0) return null;
    phrase = meaningful.slice(0, 2).join(" ");
  }
  const upper = phrase.toUpperCase().trim();
  return upper.length > 0 && upper.length <= 28 ? upper : null;
}

// ============================================================
// SELETOR SEMÂNTICO DE PALAVRA DOMINANTE (Viral Hits)
// ============================================================
// Regras:
// 1. Tier-1 (impacto): HITS, TOP, VIRAL, MAIS, BRASIL, BR, NOVO, NOW, FRESH + qualquer número (50, 100, 2024, 2025…)
// 2. Stopwords ignoradas: de, do, da, dos, das, e, a, o, os, as, para, pra, atualizada, playlist, oficial, the, of
// 3. Se houver 2 tier-1 adjacentes → combina (ex: "TOP HITS")
// 4. Se houver 1 tier-1 → ela é dominante, resto vira secundário
// 5. Se houver só número forte → número é dominante
// 6. Se nada forte → primeira palavra ≥3 letras que não é stopword
const TIER1 = new Set([
  "HITS", "TOP", "VIRAL", "MAIS", "BRASIL", "BR", "NOVO", "NOVA", "NOW", "FRESH",
  "BEST", "BEAT", "BEATS", "VIBES", "MEGA", "ULTRA", "CLUB", "PARTY",
]);
const STOPWORDS = new Set([
  "DE", "DO", "DA", "DOS", "DAS", "E", "A", "O", "OS", "AS", "PARA", "PRA",
  "ATUALIZADA", "ATUALIZADO", "PLAYLIST", "OFICIAL", "THE", "OF", "MIX", "EM",
  "COM", "POR", "QUE", "UM", "UMA",
]);

function pickDominantWord(name: string): { dominant: string; secondary: string } {
  const raw = (name ?? "").toString().trim().toUpperCase();
  if (!raw) return { dominant: "PLAYLIST", secondary: "" };

  // tokeniza preservando números
  const tokens = raw
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);

  if (tokens.length === 0) return { dominant: raw, secondary: "" };
  if (tokens.length === 1) return { dominant: tokens[0], secondary: "" };

  const isNumber = (t: string) => /^\d+$/.test(t);
  const isTier1 = (t: string) => TIER1.has(t) || isNumber(t);
  const isStop = (t: string) => STOPWORDS.has(t);

  // Regra 3: dois tier-1 adjacentes → combina
  for (let i = 0; i < tokens.length - 1; i++) {
    if (isTier1(tokens[i]) && isTier1(tokens[i + 1])) {
      const dominant = `${tokens[i]} ${tokens[i + 1]}`;
      const secondary = tokens
        .filter((_, idx) => idx !== i && idx !== i + 1 && !isStop(tokens[idx]))
        .join(" ")
        .trim();
      return { dominant, secondary };
    }
  }

  // Regra 4: um tier-1 isolado
  const t1Index = tokens.findIndex(isTier1);
  if (t1Index >= 0) {
    const dominant = tokens[t1Index];
    const secondary = tokens
      .filter((_, idx) => idx !== t1Index && !isStop(tokens[idx]))
      .join(" ")
      .trim();
    return { dominant, secondary };
  }

  // Regra 6: fallback — primeira palavra ≥3 letras não-stopword
  const fallback = tokens.find((t) => t.length >= 3 && !isStop(t)) ?? tokens[0];
  const secondary = tokens
    .filter((t) => t !== fallback && !isStop(t))
    .join(" ")
    .trim();
  return { dominant: fallback, secondary };
}

// ============================================================
// PROMPT BUILDERS — 1 por estilo
// ============================================================
function buildCleanPrompt(template: any, palette: typeof PALETTES[number]): string {
  const name = (template.name ?? "PLAYLIST").toString().trim().toUpperCase();
  const subtext = extractSubtext(template.cover_brief);

  const textBlock = subtext
    ? `Two text elements:\n  • Main title: "${name}" — large, bold, centered, sans-serif, takes ~70% width\n  • Subtitle: "${subtext}" — smaller (about 35% of title size), centered, placed below the title, same font family, slightly lower opacity`
    : `One text element:\n  • Title: "${name}" — large, bold, centered, sans-serif, takes ~75% width`;

  return [
    "Professional Spotify-style playlist cover, square format 1:1, high quality. STYLE: CLEAN EDITORIAL.",
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

function buildViralHitsPrompt(template: any, palette: typeof PALETTES[number]): string {
  const fullName = (template.name ?? "PLAYLIST").toString().trim().toUpperCase();
  const { dominant, secondary } = pickDominantWord(fullName);

  const secondaryBlock = secondary
    ? `  • Secondary text: "${secondary}" — much smaller (about 20-25% of dominant size), placed slightly overlapping the bottom of the dominant word OR right below it with very tight spacing. Same font family, slightly lower weight, integrated into the composition.`
    : "  • No secondary text. The dominant word fills the canvas alone.";

  return [
    "Trending Spotify viral playlist cover, square format 1:1, high quality. STYLE: VIRAL HITS TYPOGRAPHY.",
    "",
    "BACKGROUND:",
    `Simple ${palette.description}. Clean background — the typography is the hero, not the background.`,
    "",
    "TEXT (TYPOGRAPHY IS THE MAIN ART):",
    "Two text elements with strong hierarchy:",
    `  • Dominant word: "${dominant}" — EXTREMELY bold and dominant, fills 80-90% of the canvas width, ultra-heavy weight (Black/ExtraBold), tight letter-spacing, takes most of the visual weight.`,
    secondaryBlock,
    `${palette.text}. Use a powerful display sans-serif (Anton, Bebas Neue, Druk, Helvetica Black, or similar high-impact fonts).`,
    "Spelling MUST be EXACTLY as written. No typos, no extra letters.",
    "",
    "COMPOSITION:",
    "Text fills most of the canvas. Centered but with dynamic feel — NOT static. Slight perspective or very subtle tilt allowed (max 3-5°). Add subtle depth: a soft shadow, glow, or slight chromatic offset behind the dominant word. High energy, modern, designed — not typed.",
    "Looks like a trending Spotify editorial playlist cover (HITS, TOP, VIRAL style). Text feels designed and intentional.",
    "",
    "STRICTLY FORBIDDEN:",
    "No human faces, no human bodies, no people, no portraits.",
    "No complex scenes, no landscapes, no instruments, no musical notes, no logos.",
    "No additional text beyond what is specified. No watermarks, no signatures.",
    "No gradients with more than 2 colors. No grain, no vignette.",
  ].join("\n");
}

function buildDynamicPrompt(template: any, palette: typeof PALETTES[number]): string {
  const name = (template.name ?? "PLAYLIST").toString().trim().toUpperCase();
  const subtext = extractSubtext(template.cover_brief);

  const textBlock = subtext
    ? `Two text elements:\n  • Title: "${name}" — large, bold, asymmetrically positioned (off-center, e.g. left-aligned or rotated slightly)\n  • Subtitle: "${subtext}" — smaller, placed creatively (e.g. vertical, opposite corner, or tucked under the title)`
    : `One text element:\n  • Title: "${name}" — large, bold, placed asymmetrically (off-center or rotated 5-10°)`;

  return [
    "Editorial Spotify-style playlist cover, square format 1:1, high quality. STYLE: DYNAMIC ASYMMETRIC.",
    "",
    "BACKGROUND:",
    `Simple ${palette.description}. May include 1-2 abstract geometric shapes (circle, stripe, triangle) in solid color from the same palette family for visual interest. No textures, no photographs.`,
    "",
    "TEXT (MUST BE PERFECTLY LEGIBLE):",
    textBlock,
    `${palette.text}. Use a strong modern bold sans-serif font (Helvetica Bold, Inter Black, or Montserrat ExtraBold style).`,
    "Spelling MUST be exactly as written above.",
    "",
    "COMPOSITION:",
    "Asymmetric, designed feel — NOT centered. Use bold negative space and unexpected placement. Slight perspective or rotation allowed. Modern editorial energy. Still clean and readable on a 64x64 thumbnail.",
    "",
    "STRICTLY FORBIDDEN:",
    "No human faces, no human bodies, no people, no portraits, no characters.",
    "No complex scenes, no landscapes, no instruments, no musical notes, no logos.",
    "No additional text beyond what is specified. No watermarks, no signatures.",
    "No gradients with more than 2 colors. No grain, no vignette.",
  ].join("\n");
}

function buildPrompt(
  template: any,
  palette: typeof PALETTES[number],
  style: Style,
  customPrompt?: string,
): string {
  if (customPrompt && customPrompt.trim().length > 10) return customPrompt.trim();
  if (style === "viral") return buildViralHitsPrompt(template, palette);
  if (style === "dynamic") return buildDynamicPrompt(template, palette);
  return buildCleanPrompt(template, palette);
}

// ============================================================
// MIX DE ESTILOS POR LOTE (4 capas)
// Garante: ≥2 clean, ≤1 viral, 0-1 dynamic, resto clean.
// Embaralha pra que cada paleta receba estilos diferentes ao longo do tempo.
// ============================================================
function pickStyleMix(): Style[] {
  // base: 2 clean garantidas
  const mix: Style[] = ["clean", "clean"];
  // 3ª: 70% viral, 30% clean (puxa pra 25-30% viral no lote)
  mix.push(Math.random() < 0.7 ? "viral" : "clean");
  // 4ª: 30% dynamic, 10% viral (capeado), 60% clean
  const r = Math.random();
  if (r < 0.3) mix.push("dynamic");
  else if (r < 0.4 && !mix.includes("viral")) mix.push("viral");
  else mix.push("clean");

  // shuffle (Fisher-Yates) pra distribuir entre as 4 paletas
  for (let i = mix.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [mix[i], mix[j]] = [mix[j], mix[i]];
  }
  return mix;
}

// ============================================================
// IMAGE GENERATION
// ============================================================
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

// ============================================================
// HANDLER
// ============================================================
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
  const variations: { index: number; url: string; palette?: string; style?: Style }[] = [];

  // 🧹 Cleanup: remove variações antigas do storage antes de gerar novas
  try {
    const { data: oldFiles } = await supabase.storage.from("playlist-covers").list(tpl.id);
    if (oldFiles && oldFiles.length > 0) {
      const paths = oldFiles.map((f) => `${tpl.id}/${f.name}`);
      await supabase.storage.from("playlist-covers").remove(paths);
    }
  } catch (e) { console.warn("cleanup falhou:", e); }

  // Sorteia o mix de estilos para o lote (1 estilo por paleta)
  const styleMix = pickStyleMix();

  // Gera 1 variação por (paleta + estilo) — em paralelo
  const prompts = PALETTES.map((p, i) => buildPrompt(tpl, p, styleMix[i], body.custom_prompt));
  const results = await Promise.allSettled(prompts.map((p) => generateOne(p)));

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status !== "fulfilled") {
      console.error(`variação ${i} (${PALETTES[i].name} / ${styleMix[i]}) falhou:`, r.reason);
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
      variations.push({
        index: i,
        url: pub.publicUrl,
        palette: PALETTES[i].name,
        style: styleMix[i],
      });
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
    styles_used: variations.map((v) => v.style),
    subtext_extracted: extractSubtext(tpl.cover_brief),
  });
});
