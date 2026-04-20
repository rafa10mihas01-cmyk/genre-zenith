// spotify-auth — endpoint para testar/forçar obtenção de token
import { corsHeaders } from "npm:@supabase/supabase-js/cors";
import { getSpotifyToken } from "../_shared/spotify.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const url = new URL(req.url);
    const force = url.searchParams.get("force") === "1";
    const token = await getSpotifyToken(force);
    const ping = await fetch("https://api.spotify.com/v1/browse/categories?limit=1", {
      headers: { Authorization: `Bearer ${token}` },
    });
    await ping.text();
    return new Response(
      JSON.stringify({
        ok: ping.ok,
        status: ping.status,
        token_prefix: token.slice(0, 12) + "…",
        message: ping.ok ? "Conectado" : `Token obtido mas API respondeu ${ping.status}`,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
