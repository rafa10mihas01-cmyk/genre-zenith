// share-link — devolve HTML com Open Graph para preview rico no WhatsApp /
// iMessage / Telegram / Slack, e redireciona usuários reais para o portal
// canônico (curador ou cliente). Sem auth (rota pública). Usa service role
// só pra ler dados do deal.
//
// Rotas:
//   /share-link/curador/{slug-ou-token}  → portal do curador
//   /share-link/campanha/{slug-ou-token} → portal do cliente
import { corsHeaders } from "npm:@supabase/supabase-js/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PUBLIC_DOMAIN = "https://engine.nexcreatorx.com";

const looksLikeToken = (v: string) => /^[a-f0-9]{20,}$/i.test(v);

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatPlays(n: number | null | undefined): string {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return "";
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return Math.round(v).toString();
}

function htmlPage(opts: {
  title: string;
  description: string;
  image?: string | null;
  redirect: string;
}): Response {
  const title = escapeHtml(opts.title);
  const desc = escapeHtml(opts.description);
  const image = opts.image ? escapeHtml(opts.image) : "";
  const redirect = escapeHtml(opts.redirect);
  const html = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${title}</title>
<meta name="description" content="${desc}" />
<meta property="og:type" content="website" />
<meta property="og:title" content="${title}" />
<meta property="og:description" content="${desc}" />
<meta property="og:url" content="${redirect}" />
${image ? `<meta property="og:image" content="${image}" />
<meta property="og:image:width" content="640" />
<meta property="og:image:height" content="640" />` : ""}
<meta name="twitter:card" content="${image ? "summary_large_image" : "summary"}" />
<meta name="twitter:title" content="${title}" />
<meta name="twitter:description" content="${desc}" />
${image ? `<meta name="twitter:image" content="${image}" />` : ""}
<meta http-equiv="refresh" content="0; url=${redirect}" />
<link rel="canonical" href="${redirect}" />
<script>window.location.replace(${JSON.stringify(opts.redirect)});</script>
</head>
<body style="font-family:Inter,system-ui,sans-serif;background:#050505;color:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0">
<div style="text-align:center">
<p>Abrindo ${title}…</p>
<p><a style="color:#1DB954" href="${redirect}">Clique aqui se não for redirecionado</a></p>
</div>
</body>
</html>`;
  return new Response(html, {
    status: 200,
    headers: {
      ...corsHeaders,
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=300, s-maxage=300",
    },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const url = new URL(req.url);
  // path = /share-link/curador/slug  OR /functions/v1/share-link/curador/slug
  const parts = url.pathname.split("/").filter(Boolean);
  const ix = parts.indexOf("share-link");
  const kind = ix >= 0 ? parts[ix + 1] : parts[0];
  const idRaw = ix >= 0 ? parts.slice(ix + 2).join("/") : parts.slice(1).join("/");
  const id = decodeURIComponent(idRaw ?? "").trim();

  if (!id || (kind !== "curador" && kind !== "campanha")) {
    return htmlPage({
      title: "NexEngine",
      description: "Plataforma de campanhas e curadoria musical.",
      redirect: PUBLIC_DOMAIN,
    });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false },
  });

  if (kind === "curador") {
    const filter = looksLikeToken(id) ? "public_token" : "slug";
    const { data: deal } = await admin
      .from("curator_deals")
      .select("curator_name, song_name, song_artist, song_cover_url, target_plays, daily_goal, slug, public_token")
      .eq(filter, id)
      .maybeSingle();

    const redirect = `${PUBLIC_DOMAIN}/curador/${id}`;
    if (!deal) {
      return htmlPage({
        title: "Curadoria · NexEngine",
        description: "Acesse o portal da curadoria.",
        redirect,
      });
    }

    const curator = deal.curator_name || "Curadoria";
    const song = deal.song_name || "Campanha";
    const artist = deal.song_artist ? ` — ${deal.song_artist}` : "";
    const target = formatPlays(deal.target_plays);
    const daily = formatPlays(deal.daily_goal);
    const metaParts: string[] = [];
    if (target) metaParts.push(`meta ${target} plays`);
    if (daily) metaParts.push(`${daily}/dia`);
    const desc = `${song}${artist}${metaParts.length ? ` · ${metaParts.join(" · ")}` : ""}`;

    return htmlPage({
      title: `Curadoria · ${curator}`,
      description: desc,
      image: deal.song_cover_url,
      redirect,
    });
  }

  // kind === "campanha" — slug ou client_token bate em curator_deal_songs.
  const filter = looksLikeToken(id) ? "client_token" : "slug";
  const { data: song } = await admin
    .from("curator_deal_songs")
    .select("song_name, song_artist, song_cover_url, target_plays, daily_goal, slug, client_token")
    .eq(filter, id)
    .maybeSingle();

  const redirect = `${PUBLIC_DOMAIN}/campanha/${id}`;
  if (!song) {
    return htmlPage({
      title: "Campanha · NexEngine",
      description: "Acompanhe sua campanha em tempo real.",
      redirect,
    });
  }

  const songName = song.song_name || "Campanha";
  const artist = song.song_artist ? ` — ${song.song_artist}` : "";
  const target = formatPlays(song.target_plays);
  const desc = target
    ? `${songName}${artist} · meta ${target} plays`
    : `${songName}${artist}`;
  return htmlPage({
    title: `Campanha · ${songName}`,
    description: desc,
    image: song.song_cover_url,
    redirect,
  });
});
