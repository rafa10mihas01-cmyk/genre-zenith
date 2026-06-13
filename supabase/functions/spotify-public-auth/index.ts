// spotify-public-auth — fluxo OAuth público para login via Spotify.
//
// verify_jwt = false (rota pública, mas faz validação de state CSRF no DB).
//
// Modos:
//   GET ?mode=login&redirect=<url>
//        → grava state em spotify_oauth_states (flow='public_login') e
//          retorna { url } pra redirecionar ao authorize do Spotify.
//
//   GET ?mode=callback&code=…&state=…&redirect=<url>
//        → valida state (one-shot), troca code por tokens, busca /v1/me,
//          checa allowlist (spotify_email_allowlist), persiste tokens em
//          spotify_user_tokens, cria/recupera usuário no Supabase Auth e
//          gera magic link. Retorna { ok, magic_link } para o client
//          materializar a sessão e redirecionar pra /operacao.
//
//   GET ?mode=callback retorna { ok:false, allowed:false, reason:'not_in_allowlist',
//          email } quando o email não está na allowlist — front mostra "acesso pendente".
import { corsHeaders } from "npm:@supabase/supabase-js/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getAppCredentials } from "../_shared/spotify-client.ts";
import { logAudit, extractRequestMeta } from "../_shared/oauth-audit.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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

function db() {
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = new URL(req.url);
  const mode = url.searchParams.get("mode") ?? "login";
  const reqMeta = extractRequestMeta(req);

  try {
    // ───────────────────────── LOGIN ─────────────────────────
    if (mode === "login") {
      const redirect = url.searchParams.get("redirect");
      if (!redirect) return jr({ ok: false, error: "redirect obrigatório" }, 400);
      const appIdParam = url.searchParams.get("app_id");

      const state = crypto.randomUUID();
      const supabase = db();
      const creds = await getAppCredentials(appIdParam);
      const { error: stErr } = await supabase
        .from("spotify_oauth_states")
        .insert({ state, user_id: null, flow: "public_login", app_id: creds.app_id });
      if (stErr) return jr({ ok: false, error: `state save: ${stErr.message}` }, 500);

      const authUrl = new URL("https://accounts.spotify.com/authorize");
      authUrl.searchParams.set("client_id", creds.client_id);
      authUrl.searchParams.set("response_type", "code");
      authUrl.searchParams.set("redirect_uri", redirect);
      authUrl.searchParams.set("scope", SPOTIFY_USER_SCOPES);
      authUrl.searchParams.set("state", state);
      authUrl.searchParams.set("show_dialog", "true");

      await logAudit(supabase, {
        event: "login_started", flow: "public",
        state, app_id: creds.app_id, ...reqMeta,
      });

      return jr({ ok: true, url: authUrl.toString(), state });
    }

    // ─────────────────────── CALLBACK ────────────────────────
    if (mode === "callback") {
      const code = url.searchParams.get("code");
      const redirect = url.searchParams.get("redirect");
      const state = url.searchParams.get("state");
      const supabase = db();

      const failPublic = async (code_: string, msg: string, extras: Record<string, unknown> = {}) => {
        await logAudit(supabase, {
          event: "failure", flow: "public", status: "error",
          error_code: code_, error_message: msg, state: state ?? null,
          ...reqMeta, meta: extras,
        });
      };

      if (!code || !redirect || !state) {
        await failPublic("missing_params", "code/redirect/state ausentes");
        return jr({ ok: false, error: "code, redirect e state obrigatórios" }, 400);
      }

      await logAudit(supabase, {
        event: "callback_received", flow: "public", state, ...reqMeta,
      });

      // Valida state (one-shot, expira em 30min, flow correto)
      const { data: stRow, error: stErr } = await supabase
        .from("spotify_oauth_states")
        .select("state, flow, app_id, created_at, consumed_at")
        .eq("state", state)
        .maybeSingle();
      if (stErr) {
        await failPublic("state_lookup_failed", stErr.message);
        return jr({ ok: false, error: `state lookup: ${stErr.message}` }, 500);
      }
      if (!stRow) {
        await failPublic("state_not_found", "state inválido");
        return jr({ ok: false, error: "state inválido" }, 400);
      }
      if (stRow.flow !== "public_login") {
        await failPublic("wrong_flow", "state de flow incorreto", { flow: stRow.flow });
        return jr({ ok: false, error: "state de flow incorreto" }, 400);
      }

      // Idempotência: re-disparo dentro de 2min retorna sucesso silencioso
      if (stRow.consumed_at) {
        const ageMs = Date.now() - new Date(stRow.consumed_at).getTime();
        if (ageMs <= 2 * 60 * 1000) {
          return jr({ ok: true, idempotent: true });
        }
        await failPublic("state_already_used", "state já utilizado", { app_id: stRow.app_id });
        return jr({ ok: false, error: "state já utilizado" }, 400);
      }
      const ageMs = Date.now() - new Date(stRow.created_at).getTime();
      if (ageMs > 30 * 60 * 1000) {
        await failPublic("state_expired", "state expirado", { app_id: stRow.app_id });
        return jr({ ok: false, error: "state expirado" }, 400);
      }

      // Marca consumido (one-shot)
      await supabase
        .from("spotify_oauth_states")
        .update({ consumed_at: new Date().toISOString() })
        .eq("state", state);

      // Troca code por tokens (usa app gravado no state)
      const creds = await getAppCredentials(stRow.app_id);
      const basic = btoa(`${creds.client_id}:${creds.client_secret}`);
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
        await failPublic("token_exchange_failed", `${tokenResp.status}: ${t.slice(0, 200)}`, {
          app_id: stRow.app_id, status: tokenResp.status,
        });
        return jr(
          { ok: false, error: `token exchange ${tokenResp.status}: ${t.slice(0, 200)}` },
          400,
        );
      }
      const tj = await tokenResp.json();
      const access_token: string = tj.access_token;
      const refresh_token: string = tj.refresh_token;
      const scope: string = tj.scope ?? "";
      const expires_at = new Date(Date.now() + (tj.expires_in ?? 3600) * 1000).toISOString();

      // Busca perfil do Spotify
      const meResp = await fetch("https://api.spotify.com/v1/me", {
        headers: { Authorization: `Bearer ${access_token}` },
      });
      if (!meResp.ok) {
        const t = await meResp.text();
        await failPublic("me_fetch_failed", `${meResp.status}: ${t.slice(0, 200)}`, {
          app_id: stRow.app_id,
        });
        return jr({ ok: false, error: `me ${meResp.status}: ${t.slice(0, 200)}` }, 400);
      }
      const me = await meResp.json();
      const spotify_user_id: string = me.id;
      const display_name: string | null = me.display_name ?? null;
      const email: string | null = me.email ?? null;

      if (!email) {
        await failPublic("no_email", "Spotify não devolveu email", {
          app_id: stRow.app_id, spotify_user_id,
        });
        return jr(
          {
            ok: false,
            error:
              "Spotify não devolveu email. Confirme que o escopo user-read-email está autorizado.",
          },
          400,
        );
      }

      await logAudit(supabase, {
        event: "token_exchanged", flow: "public",
        state, app_id: stRow.app_id,
        spotify_user_id, email, display_name, ...reqMeta,
      });

      // Persiste tokens (sempre — política definida pelo dono do app)
      const { count } = await supabase
        .from("spotify_user_tokens")
        .select("*", { count: "exact", head: true })
        .eq("is_default", true);

      const { error: upErr } = await supabase
        .from("spotify_user_tokens")
        .upsert(
          {
            spotify_user_id,
            display_name,
            email,
            access_token,
            refresh_token,
            scope,
            expires_at,
            app_id: stRow.app_id,
            is_default: (count ?? 0) === 0,
          },
          { onConflict: "app_id,spotify_user_id" },
        );
      if (upErr) {
        await failPublic("tokens_upsert_failed", upErr.message, {
          app_id: stRow.app_id, spotify_user_id,
        });
        return jr({ ok: false, error: `tokens save: ${upErr.message}` }, 500);
      }

      await logAudit(supabase, {
        event: "account_connected", flow: "public",
        state, app_id: stRow.app_id,
        spotify_user_id, email, display_name, ...reqMeta,
      });

      // Verifica allowlist
      const emailLower = email.toLowerCase();
      const { data: allow } = await supabase
        .from("spotify_email_allowlist")
        .select("email")
        .ilike("email", emailLower)
        .maybeSingle();

      if (!allow) {
        return jr({
          ok: true,
          allowed: false,
          reason: "not_in_allowlist",
          email,
          display_name,
          spotify_user_id,
        });
      }

      // ── Email permitido: cria/recupera usuário no Supabase Auth e gera magic link
      // Procura usuário existente pelo email
      let userId: string | null = null;
      const { data: list, error: listErr } = await supabase.auth.admin.listUsers({
        page: 1,
        perPage: 200,
      });
      if (listErr) return jr({ ok: false, error: `list users: ${listErr.message}` }, 500);
      const existing = list?.users?.find(
        (u) => (u.email ?? "").toLowerCase() === emailLower,
      );
      if (existing) {
        userId = existing.id;
      } else {
        const { data: created, error: cErr } = await supabase.auth.admin.createUser({
          email: emailLower,
          email_confirm: true,
          user_metadata: {
            spotify_user_id,
            display_name,
            provider: "spotify",
          },
        });
        if (cErr) return jr({ ok: false, error: `create user: ${cErr.message}` }, 500);
        userId = created.user?.id ?? null;
      }

      if (!userId) return jr({ ok: false, error: "user_id ausente" }, 500);

      // Gera magic link — o client extrai o token e cria sessão sem email
      const { data: link, error: linkErr } = await supabase.auth.admin.generateLink({
        type: "magiclink",
        email: emailLower,
      });
      if (linkErr || !link?.properties?.action_link) {
        return jr({ ok: false, error: `magic link: ${linkErr?.message ?? "sem link"}` }, 500);
      }

      return jr({
        ok: true,
        allowed: true,
        magic_link: link.properties.action_link,
        email,
        display_name,
        spotify_user_id,
      });
    }

    return jr({ ok: false, error: `mode desconhecido: ${mode}` }, 400);
  } catch (e) {
    return jr({ ok: false, error: (e as Error).message }, 500);
  }
});
