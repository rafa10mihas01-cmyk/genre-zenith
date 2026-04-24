// _shared/spotify.ts — Spotify auth helpers
//   - getSpotifyToken(): Client Credentials (app-only) — leitura pública
//   - getUserAccessToken(): OAuth user token (refresh automático) — necessário para criar playlists
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CLIENT_ID = Deno.env.get("SPOTIFY_CLIENT_ID");
const CLIENT_SECRET = Deno.env.get("SPOTIFY_CLIENT_SECRET");

export const SPOTIFY_USER_SCOPES = [
  "playlist-modify-public",
  "playlist-modify-private",
  "ugc-image-upload",
  "user-read-email",
].join(" ");

function db() {
  return createClient(SUPABASE_URL, SERVICE_KEY);
}

export async function getSpotifyToken(forceRefresh = false): Promise<string> {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    throw new Error("SPOTIFY_CLIENT_ID/SECRET não configurados");
  }
  const supabase = db();

  if (!forceRefresh) {
    // 🚨 Audit #9 A.4 — lê singleton row diretamente (usa idx_spotify_tokens_singleton)
    const { data } = await supabase
      .from("spotify_tokens")
      .select("access_token,expires_at")
      .eq("singleton_key", "app")
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

  // 🚨 Audit #8 B.2 — UPSERT atômico em singleton row (elimina race condition INSERT+DELETE)
  await supabase.from("spotify_tokens").upsert(
    { singleton_key: "app", access_token, expires_at },
    { onConflict: "singleton_key" },
  );

  return access_token;
}

export type SpotifyUserToken = {
  id: string;
  spotify_user_id: string;
  display_name: string | null;
  email: string | null;
  access_token: string;
  refresh_token: string;
  scope: string | null;
  expires_at: string;
  is_default: boolean;
};

/** Faz refresh do token de usuário e persiste o novo access_token. */
async function refreshUserToken(row: SpotifyUserToken): Promise<string> {
  if (!CLIENT_ID || !CLIENT_SECRET) throw new Error("SPOTIFY_CLIENT_ID/SECRET não configurados");
  const basic = btoa(`${CLIENT_ID}:${CLIENT_SECRET}`);
  const resp = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: row.refresh_token,
    }).toString(),
  });
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`Spotify refresh ${resp.status}: ${t.slice(0, 200)}`);
  }
  const j = await resp.json();
  const access_token: string = j.access_token;
  const expires_at = new Date(Date.now() + (j.expires_in ?? 3600) * 1000).toISOString();
  const newRefresh: string = j.refresh_token ?? row.refresh_token;

  await db()
    .from("spotify_user_tokens")
    .update({ access_token, refresh_token: newRefresh, expires_at })
    .eq("id", row.id);

  return access_token;
}

/** Retorna access_token de usuário válido (faz refresh se necessário).
 *  Se userId não informado, usa o default ou o mais recente. */
export async function getUserAccessToken(userId?: string): Promise<{ token: string; row: SpotifyUserToken }> {
  const supabase = db();
  let q = supabase.from("spotify_user_tokens").select("*");
  if (userId) q = q.eq("spotify_user_id", userId);
  else q = q.order("is_default", { ascending: false }).order("updated_at", { ascending: false });
  const { data, error } = await q.limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Nenhuma conta Spotify conectada. Conecte em Configurações primeiro.");

  const row = data as SpotifyUserToken;
  const expiresMs = new Date(row.expires_at).getTime();
  if (expiresMs > Date.now() + 60_000) return { token: row.access_token, row };
  const fresh = await refreshUserToken(row);
  return { token: fresh, row: { ...row, access_token: fresh } };
}
