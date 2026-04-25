// spotify-public-auth — fluxo OAuth público para a landing.
// Não exige autenticação prévia (verify_jwt=false). Serve para a revisão
// do Spotify ver o consentimento OAuth funcionando ponta a ponta sem
// criar usuário do sistema.
//
// Modos:
//   GET ?mode=login&redirect=<url>           → retorna { url } pra redirecionar ao Spotify
//   GET ?mode=callback&code=…&state=…&redirect=<url>
//        → troca code por tokens, busca perfil e retorna { ok, display_name, email }
//        (NÃO persiste no banco — fluxo somente demonstrativo)
import { corsHeaders } from "npm:@supabase/supabase-js/cors";

const CLIENT_ID = Deno.env.get("SPOTIFY_CLIENT_ID")!;
const CLIENT_SECRET = Deno.env.get("SPOTIFY_CLIENT_SECRET")!;

// Mesmos escopos mínimos exigidos pelo app principal
const SPOTIFY_USER_SCOPES = [
  "playlist-modify-public",
  "playlist-modify-private",
  "ugc-image-upload",
  "user-read-email",
].join(" ");

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = new URL(req.url);
  const mode = url.searchParams.get("mode") ?? "login";

  try {
    if (mode === "login") {
      const redirect = url.searchParams.get("redirect");
      if (!redirect) return jr({ ok: false, error: "redirect obrigatório" }, 400);

      // State leve apenas para CSRF — não persistimos no DB pois é fluxo público.
      // O callback valida o state via cookie/sessionStorage no client.
      const state = crypto.randomUUID();

      const authUrl = new URL("https://accounts.spotify.com/authorize");
      authUrl.searchParams.set("client_id", CLIENT_ID);
      authUrl.searchParams.set("response_type", "code");
      authUrl.searchParams.set("redirect_uri", redirect);
      authUrl.searchParams.set("scope", SPOTIFY_USER_SCOPES);
      authUrl.searchParams.set("state", state);
      authUrl.searchParams.set("show_dialog", "true");

      return jr({ ok: true, url: authUrl.toString(), state });
    }

    if (mode === "callback") {
      const code = url.searchParams.get("code");
      const redirect = url.searchParams.get("redirect");
      if (!code || !redirect) {
        return jr({ ok: false, error: "code e redirect obrigatórios" }, 400);
      }

      const basic = btoa(`${CLIENT_ID}:${CLIENT_SECRET}`);
      const tokenResp = await fetch("https://accounts.spotify.com/api/token", {
        method: "POST",
        headers: {
          Authorization: `Basic ${basic}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: redirect,
        }).toString(),
      });
      if (!tokenResp.ok) {
        const t = await tokenResp.text();
        return jr({ ok: false, error: `token exchange ${tokenResp.status}: ${t.slice(0, 200)}` }, 400);
      }
      const tj = await tokenResp.json();
      const access_token: string = tj.access_token;

      // Buscar perfil só para confirmar o consentimento
      const meResp = await fetch("https://api.spotify.com/v1/me", {
        headers: { Authorization: `Bearer ${access_token}` },
      });
      if (!meResp.ok) {
        const t = await meResp.text();
        return jr({ ok: false, error: `me ${meResp.status}: ${t.slice(0, 200)}` }, 400);
      }
      const me = await meResp.json();

      // Demonstrativo: não persistimos tokens do visitante público.
      return jr({
        ok: true,
        spotify_user_id: me.id,
        display_name: me.display_name ?? null,
        email: me.email ?? null,
      });
    }

    return jr({ ok: false, error: `mode desconhecido: ${mode}` }, 400);
  } catch (e) {
    return jr({ ok: false, error: (e as Error).message }, 500);
  }
});
