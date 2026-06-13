// spotify-invite — fluxo de convite por link.
//
// O admin gera um link único pra um app específico; o dono da conta Spotify
// abre o link, autoriza no Spotify e a conta cai conectada nesse app — sem
// expor senha pro admin nem precisar estar logado no NexEngine.
//
// Modos:
//   POST ?mode=create        body {app_id, label?, hours?}  (admin)
//        → cria token, retorna { ok, token, url, expires_at }
//
//   GET  ?mode=info&token=…  (público)
//        → { ok, app_name, app_slug, expires_at, consumed_at }
//
//   GET  ?mode=login&token=…&redirect=<url>  (público)
//        → grava state com flow='invite' e retorna { url } pra Spotify
//
//   GET  ?mode=callback&code=…&state=…&redirect=…  (público)
//        → troca code, persiste em spotify_user_tokens vinculado ao app,
//          consome o invite. Retorna { ok, display_name, app_name }.
//
//   GET  ?mode=list&app_id=…  (admin)
//        → lista convites do app (pra UI)
//
//   POST ?mode=revoke  body {token}  (admin)
//        → expira o convite (set expires_at=now())

import { corsHeaders } from "npm:@supabase/supabase-js/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { SPOTIFY_USER_SCOPES, getAppCredentials } from "../_shared/spotify-client.ts";
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

function db() {
  return createClient(SUPABASE_URL, SERVICE_KEY);
}

async function requireAdmin(req: Request) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return { ok: false as const, resp: jr({ ok: false, error: "Não autenticado" }, 401) };
  }
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data, error } = await userClient.auth.getClaims(authHeader.replace("Bearer ", ""));
  if (error || !data?.claims?.sub) {
    return { ok: false as const, resp: jr({ ok: false, error: "Token inválido" }, 401) };
  }
  const userId = data.claims.sub as string;
  const admin = db();
  const { data: isAdmin } = await admin.rpc("has_role", { _user_id: userId, _role: "admin" });
  const { data: isCurador } = await admin.rpc("has_role", { _user_id: userId, _role: "curador" });
  if (!isAdmin && !isCurador) {
    return { ok: false as const, resp: jr({ ok: false, error: "Acesso restrito" }, 403) };
  }
  return { ok: true as const, userId };
}

function inviteUrlFor(token: string, origin: string) {
  return `${origin}/spotify/invite/${token}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = new URL(req.url);
  const mode = url.searchParams.get("mode") ?? "";
  const reqMeta = extractRequestMeta(req);

  try {
    // ─────────────────────── CREATE (admin) ──────────────────────
    if (mode === "create" && req.method === "POST") {
      const auth = await requireAdmin(req);
      if (!auth.ok) return auth.resp;

      const body = await req.json().catch(() => ({}));
      const app_id: string | undefined = body.app_id;
      const label: string | null = (body.label ?? "").trim() || null;
      const hours = Math.min(Math.max(Number(body.hours ?? 48), 1), 24 * 14);
      if (!app_id) return jr({ ok: false, error: "app_id obrigatório" }, 400);

      const sb = db();
      const { data: app, error: appErr } = await sb
        .from("spotify_apps")
        .select("id, name, slug, max_accounts, status")
        .eq("id", app_id)
        .maybeSingle();
      if (appErr || !app) return jr({ ok: false, error: "App não encontrado" }, 404);
      if (app.status !== "active") return jr({ ok: false, error: `App ${app.status}` }, 400);

      const { count } = await sb
        .from("spotify_user_tokens")
        .select("*", { count: "exact", head: true })
        .eq("app_id", app_id);
      if ((count ?? 0) >= app.max_accounts) {
        return jr({ ok: false, error: `App "${app.name}" lotado (${count}/${app.max_accounts})` }, 400);
      }

      const token = crypto.randomUUID().replace(/-/g, "");
      const expires_at = new Date(Date.now() + hours * 3600 * 1000).toISOString();
      const { error: insErr } = await sb.from("spotify_invite_tokens").insert({
        token, app_id, created_by: auth.userId, label, expires_at,
      });
      if (insErr) {
        await logAudit(sb, {
          event: "failure", flow: "invite", status: "error",
          error_code: "invite_create_failed", error_message: insErr.message,
          app_id, actor_user_id: auth.userId, ...reqMeta,
        });
        return jr({ ok: false, error: insErr.message }, 500);
      }

      await logAudit(sb, {
        event: "invite_created", flow: "invite",
        invite_token: token, app_id, actor_user_id: auth.userId,
        meta: { label, hours, app_name: app.name },
        ...reqMeta,
      });

      const origin = req.headers.get("origin") || body.origin || "";
      return jr({
        ok: true,
        token,
        url: origin ? inviteUrlFor(token, origin) : null,
        path: `/spotify/invite/${token}`,
        expires_at,
        app: { id: app.id, name: app.name, slug: app.slug },
      });
    }

    // ─────────────────────── INFO (público) ──────────────────────
    if (mode === "info") {
      const token = url.searchParams.get("token");
      if (!token) return jr({ ok: false, error: "token obrigatório" }, 400);
      const sb = db();
      const { data, error } = await sb
        .from("spotify_invite_tokens")
        .select("token, app_id, label, expires_at, consumed_at, consumed_email, spotify_apps(name, slug)")
        .eq("token", token)
        .maybeSingle();
      if (error) return jr({ ok: false, error: error.message }, 500);
      if (!data) return jr({ ok: false, error: "invite_not_found" }, 404);
      const expired = new Date(data.expires_at).getTime() < Date.now();
      await logAudit(sb, {
        event: "invite_opened", flow: "invite",
        invite_token: data.token, app_id: data.app_id,
        meta: { expired, consumed: !!data.consumed_at },
        ...reqMeta,
      });
      return jr({
        ok: true,
        token: data.token,
        label: data.label,
        expires_at: data.expires_at,
        consumed_at: data.consumed_at,
        consumed_email: data.consumed_email,
        expired,
        app_name: (data.spotify_apps as any)?.name ?? null,
        app_slug: (data.spotify_apps as any)?.slug ?? null,
      });
    }

    // ─────────────────────── LOGIN (público) ─────────────────────
    if (mode === "login") {
      const token = url.searchParams.get("token");
      const redirect = url.searchParams.get("redirect");
      if (!token || !redirect) return jr({ ok: false, error: "token e redirect obrigatórios" }, 400);

      const sb = db();
      const { data: inv } = await sb
        .from("spotify_invite_tokens")
        .select("token, app_id, expires_at, consumed_at")
        .eq("token", token)
        .maybeSingle();
      if (!inv) return jr({ ok: false, error: "invite_not_found" }, 404);
      if (inv.consumed_at) return jr({ ok: false, error: "invite_already_used" }, 400);
      if (new Date(inv.expires_at).getTime() < Date.now()) {
        return jr({ ok: false, error: "invite_expired" }, 400);
      }

      const creds = await getAppCredentials(inv.app_id);

      // O state guarda o invite_token codificado no próprio state pra
      // recuperarmos no callback. Formato: "inv_<token>_<random>"
      const random = crypto.randomUUID().replace(/-/g, "");
      const state = `inv_${token}_${random}`;
      const { error: stErr } = await sb
        .from("spotify_oauth_states")
        .insert({ state, user_id: null, flow: "invite", app_id: inv.app_id });
      if (stErr) return jr({ ok: false, error: `state save: ${stErr.message}` }, 500);

      const authUrl = new URL("https://accounts.spotify.com/authorize");
      authUrl.searchParams.set("client_id", creds.client_id);
      authUrl.searchParams.set("response_type", "code");
      authUrl.searchParams.set("redirect_uri", redirect);
      authUrl.searchParams.set("scope", SPOTIFY_USER_SCOPES);
      authUrl.searchParams.set("state", state);
      authUrl.searchParams.set("show_dialog", "true");
      await logAudit(sb, {
        event: "login_started", flow: "invite",
        invite_token: token, app_id: inv.app_id, state,
        ...reqMeta,
      });
      return jr({ ok: true, url: authUrl.toString(), state });
    }

    // ─────────────────────── CALLBACK (público) ──────────────────
    if (mode === "callback") {
      const code = url.searchParams.get("code");
      const redirect = url.searchParams.get("redirect");
      const state = url.searchParams.get("state");
      const sbEarly = db();
      const failInvite = async (code_: string, msg: string, extras: Record<string, unknown> = {}) => {
        await logAudit(sbEarly, {
          event: "failure", flow: "invite", status: "error",
          error_code: code_, error_message: msg, state, ...reqMeta,
          meta: extras,
        });
      };

      if (!code || !redirect || !state) {
        await failInvite("missing_params", "code/redirect/state ausentes");
        return jr({ ok: false, error: "code, redirect, state obrigatórios" }, 400);
      }
      if (!state.startsWith("inv_")) {
        await failInvite("wrong_flow", "state não é de convite");
        return jr({ ok: false, error: "state não é de convite" }, 400);
      }

      // Extrai invite_token: "inv_<token>_<random>"
      const rest = state.slice(4);
      const sepIdx = rest.lastIndexOf("_");
      if (sepIdx < 0) {
        await failInvite("state_malformed", "state malformado");
        return jr({ ok: false, error: "state malformado" }, 400);
      }
      const inviteToken = rest.slice(0, sepIdx);

      const sb = db();
      await logAudit(sb, {
        event: "callback_received", flow: "invite",
        invite_token: inviteToken, state, ...reqMeta,
      });

      // Valida state
      const { data: stRow } = await sb
        .from("spotify_oauth_states")
        .select("state, flow, app_id, created_at, consumed_at")
        .eq("state", state)
        .maybeSingle();
      if (!stRow) {
        await failInvite("state_not_found", "state inválido", { invite_token: inviteToken });
        return jr({ ok: false, error: "state inválido" }, 400);
      }
      if (stRow.flow !== "invite") {
        await failInvite("wrong_flow", "flow incorreto", { flow: stRow.flow });
        return jr({ ok: false, error: "flow incorreto" }, 400);
      }
      if (stRow.consumed_at) {
        const age = Date.now() - new Date(stRow.consumed_at).getTime();
        if (age <= 2 * 60 * 1000) return jr({ ok: true, idempotent: true });
        await failInvite("state_already_used", "state já utilizado", { app_id: stRow.app_id });
        return jr({ ok: false, error: "state já utilizado" }, 400);
      }
      if (Date.now() - new Date(stRow.created_at).getTime() > 30 * 60 * 1000) {
        await failInvite("state_expired", "state expirado", { app_id: stRow.app_id });
        return jr({ ok: false, error: "state expirado" }, 400);
      }
      await sb.from("spotify_oauth_states").update({ consumed_at: new Date().toISOString() }).eq("state", state);

      // Valida invite
      const { data: inv } = await sb
        .from("spotify_invite_tokens")
        .select("token, app_id, expires_at, consumed_at")
        .eq("token", inviteToken)
        .maybeSingle();
      if (!inv) {
        await failInvite("invite_not_found", "invite inexistente", { invite_token: inviteToken });
        return jr({ ok: false, error: "invite_not_found" }, 404);
      }
      if (inv.consumed_at) {
        await failInvite("invite_already_used", "invite já usado", { invite_token: inviteToken, app_id: inv.app_id });
        return jr({ ok: false, error: "invite_already_used" }, 400);
      }
      if (new Date(inv.expires_at).getTime() < Date.now()) {
        await failInvite("invite_expired", "invite expirado", { invite_token: inviteToken, app_id: inv.app_id });
        return jr({ ok: false, error: "invite_expired" }, 400);
      }

      // Troca code por tokens
      const creds = await getAppCredentials(inv.app_id);
      const basic = btoa(`${creds.client_id}:${creds.client_secret}`);
      const tokenResp = await fetch("https://accounts.spotify.com/api/token", {
        method: "POST",
        headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirect }).toString(),
      });
      if (!tokenResp.ok) {
        const t = await tokenResp.text();
        await failInvite("token_exchange_failed", `${tokenResp.status}: ${t.slice(0, 200)}`, {
          app_id: inv.app_id, invite_token: inviteToken, status: tokenResp.status,
        });
        return jr({ ok: false, error: `token exchange ${tokenResp.status}: ${t.slice(0, 200)}` }, 400);
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
        await failInvite("me_fetch_failed", `${meResp.status}: ${t.slice(0, 200)}`, {
          app_id: inv.app_id, invite_token: inviteToken,
        });
        return jr({ ok: false, error: `me ${meResp.status}: ${t.slice(0, 200)}` }, 400);
      }
      const me = await meResp.json();

      await logAudit(sb, {
        event: "token_exchanged", flow: "invite",
        invite_token: inviteToken, app_id: inv.app_id,
        spotify_user_id: me.id, email: me.email ?? null, display_name: me.display_name ?? null,
        state, ...reqMeta,
      });

      // Confere vaga (a vaga existia ao criar o convite, mas pode ter sido consumida por outro convite)
      const { data: app } = await sb
        .from("spotify_apps")
        .select("id, name, max_accounts")
        .eq("id", inv.app_id)
        .maybeSingle();
      if (!app) {
        await failInvite("app_missing", "App não existe mais", { app_id: inv.app_id });
        return jr({ ok: false, error: "App não existe mais" }, 400);
      }

      // Checa vínculo cruzado consultando TODAS as linhas pra essa conta
      // (a constraint composta permite multi-app; queremos saber se já existe outro app).
      const { data: existingRows } = await sb
        .from("spotify_user_tokens")
        .select("spotify_user_id, app_id")
        .eq("spotify_user_id", me.id);
      const existingSameApp = (existingRows ?? []).find((r: any) => r.app_id === inv.app_id);
      const existingOtherApp = (existingRows ?? []).find((r: any) => r.app_id !== inv.app_id);

      if (existingOtherApp && !existingSameApp) {
        // Política: convite só vincula a UM app. Registra tentativa cruzada.
        const { data: otherApp } = await sb
          .from("spotify_apps")
          .select("name")
          .eq("id", existingOtherApp.app_id)
          .maybeSingle();
        await logAudit(sb, {
          event: "failure", flow: "invite", status: "error",
          error_code: "account_in_use",
          error_message: `Conta já vinculada ao app ${otherApp?.name ?? existingOtherApp.app_id}`,
          invite_token: inviteToken, app_id: inv.app_id,
          spotify_user_id: me.id, email: me.email ?? null, display_name: me.display_name ?? null,
          state,
          meta: { other_app_id: existingOtherApp.app_id, other_app_name: otherApp?.name ?? null },
          ...reqMeta,
        });
        return jr({ ok: false, error: `Essa conta Spotify já está vinculada a outro app` }, 400);
      }
      if (!existingSameApp) {
        const { count } = await sb
          .from("spotify_user_tokens")
          .select("*", { count: "exact", head: true })
          .eq("app_id", inv.app_id);
        if ((count ?? 0) >= app.max_accounts) {
          await failInvite("app_full", `App "${app.name}" lotado`, {
            app_id: inv.app_id, app_name: app.name, count, max: app.max_accounts,
          });
          return jr({ ok: false, error: `App "${app.name}" lotado` }, 400);
        }
      }

      const { count: defCount } = await sb
        .from("spotify_user_tokens")
        .select("*", { count: "exact", head: true })
        .eq("is_default", true);

      const { error: upErr } = await sb.from("spotify_user_tokens").upsert({
        spotify_user_id: me.id,
        display_name: me.display_name ?? null,
        email: me.email ?? null,
        access_token, refresh_token, scope, expires_at,
        app_id: inv.app_id,
        is_default: (defCount ?? 0) === 0,
      }, { onConflict: "app_id,spotify_user_id" });
      if (upErr) {
        await failInvite("tokens_upsert_failed", upErr.message, {
          app_id: inv.app_id, spotify_user_id: me.id,
        });
        return jr({ ok: false, error: upErr.message }, 500);
      }

      // Marca invite como consumido
      await sb.from("spotify_invite_tokens").update({
        consumed_at: new Date().toISOString(),
        consumed_spotify_user_id: me.id,
        consumed_email: me.email ?? null,
      }).eq("token", inviteToken);

      await logAudit(sb, {
        event: "account_connected", flow: "invite",
        invite_token: inviteToken, app_id: inv.app_id,
        spotify_user_id: me.id, email: me.email ?? null, display_name: me.display_name ?? null,
        state,
        meta: { app_name: app.name },
        ...reqMeta,
      });

      return jr({
        ok: true,
        display_name: me.display_name,
        email: me.email,
        spotify_user_id: me.id,
        app_name: app.name,
      });
    }

    // ─────────────────────── LIST (admin) ────────────────────────
    if (mode === "list") {
      const auth = await requireAdmin(req);
      if (!auth.ok) return auth.resp;
      const app_id = url.searchParams.get("app_id");
      const sb = db();
      let q = sb.from("spotify_invite_tokens")
        .select("token, app_id, label, expires_at, consumed_at, consumed_email, created_at")
        .order("created_at", { ascending: false })
        .limit(50);
      if (app_id) q = q.eq("app_id", app_id);
      const { data, error } = await q;
      if (error) return jr({ ok: false, error: error.message }, 500);
      return jr({ ok: true, invites: data ?? [] });
    }

    // ─────────────────────── REVOKE (admin) ──────────────────────
    if (mode === "revoke" && req.method === "POST") {
      const auth = await requireAdmin(req);
      if (!auth.ok) return auth.resp;
      const body = await req.json().catch(() => ({}));
      const token = body.token;
      if (!token) return jr({ ok: false, error: "token obrigatório" }, 400);
      const sb = db();
      const { error } = await sb.from("spotify_invite_tokens")
        .update({ expires_at: new Date().toISOString() })
        .eq("token", token)
        .is("consumed_at", null);
      if (error) return jr({ ok: false, error: error.message }, 500);
      return jr({ ok: true });
    }

    return jr({ ok: false, error: `mode desconhecido: ${mode}` }, 400);
  } catch (e) {
    return jr({ ok: false, error: (e as Error).message }, 500);
  }
});
