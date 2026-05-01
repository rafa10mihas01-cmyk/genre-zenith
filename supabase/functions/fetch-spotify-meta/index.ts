// fetch-spotify-meta — extrai metadados públicos de um link do Spotify
// (track / playlist / album) usando o endpoint oEmbed público.
// Sem auth (rota pública).
import { corsHeaders } from "npm:@supabase/supabase-js/cors";

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Aceita URLs com prefixo de localização (ex: /intl-pt/) e variações de host
const SPOTIFY_URL_RE = /spotify\.com\/(?:intl-[a-z]{2}\/)?(track|playlist|album)\/([A-Za-z0-9]+)/i;

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

    const oembedUrl = `https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`;
    const res = await fetch(oembedUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; NexEngine/1.0)" },
    });

    if (!res.ok) {
      return jr({ ok: false, error: `oEmbed retornou ${res.status}` }, 200);
    }

    const data = await res.json();
    return jr({
      ok: true,
      type,
      id,
      title: data?.title ?? null,
      thumbnail_url: data?.thumbnail_url ?? null,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return jr({ ok: false, error: msg }, 200);
  }
});
