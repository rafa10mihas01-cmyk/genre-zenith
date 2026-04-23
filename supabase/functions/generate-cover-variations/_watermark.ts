// _watermark.ts — Compositor de marca d'água NexEngine.
//
// Recebe a capa (bytes PNG/JPG) gerada pelo Gemini e devolve a MESMA capa
// com o logo oficial monocromático aplicado no canto inferior direito.
//
// Decisões fixas (não alterar sem mudar o brief de design):
//   • PNGs originais: _brand/nexengine-mono-white.png e nexengine-mono-black.png
//     (silhuetas do logo oficial em branco/preto puro com fundo transparente)
//   • Largura do logo: 22% da largura da capa
//   • Margem do canto: 6% das bordas (right + bottom)
//   • Opacidade: 22% (visível mas discreto)
//   • Cor escolhida automaticamente via análise de luminosidade do canto
//     inferior direito da capa (fundo escuro → branco; claro → preto).
//
// Usa imagescript (puro TS/JS, sem binário nativo, roda em Deno edge runtime).

import { Image } from "https://deno.land/x/imagescript@1.2.17/mod.ts";

const LOGO_WHITE_URL =
  "https://xtxxjmkijeyxkdyxtvsf.supabase.co/storage/v1/object/public/playlist-covers/_brand/nexengine-mono-white.png";
const LOGO_BLACK_URL =
  "https://xtxxjmkijeyxkdyxtvsf.supabase.co/storage/v1/object/public/playlist-covers/_brand/nexengine-mono-black.png";

const LOGO_WIDTH_PCT = 0.22;   // 22% da largura da capa
const MARGIN_PCT     = 0.06;   // 6% das bordas
const OPACITY        = 0.22;   // 22%

// Cache em memória (a edge function pode reusar entre requests no mesmo isolate)
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
  // imagescript Image é mutável — clonamos pra não corromper o cache
  return { white: cachedWhite.clone(), black: cachedBlack.clone() };
}

// Calcula luminosidade média (0-255) de uma região retangular da imagem.
function regionLuminance(img: Image, x: number, y: number, w: number, h: number): number {
  let total = 0;
  let count = 0;
  // Amostragem em grid de 8x8 (suficiente, evita iterar pixel por pixel)
  const stepX = Math.max(1, Math.floor(w / 8));
  const stepY = Math.max(1, Math.floor(h / 8));
  for (let py = y; py < y + h && py < img.height; py += stepY) {
    for (let px = x; px < x + w && px < img.width; px += stepX) {
      const pixel = img.getPixelAt(px + 1, py + 1); // imagescript é 1-indexed
      // pixel é uint32 RGBA: r << 24 | g << 16 | b << 8 | a
      const r = (pixel >>> 24) & 0xff;
      const g = (pixel >>> 16) & 0xff;
      const b = (pixel >>> 8) & 0xff;
      // luminância perceptual (BT.709)
      total += 0.2126 * r + 0.7152 * g + 0.0722 * b;
      count++;
    }
  }
  return count > 0 ? total / count : 128;
}

/**
 * Compõe a marca d'água NexEngine sobre a capa.
 * Recebe os bytes da capa (PNG/JPEG) e devolve PNG com a watermark aplicada.
 *
 * Falha-segura: se algo der errado, devolve os bytes originais (a capa nunca
 * é perdida por causa da watermark).
 */
export async function applyWatermark(coverBytes: Uint8Array): Promise<{
  bytes: Uint8Array;
  contentType: string;
  applied: boolean;
  reason?: string;
}> {
  try {
    const cover = await Image.decode(coverBytes);
    const { white, black } = await getLogos();

    // Calcula tamanho/posição da watermark
    const targetWidth = Math.round(cover.width * LOGO_WIDTH_PCT);
    const margin = Math.round(cover.width * MARGIN_PCT);

    // Escolhe cor por luminosidade do canto inferior direito da capa
    // (a região onde a watermark vai ficar)
    const sampleX = Math.max(0, cover.width - targetWidth - margin);
    const sampleY = Math.max(0, cover.height - Math.round(targetWidth * 0.5) - margin);
    const sampleW = Math.min(cover.width - sampleX, targetWidth);
    const sampleH = Math.min(cover.height - sampleY, Math.round(targetWidth * 0.5));
    const lum = regionLuminance(cover, sampleX, sampleY, sampleW, sampleH);

    // Threshold 128: fundo escuro → logo branco; fundo claro → logo preto
    const logo = lum < 128 ? white : black;

    // Redimensiona o logo preservando aspect ratio
    const aspect = logo.height / logo.width;
    const targetHeight = Math.round(targetWidth * aspect);
    logo.resize(targetWidth, targetHeight);

    // Aplica opacidade no canal alpha (multiplica todos os alphas por OPACITY)
    logo.opacity(OPACITY);

    // Posição final (canto inferior direito com margem)
    const x = cover.width - targetWidth - margin;
    const y = cover.height - targetHeight - margin;

    // Composita
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
