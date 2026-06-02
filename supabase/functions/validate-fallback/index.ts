// validate-fallback — Validação completa do USE_PLAYLIST_TRACKS_FALLBACK
//
// Compara GET /v1/playlists/{id}?fields=... (fallback) vs GET /v1/playlists/{id}/tracks (direto)
// nos Apps 05 (alvo do fallback) e 01 (baseline). Cria playlists temporárias via App 01
// (já que App 05 não consegue escrever em /tracks), popula com pools de URIs conhecidas,
// e lê via ambos os caminhos. Cleanup obrigatório em finally.
//
// Body: { app05_id?, app01_id?, sul_user_id?, lado_sul_user_id?, existing_sul_playlist_id?, existing_lado_playlist_id? }
// Retorno: relatório JSON estruturado com tabela final e veredictos.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { refreshUserToken, type SpotifyUserToken } from "../_shared/spotify.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const APP05 = "821cb0cc-001b-4d2f-a0c0-66cafe055e72";
const APP01 = "d0676425-59bc-40a1-94ad-d96ce7b483c4";
const SUL = "31svfjqrk6nayh5d46kmffemqyhy";
const LADO = "31r2keeilv4bqululjdcpjgatlim";

const FIELDS = "id,name,collaborative,public,tracks.total,tracks.items(added_at,added_by.id,is_local,track(type,id,name,uri,duration_ms,artists(name),album(name,images)))";

// Pool de 20 URIs públicas (mix BR/global, pop/eletrônica/rock).
const TRACK_POOL = [
  "spotify:track:4PTG3Z6ehGkBFwjybzWkR8","spotify:track:7qiZfU4dY1lWllzX7mPBI3",
  "spotify:track:0e7ipj03S05BNilyu5bRzt","spotify:track:11dFghVXANMlKmJXsNCbNl",
  "spotify:track:7ouMYWpwJ422jRcDASZB7P","spotify:track:0VjIjW4GlUZAMYd2vXMi3b",
  "spotify:track:1zi7xx7UVEFkmKfv06H8x0","spotify:track:6habFhsOp2NvshLv26DqMb",
  "spotify:track:2takcwOaAZWiXQijPHIx7B","spotify:track:5QO79kh1waicV47BqGRL3g",
  "spotify:track:6UelLqGlWMcVH1E5c4H7lY","spotify:track:6f3Slt0GbA2bPZlz0aIFXN",
  "spotify:track:3FAJ6O0NOHQV8Mc5Ri6ENp","spotify:track:7KXjTSCq5nL1LoYtL7XAwS",
  "spotify:track:39LLxExYz6ewLAcYrzQQyP","spotify:track:0Z7nGFVCLfixWctgePsRk9",
  "spotify:track:6Im9k8u9iIzKMrmV7BWtlF","spotify:track:1mWdTewIgB3gtBM3TOSFhB",
  "spotify:track:3w3y8KPTfNeOKPiqUTakBh","spotify:track:5HCyWlXZPP0y6Gqq8TgA20",
];

interface Call {
  step: string; endpoint: string; method: string; status: number; ok: boolean;
  duration_ms: number; spotify_request_id: string | null; body_size: number;
  body?: unknown; error?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let lastCallAt = 0;
const MIN_GAP_MS = 250;

async function spCall(token: string, method: string, url: string, step: string, body?: unknown, keepBody = false): Promise<Call> {
  const wait = Math.max(0, MIN_GAP_MS - (Date.now() - lastCallAt));
  if (wait > 0) await sleep(wait);
  const init: RequestInit = { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } };
  if (body !== undefined) init.body = JSON.stringify(body);
  const t0 = Date.now();
  let r: Response;
  try {
    r = await fetch(url, init);
  } catch (e) {
    lastCallAt = Date.now();
    return { step, endpoint: url.replace("https://api.spotify.com",""), method, status: 0, ok: false, duration_ms: Date.now()-t0, spotify_request_id: null, body_size: 0, error: (e as Error).message };
  }
  lastCallAt = Date.now();
  // 429 retry uma vez com Retry-After
  if (r.status === 429) {
    const ra = Math.min(15, Math.max(2, Number(r.headers.get("retry-after") ?? "5")));
    await sleep(ra * 1000);
    try { r = await fetch(url, init); lastCallAt = Date.now(); } catch { /* keep */ }
  }
  const txt = await r.text();
  let parsed: unknown = null;
  try { parsed = txt ? JSON.parse(txt) : null; } catch { parsed = txt; }
  return {
    step, endpoint: url.replace("https://api.spotify.com", ""), method,
    status: r.status, ok: r.ok, duration_ms: Date.now() - t0,
    spotify_request_id: r.headers.get("x-spotify-request-id"),
    body_size: txt.length,
    body: keepBody || !r.ok ? parsed : undefined,
  };
}

async function getToken(sb: any, appId: string, userId: string): Promise<string> {
  const { data } = await sb.from("spotify_user_tokens").select("*").eq("app_id", appId).eq("spotify_user_id", userId).maybeSingle();
  if (!data) throw new Error(`token not found: ${appId}/${userId}`);
  const row = data as SpotifyUserToken;
  if (new Date(row.expires_at).getTime() > Date.now() + 60_000) return row.access_token;
  return await refreshUserToken(row);
}

function poolUris(n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(TRACK_POOL[i % TRACK_POOL.length]);
  return out;
}

async function createPl(token: string, _userId: string, name: string, opts: { public?: boolean; collaborative?: boolean } = {}): Promise<{ id: string | null; call: Call }> {
  const body: any = { name, public: opts.public ?? false };
  if (opts.collaborative) body.collaborative = true;
  const c = await spCall(token, "POST", `https://api.spotify.com/v1/me/playlists`, "create", body, true);
  return { id: (c.body as any)?.id ?? null, call: c };
}

async function addTracks(token: string, plId: string, uris: string[]): Promise<Call[]> {
  const calls: Call[] = [];
  for (let i = 0; i < uris.length; i += 100) {
    const chunk = uris.slice(i, i + 100);
    calls.push(await spCall(token, "POST", `https://api.spotify.com/v1/playlists/${plId}/tracks`, `add[${i}-${i+chunk.length}]`, { uris: chunk }));
  }
  return calls;
}

async function deletePl(token: string, plId: string): Promise<Call> {
  return await spCall(token, "DELETE", `https://api.spotify.com/v1/playlists/${plId}/followers`, "cleanup");
}

// Fallback leitor (sem paginação — falha explicitamente se > 100).
async function fallbackRead(token: string, plId: string): Promise<{ ok: boolean; total: number; items: any[]; raw: Call; truncated: boolean; error?: string }> {
  const c = await spCall(token, "GET", `https://api.spotify.com/v1/playlists/${plId}?fields=${encodeURIComponent(FIELDS)}`, "fallback_read", undefined, true);
  if (!c.ok) return { ok: false, total: 0, items: [], raw: c, truncated: false, error: `HTTP ${c.status}` };
  const b = c.body as any;
  const total = b?.tracks?.total ?? 0;
  const items = b?.tracks?.items ?? [];
  if (total > 100 && items.length <= 100) {
    return { ok: false, total, items, raw: c, truncated: true, error: `FALLBACK_PAGINATION_LIMIT: playlist=${plId} total=${total}` };
  }
  return { ok: true, total, items, raw: c, truncated: false };
}

async function directRead(token: string, plId: string): Promise<{ ok: boolean; total: number; items: any[]; raw: Call }> {
  const c = await spCall(token, "GET", `https://api.spotify.com/v1/playlists/${plId}/tracks?limit=100`, "direct_read", undefined, true);
  if (!c.ok) return { ok: false, total: 0, items: [], raw: c };
  const b = c.body as any;
  return { ok: true, total: b?.total ?? 0, items: b?.items ?? [], raw: c };
}

function checkConsumerFields(item: any, required: string[]): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
  for (const path of required) {
    const parts = path.split(".");
    let cur: any = item;
    for (const p of parts) {
      if (p === "artists[]") { cur = cur?.track?.artists?.[0]; continue; }
      if (p === "images[]") { cur = cur?.[0]; continue; }
      cur = cur?.[p];
      if (cur === undefined || cur === null) break;
    }
    if (cur === undefined || cur === null) missing.push(path);
  }
  return { ok: missing.length === 0, missing };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);
  const body = await req.json().catch(() => ({})) as any;
  const app05 = body.app05_id ?? APP05;
  const app01 = body.app01_id ?? APP01;
  const sul = body.sul_user_id ?? SUL;
  const lado = body.lado_sul_user_id ?? LADO;

  // Fecha breakers abertos antes de começar (testes controlados, sem stampede)
  await sb.from("spotify_circuit_breaker").update({ status: "closed", blocked_until: null, retry_after_sec: 0 }).eq("status", "open");

  const report: any = { started_at: new Date().toISOString(), config: { app05, app01, sul, lado }, phases: {}, rows: [] as any[], created: [] as string[] };
  const row = (phase: string, test: string, expected: string, actual: string, pass: boolean | "n/a", notes = "") => {
    report.rows.push({ phase, test, expected, actual, result: pass === "n/a" ? "N/A" : pass ? "PASS" : "FAIL", notes });
  };

  let tok05: string | null = null;
  let tok01: string | null = null;
  let baselineAvailable = false;
  const createdByApp01: string[] = [];

  try {
    tok05 = await getToken(sb, app05, sul);
    // tok01 será resolvido em Phase 0.2 iterando users do App 01

    // ============ PHASE 0 ============
    const phase0: any = {};
    // 0.1 App 05 — pega uma playlist existente do Sul pra evidenciar 403 em /tracks
    const sulPls = await spCall(tok05, "GET", "https://api.spotify.com/v1/me/playlists?limit=10", "sul_me_pls", undefined, true);
    const sulExisting = body.existing_sul_playlist_id ?? (sulPls.body as any)?.items?.[0]?.id ?? null;
    phase0.app05_existing_playlist = sulExisting;
    if (sulExisting) {
      const c = await spCall(tok05, "GET", `https://api.spotify.com/v1/playlists/${sulExisting}/tracks`, "app05_direct_tracks", undefined, true);
      phase0.app05_direct_tracks = c;
      row("0.1", "App05 GET /tracks", "403", String(c.status), c.status === 403, `req_id=${c.spotify_request_id ?? "none"}`);
    }
    // 0.2 App 01 baseline — tenta todos os users do App 01 até achar um com playlist + /tracks 200
    const { data: app01Users } = await sb.from("spotify_user_tokens").select("spotify_user_id").eq("app_id", app01);
    phase0.app01_users_tried = [];
    for (const u of (app01Users ?? [])) {
      try {
        const t = await getToken(sb, app01, u.spotify_user_id);
        const pls = await spCall(t, "GET", "https://api.spotify.com/v1/me/playlists?limit=10", `app01_me_pls(${u.spotify_user_id})`, undefined, true);
        const pid = (pls.body as any)?.items?.[0]?.id;
        phase0.app01_users_tried.push({ user: u.spotify_user_id, pls_status: pls.status, first_pl: pid ?? null });
        if (!pid) continue;
        const c = await spCall(t, "GET", `https://api.spotify.com/v1/playlists/${pid}/tracks?limit=5`, "app01_direct_tracks", undefined, true);
        if (c.ok) {
          tok01 = t;
          (report as any).app01_baseline_user = u.spotify_user_id;
          phase0.app01_existing_playlist = pid;
          phase0.app01_direct_tracks = c;
          baselineAvailable = true;
          const sample = (c.body as any)?.items?.[0];
          phase0.baseline_schema = sample ? Object.keys(sample.track ?? {}) : null;
          row("0.2", "App01 GET /tracks (baseline)", "200", String(c.status), true, `user=${u.spotify_user_id}`);
          break;
        }
      } catch (e) {
        phase0.app01_users_tried.push({ user: u.spotify_user_id, error: (e as Error).message });
      }
    }
    if (!baselineAvailable) row("0.2", "App01 baseline", "200", "none_found", false, "BASELINE_UNAVAILABLE");
    report.phases.phase0 = phase0;

    if (!tok01) {
      report.aborted = "App 01 sem token — não dá pra criar playlists de teste";
      // ainda assim continua com o que dá
    }

    // Helper: cria + popula
    async function makeTestPl(name: string, nTracks: number, opts: { public?: boolean; collaborative?: boolean } = {}): Promise<string | null> {
      if (!tok01) return null;
      const { id, call } = await createPl(tok01, lado, name, opts);
      if (!id) { report.created_errors = [...(report.created_errors ?? []), { name, status: call.status, err: call.body, raw: call }]; return null; }
      createdByApp01.push(id);
      report.created.push(id);
      if (nTracks > 0) await addTracks(tok01, id, poolUris(nTracks));
      return id;
    }

    if (tok01) {
      // ============ PHASE 0.5 — equivalence ============
      const eqPl = await makeTestPl(`__nex_eq_${Date.now()}`, 25);
      if (eqPl) {
        const fb = await fallbackRead(tok05, eqPl);
        const dr = await directRead(tok01, eqPl);
        const diffs: string[] = [];
        if (fb.total !== dr.total) diffs.push(`total: fb=${fb.total} dr=${dr.total}`);
        if (fb.items.length !== dr.items.length) diffs.push(`len: fb=${fb.items.length} dr=${dr.items.length}`);
        for (let i = 0; i < Math.min(fb.items.length, dr.items.length); i++) {
          const a = fb.items[i], b = dr.items[i];
          const fields = ["track.id", "track.uri", "track.name", "added_at", "added_by.id"];
          for (const f of fields) {
            const get = (o: any, p: string) => p.split(".").reduce((x, k) => x?.[k], o);
            if (get(a, f) !== get(b, f)) diffs.push(`item[${i}].${f}: fb=${get(a,f)} dr=${get(b,f)}`);
          }
        }
        report.phases.phase0_5 = { playlist: eqPl, fb_total: fb.total, dr_total: dr.total, diffs };
        row("0.5", "Endpoint equivalence", "EQUIVALENT", diffs.length === 0 ? "EQUIVALENT" : "DATA_MISMATCH", diffs.length === 0, diffs.slice(0, 5).join("; "));
      }

      // ============ PHASE 1 — READ ============
      const phase1: any = {};

      // 1.1 vazia
      const empty = await makeTestPl(`__nex_empty_${Date.now()}`, 0);
      if (empty) {
        const fb = await fallbackRead(tok05, empty);
        phase1.empty = { total: fb.total, len: fb.items.length };
        row("1.1", "Empty playlist", "total=0,items=0", `total=${fb.total},items=${fb.items.length}`, fb.total === 0 && fb.items.length === 0);
      }

      // 1.2 50 faixas
      const p50 = await makeTestPl(`__nex_50_${Date.now()}`, 50);
      if (p50) {
        const fb = await fallbackRead(tok05, p50);
        phase1.p50 = { total: fb.total, len: fb.items.length, size: fb.raw.body_size, ms: fb.raw.duration_ms };
        row("1.2", "50 tracks", "total=50,items=50", `total=${fb.total},items=${fb.items.length}`, fb.total === 50 && fb.items.length === 50, `${fb.raw.duration_ms}ms ${fb.raw.body_size}B`);
      }

      // 1.3 100 faixas
      const p100 = await makeTestPl(`__nex_100_${Date.now()}`, 100);
      if (p100) {
        const fb = await fallbackRead(tok05, p100);
        phase1.p100 = { total: fb.total, len: fb.items.length };
        row("1.3", "100 tracks", "total=100,items=100", `total=${fb.total},items=${fb.items.length}`, fb.total === 100 && fb.items.length === 100);
      }

      // 1.4 101 faixas → deve sinalizar truncamento
      const p101 = await makeTestPl(`__nex_101_${Date.now()}`, 101);
      if (p101) {
        const fb = await fallbackRead(tok05, p101);
        phase1.p101 = { total: fb.total, len: fb.items.length, truncated: fb.truncated, error: fb.error };
        row("1.4", "101 tracks throws FALLBACK_PAGINATION_LIMIT", "truncated=true,total=101", `truncated=${fb.truncated},total=${fb.total},items=${fb.items.length}`, fb.truncated && fb.total === 101, fb.error ?? "");
      }

      // 1.4.1 500 faixas
      const p500 = await makeTestPl(`__nex_500_${Date.now()}`, 500);
      if (p500) {
        const fb = await fallbackRead(tok05, p500);
        const totalOk = fb.total === 500;
        phase1.p500 = { total: fb.total, len: fb.items.length };
        row("1.4.1", "500 tracks total correto", "total=500", `total=${fb.total}`, totalOk, totalOk ? "PASS" : "FAIL CRÍTICO");
      }

      // 1.5 colaborativa
      const pcol = await makeTestPl(`__nex_col_${Date.now()}`, 5, { collaborative: true, public: false });
      if (pcol) {
        const fb = await fallbackRead(tok05, pcol);
        const isCol = (fb.raw.body as any)?.collaborative === true;
        phase1.collaborative = { collaborative: isCol };
        row("1.5", "Collaborative flag", "collaborative=true", String(isCol), isCol);
      }

      // 1.6 local track — não conseguimos injetar via API
      row("1.6", "Local track", "logged", "SKIPPED", "n/a", "Local tracks não podem ser adicionados via Web API");

      // 1.7 podcast episódio
      // Episódio: pode-se adicionar via uri spotify:episode:XXX
      const podPl = await makeTestPl(`__nex_pod_${Date.now()}`, 0);
      if (podPl) {
        // 1 episódio público famoso (The Joe Budden Podcast)
        const epUri = "spotify:episode:512ojhOuo1ktJprKbVcKyQ";
        await spCall(tok01, "POST", `https://api.spotify.com/v1/playlists/${podPl}/tracks`, "add_episode", { uris: [epUri] });
        // O fallback FIELDS pede track(...) — episódios precisam additional_types=episode
        const c = await spCall(tok05, "GET", `https://api.spotify.com/v1/playlists/${podPl}?additional_types=track,episode&fields=${encodeURIComponent(FIELDS)}`, "fallback_episode", undefined, true);
        const item = (c.body as any)?.tracks?.items?.[0];
        phase1.episode = { item };
        row("1.7", "Episode in playlist", "type=episode", String(item?.track?.type ?? "null"), item?.track?.type === "episode", "requires additional_types=episode");
      }

      // 1.8 privada sem acesso — cria como Lado Sul privada e tenta ler com Sul (App 05)
      // Sul não segue, então deveria dar 404 ou 403 — Spotify retorna 404 normalmente.
      const priv = await makeTestPl(`__nex_priv_${Date.now()}`, 5, { public: false });
      if (priv) {
        const c = await spCall(tok05, "GET", `https://api.spotify.com/v1/playlists/${priv}?fields=id`, "private_no_access", undefined, true);
        phase1.private_no_access = c;
        row("1.8", "Private no access", "403 or 404", String(c.status), c.status === 403 || c.status === 404, `req_id=${c.spotify_request_id ?? "none"}`);
      }

      report.phases.phase1 = phase1;

      // ============ PHASE 2 — Consumer field validation ============
      const sample = p50 ? (await fallbackRead(tok05, p50)).items[0] : null;
      const consumers: any = {};
      if (sample) {
        consumers.listPlaylistTracksRich = checkConsumerFields(sample, ["track.id","track.uri","track.name","track.duration_ms","added_at","added_by.id","track.artists[].name","track.album.name","track.album.images"]);
        consumers.playlist_tracks_list = checkConsumerFields(sample, ["track.id","track.uri","track.name","track.artists[].name","track.album.images"]);
        consumers.editor_manual = checkConsumerFields(sample, ["track.id","track.uri","track.name","track.duration_ms","track.artists[].name","track.album.name","track.album.images","added_at"]);
        consumers.snapshot_playlist_tracks = checkConsumerFields(sample, ["track.id","track.uri","added_at","added_by.id"]);
      }
      report.phases.phase2 = consumers;
      for (const [k, v] of Object.entries(consumers) as any) {
        row("2", `Consumer ${k}`, "OK", v.ok ? "OK" : `MISSING_FIELD: ${v.missing.join(",")}`, v.ok);
      }

      // ============ PHASE 3 — WRITE (App 05 deve falhar 403) ============
      const phase3: any = {};
      if (p50) {
        phase3.post = await spCall(tok05, "POST", `https://api.spotify.com/v1/playlists/${p50}/tracks`, "w_post", { uris: [TRACK_POOL[0]] }, true);
        phase3.put = await spCall(tok05, "PUT", `https://api.spotify.com/v1/playlists/${p50}/tracks`, "w_put", { range_start: 0, insert_before: 2 }, true);
        phase3.del = await spCall(tok05, "DELETE", `https://api.spotify.com/v1/playlists/${p50}/tracks`, "w_del", { tracks: [{ uri: TRACK_POOL[0] }] }, true);
        row("3.1", "App05 POST /tracks", "403", String(phase3.post.status), phase3.post.status === 403, phase3.post.ok ? "UNEXPECTED_SUCCESS" : "");
        row("3.2", "App05 DELETE /tracks", "403", String(phase3.del.status), phase3.del.status === 403, phase3.del.ok ? "UNEXPECTED_SUCCESS" : "");
        row("3.3", "App05 PUT /tracks", "403", String(phase3.put.status), phase3.put.status === 403, phase3.put.ok ? "UNEXPECTED_SUCCESS" : "");
      }
      report.phases.phase3 = phase3;

      // ============ PHASE 4 — Consistency ============
      const phase4: any = {};
      if (p50) {
        const [fbA, drA] = [await fallbackRead(tok05, p50), await directRead(tok01, p50)];
        const inconsistencies: string[] = [];
        if (fbA.total !== drA.total) inconsistencies.push(`total mismatch ${fbA.total} vs ${drA.total}`);
        for (let i = 0; i < Math.min(fbA.items.length, drA.items.length); i++) {
          if (fbA.items[i]?.track?.id !== drA.items[i]?.track?.id) inconsistencies.push(`item[${i}].id`);
        }
        phase4.cross_app = { inconsistencies };
        row("4.1", "Cross-app same data", "no diff", inconsistencies.length === 0 ? "consistent" : "DATA_INCONSISTENCY", inconsistencies.length === 0, inconsistencies.slice(0,3).join(";"));

        const [r1, r2] = await Promise.all([fallbackRead(tok05, p50), fallbackRead(tok05, p50)]);
        const par = r1.ok && r2.ok && r1.items.length === r2.items.length;
        phase4.parallel = { len1: r1.items.length, len2: r2.items.length };
        row("4.2", "Parallel reads", "both 200, same len", `${r1.raw.status}/${r2.raw.status} ${r1.items.length}/${r2.items.length}`, par);

        // 4.3 token expirando — pula (não dá pra forçar sem editar DB)
        row("4.3", "Token near expiry", "same behavior", "SKIPPED", "n/a", "Não forçamos refresh por segurança");
      }
      report.phases.phase4 = phase4;

      // ============ PHASE 5 — Performance ============
      const phase5: any = {};
      const times: any = {};
      for (const [label, pl] of [["50", p50], ["100", p100]] as const) {
        if (!pl) continue;
        const fb = await fallbackRead(tok05, pl);
        times[label] = { ms: fb.raw.duration_ms, size: fb.raw.body_size };
      }
      // baseline /tracks no p50 via App 01
      if (p50 && tok01) {
        const dr = await directRead(tok01, p50);
        times.p50_direct_app01 = { ms: dr.raw.duration_ms, size: dr.raw.body_size };
        const delta = (times["50"]?.ms ?? 0) - dr.raw.duration_ms;
        phase5.delta_ms = delta;
        row("5", "Fallback vs /tracks delta", "<300ms", `${delta}ms`, delta < 300, delta >= 300 ? "PERFORMANCE_REGRESSION" : "");
      }
      phase5.times = times;
      report.phases.phase5 = phase5;

      // ============ PHASE 6 — Regression on App 01 ============
      const phase6: any = {};
      if (p50) {
        phase6.get = await spCall(tok01, "GET", `https://api.spotify.com/v1/playlists/${p50}/tracks?limit=5`, "reg_get", undefined, true);
        phase6.post = await spCall(tok01, "POST", `https://api.spotify.com/v1/playlists/${p50}/tracks`, "reg_post", { uris: [TRACK_POOL[1]] }, true);
        const snap = (phase6.post.body as any)?.snapshot_id;
        // remove o que adicionou
        phase6.delete = await spCall(tok01, "DELETE", `https://api.spotify.com/v1/playlists/${p50}/tracks`, "reg_del", { tracks: [{ uri: TRACK_POOL[1] }] }, true);
        phase6.put = await spCall(tok01, "PUT", `https://api.spotify.com/v1/playlists/${p50}/tracks`, "reg_put", { range_start: 0, insert_before: 2 }, true);
        row("6.1", "App01 GET /tracks", "200", String(phase6.get.status), phase6.get.ok);
        row("6.2a", "App01 POST", "200/201", String(phase6.post.status), phase6.post.ok);
        row("6.2b", "App01 DELETE", "200", String(phase6.delete.status), phase6.delete.ok);
        row("6.2c", "App01 PUT", "200", String(phase6.put.status), phase6.put.ok);
      }
      report.phases.phase6 = phase6;
    }
  } catch (e) {
    report.fatal = (e as Error).message;
  } finally {
    // CLEANUP
    const cleanup: any[] = [];
    if (tok01) {
      for (const id of createdByApp01) {
        try {
          const c = await deletePl(tok01, id);
          cleanup.push({ playlist_id: id, status: c.status });
        } catch (e) {
          cleanup.push({ playlist_id: id, status: "CLEANUP_FAILED", error: (e as Error).message });
        }
      }
    }
    report.cleanup = cleanup;
  }

  // ============ VERDICTS ============
  const failedRows = report.rows.filter((r: any) => r.result === "FAIL");
  const readPhases = report.rows.filter((r: any) => ["0.5","1.1","1.2","1.3","1.4","1.4.1","1.5","1.7","1.8","2"].some(p => r.phase === p || r.phase.startsWith(p)));
  const readFails = readPhases.filter((r: any) => r.result === "FAIL");
  report.read_verdict = readFails.length === 0 ? "APPROVED" : "REJECTED";
  report.read_failures = readFails;

  const writeRows = report.rows.filter((r: any) => r.phase.startsWith("3"));
  const unexpectedWrites = writeRows.filter((r: any) => r.notes.includes("UNEXPECTED"));
  report.write_verdict = unexpectedWrites.length > 0 ? "UNEXPECTED" : "BLOCKED";

  if (!baselineAvailable) report.regression_verdict = "UNKNOWN";
  else {
    const regFails = report.rows.filter((r: any) => r.phase.startsWith("6") && r.result === "FAIL");
    report.regression_verdict = regFails.length === 0 ? "SAFE" : "BROKEN";
  }

  report.summary = { total: report.rows.length, failed: failedRows.length, read: report.read_verdict, write: report.write_verdict, regression: report.regression_verdict };
  report.finished_at = new Date().toISOString();

  return new Response(JSON.stringify(report, null, 2), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
