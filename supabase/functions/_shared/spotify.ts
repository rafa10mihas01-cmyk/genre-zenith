// _shared/spotify.ts — helper de access_token (Client Credentials) com cache em DB
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CLIENT_ID = Deno.env.get("SPOTIFY_CLIENT_ID");
const CLIENT_SECRET = Deno.env.get("SPOTIFY_CLIENT_SECRET");

export async function getSpotifyToken(forceRefresh = false): Promise<string> {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    throw new Error("SPOTIFY_CLIENT_ID/SECRET não configurados");
  }
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  if (!forceRefresh) {
    const { data } = await supabase
      .from("spotify_tokens")
      .select("access_token,expires_at")
      .order("expires_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data && new Date(data.expires_at).getTime() > Date.now() + 60_000) {
      return data.access_token;
    }
  }

  const basic = btoa(`${CLIENT_ID}:${CLIENT_SECRET}`);
  const resp = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`Spotify token ${resp.status}: ${t.slice(0, 200)}`);
  }
  const json = await resp.json();
  const access_token: string = json.access_token;
  const expires_at = new Date(Date.now() + (json.expires_in ?? 3600) * 1000).toISOString();

  await supabase.from("spotify_tokens").insert({ access_token, expires_at });
  await supabase.from("spotify_tokens").delete().lt("expires_at", new Date().toISOString());

  return access_token;
}
