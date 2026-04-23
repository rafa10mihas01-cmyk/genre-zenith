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

// ============================================================
// WATERMARK
// ============================================================
const LOGO_WHITE_URL =
  "https://xtxxjmkijeyxkdyxtvsf.supabase.co/storage/v1/object/public/playlist-covers/_brand/nexengine-mono-white.png";
const LOGO_BLACK_URL =
  "https://xtxxjmkijeyxkdyxtvsf.supabase.co/storage/v1/object/public/playlist-covers/_brand/nexengine-mono-black.png";

// Logo "gravado na superfície" — emboss premium (estilo Apple/Spotify):
//   1. Sombra 1px abaixo (escura, integra ao fundo)
//   2. Highlight 1px acima (clara, simula relevo)
//   3. Core do logo em tom adaptado ao fundo (não branco puro), opacidade ~10%
// Resultado: percebido só no segundo olhar, parece parte do material.
const LOGO_WIDTH_PCT     = 0.10;  // 10% da largura (menor, mais discreto — antes 18%)
const MARGIN_PCT         = 0.07;  // 7% das bordas (offset confortável)
const LOGO_OPACITY       = 0.10;  // 10% — limiar do "gravado", não colado
const EMBOSS_HIGHLIGHT_A = 0.06;  // alpha do brilho (relevo superior)
const EMBOSS_SHADOW_A    = 0.08;  // alpha da sombra (relevo inferior)
const LOGO_TINT_SHIFT    = 24;    // quanto puxar do branco/preto puro pra dentro do tom do fundo

// ============================================================
// PREMIUM FINISH — calibração visual
// ============================================================
// Radial glow / vignette sutil
const GLOW_CENTER_BOOST   = 14;   // ganho de luz no centro (0-255). 14 = +5% L
const GLOW_EDGE_DARKEN    = 18;   // escurecimento nas bordas (0-255). 18 = -7% L
const GLOW_RADIUS_PCT     = 0.55; // raio do "highlight central" como % da diagonal

// Grain
const GRAIN_AMPLITUDE     = 4;    // ±4 em cada canal RGB. Quase imperceptível em monitor.
const GRAIN_SEED          = 0x9E3779B1; // golden-ratio-ish (mulberry32)

// Inner border (refinada — 1px highlight branco + 1px sombra preto)
const BORDER_INSET_PCT    = 0.012; // 1.2% da largura → ~12px em 1024
const BORDER_HIGHLIGHT_A  = 38;    // alpha (0-255) do traço claro (~15%)
const BORDER_SHADOW_A     = 50;    // alpha (0-255) do traço escuro (~20%)

// ============================================================
// LOGO CACHE
// ============================================================
let cachedWhite: Image | null = null;
let cachedBlack: Image | null = null;

async function loadLogo(url: string): Promise<Image> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`logo fetch ${resp.status}: ${url}`);
  const buf = new Uint8Array(await resp.arrayBuffer());
  return await Image.decode(buf);
}

async function getLogos(): Promise<{ white: Image; black: Image }> {
  if (!cachedWhite) cachedWhite = await loadLogo(LOGO_WHITE_URL);
  if (!cachedBlack) cachedBlack = await loadLogo(LOGO_BLACK_URL);
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
  const cx = W / 2;
  const cy = H / 2;
  const maxDist = Math.sqrt(cx * cx + cy * cy);
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

  // Walker direto sobre o buffer interno (imagescript expõe `bitmap` Uint8ClampedArray RGBA).
  // Cada pixel = 4 bytes (R,G,B,A). Iterar manualmente é ~10x mais rápido que getPixelAt.
  const buf = img.bitmap;
  for (let y = 0; y < H; y++) {
    const dy = y - cy;
    for (let x = 0; x < W; x++) {
      const dx = x - cx;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // Radial glow: centro fica mais claro, bordas mais escuras.
      // Curva suave (smoothstep-like) entre 0 (centro) e 1 (canto).
      const t = Math.min(1, dist / maxDist);
      // smoothstep
      const s = t * t * (3 - 2 * t);

      // Center boost (decai do centro até glowRadius)
      const centerFactor = Math.max(0, 1 - dist / glowRadius);
      const centerBoost = GLOW_CENTER_BOOST * centerFactor * centerFactor;

      // Edge darken (cresce do centro até o canto)
      const edgeDarken = GLOW_EDGE_DARKEN * s;

      const lightDelta = centerBoost - edgeDarken;

      // Grain: ±GRAIN_AMPLITUDE, igual nos 3 canais (mantém croma do pixel)
      const grain = (rand() - 0.5) * 2 * GRAIN_AMPLITUDE;

      const totalDelta = lightDelta + grain;

      const i = (y * W + x) * 4;
      buf[i]     = clamp(buf[i]     + totalDelta);
      buf[i + 1] = clamp(buf[i + 1] + totalDelta);
      buf[i + 2] = clamp(buf[i + 2] + totalDelta);
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

    // 3. Watermark adaptativa
    const { white, black } = await getLogos();
    const targetWidth = Math.round(cover.width * LOGO_WIDTH_PCT);
    const margin = Math.round(cover.width * MARGIN_PCT);

    const sampleX = Math.max(0, cover.width - targetWidth - margin);
    const sampleY = Math.max(0, cover.height - Math.round(targetWidth * 0.5) - margin);
    const sampleW = Math.min(cover.width - sampleX, targetWidth);
    const sampleH = Math.min(cover.height - sampleY, Math.round(targetWidth * 0.5));
    const lum = regionLuminance(cover, sampleX, sampleY, sampleW, sampleH);

    const logo = lum < 128 ? white : black;

    const aspect = logo.height / logo.width;
    const targetHeight = Math.round(targetWidth * aspect);
    logo.resize(targetWidth, targetHeight);
    logo.opacity(OPACITY);

    const x = cover.width - targetWidth - margin;
    const y = cover.height - targetHeight - margin;
    cover.composite(logo, x, y);

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
