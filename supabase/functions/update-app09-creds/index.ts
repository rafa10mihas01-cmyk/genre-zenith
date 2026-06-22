import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async () => {
  const cid = Deno.env.get("SPOTIFY_APP_09_CLIENT_ID");
  const csec = Deno.env.get("SPOTIFY_APP_09_CLIENT_SECRET");
  if (!cid || !csec) return new Response(JSON.stringify({ error: "missing secrets" }), { status: 400 });

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data, error } = await sb.from("spotify_apps")
    .update({ client_id: cid, client_secret: csec })
    .eq("name", "NexEngine 09")
    .select("id, name");

  // Test refresh on bonde token
  const { data: tok } = await sb.from("spotify_user_tokens")
    .select("refresh_token, email")
    .eq("app_id", data?.[0]?.id)
    .limit(1)
    .single();

  let testResult = null;
  if (tok) {
    const r = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        "Authorization": "Basic " + btoa(`${cid}:${csec}`),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(tok.refresh_token)}`,
    });
    testResult = { email: tok.email, status: r.status, body: (await r.text()).slice(0, 200) };
  }

  return new Response(JSON.stringify({ updated: data, error, test: testResult }, null, 2), {
    headers: { "Content-Type": "application/json" },
  });
});
