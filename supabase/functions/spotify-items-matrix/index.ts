// spotify-items-matrix — Auditoria por (app, owner) usando SOMENTE endpoints /items
// Cria sandbox via POST /me/playlists, depois GET /playlists/{id}, GET /items, POST /items, DELETE /items.
// Body opcional: { app_ids?: string[], owners?: { app_id, spotify_user_id }[], test_track_uri?: string }
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DEFAULT_TRACK = "spotify:track:4cOdK2wGLETKBW3PvgPWqT";
const TARGET_APPS = [
  "d17f0d09-149d-47b0-81e7-9eb673ca50bd", // 02
  "821cb0cc-001b-4d2f-a0c0-66cafe055e72", // 05
  "20c9751d-2df9-4898-a24d-a89e96e1713e", // 06
  "c71fb93a-9cc5-4a56-a347-cd627ddede61", // 07
  "e9a23b28-a4cf-4386-ba26-7277f870952a", // 08
];

async function refreshIfNeeded(sb: any, row: any): Promise<string> {
  if (new Date(row.expires_at).getTime() > Date.now() + 60_000) return row.access_token;
  const { data: app } = await sb.from("spotify_apps").select("client_id, client_secret").eq("id", row.app_id).maybeSingle();
  if (!app) throw new Error("app not found");
  const r = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: "Basic " + btoa(`${app.client_id}:${app.client_secret}`) },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: row.refresh_token }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`refresh ${r.status}: ${JSON.stringify(j)}`);
  await sb.from("spotify_user_tokens").update({
    access_token: j.access_token,
    expires_at: new Date(Date.now() + (j.expires_in ?? 3600) * 1000).toISOString(),
    refresh_token: j.refresh_token ?? row.refresh_token,
  }).eq("id", row.id);
  return j.access_token;
}

async function call(token: string, method: string, url: string, body?: unknown) {
  const t0 = Date.now();
  const r = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const txt = await r.text();
  let parsed: any = txt;
  try { parsed = txt ? JSON.parse(txt) : null; } catch {}
  return {
    method, url,
    http_status: r.status,
    ok: r.ok,
    spotify_request_id: r.headers.get("x-spotify-request-id"),
    response_time_ms: Date.now() - t0,
    body: parsed,
  };
}

async function runOwner(sb: any, app: any, row: any, trackUri: string) {
  const base = {
    app_id: app.id, app_name: app.name,
    spotify_user_id: row.spotify_user_id,
    display_name: row.display_name,
    owner_email: row.email ?? null,
  };
  let token: string;
  try { token = await refreshIfNeeded(sb, row); }
  catch (e) {
    return { ...base, error: `refresh: ${(e as Error).message}`, verdict: "REPROVADO" };
  }

  const create = await call(token, "POST", "https://api.spotify.com/v1/me/playlists", {
    name: `__nex_items_matrix_${Date.now()}`, public: false, description: "Audit — safe to delete",
  });
  const playlistId = (create.body as any)?.id;
  const out: any = {
    ...base,
    create: { status: create.http_status, ms: create.response_time_ms, request_id: create.spotify_request_id, playlist_id: playlistId, body: create.ok ? undefined : create.body },
  };
  if (!playlistId) {
    out.verdict = "REPROVADO";
    return out;
  }

  const getPl  = await call(token, "GET",    `https://api.spotify.com/v1/playlists/${playlistId}`);
  const getIt  = await call(token, "GET",    `https://api.spotify.com/v1/playlists/${playlistId}/items?limit=10`);
  const addIt  = await call(token, "POST",   `https://api.spotify.com/v1/playlists/${playlistId}/items`, { uris: [trackUri] });
  const remIt  = await call(token, "DELETE", `https://api.spotify.com/v1/playlists/${playlistId}/items`, { items: [{ uri: trackUri }] });
  const cleanup = await call(token, "DELETE", `https://api.spotify.com/v1/playlists/${playlistId}/followers`);

  out.get_playlist = { status: getPl.http_status, ms: getPl.response_time_ms, request_id: getPl.spotify_request_id, body: getPl.ok ? undefined : getPl.body };
  out.get_items    = { status: getIt.http_status, ms: getIt.response_time_ms, request_id: getIt.spotify_request_id, body: getIt.ok ? undefined : getIt.body };
  out.add_items    = { status: addIt.http_status, ms: addIt.response_time_ms, request_id: addIt.spotify_request_id, snapshot_id: (addIt.body as any)?.snapshot_id ?? null, body: addIt.ok ? undefined : addIt.body };
  out.remove_items = { status: remIt.http_status, ms: remIt.response_time_ms, request_id: remIt.spotify_request_id, snapshot_id: (remIt.body as any)?.snapshot_id ?? null, body: remIt.ok ? undefined : remIt.body };
  out.cleanup      = { status: cleanup.http_status };

  const aprovado =
    create.http_status === 201 &&
    getIt.http_status === 200 &&
    addIt.http_status === 201 &&
    remIt.http_status === 200;
  out.verdict = aprovado ? "APROVADO" : "REPROVADO";
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);
  let body: any = {};
  try { body = await req.json(); } catch {}
  const appIds: string[] = body.app_ids ?? TARGET_APPS;
  const trackUri: string = body.test_track_uri ?? DEFAULT_TRACK;

  const { data: apps } = await sb.from("spotify_apps").select("id,name").in("id", appIds);
  const appMap = new Map((apps ?? []).map((a: any) => [a.id, a]));

  const ownerRows: any[] = [];
  if (body.owners?.length) {
    for (const o of body.owners) {
      const { data } = await sb.from("spotify_user_tokens").select("*")
        .eq("app_id", o.app_id).eq("spotify_user_id", o.spotify_user_id).maybeSingle();
      if (data) ownerRows.push(data);
    }
  } else {
    for (const appId of appIds) {
      const { data } = await sb.from("spotify_user_tokens").select("*")
        .eq("app_id", appId)
        .order("updated_at", { ascending: false }).limit(1);
      if (data?.[0]) ownerRows.push(data[0]);
    }
  }

  const results = [];
  for (const row of ownerRows) {
    const app = appMap.get(row.app_id) ?? { id: row.app_id, name: "?" };
    results.push(await runOwner(sb, app, row, trackUri));
  }

  // Matriz resumida
  const matrix = results.map((r: any) => ({
    app: r.app_name,
    owner: r.display_name ?? r.spotify_user_id,
    spotify_user_id: r.spotify_user_id,
    create: r.create?.status ?? null,
    read_items: r.get_items?.status ?? null,
    add_items: r.add_items?.status ?? null,
    remove_items: r.remove_items?.status ?? null,
    snapshot_add: r.add_items?.snapshot_id ?? null,
    verdict: r.verdict,
  }));

  const aprovados = matrix.filter((m) => m.verdict === "APROVADO");
  const reprovados = matrix.filter((m) => m.verdict === "REPROVADO");
  const byApp = new Map<string, { total: number; ok: number }>();
  for (const m of matrix) {
    const v = byApp.get(m.app) ?? { total: 0, ok: 0 };
    v.total++; if (m.verdict === "APROVADO") v.ok++;
    byApp.set(m.app, v);
  }
  const apps_health = Array.from(byApp.entries()).map(([app, v]) => ({
    app, owners_tested: v.total, owners_aprovados: v.ok,
    status: v.ok === v.total && v.total > 0 ? "SAUDÁVEL" : v.ok === 0 ? "BLOQUEADO" : "PARCIAL",
  }));

  return new Response(JSON.stringify({
    summary: {
      owners_total: matrix.length,
      owners_aprovados: aprovados.length,
      owners_reprovados: reprovados.length,
      apps_health,
      reprovados: reprovados.map((r) => ({ app: r.app, owner: r.owner, spotify_user_id: r.spotify_user_id, create: r.create, get: r.read_items, add: r.add_items, remove: r.remove_items })),
    },
    matrix,
    evidence: results,
  }, null, 2), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
