// fetch-spotify-meta — extrai metadados públicos de um link do Spotify
// (track / playlist / album). Combina oEmbed (título + thumbnail) com
// scrape de og:description da página pública pra extrair o artista
// quando o oEmbed não traz no formato "Title - Artist".
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { spotifyFetch } from "../_shared/spotify-client.ts";

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
  s = s.replace(/\s*\((?:feat\.?|ft\.?|with|com)[^)]*\)/gi, "");
  s = s.replace(/\s*\[(?:feat\.?|ft\.?|with|com)[^\]]*\]/gi, "");
  s = s.split(/\s+(?:feat\.?|ft\.?)\s+/i)[0];
  s = s.split(/\s*(?:,|&|\sx\s|\se\s|\sand\s|\swith\s|\/|·|\|)\s*/i)[0];
  return s.trim() || null;
}

// Devolve TODOS os artistas da string ("Kaue Mc, WR Original, DJ Cleber")
// → ["Kaue Mc", "WR Original", "DJ Cleber"]. O bot tenta um a um e usa
// o primeiro que ele tiver acesso no Spotify for Artists (artista interno).
function pickArtistCandidates(raw: string | null): string[] {
  if (!raw) return [];
  let s = raw.trim();
  s = s.replace(/\s*\((?:feat\.?|ft\.?|with|com)[^)]*\)/gi, ",");
  s = s.replace(/\s*\[(?:feat\.?|ft\.?|with|com)[^\]]*\]/gi, ",");
  s = s.replace(/\s+(?:feat\.?|ft\.?)\s+/gi, ",");
  const parts = s.split(/\s*(?:,|&|\sx\s|\se\s|\sand\s|\swith\s|\/|·|\|)\s*/i);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    const v = p.trim();
    if (!v) continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
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

    // 1) oEmbed — título + thumbnail oficiais (com retry)
    // Spotify às vezes devolve 5xx/empty pra URLs intl-pt; tentamos 3x e depois
    // caímos pra URL canônica sem locale.
    const canonicalUrl = `https://open.spotify.com/${type}/${id}`;
    let title: string | null = null;
    let thumbnail_url: string | null = null;
    for (const tryUrl of [url, canonicalUrl]) {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const oembedUrl = `https://open.spotify.com/oembed?url=${encodeURIComponent(tryUrl)}`;
          const oembedRes = await spotifyFetch(oembedUrl, { headers: { "User-Agent": UA } });
          if (oembedRes.ok) {
            const data = await oembedRes.json().catch(() => ({}));
            title = data?.title ?? title;
            thumbnail_url = data?.thumbnail_url ?? thumbnail_url;
            if (thumbnail_url) break;
          }
        } catch { /* retry */ }
        await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
      }
      if (thumbnail_url) break;
    }

    // 2) Parse "Title - Artist" se vier nesse formato
    let parsedTitle = title;
    let parsedArtist: string | null = null;
    if (title && title.includes(" - ")) {
      const idx = title.indexOf(" - ");
      parsedTitle = title.slice(0, idx).trim();
      parsedArtist = title.slice(idx + 3).trim();
    }

    // 3) Fallback: scrape og:description da página pública pra pegar artista,
    //    e og:image pra capa quando o oEmbed não retornar thumbnail.
    if ((!parsedArtist && type === "track") || !thumbnail_url) {
      try {
        const pageUrl = `https://open.spotify.com/${type}/${id}`;
        const pageRes = await spotifyFetch(pageUrl, {
          headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" },
        });
        if (pageRes.ok) {
          const html = await pageRes.text();
          if (!parsedArtist && type === "track") {
            const ogDesc = pickMeta(html, "og:description");
            const ogTitle = pickMeta(html, "og:title");
            parsedArtist = extractArtistFromDescription(ogDesc, parsedTitle ?? ogTitle);
            if (!parsedTitle && ogTitle) parsedTitle = decodeEntities(ogTitle);
          }
          if (!thumbnail_url) {
            thumbnail_url = pickMeta(html, "og:image");
          }
        }
      } catch {
        // ignora — artista/capa null é aceitável aqui
      }
    }

    const primaryArtist = pickPrimaryArtist(parsedArtist);
    const artistCandidates = pickArtistCandidates(parsedArtist);

    return jr({
      ok: true,
      type,
      id,
      title: parsedTitle,
      artist: primaryArtist,                // principal (compat)
      artist_full: parsedArtist,            // string completa
      artist_candidates: artistCandidates,  // todos separados — bot tenta um a um
      thumbnail_url,
      raw_title: title,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return jr({ ok: false, error: msg }, 200);
  }
});
