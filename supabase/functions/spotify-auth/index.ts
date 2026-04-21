// spotify-auth — múltiplos modos:
//   GET  ?mode=ping            → testa client_credentials
//   GET  ?mode=login&redirect=<url> → retorna URL para iniciar OAuth de usuário
//   GET  ?mode=callback&code=…&state=…&redirect=<url> → troca code por tokens e salva
//   GET  ?mode=accounts        → lista contas conectadas
import { corsHeaders } from "npm:@supabase/supabase-js/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getSpotifyToken, SPOTIFY_USER_SCOPES } from "../_shared/spotify.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CLIENT_ID = Deno.env.get("SPOTIFY_CLIENT_ID")!;
const CLIENT_SECRET = Deno.env.get("SPOTIFY_CLIENT_SECRET")!;

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = new URL(req.url);
  const mode = url.searchParams.get("mode") ?? "ping";

  try {
    if (mode === "ping") {
      const force = url.searchParams.get("force") === "1";
      const token = await getSpotifyToken(force);
      const ping = await fetch("https://api.spotify.com/v1/browse/categories?limit=1", {
        headers: { Authorization: `Bearer ${token}` },
      });
      await ping.text();
      return jr({
        ok: ping.ok, status: ping.status,
        token_prefix: token.slice(0, 12) + "…",
        message: ping.ok ? "Conectado (app)" : `Token obtido mas API respondeu ${ping.status}`,
      });
    }

    if (mode === "login") {
      const redirect = url.searchParams.get("redirect");
      if (!redirect) return jr({ ok: false, error: "redirect obrigatório" }, 400);
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
      if (!code || !redirect) return jr({ ok: false, error: "code e redirect obrigatórios" }, 400);

      const basic = btoa(`${CLIENT_ID}:${CLIENT_SECRET}`);
      const tokenResp = await fetch("https://accounts.spotify.com/api/token", {
        method: "POST",
        headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code, redirect_uri: redirect,
        }).toString(),
      });
      if (!tokenResp.ok) {
        const t = await tokenResp.text();
        return jr({ ok: false, error: `token exchange ${tokenResp.status}: ${t.slice(0, 200)}` }, 400);
      }
      const tj = await tokenResp.json();
      const access_token: string = tj.access_token;
      const refresh_token: string = tj.refresh_token;
      const scope: string = tj.scope ?? "";
      const expires_at = new Date(Date.now() + (tj.expires_in ?? 3600) * 1000).toISOString();

      // Buscar perfil
      const meResp = await fetch("https://api.spotify.com/v1/me", {
        headers: { Authorization: `Bearer ${access_token}` },
      });
      if (!meResp.ok) {
        const t = await meResp.text();
        return jr({ ok: false, error: `me ${meResp.status}: ${t.slice(0, 200)}` }, 400);
      }
      const me = await meResp.json();

      const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

      // Garante 1 default: se não houver default ainda, marca este
      const { count } = await supabase
        .from("spotify_user_tokens")
        .select("*", { count: "exact", head: true })
        .eq("is_default", true);

      const { error: upErr } = await supabase
        .from("spotify_user_tokens")
        .upsert({
          spotify_user_id: me.id,
          display_name: me.display_name ?? null,
          email: me.email ?? null,
          access_token, refresh_token, scope, expires_at,
          is_default: (count ?? 0) === 0,
        }, { onConflict: "spotify_user_id" });
      if (upErr) return jr({ ok: false, error: upErr.message }, 500);

      return jr({
        ok: true,
        spotify_user_id: me.id,
        display_name: me.display_name,
        email: me.email,
        scope,
      });
    }

    if (mode === "accounts") {
      const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
      const { data, error } = await supabase
        .from("spotify_user_tokens")
        .select("id,spotify_user_id,display_name,email,is_default,scope,expires_at,updated_at")
        .order("is_default", { ascending: false })
        .order("updated_at", { ascending: false });
      if (error) return jr({ ok: false, error: error.message }, 500);
      return jr({ ok: true, accounts: data ?? [] });
    }

    return jr({ ok: false, error: `mode desconhecido: ${mode}` }, 400);
  } catch (e) {
    return jr({ ok: false, error: (e as Error).message }, 200);
  }
});
