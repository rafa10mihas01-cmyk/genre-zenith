import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async () => {
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: apps } = await sb.from("spotify_apps").select("id,name,client_id,client_secret").order("name");
  const results: any[] = [];
  for (const app of apps!) {
    const { data: toks } = await sb.from("spotify_user_tokens").select("id,email,refresh_token").eq("app_id", app.id);
    for (const t of toks!) {
      const r = await fetch("https://accounts.spotify.com/api/token", {
        method: "POST",
        headers: { "Authorization": "Basic " + btoa(`${app.client_id}:${app.client_secret}`), "Content-Type": "application/x-www-form-urlencoded" },
        body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(t.refresh_token)}`,
      });
      const j = await r.json();
      let me = null;
      if (j.access_token) {
        const m = await fetch("https://api.spotify.com/v1/me", { headers: { Authorization: `Bearer ${j.access_token}` } });
        me = m.status; await m.text();
      }
      results.push({ app: app.name, email: t.email, refresh: r.status, me, err: j.error || null });
    }
  }
  return new Response(JSON.stringify(results, null, 2), { headers: { "Content-Type": "application/json" } });
});
