// generate-cover-variations — gera 1 capa por chamada, com cache acumulativo por cor.
//
// 🎯 ECONOMIA MÁXIMA:
//   - Sem palette no body → gera a paleta padrão (determinística por template_id).
//   - Com palette no body → gera APENAS aquela cor (sob demanda).
//   - Se a cor solicitada já estiver em cover_variations → devolve do cache (0 crédito).
//   - NÃO apaga variações antigas: vai acumulando as 4 cores ao longo do tempo.
//
// Paletas disponíveis: "spotify-green", "deep-purple", "vibrant-orange", "midnight-blue".
// Estilo SEMPRE clean (padrão aprovado visualmente). Watermark + premium finish aplicados.
//
// POST { template_id: string, palette?: string, custom_prompt?: string }
// → { ok, cached, variation: {index,url,palette,style}, variations: [...] }
import { corsHeaders } from "npm:@supabase/supabase-js/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { applyWatermark } from "./_watermark.ts";

import { deprecationGate } from "../_shared/_deprecation.ts";
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
// SANITIZAÇÃO DE TÍTULO (editorial — variação controlada 70/20/10)
// ============================================================
// O título final SEMPRE segue um destes 3 formatos:
//   FORMATO 1 — PRINCIPAL (≈70%): [FORTE] + [GÊNERO] + [ANO?]
//       ex: "TOP SERTANEJO", "HITS FUNK 2026", "MODÃO SERTANEJO"
//       ⚠️ ANO só aparece se a IA tiver passado um ano no nome — nunca forçamos.
//   FORMATO 2 — EDITORIAL (≈20%): [GÊNERO] + [VARIAÇÃO]
//       ex: "SERTANEJO RAIZ", "FUNK CLÁSSICO", "TRAP ATUAL"
//   FORMATO 3 — GANCHO    (≈10%): [FORTE] (1–2 palavras curtas)
//       ex: "TOP HITS", "VIRAL HITS", "HITS BR"
//
// A escolha do formato é determinística (hash do nome original) para que:
//   • a mesma playlist sempre gere o mesmo título
//   • playlists diferentes recebam variação distribuída
// Toda regra anterior continua valendo: sem emoji, sem fillers, sem
// duplicação, máximo 3 palavras, sempre legível.
const TIER1_WORDS = new Set([
  "TOP", "HITS", "VIRAL", "BRASIL", "BR", "MEGA", "ULTRA", "NOW", "FRESH",
]);
const TIER2_WORDS = new Set([
  "SERTANEJO", "FUNK", "TRAP", "PISEIRO", "PAGODE", "ROCK", "POP",
  "RAP", "MPB", "FORRÓ", "FORRO", "SAMBA", "REGGAE", "GOSPEL",
  "ELETRÔNICA", "ELETRONICA", "RAVE",
]);
const TIER3_WORDS = new Set([
  "RAIZ", "MODÃO", "MODAO", "NOSTALGIA", "CLÁSSICOS", "CLASSICOS",
  "ATUALIZADO", "ATUALIZADA", "ROMÂNTICAS", "ROMANTICAS",
  "FESTA", "BALADA", "VERÃO", "VERAO", "SOFRÊNCIA", "SOFRENCIA",
]);
const TITLE_FILLER = new Set([
  // artigos / conectivos
  "DE", "DO", "DA", "DOS", "DAS", "E", "A", "O", "OS", "AS", "PARA", "PRA",
  "EM", "COM", "POR", "QUE", "UM", "UMA", "NO", "NA", "NOS", "NAS", "AO", "AOS",
  // descritivos fracos
  "PLAYLIST", "OFICIAL", "SELEÇÃO", "SELECAO",
  "COLETÂNEA", "COLETANEA", "COLEÇÃO", "COLECAO", "MIX",
  // ruído promocional
  "SÓ", "SO", "AGORA", "ESCUTAR", "OUVIR", "TOCAR", "CURTIR",
  "MELHORES", "MELHOR", "TODAS", "TODOS", "MAIS", "TOCADAS", "TOCADOS",
  // inglês comum
  "THE", "OF", "FOR", "TO", "AND", "OFFICIAL",
]);

function isYearOrNumber(t: string): boolean {
  return /^\d{2,4}$/.test(t);
}

function tierOf(t: string): 0 | 1 | 2 | 3 | 4 {
  if (TITLE_FILLER.has(t)) return 0;
  if (TIER1_WORDS.has(t) || isYearOrNumber(t)) return 1;
  if (TIER2_WORDS.has(t)) return 2;
  if (TIER3_WORDS.has(t)) return 3;
  return 4; // outras palavras com 3+ letras
}

// Listas controladas para os 3 formatos
const STRONG_WORDS = ["TOP", "HITS", "VIRAL"] as const;
const VARIATION_WORDS = ["RAIZ", "CLÁSSICO", "ATUAL"] as const;
// Mapeia palavra detectada no input → variação canônica permitida
const VARIATION_ALIASES: Record<string, string> = {
  "RAIZ": "RAIZ",
  "CLÁSSICO": "CLÁSSICO", "CLASSICO": "CLÁSSICO",
  "CLÁSSICOS": "CLÁSSICO", "CLASSICOS": "CLÁSSICO",
  "ATUAL": "ATUAL", "ATUALIZADO": "ATUAL", "ATUALIZADA": "ATUAL",
  "NOSTALGIA": "CLÁSSICO",
  "MANDELÃO": "MANDELÃO", "MANDELAO": "MANDELÃO",
};

function canonicalGenre(input: string | null | undefined): string | null {
  const v = (input ?? "").toString().trim().toUpperCase();
  if (!v) return null;
  if (v.includes("FUNK")) return "FUNK";
  if (v.includes("SERTANEJO")) return "SERTANEJO";
  if (v.includes("TRAP")) return "TRAP";
  if (v.includes("PAGODE")) return "PAGODE";
  if (v.includes("FORRÓ") || v.includes("FORRO")) return "FORRÓ";
  if (v.includes("SAMBA")) return "SAMBA";
  if (v.includes("POP")) return "POP";
  if (v.includes("ROCK")) return "ROCK";
  if (v.includes("RAP")) return "RAP";
  if (v.includes("PISEIRO")) return "PISEIRO";
  return v;
}

function strongWordsForGenre(genre: string | null): readonly string[] {
  if (genre === "SERTANEJO") return ["MODÃO", "TOP", "HITS"] as const;
  if (genre === "FUNK") return ["HITS", "TOP", "VIRAL"] as const;
  return STRONG_WORDS;
}
// Hash determinístico simples (djb2) para escolher formato a partir do nome
function hashString(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
// Distribuição alvo: 70% F1, 20% F2, 10% F3
function pickFormat(seed: string): 1 | 2 | 3 {
  const bucket = hashString(seed) % 100;
  if (bucket < 70) return 1;
  if (bucket < 90) return 2;
  return 3;
}

function sanitizePlaylistTitle(
  name: string | null | undefined,
  options?: { genreHint?: string | null; stripYear?: boolean; forceGenre?: boolean },
): string {
  const raw = (name ?? "").toString();
  if (!raw.trim()) return "TOP HITS";

  // 1. Limpa emojis/símbolos e normaliza
  const cleaned = raw
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F2FF}]/gu, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
  if (!cleaned) return "TOP HITS";

  // 2. Tokeniza preservando ordem
  const rawTokens = cleaned.split(" ").filter(Boolean);
  const tokens: string[] = [];
  const seen = new Set<string>();
  for (const t of rawTokens) {
    if (seen.has(t)) continue;
    if (TITLE_FILLER.has(t)) continue;
    if (t.length < 2) continue;
    seen.add(t);
    tokens.push(t);
  }

  // 3. Detecta componentes presentes no input
  const hintedGenre = canonicalGenre(options?.genreHint);
  const detectedStrong = tokens.find((t) => (STRONG_WORDS as readonly string[]).includes(t) || t === "MODÃO") ?? null;
  const tokenGenre = tokens.find((t) => TIER2_WORDS.has(t)) ?? null;
  const detectedGenre = options?.forceGenre && hintedGenre ? hintedGenre : (tokenGenre ?? hintedGenre);
  const detectedYear = options?.stripYear
    ? null
    : tokens.find((t) => isYearOrNumber(t) && /^\d{4}$/.test(t)) ?? null;
  const detectedVariationRaw = tokens.find((t) => VARIATION_ALIASES[t]) ?? null;
  const detectedVariation = detectedVariationRaw ? VARIATION_ALIASES[detectedVariationRaw] : null;

  // 4. Escolhe formato (determinístico por nome) — com fallback inteligente
  let format = pickFormat(raw);
  // Se faltam ingredientes para o formato sorteado, faz fallback coerente
  if (format === 1 && !detectedGenre) format = detectedVariation ? 2 : 3;
  if (format === 2 && !detectedGenre) format = 3;

  // 5. Constrói o título conforme o formato
  const seed = hashString(raw);
  const pickFrom = <T extends readonly string[]>(arr: T, offset = 0): T[number] =>
    arr[(seed + offset) % arr.length];

  let parts: string[] = [];

  if (format === 1) {
    // [FORTE] + [GÊNERO] + [ANO opcional]
    // 🚫 ANO: só usa se a IA tiver passado um ano no nome. NUNCA forçamos default.
    // O ano nas capas vinha hardcoded "2024" — agora respeita 100% o nome do template.
    const strongPool = strongWordsForGenre(detectedGenre);
    const strong = detectedStrong ?? pickFrom(strongPool);
    const genre = detectedGenre!; // garantido pelo fallback
    parts = detectedYear ? [strong, genre, detectedYear] : [strong, genre];
  } else if (format === 2) {
    // [GÊNERO] + [VARIAÇÃO]
    const genre = detectedGenre!;
    const variation = detectedVariation ?? pickFrom(VARIATION_WORDS, 1);
    parts = [genre, variation];
  } else {
    // FORMATO 3 — GANCHO: [FORTE] sozinho ou [FORTE] + [HITS/VIRAL/BRASIL]
    // 🚫 ANO: removido do pool de fallback — só entra se vier do nome original.
    const strong = detectedStrong ?? pickFrom(STRONG_WORDS);
    const tail = detectedYear
      ? detectedYear
      : strong === "HITS"
        ? pickFrom(["VIRAL", "BRASIL", "BR"] as const, 2)
        : "HITS";
    parts = strong === tail ? [strong] : [strong, tail];
  }

  // 6. Sanidade final: dedupe, máx 3 palavras, nunca vazio
  const finalParts: string[] = [];
  for (const p of parts) {
    if (!p) continue;
    if (finalParts.includes(p)) continue;
    finalParts.push(p);
    if (finalParts.length >= 3) break;
  }
  const result = finalParts.join(" ").trim();
  return result.length > 0 ? result : "TOP HITS";
}

// ============================================================
// SUBTEXTO EDITORIAL (frases que comunicam VALOR — nunca decorativas)
// ============================================================
// Estratégia em 2 passos:
//   1. Detecta GÊNERO musical no contexto (brief + nome da playlist)
//   2. Detecta CONTEXTO/MOOD no brief
//   3. Combina em frase editorial (ex: "CLÁSSICOS DO SERTANEJO")
// Se não houver contexto musical claro → retorna null (não força nada).
// PROIBIDO: termos genéricos, palavras decorativas, frases sem valor.

const GENRE_MAP: { match: RegExp; label: string; preposition: "DO" | "DA" | "DOS" }[] = [
  { match: /\bsertanej[oa]s?\b/i,            label: "SERTANEJO",   preposition: "DO" },
  { match: /\bfunk(s|ão|eiros?)?\b/i,        label: "FUNK",        preposition: "DO" },
  { match: /\bpiseiros?\b/i,                 label: "PISEIRO",     preposition: "DO" },
  { match: /\bpagodes?\b/i,                  label: "PAGODE",      preposition: "DO" },
  { match: /\bsambas?\b/i,                   label: "SAMBA",       preposition: "DO" },
  { match: /\bforr[oó]s?\b/i,                label: "FORRÓ",       preposition: "DO" },
  { match: /\brock\b/i,                      label: "ROCK",        preposition: "DO" },
  { match: /\bpop\b/i,                       label: "POP",         preposition: "DO" },
  { match: /\brap\b/i,                       label: "RAP",         preposition: "DO" },
  { match: /\btraps?\b/i,                    label: "TRAP",        preposition: "DO" },
  { match: /\bmpb\b/i,                       label: "MPB",         preposition: "DA" },
  { match: /\breggaes?\b/i,                  label: "REGGAE",      preposition: "DO" },
  { match: /\bgospel\b/i,                    label: "GOSPEL",      preposition: "DO" },
  { match: /\belectr[oô]nicas?|eletr[oô]nicas?|edm|house\b/i, label: "ELETRÔNICA", preposition: "DA" },
];

// Contextos detectáveis → frase pronta (sem gênero) OU template (com gênero)
type ContextRule =
  | { match: RegExp; standalone: string }                                   // frase fixa quando NÃO há gênero
  | { match: RegExp; standalone: string; withGenre: (g: string, prep: string) => string }; // muda quando há gênero

const CONTEXT_RULES: ContextRule[] = [
  // hits / sucessos
  { match: /\b(mais\s+tocad[oa]s?|tocad[oa]s?|sucessos?)\b/i,
    standalone: "AS MAIS TOCADAS",
    withGenre: (g) => `SUCESSOS DO ${g}` },
  // clássicos / atemporais
  { match: /\b(cl[aá]ssic[oa]s?|atemporais?)\b/i,
    standalone: "OS CLÁSSICOS",
    withGenre: (g, p) => `CLÁSSICOS ${p} ${g}` },
  // raiz / tradicional
  { match: /\b(raiz|tradicional|raízes?|raizes)\b/i,
    standalone: "RAIZ DO BRASIL",
    withGenre: (g, p) => `RAIZ ${p} ${g}` },
  // momento / agora / atual
  { match: /\b(do\s+momento|agora|atual|atualizad[oa]s?|recentes?)\b/i,
    standalone: "SUCESSOS DO MOMENTO",
    withGenre: (g) => `${g} DO MOMENTO` },
  // novidades / lançamentos
  { match: /\b(novidades?|lan[cç]amentos?|fresh|nov[oa]s?)\b/i,
    standalone: "NOVIDADES",
    withGenre: (g) => `${g} NOVO` },
  // viral
  { match: /\b(viral|viralizou|tiktok|trending)\b/i,
    standalone: "VIRAL AGORA",
    withGenre: (g) => `${g} VIRAL` },
  // top
  { match: /\b(top\s+brasil|brasil|nacional|br\b)/i,
    standalone: "TOP BRASIL",
    withGenre: (g) => `TOP ${g}` },
  // nostalgia / antigas
  { match: /\b(nost[aá]lgic[oa]?|nostalgia|saudade|antigas?|relíquia|reliquia)\b/i,
    standalone: "NOSTALGIA PURA",
    withGenre: (g, p) => `NOSTALGIA ${p} ${g}` },
  // romance
  { match: /\b(rom[aâ]ntic[oa]s?|romance|amor|paix[aã]o)\b/i,
    standalone: "SÓ ROMANCE",
    withGenre: (g) => `${g} ROMÂNTICO` },
  // sofrência
  { match: /\b(sofr[eê]ncia|chorar|término|termino)\b/i,
    standalone: "SOFRÊNCIA",
    withGenre: (g) => `${g} SOFRÊNCIA` },
  // festa
  { match: /\b(festa|balada|agitad[oa]s?|pra\s+dan[cç]ar)\b/i,
    standalone: "MODO FESTA",
    withGenre: (g) => `${g} NA FESTA` },
  // verão
  { match: /\b(ver[aã]o|praia|viagem|piscina)\b/i,
    standalone: "VIBE DE VERÃO",
    withGenre: (g) => `${g} DE VERÃO` },
  // chill / relax
  { match: /\b(relax|calm[oa]|chill|tranquilo|leve)\b/i,
    standalone: "MODO CHILL",
    withGenre: (g) => `${g} LEVE` },
];

function detectGenre(text: string): { label: string; preposition: string } | null {
  for (const g of GENRE_MAP) {
    if (g.match.test(text)) return { label: g.label, preposition: g.preposition };
  }
  return null;
}

function extractSubtext(
  brief: string | null | undefined,
  playlistName: string | null | undefined = null,
): string | null {
  const briefText = (brief ?? "").toString().trim();
  const nameText = (playlistName ?? "").toString().trim();
  // Procura gênero em ambos (brief tem prioridade), contexto APENAS no brief.
  const genreSrc = `${briefText} ${nameText}`.trim();
  if (briefText.length < 4 && nameText.length < 3) return null;

  const genre = detectGenre(genreSrc);

  // procura contexto no brief
  for (const rule of CONTEXT_RULES) {
    if (!rule.match.test(briefText)) continue;
    if (genre && "withGenre" in rule) {
      return rule.withGenre(genre.label, genre.preposition).toUpperCase().trim();
    }
    return rule.standalone;
  }

  // sem contexto explícito → só usa subtítulo se houver GÊNERO claro
  // (assim "CLÁSSICOS DO SERTANEJO" só aparece com contexto; gênero sozinho não vira subtítulo)
  return null;
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
// ACABAMENTO PREMIUM (compartilhado pelos 3 estilos)
// Adiciona profundidade/relevo SEM mudar layout, tipografia ou hierarquia.
// Tudo deve ser SUTIL — quase imperceptível, nunca chamativo.
// ============================================================
const PREMIUM_FINISH_BLOCK = [
  "PREMIUM FINISH (subtle depth — never strong or flashy):",
  "- Background depth: subtle radial light from center (very soft, almost imperceptible glow). Center slightly more illuminated than edges. Still only 2 base colors — no third color, no extra hue.",
  "- Surface relief: very faint embossed feeling, soft inner highlight on the top inner edge and a soft inner shadow on the bottom inner edge. Premium material feel, NOT a thick frame.",
  "- Inner border: extremely thin (1–2px) soft inner border with a subtle light reflection — like a refined card edge. Same hue family as the palette, low opacity.",
  "- Text finish: clean bold text with a VERY subtle drop shadow (low opacity, tight offset, soft blur) and an almost imperceptible top highlight on the letters. Text must remain ultra readable — depth is felt, not seen.",
  "- NO brand signature, NO watermark, NO wordmark, NO \"NEXENGINE\" text, NO logo of any kind anywhere on the cover. The surface stays completely clean — no signature text, no initials, no copyright mark, no watermark in any corner. The only text allowed is the title (and subtitle, if any).",
  "INTENSITY RULE (CRITICAL): all of the above must be SUBTLE, ELEGANT, ALMOST IMPERCEPTIBLE.",
  "STRICTLY FORBIDDEN inside premium finish: strong glow, heavy shadows, neon effects, glossy plastic look, 3D bevels, flashy reflections, any effect that pulls attention away from the text.",
].join("\n");

// ============================================================
// LAYOUT RULES (compartilhado pelos 3 estilos)
// Controla APENAS spacing e alinhamento — NÃO altera texto, cor, fonte ou efeitos.
// ============================================================
const LAYOUT_RULES_BLOCK = [
  "LAYOUT RULES (spacing & alignment — STRICT):",
  "- Internal padding: exactly 12% of the canvas on every side (top, bottom, left, right). No text or element ever bleeds into this safe area.",
  "- Title block occupies about 65% of the usable area (the area inside the 12% padding). Never fills 100%.",
  "- Subtitle is about 30% of the title size — clear visual hierarchy.",
  "- Vertical placement: title sits slightly ABOVE the geometric center (visual/optical center, around 46–48% from the top), so it feels balanced to the human eye, not just mathematically centered. The optical lift is small (roughly 2–4px on a 1024 canvas) — never a dramatic shift.",
  "- Subtitle sits below the title with a FIXED, constant gap of about 6–7% of canvas height — same gap on every cover, never floating loose.",
  "- Title line-height tight: between 0.88 and 0.94 (editorial, cohesive — lines feel like one block, not separated).",
  "- Subtitle line-height: about 1.15–1.2 (slightly looser than title but still controlled).",
  "- Horizontal centering must be OPTICAL, not just mathematical: equal visual weight on left and right, accounting for letter shapes and punctuation.",
  "- Equal left/right margins. No element off-balance unless the style explicitly allows asymmetry.",
  "- Consistent, intentional spacing — the layout must feel calm, professional and editorial.",
].join("\n");

// ============================================================
// MICRO-ALIGNMENT RULES — invisible grid for premium finishing.
// Apenas POSIÇÃO e ESPAÇAMENTO. Não muda texto, tamanho, hierarquia ou cor.
// ============================================================
const MICRO_ALIGNMENT_BLOCK = [
  "MICRO-ALIGNMENT & INVISIBLE GRID (premium finishing — STRICT):",
  "- Use an invisible 8px baseline grid: every text element snaps to it. No floating, no off-grid drift.",
  "- Optical centering correction: lift the whole text block 2–4px above the geometric center so it READS as centered (compensating for descenders and visual weight).",
  "- Title and subtitle must share the SAME optical center axis — perfectly stacked, no horizontal drift between lines.",
  "- Line-to-line spacing inside the title is tight and consistent — multi-line titles must feel like ONE cohesive block, never two separate lines.",
  "- Subtitle is locked to the title with a FIXED gap (about 6–7% of canvas height). Never visually floating, never glued.",
  "- Across all covers in the same set: identical perceived width, identical perceived height, identical perceived position. Same visual rhythm everywhere.",
  "- No element may shift more than a few pixels from its grid slot. Position changes are micro, not macro.",
  "- Letter-spacing on the title kept consistent — no stretched or compressed characters to fit the box.",
  "- Final feeling: calm, locked-in, professional, high-end editorial finishing.",
].join("\n");

// ============================================================
// HIERARCHY RULES (compartilhado pelos 3 estilos)
// Controla APENAS hierarquia e tamanho relativo — NÃO altera tipografia, cor ou estilo.
// ============================================================
const HIERARCHY_RULES_BLOCK = [
  "HIERARCHY & SCALE RULES (STRICT — same standard across every cover):",
  "- There is ALWAYS exactly ONE dominant element (the main title). It is clearly the largest piece of text on the canvas.",
  "- The secondary element (subtitle / secondary line) is at MOST 40% of the dominant element's size. Never close to the same size.",
  "- Two elements with similar size COMPETING for attention is STRICTLY FORBIDDEN — the eye must immediately know what to read first.",
  "- Main title: large, prominent, optically centered. It is the visual anchor of the cover.",
  "- Secondary text: clearly smaller, placed below (or above) the title with strong, obvious size contrast.",
  "- No text element may be too small to read at a 64x64 thumbnail — if it cannot be read, it should not exist.",
  "- Visual weight must feel CONSISTENT across all generated covers (same dominant/secondary ratio every time).",
  "NUMBER INTEGRITY (CRITICAL):",
  "- Numbers (especially years) must NEVER be broken across lines or split into parts (e.g. \"20\" / \"26\" is FORBIDDEN).",
  "- Years and multi-digit numbers always render as a single, unbroken token on the same line.",
  "- If the layout cannot fit the full number on one line, shrink the number slightly or rebalance the title — never split the digits.",
].join("\n");


// ============================================================
// PROMPT BUILDERS — 1 por estilo
// ============================================================
function buildCleanPrompt(template: any, palette: typeof PALETTES[number], index = 0): string {
  const name = sanitizePlaylistTitle(template.name, template.__promptOptions);
  const subtext = extractSubtext(template.__cover_brief_override ?? template.cover_brief, name);

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
    LAYOUT_RULES_BLOCK,
    "",
    HIERARCHY_RULES_BLOCK,
    "",
    MICRO_ALIGNMENT_BLOCK,
    "",
    "VARIATION (subtle, this card only):",
    variationHints(index),
    "",
    PREMIUM_FINISH_BLOCK,
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
    "- No icons, no objects, no instruments, no musical notes, no logos, no wordmarks of any kind",
    "- No textures, no noise, no grain, no vignette",
    "- No STRONG shadows, no STRONG glow, no neon, no chromatic effects (the subtle premium finish above is the ONLY allowed depth)",
    "- No perspective, no rotation, no tilt",
    "- No additional text beyond title and subtitle. NO signature, NO watermark, NO \"NEXENGINE\", NO brand mark anywhere",
    "- No decorative elements",
    "- No more than 2 colors in background",
    "",
    "SPELLING:",
    "- Text must be EXACTLY as provided above — no typos, no variations, no stylization of letters",
  ].join("\n");
}

function buildViralHitsPrompt(template: any, palette: typeof PALETTES[number], index = 0): string {
  const sanitized = sanitizePlaylistTitle(template.name, template.__promptOptions);
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
    LAYOUT_RULES_BLOCK,
    "",
    HIERARCHY_RULES_BLOCK,
    "",
    MICRO_ALIGNMENT_BLOCK,
    "",
    "VARIATION (subtle, this card only):",
    variationHints(index),
    "",
    PREMIUM_FINISH_BLOCK,
    "",
    "COMPOSITION:",
    "- Centered with confident editorial weight — NOT chaotic",
    "- Very subtle tilt allowed (max 3°), or perfectly straight",
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
    "- No complex scenes, no landscapes, no instruments, no musical notes, no logos, no wordmarks of any kind",
    "- No additional text beyond what is specified above. NO signature, NO watermark, NO \"NEXENGINE\", NO brand mark anywhere",
    "- No watermarks, no signatures, no copyright marks, no initials in any corner",
    "- No STRONG shadows, no STRONG glow, no neon (the subtle premium finish above is the ONLY allowed depth)",
    "- No gradients with more than 2 colors, no grain, no vignette",
  ].join("\n");
}

function buildDynamicPrompt(template: any, palette: typeof PALETTES[number], index = 0): string {
  const sanitized = sanitizePlaylistTitle(template.name, template.__promptOptions);
  const { dominant, secondary } = pickDominantWord(sanitized);
  const subtext = extractSubtext(template.__cover_brief_override ?? template.cover_brief, sanitized);

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
    LAYOUT_RULES_BLOCK,
    "",
    HIERARCHY_RULES_BLOCK,
    "",
    MICRO_ALIGNMENT_BLOCK,
    "",
    "VARIATION (subtle, this card only):",
    variationHints(index),
    "",
    PREMIUM_FINISH_BLOCK,
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
    "- No icons, no objects, no instruments, no musical notes, no logos, no wordmarks of any kind",
    "- No textures, no noise, no grain, no vignette",
    "- No STRONG drop shadows, no STRONG glow, no chromatic effects (the subtle premium finish above is the ONLY allowed depth)",
    "- No perspective, no 3D",
    "- No additional text beyond what is specified above. NO signature, NO watermark, NO \"NEXENGINE\", NO brand mark anywhere",
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
    if (resp.status === 402) {
      const err: any = new Error(`AI 402: ${t.slice(0, 500)}`);
      err.code = "AI_PAYMENT_REQUIRED";
      err.status = 402;
      err.details = t;
      throw err;
    }
    if (resp.status === 429) {
      const err: any = new Error(`AI 429: ${t.slice(0, 500)}`);
      err.code = "AI_RATE_LIMITED";
      err.status = 429;
      err.details = t;
      throw err;
    }
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
  const __dep = await deprecationGate(req, "generate-cover-variations");
  if (__dep) return __dep;
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jr({ error: "POST only" }, 405);

  // 🔐 Exige service_role (chamada interna) ou usuário admin/curador
  const { requireTeamAccess } = await import("../_shared/auth.ts");
  const guard = await requireTeamAccess(req);
  if (!guard.ok) return guard.resp;

  let body: { template_id?: string; custom_prompt?: string; palette?: string; force?: boolean };
  try { body = await req.json(); } catch { return jr({ error: "invalid json" }, 400); }
  if (!body.template_id) return jr({ error: "template_id required" }, 400);

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: tpl, error: tplErr } = await supabase
    .from("playlist_templates").select("*").eq("id", body.template_id).maybeSingle();
  if (tplErr || !tpl) return jr({ error: "template not found" }, 404);
  const { data: genreRow } = await supabase
    .from("genres")
    .select("nome")
    .eq("id", tpl.genre_id)
    .maybeSingle();

  // 🎨 DNA visual do gênero (cores dominantes, estilo, atmosfera) — injetado no prompt
  // pra capa não ignorar o aprendizado do analyze-genre-visual-dna.
  let dnaVisual: any = null;
  if (tpl.genre_id) {
    const { data: gm } = await supabase
      .from("genre_models")
      .select("insights")
      .eq("genre_id", tpl.genre_id)
      .maybeSingle();
    dnaVisual = (gm?.insights as any)?.dna_visual ?? null;
  }


  // 🛡️ Proteção: NUNCA regenerar capa de playlist já publicada no Spotify.
  // Mesmo com force=true. Quem está no ar fica como está.
  if (body.force && tpl.spotify_playlist_id) {
    return jr({
      ok: false,
      error: "Não é possível regenerar capa de playlist já publicada no Spotify",
    }, 409);
  }

  const ts = Date.now();

  // 🎯 ESCOLHA DA PALETA:
  // - Se body.palette vier → gera SÓ aquela cor (sob demanda, 1 crédito).
  // - Senão → paleta padrão determinística por template_id (1ª geração).
  let palette = body.palette
    ? PALETTES.find((p) => p.name === body.palette)
    : null;
  if (!palette) {
    const paletteIdx = hashString(tpl.id) % PALETTES.length;
    palette = PALETTES[paletteIdx];
  }
  const style: Style = "clean";

  // 📦 Cache acumulativo: NÃO apaga variações antigas. Se a paleta solicitada
  // já existir em cover_variations, devolve direto (0 crédito gasto).
  // 🔄 EXCEÇÃO: force=true ignora o cache E LIMPA todas as variações antigas
  //   (caso de uso: capa antiga com "2024" hardcoded — quero regenerar do zero).
  const existingRaw = (tpl.cover_variations as Array<{ index: number; url: string; palette?: string; style?: Style }> | null) ?? [];
  const existing = body.force ? [] : existingRaw;
  if (!body.force) {
    const cached = existing.find((v) => v.palette === palette.name);
    if (cached) {
      return jr({
        ok: true,
        cached: true,
        variation: cached,
        variations: existing,
        palette_used: palette.name,
      });
    }
  }

  // 🆕 Gera só essa cor
  // force=true = regeneração corretiva: usa o gênero do template como verdade,
  // ignora ano legado do nome e evita contaminar a capa com briefing antigo.
  const promptTemplate = {
    ...tpl,
    __promptOptions: {
      genreHint: genreRow?.nome ?? null,
      stripYear: Boolean(body.force),
      forceGenre: Boolean(body.force),
    },
    __cover_brief_override: body.force ? null : tpl.cover_brief,
  };
  const prompt = buildPrompt(promptTemplate, palette, style, 0, body.custom_prompt);
  let dataUrl: string;
  try {
    dataUrl = await generateOne(prompt);
  } catch (e: any) {
    console.error(`geração falhou (${palette.name}/${style}):`, e);
    if (e?.code === "AI_PAYMENT_REQUIRED") {
      return jr({
        ok: false,
        fallback: true,
        code: "AI_PAYMENT_REQUIRED",
        error: "Sem créditos de IA. Adicione saldo em Settings → Workspace → Usage para gerar novas capas.",
      }, 200);
    }
    if (e?.code === "AI_RATE_LIMITED") {
      return jr({
        ok: false,
        fallback: true,
        code: "AI_RATE_LIMITED",
        error: "Muitas requisições à IA. Aguarde alguns segundos e tente novamente.",
      }, 200);
    }
    return jr({ ok: false, error: `Falha ao gerar capa: ${e instanceof Error ? e.message : String(e)}` }, 500);
  }

  let newVariation: { index: number; url: string; palette: string; style: Style };
  try {
    const { bytes: rawBytes } = dataUrlToBytes(dataUrl);
    const wm = await applyWatermark(rawBytes);
    const finalType = wm.contentType;
    const ext = finalType.split("/")[1].replace("+xml", "");
    // path inclui paleta → arquivos não colidem, fácil de auditar
    const path = `${tpl.id}/${palette.name}-${ts}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from("playlist-covers")
      .upload(path, wm.bytes, { contentType: finalType, upsert: true });
    if (upErr) {
      console.error("upload err:", upErr);
      return jr({ ok: false, error: `Falha no upload: ${upErr.message}` }, 500);
    }
    const { data: pub } = supabase.storage.from("playlist-covers").getPublicUrl(path);
    // próximo index disponível
    const nextIndex = existing.length > 0 ? Math.max(...existing.map((v) => v.index)) + 1 : 0;
    newVariation = {
      index: nextIndex,
      url: pub.publicUrl,
      palette: palette.name,
      style,
    };
  } catch (e) {
    console.error("processing err:", e);
    return jr({ ok: false, error: `Falha no processamento: ${e instanceof Error ? e.message : String(e)}` }, 500);
  }

  // Adiciona ao cache (preserva as outras paletas já geradas).
  // Em modo force=true, `existing` já foi zerado no início do handler,
  // então `updatedVariations` contém só a capa nova — capa antiga é descartada.
  const updatedVariations = [...existing, newVariation];

  const updatePayload: Record<string, unknown> = {
    cover_variations: updatedVariations,
    cover_generated_at: new Date().toISOString(),
    auto_cover_requested: false,
  };
  // Se foi um force-regen, já seleciona a capa nova como ativa
  // (a antiga em cover_image_url ficaria pendurada caso contrário).
  if (body.force) {
    updatePayload.cover_image_url = newVariation.url;
    updatePayload.cover_selected_index = newVariation.index;
  }
  await supabase.from("playlist_templates").update(updatePayload).eq("id", tpl.id);

  return jr({
    ok: true,
    cached: false,
    variation: newVariation,
    variations: updatedVariations,
    palette_used: palette.name,
  });
});
