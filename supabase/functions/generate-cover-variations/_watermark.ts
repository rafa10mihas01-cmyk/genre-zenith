// _watermark.ts — Compositor de marca d'água + acabamento premium NexEngine.
//
// Pipeline (na ordem):
//   1. Decode da capa gerada pelo AI (PNG/JPG)
//   2. PREMIUM FINISH (preserva 100% layout/typo/cores; só adiciona "vida" à superfície):
//        a. Soft radial glow central (centro +luz, bordas levemente -luz) — vinheta inversa sutil
//        b. Grain quase invisível (textura de superfície, evita o look "flat plástico")
//        c. Inner border refinada (highlight 1px + sombra 1px logo abaixo)
//   3. Watermark NexEngine (logo oficial monocromático, canto inferior direito, adaptativo)
//   4. Encode PNG final
//
// Tudo é fail-safe: cada etapa tem try/catch e nunca quebra a capa.
//
// Constantes calibradas para "premium discreto" — ajustar com extremo cuidado.

import { Image } from "https://deno.land/x/imagescript@1.2.17/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

// ============================================================
// WATERMARK
// 🔐 Audit #14 F2C: logos servidos do bucket PRIVADO `brand-assets`
// via Supabase SDK (download autenticado com service role).
// Fix Audit #15: fetch direto retornava 400; SDK trata auth corretamente.
// ============================================================
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOGO_WHITE_PATH = "_brand/nexengine-mono-white.png";
const LOGO_BLACK_PATH = "_brand/nexengine-mono-black.png";
const BRAND_BUCKET = "brand-assets";

const _storageClient = createClient(SUPABASE_URL, SRK, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Logo NexEngine — assinatura visível da marca (canto inferior direito).
// Restaurado: logo branco/preto puro, bem legível, com sombra de profundidade.
// Referência: capa "MODÃO SERTANEJO 2024" (verde) — logo claro e identificável.
const LOGO_WIDTH_PCT     = 0.11;  // 11% da largura — presença clara como assinatura
const MARGIN_PCT         = 0.06;  // 6% das bordas
const LOGO_OPACITY       = 0.55;  // 55% — VISÍVEL como marca, sem competir com título
// Sombra de profundidade (drop shadow sutil) — destaca o logo do fundo:
const DEBOSS_SHADOW_A    = 0.35;  // sombra escura mais forte (pop visual)
const DEBOSS_HIGHLIGHT_A = 0.0;   // sem highlight inferior (estilo logo flat sobre fundo)
const LOGO_TINT_SHIFT    = 0;     // SEM tint — logo em branco/preto puro

// ============================================================
// PREMIUM FINISH — calibração visual
// ============================================================
// Radial glow — ASSINATURA VISUAL DA MARCA + sensação de material premium.
// Posição FIXA ligeiramente acima do centro (peso óptico para texto/título),
// intensidade ÚNICA em todas as capas. Centro mais iluminado, bordas levemente
// escurecidas → superfície deixa de parecer flat e ganha "corpo".
const GLOW_CENTER_BOOST   = 10;    // ganho de luz no centro (0-255). 10 = ~+4% L (presente mas sutil)
const GLOW_EDGE_DARKEN    = 16;    // escurecimento nas bordas (0-255). 16 = ~-6% L (vinheta material)
const GLOW_RADIUS_PCT     = 0.55;  // raio do highlight central (transição mais suave)
const GLOW_CENTER_X_PCT   = 0.50;  // X do glow: 50% (centro horizontal exato)
const GLOW_CENTER_Y_PCT   = 0.42;  // Y do glow: 42% (ligeiramente acima do centro — assinatura)

// Grain — textura de superfície (não digital flat).
// Levemente colorido por canal (não monocromático) → simula grão de papel/película.
const GRAIN_AMPLITUDE     = 5;    // ±5 luma. Quase imperceptível, mas tira o look "render"
const GRAIN_CHROMA        = 1.5;  // ±1.5 extra por canal RGB (variação cromática microscópica)
const GRAIN_SEED          = 0x9E3779B1; // golden-ratio-ish (mulberry32) — determinístico

// Inner border — ASSINATURA VISUAL (mesma em TODAS as capas, sem variação).
// 1px highlight (claro) + 1px sombra (escuro) logo abaixo, posição fixa.
const BORDER_INSET_PCT    = 0.014; // 1.4% da largura → ~14px em 1024 (respiro consistente)
const BORDER_HIGHLIGHT_A  = 28;    // ~11% — traço claro discreto
const BORDER_SHADOW_A     = 36;    // ~14% — traço escuro discreto, levemente mais forte (peso óptico)

// ============================================================
// LOGO CACHE
// ============================================================
let cachedWhite: Image | null = null;
let cachedBlack: Image | null = null;

async function loadLogo(path: string): Promise<Image> {
  const { data, error } = await _storageClient.storage.from(BRAND_BUCKET).download(path);
  if (error || !data) throw new Error(`logo download failed: ${path} — ${error?.message ?? "no data"}`);
  const buf = new Uint8Array(await data.arrayBuffer());
  return await Image.decode(buf);
}

async function getLogos(): Promise<{ white: Image; black: Image }> {
  if (!cachedWhite) cachedWhite = await loadLogo(LOGO_WHITE_PATH);
  if (!cachedBlack) cachedBlack = await loadLogo(LOGO_BLACK_PATH);
  return { white: cachedWhite.clone(), black: cachedBlack.clone() };
}

// ============================================================
// LUMINANCE + AVG COLOR (pra escolher e tonalizar a watermark)
// ============================================================
function regionStats(img: Image, x: number, y: number, w: number, h: number): {
  lum: number; r: number; g: number; b: number;
} {
  let tr = 0, tg = 0, tb = 0, total = 0, count = 0;
  const stepX = Math.max(1, Math.floor(w / 8));
  const stepY = Math.max(1, Math.floor(h / 8));
  for (let py = y; py < y + h && py < img.height; py += stepY) {
    for (let px = x; px < x + w && px < img.width; px += stepX) {
      const pixel = img.getPixelAt(px + 1, py + 1);
      const r = (pixel >>> 24) & 0xff;
      const g = (pixel >>> 16) & 0xff;
      const b = (pixel >>> 8) & 0xff;
      tr += r; tg += g; tb += b;
      total += 0.2126 * r + 0.7152 * g + 0.0722 * b;
      count++;
    }
  }
  if (count === 0) return { lum: 128, r: 128, g: 128, b: 128 };
  return { lum: total / count, r: tr / count, g: tg / count, b: tb / count };
}

// ============================================================
// PREMIUM FINISH — single-pass pixel walker
// ============================================================
// Faz radial glow + grain numa única varredura por motivos de performance.
// Edita os pixels do `img` IN-PLACE.
function applyPremiumFinish(img: Image): void {
  const W = img.width;
  const H = img.height;

  // Centro geométrico (usado pra vinheta de borda — consistente em qualquer aspecto)
  const cx = W / 2;
  const cy = H / 2;
  const maxDist = Math.sqrt(cx * cx + cy * cy);

  // Centro do GLOW radial — FIXO ligeiramente acima do centro (assinatura visual)
  const gx = W * GLOW_CENTER_X_PCT;
  const gy = H * GLOW_CENTER_Y_PCT;
  const glowRadius = maxDist * GLOW_RADIUS_PCT;

  // Mulberry32 PRNG — determinístico (mesma capa = mesmo grain a cada re-encode)
  let seed = GRAIN_SEED >>> 0;
  const rand = () => {
    seed = (seed + 0x6D2B79F5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v) | 0;

  const buf = img.bitmap;
  for (let y = 0; y < H; y++) {
    const dyEdge = y - cy;       // p/ vinheta (centro geométrico)
    const dyGlow = y - gy;       // p/ glow assinatura (centro deslocado)
    for (let x = 0; x < W; x++) {
      const dxEdge = x - cx;
      const dxGlow = x - gx;

      // Vinheta de borda: usa distância ao centro geométrico (consistência radial)
      const distEdge = Math.sqrt(dxEdge * dxEdge + dyEdge * dyEdge);
      const tE = Math.min(1, distEdge / maxDist);
      const sE = tE * tE * (3 - 2 * tE); // smoothstep
      const edgeDarken = GLOW_EDGE_DARKEN * sE;

      // Glow assinatura: posição fixa acima do centro, intensidade única
      const distGlow = Math.sqrt(dxGlow * dxGlow + dyGlow * dyGlow);
      const centerFactor = Math.max(0, 1 - distGlow / glowRadius);
      const centerBoost = GLOW_CENTER_BOOST * centerFactor * centerFactor;

      const lightDelta = centerBoost - edgeDarken;

      // Grain orgânico: luma comum + microvariação cromática por canal.
      // Simula textura de material real (papel/película), não ruído digital.
      const grainLuma = (rand() - 0.5) * 2 * GRAIN_AMPLITUDE;
      const grainR = grainLuma + (rand() - 0.5) * 2 * GRAIN_CHROMA;
      const grainG = grainLuma + (rand() - 0.5) * 2 * GRAIN_CHROMA;
      const grainB = grainLuma + (rand() - 0.5) * 2 * GRAIN_CHROMA;

      const i = (y * W + x) * 4;
      buf[i]     = clamp(buf[i]     + lightDelta + grainR);
      buf[i + 1] = clamp(buf[i + 1] + lightDelta + grainG);
      buf[i + 2] = clamp(buf[i + 2] + lightDelta + grainB);
      // alpha intocado
    }
  }
}

// ============================================================
// INNER BORDER refinada (highlight + sombra)
// ============================================================
// Desenha 2 traços de 1px concêntricos a `inset` da borda:
//   • externo: highlight branco translúcido
//   • interno (1px abaixo): sombra preta translúcida
// Resultado: micro-bevel premium, tipo card de produto.
function drawInnerBorder(img: Image): void {
  const W = img.width;
  const H = img.height;
  const inset = Math.max(2, Math.round(W * BORDER_INSET_PCT));
  const buf = img.bitmap;

  const blendOver = (i: number, r: number, g: number, b: number, a: number) => {
    // a em [0..255]; blend "src over dst" preservando alpha do dst
    const af = a / 255;
    buf[i]     = (buf[i]     * (1 - af) + r * af) | 0;
    buf[i + 1] = (buf[i + 1] * (1 - af) + g * af) | 0;
    buf[i + 2] = (buf[i + 2] * (1 - af) + b * af) | 0;
  };

  // helper para desenhar UM rect oco de 1px de espessura na posição `pad`
  const strokeRect = (pad: number, r: number, g: number, b: number, a: number) => {
    if (pad < 0 || pad >= Math.min(W, H) / 2) return;
    const x0 = pad, x1 = W - 1 - pad;
    const y0 = pad, y1 = H - 1 - pad;
    // top + bottom
    for (let x = x0; x <= x1; x++) {
      blendOver((y0 * W + x) * 4, r, g, b, a);
      blendOver((y1 * W + x) * 4, r, g, b, a);
    }
    // left + right (sem repetir cantos)
    for (let y = y0 + 1; y <= y1 - 1; y++) {
      blendOver((y * W + x0) * 4, r, g, b, a);
      blendOver((y * W + x1) * 4, r, g, b, a);
    }
  };

  // Highlight (mais externo)
  strokeRect(inset, 255, 255, 255, BORDER_HIGHLIGHT_A);
  // Sombra (1px para dentro)
  strokeRect(inset + 1, 0, 0, 0, BORDER_SHADOW_A);
}

// ============================================================
// MAIN — aplica acabamento premium + watermark
// ============================================================
export async function applyWatermark(coverBytes: Uint8Array): Promise<{
  bytes: Uint8Array;
  contentType: string;
  applied: boolean;
  reason?: string;
}> {
  try {
    const cover = await Image.decode(coverBytes);

    // 1. Premium finish (radial glow + grain)
    try { applyPremiumFinish(cover); }
    catch (e) { console.warn("[premium-finish] pulou:", e); }

    // 2. Inner border refinada
    try { drawInnerBorder(cover); }
    catch (e) { console.warn("[inner-border] pulou:", e); }

    // 3. Watermark "gravada" — emboss + tint adaptado ao fundo
    const { white, black } = await getLogos();
    const targetWidth = Math.round(cover.width * LOGO_WIDTH_PCT);
    const margin = Math.round(cover.width * MARGIN_PCT);

    const sampleX = Math.max(0, cover.width - targetWidth - margin);
    const sampleY = Math.max(0, cover.height - Math.round(targetWidth * 0.5) - margin);
    const sampleW = Math.min(cover.width - sampleX, targetWidth);
    const sampleH = Math.min(cover.height - sampleY, Math.round(targetWidth * 0.5));
    const stats = regionStats(cover, sampleX, sampleY, sampleW, sampleH);
    const isDarkBg = stats.lum < 128;

    // Logo base (branco para fundo escuro, preto para fundo claro)
    const baseLogo = isDarkBg ? white : black;
    const aspect = baseLogo.height / baseLogo.width;
    const targetHeight = Math.round(targetWidth * aspect);

    // Logo em branco puro (fundo escuro) ou preto puro (fundo claro).
    // Sem tint: assinatura nítida e consistente, como nas capas de referência.
    const tintR = isDarkBg ? 255 : 0;
    const tintG = isDarkBg ? 255 : 0;
    const tintB = isDarkBg ? 255 : 0;

    // Helper: cria uma cópia do logo já redimensionada, com cor uniforme + opacidade.
    // Preserva o canal alpha original (mantém o desenho), só substitui RGB.
    const makeTintedLogo = (r: number, g: number, b: number, opacity: number): Image => {
      const clone = baseLogo.clone();
      clone.resize(targetWidth, targetHeight);
      const buf = clone.bitmap;
      for (let i = 0; i < buf.length; i += 4) {
        if (buf[i + 3] === 0) continue; // pixel transparente, ignora
        buf[i]     = r;
        buf[i + 1] = g;
        buf[i + 2] = b;
        buf[i + 3] = (buf[i + 3] * opacity) | 0;
      }
      return clone;
    };

    // DROP SHADOW + LOGO — assinatura visível com profundidade:
    //   • shadow escura 2px abaixo/direita → cria pop sobre fundos coloridos
    //   • core: branco/preto puro com opacidade alta (~55%) → marca legível
    const shadowLayer    = makeTintedLogo(0,   0,   0,   DEBOSS_SHADOW_A);
    const coreLayer      = makeTintedLogo(tintR, tintG, tintB, LOGO_OPACITY);

    const x = cover.width - targetWidth - margin;
    const y = cover.height - targetHeight - margin;

    cover.composite(shadowLayer, x + 2, y + 2);  // drop shadow profundidade
    cover.composite(coreLayer,   x,     y);      // logo no canto

    const out = await cover.encode();
    return { bytes: out, contentType: "image/png", applied: true };
  } catch (e) {
    console.error("[watermark] falhou, devolvendo capa original:", e);
    return {
      bytes: coverBytes,
      contentType: "image/png",
      applied: false,
      reason: e instanceof Error ? e.message : String(e),
    };
  }
}
