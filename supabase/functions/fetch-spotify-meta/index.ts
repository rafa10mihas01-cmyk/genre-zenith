// fetch-spotify-meta — extrai metadados públicos de um link do Spotify
// (track / playlist / album). Combina oEmbed (título + thumbnail) com
// scrape de og:description da página pública pra extrair o artista
// quando o oEmbed não traz no formato "Title - Artist".
import { corsHeaders } from "npm:@supabase/supabase-js/cors";

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const SPOTIFY_URL_RE = /spotify\.com\/(?:intl-[a-z]{2}\/)?(track|playlist|album)\/([A-Za-z0-9]+)/i;
const UA = "Mozilla/5.0 (compatible; NexEngine/1.0)";

function pickMeta(html: string, prop: string): string | null {
  // og:description / og:title etc — aceita aspas simples ou duplas, ordem flexível
  const re = new RegExp(
    `<meta[^>]+property=["']${prop}["'][^>]+content=["']([^"']+)["']`,
    "i",
  );
  const m = html.match(re);
  if (m) return m[1];
  const re2 = new RegExp(
    `<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${prop}["']`,
    "i",
  );
  const m2 = html.match(re2);
  return m2 ? m2[1] : null;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&middot;/g, "·");
}

// Extrai artista de og:description. Formato típico Spotify track:
// "Song · Artist · Song · 2024" ou "Música de Artist no Spotify."
function extractArtistFromDescription(desc: string | null, title: string | null): string | null {
  if (!desc) return null;
  const d = decodeEntities(desc);
  // Padrão 1: "X · Artist · Song · 2024"
  const parts = d.split("·").map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) {
    // Frequentemente: [title, artist, ...]
    const t = (title || "").toLowerCase().trim();
    for (const p of parts) {
      if (p.toLowerCase() !== t && !/^\d{4}$/.test(p) && p.length < 80) {
        return p;
      }
    }
  }
  // Padrão 2 (PT): "Música · Artist no Spotify"
  const m = d.match(/(?:Música|Song|Listen to .+? on Spotify\. )([^·]+?) (?:no Spotify|on Spotify)/i);
  if (m) return m[1].trim();
  return null;
}

// Pega só o artista PRINCIPAL — sem features, colabs, vírgulas, "&", "feat.", etc.
// O Spotify for Artists busca pelo nome do dono da faixa, então passar a string toda
// (ex: "Kaue Mc, WR Original, DJ CLEBER") faz a busca falhar / abrir o seletor de artistas.
function pickPrimaryArtist(raw: string | null): string | null {
  if (!raw) return null;
  let s = raw.trim();
  // remove features e colabs
  s = s.replace(/\s*\((?:feat\.?|ft\.?|with|com)[^)]*\)/gi, "");
  s = s.replace(/\s*\[(?:feat\.?|ft\.?|with|com)[^\]]*\]/gi, "");
  s = s.split(/\s+(?:feat\.?|ft\.?)\s+/i)[0];
  // pega antes de qualquer separador de múltiplos artistas
  s = s.split(/\s*(?:,|&|\sx\s|\se\s|\sand\s|\swith\s|\/|·|\|)\s*/i)[0];
  return s.trim() || null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const url = typeof body?.url === "string" ? body.url.trim() : "";
    if (!url) return jr({ ok: false, error: "url obrigatória" }, 400);

    const match = url.match(SPOTIFY_URL_RE);
    if (!match) return jr({ ok: false, error: "URL do Spotify inválida" }, 400);

    const type = match[1] as "track" | "playlist" | "album";
    const id = match[2];

    // 1) oEmbed — título + thumbnail oficiais
    const oembedUrl = `https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`;
    const oembedRes = await fetch(oembedUrl, { headers: { "User-Agent": UA } });
    let title: string | null = null;
    let thumbnail_url: string | null = null;
    if (oembedRes.ok) {
      const data = await oembedRes.json().catch(() => ({}));
      title = data?.title ?? null;
      thumbnail_url = data?.thumbnail_url ?? null;
    }

    // 2) Parse "Title - Artist" se vier nesse formato
    let parsedTitle = title;
    let parsedArtist: string | null = null;
    if (title && title.includes(" - ")) {
      const idx = title.indexOf(" - ");
      parsedTitle = title.slice(0, idx).trim();
      parsedArtist = title.slice(idx + 3).trim();
    }

    // 3) Fallback: scrape og:description da página pública pra pegar artista
    if (!parsedArtist && type === "track") {
      try {
        const pageUrl = `https://open.spotify.com/${type}/${id}`;
        const pageRes = await fetch(pageUrl, {
          headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" },
        });
        if (pageRes.ok) {
          const html = await pageRes.text();
          const ogDesc = pickMeta(html, "og:description");
          const ogTitle = pickMeta(html, "og:title");
          parsedArtist = extractArtistFromDescription(ogDesc, parsedTitle ?? ogTitle);
          if (!parsedTitle && ogTitle) parsedTitle = decodeEntities(ogTitle);
        }
      } catch {
        // ignora — artista null é aceitável aqui, mas o cliente vai validar
      }
    }

    const primaryArtist = pickPrimaryArtist(parsedArtist);

    return jr({
      ok: true,
      type,
      id,
      title: parsedTitle,
      artist: primaryArtist,        // ← só o principal (usado pelo bot)
      artist_full: parsedArtist,    // ← string completa, pra exibição
      thumbnail_url,
      raw_title: title,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return jr({ ok: false, error: msg }, 200);
  }
});
