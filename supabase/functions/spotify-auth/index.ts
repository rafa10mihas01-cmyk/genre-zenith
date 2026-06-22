// spotify-auth — múltiplos modos (multi-app aware) — pós-17-C (sem app default):
//   GET  ?mode=ping                              → testa client_credentials do app default
//   GET  ?mode=login&redirect=<url>[&app_id=…]   → URL OAuth pro app escolhido
//   GET  ?mode=callback&code=…&state=…&redirect= → troca code (usa app gravado no state)
//   GET  ?mode=accounts                          → lista contas conectadas (com app)
//   GET  ?mode=apps                              → lista apps Spotify (com contagem)
//   POST ?mode=app_save     body {id?,name,client_id,client_secret,max_accounts?,notes?}
//   POST ?mode=app_delete   body {id}
import { corsHeaders } from "npm:@supabase/supabase-js/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getAppToken, forceRefreshAppToken, SPOTIFY_USER_SCOPES, SPOTIFY_USER_SCOPES_LIST, getAppCredentials, spotifyFetch } from "../_shared/spotify-client.ts";
import { logAudit, extractRequestMeta } from "../_shared/oauth-audit.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function requireTeamMember(req: Request): Promise<{ ok: true; userId: string; isAdmin: boolean } | { ok: false; resp: Response }> {
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

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: hasAccess, error: rpcErr } = await admin.rpc("has_role", {
    _user_id: userId, _role: "admin",
  });
  const { data: isCurador } = await admin.rpc("has_role", {
    _user_id: userId, _role: "curador",
  });
  if (rpcErr) return { ok: false, resp: jr({ ok: false, error: "Falha ao validar permissão" }, 500) };
  if (!hasAccess && !isCurador) {
    return { ok: false, resp: jr({ ok: false, error: "Acesso restrito à equipe" }, 403) };
  }
  return { ok: true, userId, isAdmin: !!hasAccess };
}

/** Escolhe app com vaga: usa app_id se informado, senão default com slots > 0. */
async function resolveAppForNewAccount(sb: any, requestedAppId?: string | null) {
  if (requestedAppId) {
    const { data: app } = await sb
      .from("spotify_apps")
      .select("id, name, max_accounts, status")
      .eq("id", requestedAppId)
      .maybeSingle();
    if (!app) throw new Error("App informado não existe");
    if (app.status !== "active") throw new Error(`App "${app.name}" está ${app.status}`);
    return app.id as string;
  }

  // Auto-pick: primeiro app active com vaga (pós-17-C: sem "default" — só created_at)
  const { data: apps } = await sb
    .from("spotify_apps")
    .select("id, name, max_accounts")
    .eq("status", "active")
    .order("created_at", { ascending: true });

  for (const a of apps ?? []) {
    const { count } = await sb
      .from("spotify_user_tokens")
      .select("*", { count: "exact", head: true })
      .eq("app_id", a.id);
    if ((count ?? 0) < a.max_accounts) return a.id as string;
  }
  // Sem apps ou todos lotados → null = usa fallback env
  return null;
}

async function assertAppHasSlotForSpotifyUser(sb: any, appId: string | null, spotifyUserId: string) {
  if (!appId) return;

  const { data: app } = await sb
    .from("spotify_apps")
    .select("id, name, max_accounts")
    .eq("id", appId)
    .maybeSingle();
  if (!app) throw new Error("App informado não existe");

  const { data: existing } = await sb
    .from("spotify_user_tokens")
    .select("spotify_user_id, app_id")
    .eq("spotify_user_id", spotifyUserId)
    .maybeSingle();
  if (existing?.app_id === appId) return;

  const { count } = await sb
    .from("spotify_user_tokens")
    .select("*", { count: "exact", head: true })
    .eq("app_id", appId);
  if ((count ?? 0) >= app.max_accounts) {
    throw new Error(`App "${app.name}" lotado (${count}/${app.max_accounts}). Escolha outro.`);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = new URL(req.url);
  const mode = url.searchParams.get("mode") ?? "ping";
  const reqMeta = extractRequestMeta(req);

  try {
    if (mode === "scopes") {
      return jr({ ok: true, scopes: SPOTIFY_USER_SCOPES_LIST });
    }

    if (mode === "ping") {
      const force = url.searchParams.get("force") === "1";
      const token = force ? await forceRefreshAppToken() : await getAppToken();
      const ping = await spotifyFetch(
        "https://api.spotify.com/v1/search?q=artist%3AAnitta&type=artist&limit=1",
        { headers: { Authorization: `Bearer ${token}` } },
        { functionName: "spotify-auth", operation: "ping" },
      );
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
      const requestedAppId = url.searchParams.get("app_id");
      if (!redirect) return jr({ ok: false, error: "redirect obrigatório" }, 400);

      const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

      // Resolve app (verifica vaga)
      let appId: string | null = null;
      try {
        appId = await resolveAppForNewAccount(supabase, requestedAppId);
      } catch (e) {
        return jr({ ok: false, error: (e as Error).message }, 400);
      }

      // Pega credenciais (com fallback env se appId=null) + slug pra validar redirect
      const creds = await getAppCredentials(appId);
      let expectedSlug: string | null = null;
      if (appId) {
        const { data: appRow } = await supabase
          .from("spotify_apps")
          .select("slug")
          .eq("id", appId)
          .maybeSingle();
        expectedSlug = appRow?.slug ?? null;
      }

      // Valida que o redirect informado tem path /spotify/callback/<slug>
      // (ou /spotify/callback simples se appId=null — fluxo público/legado)
      try {
        const u = new URL(redirect);
        const expectedPath = expectedSlug
          ? `/spotify/callback/${expectedSlug}`
          : "/spotify/callback";
        if (u.pathname !== expectedPath) {
          return jr({
            ok: false,
            error: `redirect_uri inválido: esperado terminar em ${expectedPath}, recebido ${u.pathname}`,
          }, 400);
        }
      } catch {
        return jr({ ok: false, error: "redirect não é URL válida" }, 400);
      }

      const state = crypto.randomUUID();
      const { error: stErr } = await supabase
        .from("spotify_oauth_states")
        .insert({ state, user_id: auth.userId, app_id: appId });
      if (stErr) return jr({ ok: false, error: `state save: ${stErr.message}` }, 500);

      const authUrl = new URL("https://accounts.spotify.com/authorize");
      authUrl.searchParams.set("client_id", creds.client_id);
      authUrl.searchParams.set("response_type", "code");
      authUrl.searchParams.set("redirect_uri", redirect);
      authUrl.searchParams.set("scope", SPOTIFY_USER_SCOPES);
      authUrl.searchParams.set("state", state);
      authUrl.searchParams.set("show_dialog", "true");

      await logAudit(supabase, {
        event: "login_started", flow: "admin",
        state, app_id: appId, actor_user_id: auth.userId,
        meta: { app_name: creds.name, force_login: forceLogin },
        ...reqMeta,
      });

      return jr({ ok: true, url: authUrl.toString(), state, app: creds.name, app_id: appId, slug: expectedSlug, force_login: forceLogin });
    }

    if (mode === "callback") {
      const auth = await requireTeamMember(req);
      if (!auth.ok) return auth.resp;

      const code = url.searchParams.get("code");
      const redirect = url.searchParams.get("redirect");
      const state = url.searchParams.get("state");
      const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

      const failAdmin = async (code_: string, msg: string, extras: Record<string, unknown> = {}) => {
        await logAudit(supabase, {
          event: "failure", flow: "admin", status: "error",
          error_code: code_, error_message: msg,
          state: state ?? null, actor_user_id: auth.userId,
          ...reqMeta, meta: extras,
        });
      };

      if (!code || !redirect || !state) {
        await failAdmin("missing_params", "code/redirect/state ausentes");
        return jr({ ok: false, error: "code, redirect e state obrigatórios" }, 400);
      }

      await logAudit(supabase, {
        event: "callback_received", flow: "admin",
        state, actor_user_id: auth.userId, ...reqMeta,
      });

      const { data: stRow, error: stErr } = await supabase
        .from("spotify_oauth_states")
        .select("state, user_id, app_id, created_at, consumed_at")
        .eq("state", state)
        .maybeSingle();
      if (stErr) {
        await failAdmin("state_lookup_failed", stErr.message);
        return jr({ ok: false, error: `state lookup: ${stErr.message}` }, 500);
      }
      if (!stRow) {
        await failAdmin("state_not_found", "state inválido");
        return jr({ ok: false, error: "state inválido" }, 400);
      }
      if (stRow.user_id !== auth.userId) {
        await failAdmin("state_user_mismatch", "state não pertence ao usuário", { app_id: stRow.app_id });
        return jr({ ok: false, error: "state não pertence ao usuário" }, 403);
      }

      if (stRow.consumed_at) {
        const consumedAgeMs = Date.now() - new Date(stRow.consumed_at).getTime();
        if (consumedAgeMs <= 2 * 60 * 1000) {
          const { data: latest } = await supabase
            .from("spotify_user_tokens")
            .select("spotify_user_id, display_name, email, scope, app_id")
            .order("updated_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          return jr({
            ok: true, idempotent: true,
            spotify_user_id: latest?.spotify_user_id,
            display_name: latest?.display_name,
            email: latest?.email, scope: latest?.scope,
            app_id: latest?.app_id,
          });
        }
        await failAdmin("state_already_used", "state já utilizado", { app_id: stRow.app_id });
        return jr({ ok: false, error: "state já utilizado" }, 400);
      }
      const ageMs = Date.now() - new Date(stRow.created_at).getTime();
      if (ageMs > 30 * 60 * 1000) {
        await failAdmin("state_expired", "state expirado", { app_id: stRow.app_id });
        return jr({ ok: false, error: "state expirado" }, 400);
      }

      await supabase
        .from("spotify_oauth_states")
        .update({ consumed_at: new Date().toISOString() })
        .eq("state", state);

      // Usa credenciais do app gravado no state (essencial p/ token exchange)
      const creds = await getAppCredentials(stRow.app_id);
      const basic = btoa(`${creds.client_id}:${creds.client_secret}`);
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
        console.error("[spotify-auth] token exchange failed", {
          app_id: stRow.app_id, app_name: creds.name,
          client_id_prefix: creds.client_id.slice(0, 6),
          redirect_uri: redirect, status: tokenResp.status, body: t.slice(0, 500),
        });
        await failAdmin("token_exchange_failed", `${tokenResp.status}: ${t.slice(0, 200)}`, {
          app_id: stRow.app_id, app_name: creds.name, status: tokenResp.status,
        });
        return jr({ ok: false, error: `token exchange ${tokenResp.status} (app=${creds.name}, client_id=${creds.client_id.slice(0, 6)}…, redirect=${redirect}): ${t.slice(0, 300)}` }, 400);
      }
      const tj = await tokenResp.json();
      const access_token: string = tj.access_token;
      const refresh_token: string = tj.refresh_token;
      const scope: string = tj.scope ?? "";
      const expires_at = new Date(Date.now() + (tj.expires_in ?? 3600) * 1000).toISOString();

      const meResp = await fetch("https://api.spotify.com/v1/me", {
        headers: { Authorization: `Bearer ${access_token}` },
      });
      if (!meResp.ok) {
        const t = await meResp.text();
        console.error("[spotify-auth] /me failed", {
          app_id: stRow.app_id, app_name: creds.name,
          status: meResp.status, body: t.slice(0, 500),
        });
        await failAdmin("me_fetch_failed", `${meResp.status}: ${t.slice(0, 200)}`, {
          app_id: stRow.app_id, app_name: creds.name,
        });
        return jr({ ok: false, error: `/me ${meResp.status} (app=${creds.name}): ${t.slice(0, 300)}` }, 400);
      }
      const me = await meResp.json();

      await logAudit(supabase, {
        event: "token_exchanged", flow: "admin",
        state, app_id: stRow.app_id, actor_user_id: auth.userId,
        spotify_user_id: me.id, email: me.email ?? null, display_name: me.display_name ?? null,
        ...reqMeta,
      });

      try {
        await assertAppHasSlotForSpotifyUser(supabase, stRow.app_id, me.id);
      } catch (e) {
        console.error("[spotify-auth] slot check failed", {
          app_id: stRow.app_id, spotify_user: me.id, err: (e as Error).message,
        });
        await failAdmin("slot_check_failed", (e as Error).message, {
          app_id: stRow.app_id, spotify_user_id: me.id,
        });
        return jr({ ok: false, error: (e as Error).message }, 400);
      }

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
          app_id: stRow.app_id,
          is_default: (count ?? 0) === 0,
        }, { onConflict: "app_id,spotify_user_id" });
      if (upErr) {
        await failAdmin("tokens_upsert_failed", upErr.message, {
          app_id: stRow.app_id, spotify_user_id: me.id,
        });
        return jr({ ok: false, error: upErr.message }, 500);
      }

      await logAudit(supabase, {
        event: "account_connected", flow: "admin",
        state, app_id: stRow.app_id, actor_user_id: auth.userId,
        spotify_user_id: me.id, email: me.email ?? null, display_name: me.display_name ?? null,
        meta: { app_name: creds.name },
        ...reqMeta,
      });

      return jr({
        ok: true,
        spotify_user_id: me.id,
        display_name: me.display_name,
        email: me.email, scope,
        app: creds.name, app_id: stRow.app_id,
      });
    }

    if (mode === "accounts") {
      const auth = await requireTeamMember(req);
      if (!auth.ok) return auth.resp;

      const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
      const { data, error } = await supabase
        .from("spotify_user_tokens")
        .select("id,spotify_user_id,display_name,email,is_default,scope,expires_at,updated_at,app_id,spotify_apps(name)")
        .order("is_default", { ascending: false })
        .order("updated_at", { ascending: false });
      if (error) return jr({ ok: false, error: error.message }, 500);
      return jr({ ok: true, accounts: data ?? [] });
    }

    if (mode === "apps") {
      const auth = await requireTeamMember(req);
      if (!auth.ok) return auth.resp;
      if (!auth.isAdmin) return jr({ ok: false, error: "Somente admin" }, 403);

      const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
      console.log("[spotify-auth mode=apps] v2 — sem is_default");
      const { data: apps, error } = await supabase
        .from("spotify_apps")
        .select("id, name, slug, client_id, max_accounts, status, notes, owner_email, created_at")
        .order("created_at", { ascending: true });
      if (error) {
        console.error("[spotify-auth mode=apps] select failed", error);
        return jr({ ok: false, error: error.message }, 500);
      }

      // Conta accounts por app (uma query)
      const { data: counts } = await supabase
        .from("spotify_user_tokens")
        .select("app_id");
      const used: Record<string, number> = {};
      for (const r of (counts ?? []) as { app_id: string | null }[]) {
        if (r.app_id) used[r.app_id] = (used[r.app_id] ?? 0) + 1;
      }

      return jr({
        ok: true,
        apps: (apps ?? []).map((a: any) => ({
          ...a,
          client_id_preview: a.client_id ? a.client_id.slice(0, 6) + "…" + a.client_id.slice(-4) : "",
          accounts_used: used[a.id] ?? 0,
          slots_remaining: Math.max(0, (a.max_accounts ?? 5) - (used[a.id] ?? 0)),
        })),
      });
    }

    if (mode === "app_save" && req.method === "POST") {
      const auth = await requireTeamMember(req);
      if (!auth.ok) return auth.resp;
      if (!auth.isAdmin) return jr({ ok: false, error: "Somente admin" }, 403);

      const body = await req.json().catch(() => ({}));
      const id: string | undefined = body.id;
      const name: string = (body.name ?? "").trim();
      const slug: string | null = body.slug ? String(body.slug).trim() : null;
      const client_id: string = (body.client_id ?? "").trim();
      const client_secret: string = (body.client_secret ?? "").trim();
      const max_accounts: number = Number(body.max_accounts ?? 5);
      const notes: string | null = body.notes ?? null;
      const owner_email: string | null = body.owner_email ? String(body.owner_email).trim().toLowerCase() : null;
      const status: string = body.status ?? "active";

      if (!name) return jr({ ok: false, error: "name obrigatório" }, 400);
      if (!id && (!client_id || !client_secret)) {
        return jr({ ok: false, error: "client_id e client_secret obrigatórios" }, 400);
      }

      const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

      if (id) {
        const patch: any = { name, max_accounts, notes, owner_email, status };
        if (client_id) patch.client_id = client_id;
        if (client_secret) patch.client_secret = client_secret;
        if (slug) patch.slug = slug;
        const { error } = await supabase.from("spotify_apps").update(patch).eq("id", id);
        if (error) return jr({ ok: false, error: error.message }, 500);
        return jr({ ok: true, id });
      } else {
        const insert: any = { name, client_id, client_secret, max_accounts, notes, owner_email, status };
        if (slug) insert.slug = slug;
        const { data, error } = await supabase
          .from("spotify_apps")
          .insert(insert)
          .select("id, slug")
          .single();
        if (error) return jr({ ok: false, error: error.message }, 500);
        return jr({ ok: true, id: data.id, slug: data.slug });
      }
    }

    if (mode === "app_delete" && req.method === "POST") {
      const auth = await requireTeamMember(req);
      if (!auth.ok) return auth.resp;
      if (!auth.isAdmin) return jr({ ok: false, error: "Somente admin" }, 403);

      const body = await req.json().catch(() => ({}));
      const id: string = body.id;
      if (!id) return jr({ ok: false, error: "id obrigatório" }, 400);

      const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
      // Bloqueia se houver contas vinculadas
      const { count } = await supabase
        .from("spotify_user_tokens")
        .select("*", { count: "exact", head: true })
        .eq("app_id", id);
      if ((count ?? 0) > 0) {
        return jr({ ok: false, error: `App tem ${count} conta(s) vinculada(s). Remova-as antes.` }, 400);
      }
      const { error } = await supabase.from("spotify_apps").delete().eq("id", id);
      if (error) return jr({ ok: false, error: error.message }, 500);
      return jr({ ok: true });
    }

    return jr({ ok: false, error: `mode desconhecido: ${mode}` }, 400);
  } catch (e) {
    return jr({ ok: false, error: (e as Error).message }, 200);
  }
});
