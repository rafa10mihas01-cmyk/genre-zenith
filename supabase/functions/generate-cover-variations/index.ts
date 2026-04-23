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
// SANITIZAÇÃO DE TÍTULO (editorial — máx 3-4 palavras fortes)
// ============================================================
// Remove emojis, símbolos decorativos, ano de cauda inútil, palavras descritivas
// fracas e mantém SOMENTE as 3-4 palavras de maior impacto. Resultado em CAIXA ALTA.
//
// Exemplos:
//   "MODÃO SERTANEJO RAIZ 2024 - SÓ AS MELHORES 🎉" → "MODÃO RAIZ 2024" / "SERTANEJO RAIZ"
//   "playlist oficial do sertanejo atualizada"      → "SERTANEJO"
//   "TOP HITS BRASIL 2025 PRA ESCUTAR AGORA"        → "TOP HITS BRASIL"
const TITLE_FILLER = new Set([
  // artigos / conectivos
  "DE", "DO", "DA", "DOS", "DAS", "E", "A", "O", "OS", "AS", "PARA", "PRA",
  "EM", "COM", "POR", "QUE", "UM", "UMA", "NO", "NA", "NOS", "NAS", "AO", "AOS",
  // descritivos fracos
  "PLAYLIST", "OFICIAL", "ATUALIZADA", "ATUALIZADO", "SELEÇÃO", "SELECAO",
  "COLETÂNEA", "COLETANEA", "COLEÇÃO", "COLECAO", "MIX",
  // ruído promocional
  "SÓ", "SO", "AGORA", "ESCUTAR", "OUVIR", "TOCAR", "CURTIR",
  "MELHORES", "MELHOR", "TODAS", "TODOS", "MAIS",
  // inglês comum
  "THE", "OF", "FOR", "TO", "AND", "PLAYLIST", "OFFICIAL",
]);
// palavras que sempre valem como "fortes" (não devem cair no filtro de tamanho)
const TITLE_STRONG = new Set([
  "TOP", "HITS", "VIRAL", "BR", "BRASIL", "RAIZ", "MODÃO", "MODAO",
  "SERTANEJO", "FUNK", "PAGODE", "ROCK", "POP", "RAP", "TRAP", "MPB",
  "CLÁSSICOS", "CLASSICOS", "NOSTALGIA", "ROMÂNTICAS", "ROMANTICAS",
  "FESTA", "BALADA", "VERÃO", "VERAO", "NOW", "FRESH", "MEGA",
]);

function sanitizePlaylistTitle(name: string | null | undefined): string {
  const raw = (name ?? "").toString();
  if (!raw.trim()) return "PLAYLIST";

  // 1. remove emojis e símbolos decorativos, mantém letras/números/espaço
  const cleaned = raw
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F2FF}]/gu, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();

  if (!cleaned) return "PLAYLIST";

  // 2. tokeniza
  const tokens = cleaned.split(" ").filter(Boolean);
  if (tokens.length === 0) return "PLAYLIST";

  // 3. filtra fillers + curtos fracos, preserva fortes e números
  const isYearOrNumber = (t: string) => /^\d{2,4}$/.test(t);
  const strong = tokens.filter((t) => {
    if (TITLE_FILLER.has(t)) return false;
    if (TITLE_STRONG.has(t)) return true;
    if (isYearOrNumber(t)) return true;
    return t.length >= 3; // descarta "SÓ", "É", etc não listados
  });

  const final = strong.length > 0 ? strong : tokens;

  // 4. máximo 4 palavras (preferimos 3); cortar do fim
  // se sobrou número (ano) e temos >3 palavras, mantemos o ano por último
  let limited: string[];
  if (final.length <= 3) {
    limited = final;
  } else {
    const yearIdx = final.findIndex(isYearOrNumber);
    if (yearIdx >= 0 && yearIdx >= 3) {
      // mantém 2 primeiras palavras + ano
      limited = [final[0], final[1], final[yearIdx]];
    } else {
      limited = final.slice(0, 3);
    }
  }

  const result = limited.join(" ").trim();
  return result.length > 0 ? result : "PLAYLIST";
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
// VARIAÇÃO CONTROLADA POR ÍNDICE (4 capas do mesmo template)
// Varia LEVEMENTE: posição vertical, peso da fonte, intensidade do gradiente.
// NUNCA muda layout base, alinhamento ou composição.
// ============================================================
function variationHints(index: number): string {
  const hints = [
    "- Vertical position: text block perfectly centered on the canvas\n- Font weight: ExtraBold (heavy)\n- Gradient intensity: balanced, mid contrast between the two colors",
    "- Vertical position: text block slightly above center (about 45% from top)\n- Font weight: Black (heaviest)\n- Gradient intensity: smooth, soft transition between the two colors",
    "- Vertical position: text block perfectly centered on the canvas\n- Font weight: Bold (slightly lighter than ExtraBold, still strong)\n- Gradient intensity: stronger contrast, more dramatic transition",
    "- Vertical position: text block slightly above center (about 47% from top)\n- Font weight: ExtraBold (heavy)\n- Gradient intensity: balanced, mid contrast",
  ];
  return hints[index % hints.length];
}

// ============================================================
// PROMPT BUILDERS — 1 por estilo
// ============================================================
function buildCleanPrompt(template: any, palette: typeof PALETTES[number], index = 0): string {
  const name = sanitizePlaylistTitle(template.name);
  const subtext = extractSubtext(template.cover_brief);

  const textBlock = subtext
    ? [
        "Two text elements ONLY (clear hierarchy):",
        `  • Main title: "${name}"`,
        "    - Bold, centered",
        "    - Title block must occupy 60–70% of the card width (NEVER fill 100%)",
        "    - Strong sans-serif (Helvetica Bold / Inter Black / Montserrat ExtraBold)",
        "    - Maximum 2 lines, broken naturally on word boundaries (never ugly mid-word breaks)",
        `  • Subtitle: "${subtext}"`,
        "    - Smaller — about 30% of the title size (clear visual hierarchy)",
        "    - Lighter weight, slightly looser letter-spacing",
        "    - Centered below the title with 8% of canvas height as gap between title and subtitle",
        "    - Same font family",
      ].join("\n")
    : [
        "One text element ONLY:",
        `  • Title: "${name}"`,
        "    - Bold, centered",
        "    - Title block must occupy 60–70% of the card width (NEVER fill 100%)",
        "    - Strong sans-serif (Helvetica Bold / Inter Black / Montserrat ExtraBold)",
        "    - Maximum 2 lines, broken naturally",
      ].join("\n");

  return [
    "Professional Spotify-style playlist cover, square format 1:1, high quality. STYLE: CLEAN EDITORIAL (STRICT).",
    "",
    "BACKGROUND:",
    `Simple smooth gradient using ONLY 2 colors from this palette: ${palette.description}. No textures, no patterns, no images, no objects.`,
    "",
    "TEXT (MUST BE PERFECTLY LEGIBLE):",
    textBlock,
    `${palette.text}.`,
    "",
    "SAFE AREA (CRITICAL — never violate):",
    "- Internal padding: minimum 12% of the card on every side (top, bottom, left, right)",
    "- No text element ever touches or bleeds into the edges",
    "- Generous breathing space around the entire text block",
    "",
    "VARIATION (subtle, this card only):",
    variationHints(index),
    "",
    "LAYOUT RULES (STRICT GRID):",
    "- Perfect horizontal centering",
    "- Equal margins left and right",
    "- Consistent spacing between title and subtitle (8% of canvas height)",
    "- No overlap, no stacking effects, no perspective, no tilt, no distortion",
    "",
    "VISUAL STYLE:",
    "- Minimal, editorial, clean, professional",
    "- Feels like an OFFICIAL Spotify playlist cover",
    "- Does NOT look AI-generated",
    "",
    "READABILITY (FINAL TEST — must pass):",
    "- Readable in under 1 second at 64x64 thumbnail",
    "- High contrast between text and background",
    "- No thin fonts, no light weights",
    "",
    "STRICTLY FORBIDDEN:",
    "- No emojis, no decorative symbols",
    "- No long sentences, no more than 2 lines of title",
    "- No ugly word-breaks",
    "- No humans, no faces, no people, no portraits, no characters",
    "- No icons, no logos, no objects, no instruments, no musical notes",
    "- No textures, no noise, no grain, no vignette",
    "- No shadows, no glow, no effects",
    "- No perspective, no rotation, no tilt",
    "- No additional text beyond title/subtitle",
    "- No decorative elements",
    "- No more than 2 colors in background",
    "",
    "SPELLING:",
    "- Text must be EXACTLY as provided above — no typos, no variations, no stylization of letters",
  ].join("\n");
}

function buildViralHitsPrompt(template: any, palette: typeof PALETTES[number], index = 0): string {
  const sanitized = sanitizePlaylistTitle(template.name);
  const { dominant, secondary } = pickDominantWord(sanitized);

  const secondaryBlock = secondary
    ? `  • Secondary text: "${secondary}" — much smaller (about 25–30% of dominant size), placed right below the dominant word with comfortable spacing (about 8% of canvas height between them). Same font family, slightly lower weight, integrated into the composition.`
    : "  • No secondary text. The dominant word stands alone with full breathing space.";

  return [
    "Trending Spotify viral playlist cover, square format 1:1, high quality. STYLE: VIRAL HITS TYPOGRAPHY.",
    "",
    "BACKGROUND:",
    `Simple ${palette.description}. Clean background — the typography is the hero, not the background.`,
    "",
    "TEXT (TYPOGRAPHY IS THE MAIN ART — clear hierarchy):",
    "Two text elements with strong, controlled hierarchy:",
    `  • Dominant word: "${dominant}" — bold and dominant, fills 65–75% of the canvas width (NEVER 100%, always with breathing space). Ultra-heavy weight (Black/ExtraBold), tight letter-spacing.`,
    secondaryBlock,
    `${palette.text}. Use a powerful display sans-serif (Anton, Bebas Neue, Druk, Helvetica Black, or similar high-impact fonts).`,
    "Spelling MUST be EXACTLY as written. No typos, no extra letters.",
    "",
    "SAFE AREA (CRITICAL):",
    "- Internal padding: minimum 12% of the card on every side",
    "- No text element ever touches or bleeds into the edges",
    "- Generous breathing space around the typography block",
    "",
    "VARIATION (subtle, this card only):",
    variationHints(index),
    "",
    "COMPOSITION:",
    "- Centered with confident editorial weight — NOT chaotic",
    "- Very subtle tilt allowed (max 3°), or perfectly straight",
    "- Optional very soft depth: a faint shadow OR a subtle chromatic offset (never both)",
    "- High energy, modern, designed — feels like a trending Spotify HITS / TOP / VIRAL editorial cover",
    "",
    "READABILITY (FINAL TEST — must pass):",
    "- Readable in under 1 second at 64x64 thumbnail",
    "- High contrast between text and background",
    "",
    "STRICTLY FORBIDDEN:",
    "- No emojis, no decorative symbols",
    "- No long sentences, no more than 2 lines",
    "- No ugly word-breaks",
    "- No human faces, no human bodies, no people, no portraits",
    "- No complex scenes, no landscapes, no instruments, no musical notes, no logos",
    "- No additional text beyond what is specified",
    "- No watermarks, no signatures",
    "- No gradients with more than 2 colors, no grain, no vignette",
  ].join("\n");
}

function buildDynamicPrompt(template: any, palette: typeof PALETTES[number], index = 0): string {
  const sanitized = sanitizePlaylistTitle(template.name);
  const { dominant, secondary } = pickDominantWord(sanitized);
  const subtext = extractSubtext(template.cover_brief);

  // Decide the secondary line: palavra secundária da tipografia OU subtitle do brief
  const secondLine = secondary || subtext;

  const textBlock = secondLine
    ? [
        "Two text elements with a fresh, designed hierarchy:",
        `  • Main word: "${dominant}" — bold, dominant. Title block occupies 60–70% of the card width (NEVER 100%). Allowed treatments (pick exactly ONE subtly): split into two stacked lines, slight alignment shift (left or right of perfect center), or a thin underline accent below the word.`,
        `  • Secondary line: "${secondLine}" — about 30% of main size, same font family, placed with a slight asymmetric offset (shifted left/right or tucked under one edge — NOT perfectly centered, but still balanced and breathing). Gap of about 8% of canvas height between main and secondary.`,
      ].join("\n")
    : [
        "One text element with a fresh, designed treatment:",
        `  • Title: "${sanitized}" — bold. Title block occupies 60–70% of the card width. Allowed treatments (pick exactly ONE subtly): split into two stacked lines, slight alignment shift off perfect center, or a thin underline accent.`,
      ].join("\n");

  return [
    "Editorial Spotify-style playlist cover, square format 1:1, high quality. STYLE: DYNAMIC MODERN TYPOGRAPHY (controlled creativity).",
    "",
    "BACKGROUND:",
    `Simple smooth gradient using ONLY 2 colors from this palette: ${palette.description}. No textures, no patterns, no photographs, no objects.`,
    "",
    "TEXT (MUST BE PERFECTLY LEGIBLE):",
    textBlock,
    `${palette.text}. Use a strong modern bold sans-serif font (Helvetica Bold, Inter Black, Montserrat ExtraBold or similar). High weight only — no thin or light fonts.`,
    "",
    "VISUAL VARIATION TECHNIQUE (CRITICAL — pick exactly ONE, never combine):",
    "  • OR slight rotation of the text block (max 5°, very subtle)",
    "  • OR asymmetrical alignment (text shifted off perfect center to the left or right)",
    "  • OR a thin underline accent under the main word",
    "  • OR light text layering / stacking (mild, never illegible)",
    "Never combine multiple techniques in the same cover.",
    "",
    "SAFE AREA (CRITICAL):",
    "- Internal padding: minimum 12% of the card on every side",
    "- No text touching or bleeding into the edges",
    "- Comfortable spacing and generous breathing space around every element",
    "",
    "VARIATION (subtle, this card only):",
    variationHints(index),
    "",
    "READABILITY (FINAL TEST — must pass):",
    "- Readable in under 1 second at 64x64 thumbnail",
    "- High contrast between text and background",
    "- Clarity over creativity — if a treatment hurts legibility, drop it",
    "",
    "SHAPE CONTROL (only if a shape is used at all):",
    "- Maximum 1 or 2 simple geometric shapes (circle, line, rectangle)",
    "- Same color palette, no overlap chaos, never compete with the text",
    "- Shapes are optional — most covers should rely on typography alone",
    "",
    "COMPOSITION (Dynamic essence — preserve all of this):",
    "- Light asymmetry, subtle movement and rhythm",
    "- Modern composition with a human-designed feel",
    "- Always clean, intentional and balanced — never messy",
    "- Generous negative space; should feel fresh and updated, not repetitive",
    "",
    "AVOID DISGUISED VIRAL STYLE:",
    "- Do NOT use oversized dominant words that fill 80%+ of the canvas",
    "- Do NOT apply extreme typography effects",
    "- Maintain editorial balance and structure at all times",
    "",
    "STRICTLY FORBIDDEN:",
    "- No emojis, no decorative symbols",
    "- No long sentences, no more than 2 lines",
    "- No ugly word-breaks",
    "- Multiple visual techniques combined at once",
    "- Strong distortion of letters, exaggerated rotation (anything beyond 5°)",
    "- Visual pollution or busy backgrounds, loss of legibility",
    "- No humans, no faces, no people, no portraits, no characters",
    "- No icons, no logos, no objects, no instruments, no musical notes",
    "- No textures, no noise, no grain, no vignette",
    "- No drop shadows, no glow, no chromatic effects",
    "- No perspective, no 3D",
    "- No additional text beyond what is specified above",
    "- No more than 2 colors in the background",
    "",
    "SPELLING:",
    "- Text must be EXACTLY as provided above — no typos, no variations, no stylization of letters",
  ].join("\n");
}

function buildPrompt(
  template: any,
  palette: typeof PALETTES[number],
  style: Style,
  index: number,
  customPrompt?: string,
): string {
  if (customPrompt && customPrompt.trim().length > 10) return customPrompt.trim();
  if (style === "viral") return buildViralHitsPrompt(template, palette, index);
  if (style === "dynamic") return buildDynamicPrompt(template, palette, index);
  return buildCleanPrompt(template, palette, index);
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
