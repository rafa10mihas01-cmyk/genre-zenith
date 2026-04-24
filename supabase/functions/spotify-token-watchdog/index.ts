// spotify-token-watchdog — força refresh preemptivo dos tokens de usuário Spotify.
// Cron-friendly. Sem auth (chamado via cron com service_role no body opcional).
// POST → checa todas as contas, refresha as que vencem em <10min, alerta as que falharem.
import { corsHeaders } from "npm:@supabase/supabase-js/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CLIENT_ID = Deno.env.get("SPOTIFY_CLIENT_ID")!;
const CLIENT_SECRET = Deno.env.get("SPOTIFY_CLIENT_SECRET")!;

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);
  const threshold = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  const { data: accounts, error } = await sb
    .from("spotify_user_tokens")
    .select("id, spotify_user_id, refresh_token, expires_at")
    .lt("expires_at", threshold);

  if (error) return jr({ error: error.message }, 500);

  const results: any[] = [];
  const basic = btoa(`${CLIENT_ID}:${CLIENT_SECRET}`);

  for (const acc of accounts ?? []) {
    try {
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
        await sb.from("collection_logs").insert({
          acao: "spotify_refresh_failed",
          status: "erro",
          mensagem: `${acc.spotify_user_id}: ${r.status} ${txt.slice(0, 200)}`,
        });
        await sb.rpc("create_notification", {
          p_type: "error",
          p_title: "Spotify token falhou refresh ⚠️",
          p_message: `Conta ${acc.spotify_user_id} precisa reconectar (HTTP ${r.status}).`,
          p_action_url: "/configuracoes",
          p_metadata: { account: acc.spotify_user_id, http: r.status },
        }).then(() => {}, () => {});
        results.push({ account: acc.spotify_user_id, ok: false, status: r.status });
        continue;
      }
      const j = await r.json();
      const access_token: string = j.access_token;
      const expires_at = new Date(Date.now() + (j.expires_in ?? 3600) * 1000).toISOString();
      const refresh_token: string = j.refresh_token ?? acc.refresh_token;
      await sb.from("spotify_user_tokens").update({
        access_token, refresh_token, expires_at,
      }).eq("id", acc.id);
      results.push({ account: acc.spotify_user_id, ok: true, expires_at });
    } catch (e) {
      const msg = (e as Error).message;
      await sb.from("collection_logs").insert({
        acao: "spotify_refresh_failed", status: "erro",
        mensagem: `${acc.spotify_user_id}: ${msg.slice(0, 200)}`,
      });
      results.push({ account: acc.spotify_user_id, ok: false, error: msg });
    }
  }

  return jr({ ok: true, checked: accounts?.length ?? 0, results });
});
