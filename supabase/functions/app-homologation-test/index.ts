// app-homologation-test — validação operacional real per (app, owner)
// Cria playlist sandbox privada no owner, GET /me, GET playlist, GET tracks,
// POST add, GET tracks, DELETE remove, GET tracks, unfollow playlist.
// NÃO toca em playlists de clientes/campanhas.
//
// Body: { app_ids?: string[], owners?: { app_id: string, spotify_user_id: string }[] }
// Sem body = roda 1 owner por app (05/06/07/08).
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { refreshUserToken, type SpotifyUserToken } from "../_shared/spotify-client.ts";
import { spotifyFetch } from "../_shared/spotify-client.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TEST_TRACK_URI = "spotify:track:4cOdK2wGLETKBW3PvgPWqT"; // Rick Astley
const TARGET_APPS = [
  "821cb0cc-001b-4d2f-a0c0-66cafe055e72", // 05
  "20c9751d-2df9-4898-a24d-a89e96e1713e", // 06
  "c71fb93a-9cc5-4a56-a347-cd627ddede61", // 07
  "e9a23b28-a4cf-4386-ba26-7277f870952a", // 08
];

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p, null, 2), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function getValidToken(row: SpotifyUserToken): Promise<string> {
  if (new Date(row.expires_at).getTime() > Date.now() + 60_000) return row.access_token;
  return await refreshUserToken(row);
}

type StepResult = {
  step: string;
  method: string;
  url: string;
  request_body: unknown;
  http_status: number | null;
  spotify_request_id: string | null;
  response_headers: Record<string, string> | null;
  ok: boolean;
  body_preview: unknown;
  raw_body: string | null;
  error?: string;
};

async function call(token: string, method: string, url: string, body?: unknown): Promise<StepResult> {
  const init: RequestInit = {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  try {
    const r = await spotifyFetch(url, init, { functionName: "app-homologation-test", operation: "homologation_step" });
    const txt = await r.text();
    let parsed: unknown = txt;
    try { parsed = txt ? JSON.parse(txt) : null; } catch { /* keep text */ }
    const headers: Record<string, string> = {};
    r.headers.forEach((v, k) => { headers[k] = v; });
    return {
      step: "",
      method,
      url,
      request_body: body ?? null,
      http_status: r.status,
      spotify_request_id: r.headers.get("x-spotify-request-id") ?? r.headers.get("x-request-id"),
      response_headers: headers,
      ok: r.ok,
      body_preview: typeof parsed === "string" ? parsed.slice(0, 2000) : parsed,
      raw_body: txt,
    };
  } catch (e) {
    return {
      step: "", method, url, request_body: body ?? null,
      http_status: null, spotify_request_id: null, response_headers: null,
      ok: false, body_preview: null, raw_body: null,
      error: (e as Error).message,
    };
  }
}

async function runOwner(app: { id: string; name: string }, row: SpotifyUserToken): Promise<{
  app_id: string; app_name: string; spotify_user_id: string; display_name: string | null;
  steps: StepResult[]; verdict: "APROVADO" | "REPROVADO"; summary: string;
}> {
  const steps: StepResult[] = [];
  const verdict = (ok: boolean, msg: string) => ({ ok, msg });
  let token: string;
  try {
    token = await getValidToken(row);
  } catch (e) {
    return {
      app_id: app.id, app_name: app.name, spotify_user_id: row.spotify_user_id,
      display_name: row.display_name,
      steps: [{ step: "refresh", method: "POST", url: "accounts/api/token",
        request_body: null, http_status: null, spotify_request_id: null,
        response_headers: null, ok: false, body_preview: null, raw_body: null,
        error: (e as Error).message }],
      verdict: "REPROVADO", summary: `refresh falhou: ${(e as Error).message}`,
    };
  }

  // 1) GET /me
  const me = await call(token, "GET", "https://api.spotify.com/v1/me");
  me.step = "GET /me"; steps.push(me);
  if (!me.ok) {
    return { app_id: app.id, app_name: app.name, spotify_user_id: row.spotify_user_id,
      display_name: row.display_name, steps, verdict: "REPROVADO", summary: `GET /me ${me.http_status}` };
  }
  const meId = (me.body_preview as { id?: string })?.id ?? row.spotify_user_id;

  // 2) CRIA sandbox privada via /me/playlists (funciona em Dev Mode)
  void meId;
  const createRes = await call(token, "POST",
    `https://api.spotify.com/v1/me/playlists`,
    { name: `__nex_sandbox_${Date.now()}`, public: false, collaborative: false,
      description: "Homologation test — safe to delete" });
  createRes.step = "POST create sandbox (/me/playlists)"; steps.push(createRes);
  if (!createRes.ok) {
    return { app_id: app.id, app_name: app.name, spotify_user_id: row.spotify_user_id,
      display_name: row.display_name, steps, verdict: "REPROVADO",
      summary: `Criar sandbox falhou: ${createRes.http_status}` };
  }
  const playlistId = (createRes.body_preview as { id: string }).id;
  const sandboxCreated = true;


  // 3) GET /playlists/{id}
  const getPl = await call(token, "GET", `https://api.spotify.com/v1/playlists/${playlistId}`);
  getPl.step = "GET /playlists/{id}"; steps.push(getPl);

  // 4) GET /playlists/{id}/tracks (vazio)
  const getTracks1 = await call(token, "GET", `https://api.spotify.com/v1/playlists/${playlistId}/tracks`);
  getTracks1.step = "GET tracks (antes)"; steps.push(getTracks1);

  // 5) POST add
  const addRes = await call(token, "POST",
    `https://api.spotify.com/v1/playlists/${playlistId}/tracks`,
    { uris: [TEST_TRACK_URI] });
  addRes.step = "POST add track"; steps.push(addRes);

  // 6) GET tracks (deve ter 1)
  const getTracks2 = await call(token, "GET", `https://api.spotify.com/v1/playlists/${playlistId}/tracks`);
  getTracks2.step = "GET tracks (depois add)"; steps.push(getTracks2);
  const countBefore = (getTracks1.body_preview as { items?: unknown[] })?.items?.length ?? 0;
  const countAfterAdd = (getTracks2.body_preview as { items?: unknown[] })?.items?.length ?? 0;

  // 7) DELETE remove
  const delRes = await call(token, "DELETE",
    `https://api.spotify.com/v1/playlists/${playlistId}/tracks`,
    { tracks: [{ uri: TEST_TRACK_URI }] });
  delRes.step = "DELETE remove track"; steps.push(delRes);

  // 8) GET tracks (deve voltar ao count original)
  const getTracks3 = await call(token, "GET", `https://api.spotify.com/v1/playlists/${playlistId}/tracks`);
  getTracks3.step = "GET tracks (depois remove)"; steps.push(getTracks3);
  const countAfterDel = (getTracks3.body_preview as { items?: unknown[] })?.items?.length ?? 0;

  // 9) Cleanup: se criou sandbox, unfollow
  if (sandboxCreated) {
    const cleanup = await call(token, "DELETE",
      `https://api.spotify.com/v1/playlists/${playlistId}/followers`);
    cleanup.step = "DELETE sandbox (unfollow)"; steps.push(cleanup);
  }

  // Critérios
  const has403 = steps.some((s) => s.http_status === 403);
  const has429 = steps.some((s) => s.http_status === 429);
  const tracksOk = getTracks1.ok && getTracks2.ok && getTracks3.ok;
  const addOk = addRes.ok && countAfterAdd === countBefore + 1;
  const delOk = delRes.ok && countAfterDel === countBefore;
  const aprovado = tracksOk && addOk && delOk && !has403 && !has429;

  return {
    app_id: app.id, app_name: app.name,
    spotify_user_id: row.spotify_user_id, display_name: row.display_name,
    steps,
    verdict: aprovado ? "APROVADO" : "REPROVADO",
    summary: `tracks=${tracksOk?"OK":"FAIL"} add=${addOk?"OK":"FAIL"}(n=${countAfterAdd}) del=${delOk?"OK":"FAIL"}(n=${countAfterDel}) 403=${has403} 429=${has429}`,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  let body: { app_ids?: string[]; owners?: { app_id: string; spotify_user_id: string }[] } = {};
  try { body = await req.json(); } catch { /* no body ok */ }

  const appIds = body.app_ids ?? TARGET_APPS;
  const { data: apps } = await sb.from("spotify_apps").select("id,name").in("id", appIds);
  const appMap = new Map((apps ?? []).map((a: any) => [a.id, a]));

  // Seleciona owners: ou os do body, ou 1 por app (mais recente).
  let ownerRows: SpotifyUserToken[] = [];
  if (body.owners?.length) {
    for (const o of body.owners) {
      const { data } = await sb.from("spotify_user_tokens").select("*")
        .eq("app_id", o.app_id).eq("spotify_user_id", o.spotify_user_id).maybeSingle();
      if (data) ownerRows.push(data as SpotifyUserToken);
    }
  } else {
    for (const appId of appIds) {
      const { data } = await sb.from("spotify_user_tokens").select("*")
        .eq("app_id", appId).order("updated_at", { ascending: false }).limit(1);
      if (data?.[0]) ownerRows.push(data[0] as SpotifyUserToken);
    }
  }

  const results = [];
  for (const row of ownerRows) {
    const app = appMap.get(row.app_id!) ?? { id: row.app_id!, name: "?" };
    results.push(await runOwner(app, row));
  }

  // Veredito por app
  const byApp = new Map<string, { name: string; owners: typeof results }>();
  for (const r of results) {
    if (!byApp.has(r.app_id)) byApp.set(r.app_id, { name: r.app_name, owners: [] });
    byApp.get(r.app_id)!.owners.push(r);
  }
  const verdicts = Array.from(byApp.entries()).map(([appId, v]) => ({
    app_id: appId,
    app_name: v.name,
    verdict: v.owners.every((o) => o.verdict === "APROVADO") ? "APROVADO" : "REPROVADO",
    owners_tested: v.owners.length,
  }));

  return jr({ ok: true, verdicts, results });
});
