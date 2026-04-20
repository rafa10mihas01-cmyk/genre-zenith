// test-enrich — teste pontual do actor epctex/spotify-scraper para validar dados
import { corsHeaders } from "npm:@supabase/supabase-js/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const APIFY_API_KEY = Deno.env.get("APIFY_API_KEY")!;

const ACTOR = "epctex~spotify-scraper";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  const start = Date.now();

  let body: { url?: string } = {};
  try { body = await req.json(); } catch { /* default */ }
  const url = body.url ?? "https://open.spotify.com/playlist/37i9dQZF1E8M3FHppPvqnM";

  try {
    const apifyUrl = `https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items?token=${APIFY_API_KEY}&timeout=120`;
    const resp = await fetch(apifyUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        startUrls: [{ url }],
        proxy: { useApifyProxy: true },
      }),
    });

    const status = resp.status;
    const raw = await resp.text();
    let parsed: any = null;
    try { parsed = JSON.parse(raw); } catch { /* keep raw */ }

    // Resumo: tipos de campos no primeiro item
    const first = Array.isArray(parsed) ? parsed[0] : null;
    const summary = first ? {
      keys: Object.keys(first),
      followers: first.followers ?? first.followersCount ?? first.totalFollowers ?? null,
      tracksCount: Array.isArray(first.tracks) ? first.tracks.length :
                   Array.isArray(first.items) ? first.items.length : null,
      sampleTrack: Array.isArray(first.tracks) ? first.tracks[0] :
                   Array.isArray(first.items) ? first.items[0] : null,
    } : null;

    await supabase.from("collection_logs").insert({
      acao: "test-enrich",
      status: status === 200 ? "sucesso" : "erro",
      mensagem: `[${status}] ${url} | summary=${JSON.stringify(summary)?.slice(0, 800)} | raw=${raw.slice(0, 1500)}`,
      duracao_ms: Date.now() - start,
    });

    return new Response(JSON.stringify({ ok: status === 200, status, summary, sample: first }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    await supabase.from("collection_logs").insert({
      acao: "test-enrich",
      status: "erro",
      mensagem: msg.slice(0, 500),
      duracao_ms: Date.now() - start,
    });
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
