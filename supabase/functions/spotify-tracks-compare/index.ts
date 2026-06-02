// spotify-tracks-compare — Comparative forensics: same Spotify user across multiple apps,
// running identical GET /playlists/{id}/tracks variants.
// Goal: prove if 403 is request-shape dependent or client_id dependent.
//
// Body: { spotify_user_ids?: string[], playlist_id?: string }
// Defaults: tests a curated set of users present in apps 01 + (05/06/07/08).
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Same user authorized on App 01 (old) AND App 05/06/07/08 (new) — gives clean A/B
const DEFAULT_USERS = [
  "22ng2pjzdb2tucin4324eh5cq", // Playlists do Lucas → apps 05 + 01
  "223kkcpliwfmurqsdn3e2uutq", // Play lists Mamute → apps 05 + 01
  "6p5z5stfg640xtjoobureeo3g", // Musicas do momento → apps 05 + 01
];

const APP_NAMES: Record<string, string> = {
  "d0676425-59bc-40a1-94ad-d96ce7b483c4": "App 01 (NexEngine)",
  "d17f0d09-149d-47b0-81e7-9eb673ca50bd": "App 02",
  "091a1854-d762-4455-9308-5897f5d8a418": "App 03",
  "5eae32c6-0d89-4d36-9138-29c04fc96994": "App 04",
  "821cb0cc-001b-4d2f-a0c0-66cafe055e72": "App 05",
  "20c9751d-2df9-4898-a24d-a89e96e1713e": "App 06",
  "c71fb93a-9cc5-4a56-a347-cd627ddede61": "App 07",
  "e9a23b28-a4cf-4386-ba26-7277f870952a": "App 08",
};

interface TokenRow {
  id: string;
  app_id: string;
  spotify_user_id: string;
  display_name: string | null;
  access_token: string;
  refresh_token: string;
  expires_at: string;
  scope: string;
}

async function refreshIfNeeded(sb: ReturnType<typeof createClient>, row: TokenRow): Promise<string> {
  if (new Date(row.expires_at).getTime() > Date.now() + 60_000) return row.access_token;
  const { data: app } = await sb.from("spotify_apps").select("client_id, client_secret").eq("id", row.app_id).maybeSingle();
  if (!app) throw new Error(`app ${row.app_id} not found`);
  const r = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: "Basic " + btoa(`${app.client_id}:${app.client_secret}`),
    },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: row.refresh_token }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`refresh ${r.status}: ${JSON.stringify(j)}`);
  const newToken = j.access_token as string;
  const expiresAt = new Date(Date.now() + (j.expires_in ?? 3600) * 1000).toISOString();
  await sb.from("spotify_user_tokens").update({
    access_token: newToken,
    expires_at: expiresAt,
    refresh_token: j.refresh_token ?? row.refresh_token,
  }).eq("id", row.id);
  return newToken;
}

async function call(token: string, method: string, url: string, extraHeaders: Record<string, string> = {}) {
  const r = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...extraHeaders },
  });
  const txt = await r.text();
  let parsed: unknown = txt;
  try { parsed = txt ? JSON.parse(txt) : null; } catch { /* */ }
  const headers: Record<string, string> = {};
  r.headers.forEach((v, k) => { headers[k] = v; });
  return {
    url, method,
    http_status: r.status,
    ok: r.ok,
    spotify_request_id: r.headers.get("x-spotify-request-id") ?? r.headers.get("x-request-id"),
    retry_after: r.headers.get("retry-after"),
    response_headers: headers,
    body_preview: typeof parsed === "string" ? parsed.slice(0, 400) : parsed,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);
  let body: { spotify_user_ids?: string[]; playlist_id?: string } = {};
  try { body = await req.json(); } catch { /* */ }
  const userIds = body.spotify_user_ids?.length ? body.spotify_user_ids : DEFAULT_USERS;

  const results: unknown[] = [];

  for (const uid of userIds) {
    const { data: tokens } = await sb.from("spotify_user_tokens").select("*").eq("spotify_user_id", uid);
    if (!tokens?.length) {
      results.push({ spotify_user_id: uid, error: "no tokens" });
      continue;
    }

    // pick a playlist owned by this user via the first available token (any app)
    let playlistId = body.playlist_id ?? null;
    let playlistMeta: unknown = null;
    let playlistOwnerApp: string | null = null;

    if (!playlistId) {
      for (const t of tokens) {
        const tok = await refreshIfNeeded(sb, t as TokenRow).catch(() => null);
        if (!tok) continue;
        const me = await call(tok, "GET", "https://api.spotify.com/v1/me/playlists?limit=20");
        const items = (me.body_preview as { items?: Array<{ id: string; name: string; owner?: { id: string }; tracks?: { total: number } }> } | null)?.items ?? [];
        const own = items.find((p) => p.owner?.id === uid && (p.tracks?.total ?? 0) > 0);
        if (own) {
          playlistId = own.id;
          playlistMeta = { name: own.name, total_tracks_reported: own.tracks?.total ?? null };
          playlistOwnerApp = (t as TokenRow).app_id;
          break;
        }
      }
    }

    if (!playlistId) {
      results.push({ spotify_user_id: uid, error: "no owned playlist with tracks found" });
      continue;
    }

    // Variants to test
    const variants = [
      { label: "plain", qs: "" },
      { label: "limit=1", qs: "?limit=1" },
      { label: "fields=items(track(id))", qs: "?fields=" + encodeURIComponent("items(track(id))") },
      { label: "market=BR", qs: "?market=BR" },
      { label: "market=from_token", qs: "?market=from_token" },
      { label: "additional_types=track", qs: "?additional_types=track" },
      { label: "limit=1&market=BR&additional_types=track", qs: "?limit=1&market=BR&additional_types=track" },
    ];

    const perApp: unknown[] = [];
    for (const t of tokens) {
      const row = t as TokenRow;
      const appLabel = APP_NAMES[row.app_id] ?? row.app_id;
      let tok: string;
      try { tok = await refreshIfNeeded(sb, row); }
      catch (e) {
        perApp.push({ app: appLabel, app_id: row.app_id, error: `refresh: ${(e as Error).message}` });
        continue;
      }
      // probe: GET /me (sanity)
      const me = await call(tok, "GET", "https://api.spotify.com/v1/me");
      const product = (me.body_preview as { product?: string } | null)?.product ?? null;
      const country = (me.body_preview as { country?: string } | null)?.country ?? null;
      // probe: GET /playlists/{id} (no /tracks)
      const meta = await call(tok, "GET", `https://api.spotify.com/v1/playlists/${playlistId}?fields=id,name,owner.id,tracks.total`);
      // variants
      const variantResults: Record<string, { status: number; req_id: string | null; body: unknown }> = {};
      for (const v of variants) {
        const r = await call(tok, "GET", `https://api.spotify.com/v1/playlists/${playlistId}/tracks${v.qs}`);
        variantResults[v.label] = { status: r.http_status, req_id: r.spotify_request_id, body: r.body_preview };
      }
      perApp.push({
        app: appLabel,
        app_id: row.app_id,
        me_status: me.http_status,
        product, country,
        scope: row.scope,
        playlist_meta_status: meta.http_status,
        playlist_meta_body: meta.body_preview,
        tracks_variants: variantResults,
      });
    }

    results.push({
      spotify_user_id: uid,
      display_name: (tokens[0] as TokenRow).display_name,
      playlist_id: playlistId,
      playlist_meta: playlistMeta,
      discovered_via_app: playlistOwnerApp ? (APP_NAMES[playlistOwnerApp] ?? playlistOwnerApp) : null,
      per_app: perApp,
    });
  }

  // Summary matrix
  const matrix: Array<Record<string, unknown>> = [];
  for (const r of results as Array<{ spotify_user_id: string; display_name: string | null; playlist_id?: string; per_app?: Array<{ app: string; tracks_variants?: Record<string, { status: number }> }> }>) {
    if (!r.per_app) continue;
    for (const a of r.per_app) {
      if (!a.tracks_variants) continue;
      const row: Record<string, unknown> = { user: r.display_name, spotify_user_id: r.spotify_user_id, playlist_id: r.playlist_id, app: a.app };
      for (const [k, v] of Object.entries(a.tracks_variants)) row[k] = v.status;
      matrix.push(row);
    }
  }

  return new Response(JSON.stringify({ ok: true, matrix, results }, null, 2), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
