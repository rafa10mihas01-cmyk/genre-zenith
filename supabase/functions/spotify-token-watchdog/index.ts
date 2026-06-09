// spotify-token-watchdog — força refresh preemptivo dos tokens de usuário Spotify.
// 🔐 Audit #10 A.2: exige header x-cron-secret OU service_role JWT.
// 📊 Audit #10 A.1: heartbeat sempre logado (mesmo quando 0 contas a refrescar).
import { corsHeaders } from "npm:@supabase/supabase-js/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getAppCredentials } from "../_shared/spotify.ts";
import { reportCronHealth } from "../_shared/cron-health.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Cache do segredo do vault (in-memory por instância)
let _vaultCronSecret: string | null = null;
async function getVaultCronSecret(sb: any): Promise<string> {
  if (_vaultCronSecret !== null) return _vaultCronSecret;
  try {
    const { data } = await sb.rpc("get_cron_secret");
    _vaultCronSecret = (data as string) ?? "";
  } catch { _vaultCronSecret = ""; }
  return _vaultCronSecret;
}

async function authorized(req: Request, sb: any): Promise<boolean> {
  const cs = req.headers.get("x-cron-secret");
  // Edge env match
  if (CRON_SECRET && cs && cs === CRON_SECRET) return true;
  // Vault match (cron usa este)
  if (cs) {
    const vaultSecret = await getVaultCronSecret(sb);
    if (vaultSecret && cs === vaultSecret) return true;
  }
  const auth = req.headers.get("Authorization") ?? "";
  if (auth === `Bearer ${SERVICE_KEY}`) return true;
  return false;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const sbAuth = createClient(SUPABASE_URL, SERVICE_KEY);
  if (!(await authorized(req, sbAuth))) {
    return jr({ error: "unauthorized" }, 401);
  }

  const sb = sbAuth;
  const startedAt = Date.now();
  const threshold = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  const { data: accounts, error } = await sb
    .from("spotify_user_tokens")
    .select("id, spotify_user_id, refresh_token, expires_at, app_id")
    .lt("expires_at", threshold);

  if (error) {
    await sb.from("collection_logs").insert({
      acao: "spotify_token_watchdog", status: "erro",
      mensagem: `query failed: ${error.message}`,
    }).then(() => {}, (e) => console.error("[spotify-token-watchdog] log/op failed:", e?.message ?? e));
    await reportCronHealth(sb, { job_name: "spotify-token-watchdog", status: "error", startedAt, message: error.message });
    return jr({ error: error.message }, 500);
  }

  const results: any[] = [];
  let okCount = 0;
  let failCount = 0;

  // Cache de credenciais por app pra evitar N lookups
  const credsCache: Record<string, { client_id: string; client_secret: string; name: string }> = {};
  async function credsFor(appId: string | null) {
    const key = appId ?? "__env__";
    if (!credsCache[key]) {
      const c = await getAppCredentials(appId);
      credsCache[key] = { client_id: c.client_id, client_secret: c.client_secret, name: c.name };
    }
    return credsCache[key];
  }

  for (const acc of accounts ?? []) {
    try {
      const c = await credsFor(acc.app_id ?? null);
      const basic = btoa(`${c.client_id}:${c.client_secret}`);
      const r = await fetch("https://accounts.spotify.com/api/token", {
        method: "POST",
        headers: {
          Authorization: `Basic ${basic}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: acc.refresh_token,
        }).toString(),
      });
      if (!r.ok) {
        const txt = await r.text();
        failCount++;
        try {
          await sb.from("collection_logs").insert({
            acao: "spotify_refresh_failed",
            status: "erro",
            mensagem: `${acc.spotify_user_id}: ${r.status} ${txt.slice(0, 200)}`,
          });
        } catch (e) {
          console.error("[spotify-token-watchdog] log insert failed:", (e as Error)?.message ?? e);
        }
        try {
          await sb.rpc("create_notification", {
            p_type: "warning",
            p_title: "Conexão Spotify expirada",
            p_message:
              "Uma conta Spotify perdeu acesso e precisa ser reconectada. " +
              "Impacto: enriquecimento e coletas dessa conta estão pausados. " +
              "Ação: abra Configurações e reconecte a conta.",
            p_action_url: "/configuracoes",
            p_metadata: {
              domain: "system",
              severity: "high",
              kind: "spotify_token_failed",
              action_required: true,
              account_id: acc.id,
            },
            p_dedupe_key: `spotify_token_failed:${acc.id}`,
            p_cooldown_minutes: 360,
          });
        } catch (e) {
          console.error("[spotify-token-watchdog] notification rpc failed:", (e as Error)?.message ?? e);
        }
        results.push({ account: acc.spotify_user_id, ok: false, status: r.status });
        continue;
      }
      const j = await r.json();
      const access_token: string = j.access_token;
      const expires_at = new Date(Date.now() + (j.expires_in ?? 3600) * 1000).toISOString();
      const refresh_token: string = j.refresh_token ?? acc.refresh_token;
      // 🔧 Audit #10 B.2: atualiza updated_at também (afeta ordering em getUserAccessToken)
      await sb.from("spotify_user_tokens").update({
        access_token, refresh_token, expires_at, updated_at: new Date().toISOString(),
      }).eq("id", acc.id);
      okCount++;
      results.push({ account: acc.spotify_user_id, ok: true, expires_at });
    } catch (e) {
      const msg = (e as Error).message;
      failCount++;
      await sb.from("collection_logs").insert({
        acao: "spotify_refresh_failed", status: "erro",
        mensagem: `${acc.spotify_user_id}: ${msg.slice(0, 200)}`,
      });
      results.push({ account: acc.spotify_user_id, ok: false, error: msg });
    }
  }

  // 🚨 Audit #11 P2: também refresca app token (client_credentials) se expirado/<10min restantes
  let appTokenRefreshed = false;
  let appTokenError: string | null = null;
  try {
    const { data: appRow } = await sb
      .from("spotify_tokens")
      .select("expires_at")
      .eq("singleton_key", "app")
      .maybeSingle();
    const expSoon = !appRow || new Date(appRow.expires_at).getTime() - Date.now() < 10 * 60 * 1000;
    if (expSoon) {
      const appCreds = await getAppCredentials();
      const appBasic = btoa(`${appCreds.client_id}:${appCreds.client_secret}`);
      const ar = await fetch("https://accounts.spotify.com/api/token", {
        method: "POST",
        headers: {
          Authorization: `Basic ${appBasic}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: "grant_type=client_credentials",
      });
      if (ar.ok) {
        const aj = await ar.json();
        const access_token: string = aj.access_token;
        const expires_at = new Date(Date.now() + (aj.expires_in ?? 3600) * 1000).toISOString();
        await sb.from("spotify_tokens").upsert(
          { singleton_key: "app", access_token, expires_at, app_id: appCreds.app_id },
          { onConflict: "singleton_key" },
        );
        appTokenRefreshed = true;
      } else {
        appTokenError = `HTTP ${ar.status}`;
      }
    }
  } catch (e) {
    appTokenError = (e as Error).message;
  }

  // 📊 Heartbeat sempre — prova que o cron rodou
  const dur = Date.now() - startedAt;
  try {
    await sb.from("collection_logs").insert({
      acao: "spotify_token_watchdog",
      status: failCount > 0 || appTokenError ? "warning" : "sucesso",
      duracao_ms: dur,
      mensagem: `checked=${accounts?.length ?? 0} ok=${okCount} fail=${failCount} app_refreshed=${appTokenRefreshed}${appTokenError ? ` app_err=${appTokenError}` : ""}`,
    });
  } catch (e) {
    console.error("[spotify-token-watchdog] heartbeat log failed:", (e as Error)?.message ?? e);
  }

  await reportCronHealth(sb, {
    job_name: "spotify-token-watchdog",
    status: (failCount > 0 || appTokenError) ? "partial" : "ok",
    startedAt,
    metrics: {
      checked: accounts?.length ?? 0,
      ok_count: okCount,
      fail_count: failCount,
      app_token_refreshed: appTokenRefreshed,
    },
    message: `checked=${accounts?.length ?? 0} ok=${okCount} fail=${failCount} app_refreshed=${appTokenRefreshed}${appTokenError ? ` app_err=${appTokenError}` : ""}`,
  });

  return jr({ ok: true, checked: accounts?.length ?? 0, ok_count: okCount, fail_count: failCount, app_token_refreshed: appTokenRefreshed, app_token_error: appTokenError, results });
});
