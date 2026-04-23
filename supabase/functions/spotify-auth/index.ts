// spotify-auth — múltiplos modos:
//   GET  ?mode=ping            → testa client_credentials
//   GET  ?mode=login&redirect=<url> → retorna URL para iniciar OAuth de usuário
//   GET  ?mode=callback&code=…&state=…&redirect=<url> → troca code por tokens e salva
//   GET  ?mode=accounts        → lista contas conectadas (requer auth de membro da equipe)
import { corsHeaders } from "npm:@supabase/supabase-js/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getSpotifyToken, SPOTIFY_USER_SCOPES } from "../_shared/spotify.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const CLIENT_ID = Deno.env.get("SPOTIFY_CLIENT_ID")!;
const CLIENT_SECRET = Deno.env.get("SPOTIFY_CLIENT_SECRET")!;

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Valida JWT do usuário e confirma que é membro da equipe (admin/curador). */
async function requireTeamMember(req: Request): Promise<{ ok: true; userId: string } | { ok: false; resp: Response }> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return { ok: false, resp: jr({ ok: false, error: "Não autenticado" }, 401) };
  }
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const token = authHeader.replace("Bearer ", "");
  const { data, error } = await userClient.auth.getClaims(token);
  if (error || !data?.claims?.sub) {
    return { ok: false, resp: jr({ ok: false, error: "Token inválido" }, 401) };
  }
  const userId = data.claims.sub as string;

  // Verifica se é membro da equipe via service role
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: hasAccess, error: rpcErr } = await admin.rpc("has_role", {
    _user_id: userId,
    _role: "admin",
  });
  const { data: isCurador } = await admin.rpc("has_role", {
    _user_id: userId,
    _role: "curador",
  });
  if (rpcErr) return { ok: false, resp: jr({ ok: false, error: "Falha ao validar permissão" }, 500) };
  if (!hasAccess && !isCurador) {
    return { ok: false, resp: jr({ ok: false, error: "Acesso restrito à equipe" }, 403) };
  }
  return { ok: true, userId };
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
      const auth = await requireTeamMember(req);
      if (!auth.ok) return auth.resp;

      const redirect = url.searchParams.get("redirect");
      const forceLogin = url.searchParams.get("force_login") === "1";
      if (!redirect) return jr({ ok: false, error: "redirect obrigatório" }, 400);
      const state = crypto.randomUUID();

      // Persiste o state vinculado ao usuário para validar no callback (CSRF)
      const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
      const { error: stErr } = await supabase
        .from("spotify_oauth_states")
        .insert({ state, user_id: auth.userId });
      if (stErr) return jr({ ok: false, error: `state save: ${stErr.message}` }, 500);

      const authUrl = new URL("https://accounts.spotify.com/authorize");
      authUrl.searchParams.set("client_id", CLIENT_ID);
      authUrl.searchParams.set("response_type", "code");
      authUrl.searchParams.set("redirect_uri", redirect);
      authUrl.searchParams.set("scope", SPOTIFY_USER_SCOPES);
      authUrl.searchParams.set("state", state);
      authUrl.searchParams.set("show_dialog", "true");

      return jr({ ok: true, url: authUrl.toString(), state, force_login: forceLogin });
    }

    if (mode === "callback") {
      const auth = await requireTeamMember(req);
      if (!auth.ok) return auth.resp;

      const code = url.searchParams.get("code");
      const redirect = url.searchParams.get("redirect");
      const state = url.searchParams.get("state");
      if (!code || !redirect || !state) {
        return jr({ ok: false, error: "code, redirect e state obrigatórios" }, 400);
      }

      const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

      // Valida o state: deve existir, pertencer ao mesmo usuário, não estar consumido nem expirado
      const { data: stRow, error: stErr } = await supabase
        .from("spotify_oauth_states")
        .select("state, user_id, created_at, consumed_at")
        .eq("state", state)
        .maybeSingle();
      if (stErr) return jr({ ok: false, error: `state lookup: ${stErr.message}` }, 500);
      if (!stRow) return jr({ ok: false, error: "state inválido" }, 400);
      if (stRow.consumed_at) return jr({ ok: false, error: "state já utilizado" }, 400);
      if (stRow.user_id !== auth.userId) return jr({ ok: false, error: "state não pertence ao usuário" }, 403);
      const ageMs = Date.now() - new Date(stRow.created_at).getTime();
      if (ageMs > 30 * 60 * 1000) return jr({ ok: false, error: "state expirado" }, 400);

      // Marca como consumido imediatamente (one-shot)
      await supabase
        .from("spotify_oauth_states")
        .update({ consumed_at: new Date().toISOString() })
        .eq("state", state);

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
      const auth = await requireTeamMember(req);
      if (!auth.ok) return auth.resp;

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
