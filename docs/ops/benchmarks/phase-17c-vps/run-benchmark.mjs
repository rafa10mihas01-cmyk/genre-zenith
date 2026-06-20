#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Fase 17-C — Pacote único de benchmark VPS × Gateway CC × OAuth
 *
 * READ-ONLY. Nenhuma modificação em playlists reais é feita.
 * Operações de escrita (T3) só são executadas se BENCH_SANDBOX_*_PLAYLIST_ID
 * estiver configurado E o flag --include-writes for passado.
 *
 * Requisitos: Node >= 18 (fetch nativo). Sem dependências externas.
 *
 * Saídas (no diretório de execução, configurável via --out):
 *   benchmark_results.json   — registros brutos de todas as chamadas
 *   benchmark_summary.csv    — agregação por (componente, endpoint)
 *   benchmark_log.txt        — log linear com timestamp
 *   benchmark_report.txt     — resumo final (factual, sem interpretação)
 *
 * Uso:
 *   node run-benchmark.mjs --out ./out
 *   node run-benchmark.mjs --out ./out --skip vps      # pula um componente
 *   node run-benchmark.mjs --out ./out --include-writes
 *
 * Variáveis de ambiente (ver .env.example):
 *   BENCH_CC_TOKEN_URL, BENCH_CC_CLIENT_ID, BENCH_CC_CLIENT_SECRET
 *   BENCH_OAUTH_ACCESS_TOKEN   (token de usuário já obtido)
 *   BENCH_VPS_BASE_URL         (ex: https://vps.exemplo/spotify)
 *   BENCH_VPS_AUTH_HEADER      (ex: "Bearer xxx" — opcional)
 *   BENCH_SANDBOX_OAUTH_PLAYLIST_ID
 *   BENCH_SANDBOX_VPS_PLAYLIST_ID
 *   BENCH_LOAD_DURATION_SEC    (default 60)
 *   BENCH_T1_DELAY_SEC         (default 900 — 15 min entre T0 e T1)
 */

import { writeFileSync, mkdirSync, existsSync, appendFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

// ---------- args ----------
const args = process.argv.slice(2);
function arg(name, def = undefined) {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return def;
  const v = args[i + 1];
  return v && !v.startsWith("--") ? v : true;
}
const OUT_DIR = resolve(arg("out", "./out"));
const SKIP = String(arg("skip", "")).split(",").filter(Boolean);
const INCLUDE_WRITES = !!arg("include-writes", false);
const T1_DELAY_SEC = Number(process.env.BENCH_T1_DELAY_SEC ?? 900);
const LOAD_DURATION_SEC = Number(process.env.BENCH_LOAD_DURATION_SEC ?? 60);

if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
const LOG_PATH = join(OUT_DIR, "benchmark_log.txt");
const RESULTS_PATH = join(OUT_DIR, "benchmark_results.json");
const SUMMARY_PATH = join(OUT_DIR, "benchmark_summary.csv");
const REPORT_PATH = join(OUT_DIR, "benchmark_report.txt");
writeFileSync(LOG_PATH, "");

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  appendFileSync(LOG_PATH, line + "\n");
}

// ---------- amostra oficial (Fase 17-C §3) ----------
const SAMPLE_PLAYLISTS = [
  { id: "3xahW0MZvHpK2afozhqTe3", track: "4scixfOOff83kvnCw0TCvq" },
  { id: "4fxjF1C0lGgRyv4bZsqkvL", track: "4scixfOOff83kvnCw0TCvq" },
  { id: "1dSOLHIW6tauAyBuOxjbIX", track: "65aH3l8LEmRp3HuH5XpKoH" },
  { id: "4G2NKOWwnf7Tabta8Y3H46", track: "4scixfOOff83kvnCw0TCvq" },
  { id: "4ocOKyPe51UAFuqPgmWPMM", track: "4scixfOOff83kvnCw0TCvq" },
];

// Endpoints de leitura — escopo do protocolo §4
function readEndpoints(p) {
  return [
    { key: "track_get",          method: "GET", path: `/v1/tracks/${p.track}` },
    { key: "tracks_batch",       method: "GET", path: `/v1/tracks?ids=${p.track}` },
    { key: "artist_get",         method: "GET", path: `/v1/artists/06HL4z0CvFAxyc27GXpf02` },
    { key: "search",             method: "GET", path: `/v1/search?q=test&type=track&limit=1` },
    { key: "playlist_meta",      method: "GET", path: `/v1/playlists/${p.id}` },
    { key: "playlist_tracks",    method: "GET", path: `/v1/playlists/${p.id}/tracks?limit=50` },
    { key: "playlist_tracks_fields", method: "GET",
      path: `/v1/playlists/${p.id}/tracks?fields=items(track(id,name)),next&limit=50` },
  ];
}

// ---------- componentes ----------
let ccTokenCache = null;
async function getCcToken() {
  if (ccTokenCache && ccTokenCache.exp > Date.now() + 30_000) return ccTokenCache.token;
  const url = process.env.BENCH_CC_TOKEN_URL || "https://accounts.spotify.com/api/token";
  const id = process.env.BENCH_CC_CLIENT_ID;
  const secret = process.env.BENCH_CC_CLIENT_SECRET;
  if (!id || !secret) throw new Error("CC client_id/secret ausentes");
  const body = new URLSearchParams({ grant_type: "client_credentials" });
  const auth = Buffer.from(`${id}:${secret}`).toString("base64");
  const r = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!r.ok) throw new Error(`CC token HTTP ${r.status}`);
  const j = await r.json();
  ccTokenCache = { token: j.access_token, exp: Date.now() + (j.expires_in ?? 3600) * 1000 };
  return ccTokenCache.token;
}

const COMPONENTS = {
  gateway_cc: {
    name: "gateway_cc",
    base: "https://api.spotify.com",
    supportsWrites: false,
    async headers() {
      const t = await getCcToken();
      return { Authorization: `Bearer ${t}` };
    },
    enabled: () => !!(process.env.BENCH_CC_CLIENT_ID && process.env.BENCH_CC_CLIENT_SECRET),
  },
  oauth: {
    name: "oauth",
    base: "https://api.spotify.com",
    supportsWrites: true,
    sandboxEnv: "BENCH_SANDBOX_OAUTH_PLAYLIST_ID",
    async headers() {
      const t = process.env.BENCH_OAUTH_ACCESS_TOKEN;
      if (!t) throw new Error("OAuth token ausente");
      return { Authorization: `Bearer ${t}` };
    },
    enabled: () => !!process.env.BENCH_OAUTH_ACCESS_TOKEN,
  },
  vps: {
    name: "vps",
    base: process.env.BENCH_VPS_BASE_URL || "",
    supportsWrites: true,
    sandboxEnv: "BENCH_SANDBOX_VPS_PLAYLIST_ID",
    async headers() {
      const h = {};
      if (process.env.BENCH_VPS_AUTH_HEADER) h.Authorization = process.env.BENCH_VPS_AUTH_HEADER;
      return h;
    },
    enabled: () => !!process.env.BENCH_VPS_BASE_URL,
  },
};

// ---------- coleta ----------
const records = []; // 1 por chamada

async function callOnce({ component, phase, endpointKey, method, path, body = null, playlistId = null, run = 0 }) {
  const comp = COMPONENTS[component];
  const url = comp.base + path;
  const correlation_id = randomUUID();
  const headers = await comp.headers();
  if (body) headers["Content-Type"] = "application/json";
  const t0 = performance.now();
  let status = 0, ok = false, retryAfter = null, errorClass = null, bodyPreview = null, bytes = 0;
  try {
    const r = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
    status = r.status;
    ok = r.ok;
    retryAfter = r.headers.get("retry-after");
    const text = await r.text();
    bytes = text.length;
    bodyPreview = text.slice(0, 400);
    if (!ok) errorClass = classify(status);
  } catch (e) {
    errorClass = e.name === "AbortError" ? "timeout" : "network";
    bodyPreview = String(e?.message || e).slice(0, 400);
  }
  const elapsed_ms = +(performance.now() - t0).toFixed(2);
  const rec = {
    ts: new Date().toISOString(),
    correlation_id, component, phase, endpointKey, method, url,
    playlist_id: playlistId, run, status, ok, elapsed_ms,
    retry_after: retryAfter, error_class: errorClass, bytes, body_preview: bodyPreview,
  };
  records.push(rec);
  return rec;
}

function classify(s) {
  if (s === 401) return "401";
  if (s === 403) return "403";
  if (s === 404) return "404";
  if (s === 429) return "429";
  if (s >= 500) return "5xx";
  if (s >= 400) return `4xx_${s}`;
  return null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- fases ----------
async function runReadPass(component, phaseLabel, run) {
  log(`  ${phaseLabel} — ${component} — run ${run}`);
  for (const p of SAMPLE_PLAYLISTS) {
    for (const e of readEndpoints(p)) {
      const rec = await callOnce({
        component, phase: phaseLabel, endpointKey: e.key,
        method: e.method, path: e.path, playlistId: p.id, run,
      });
      log(`    ${component} ${e.key} pl=${p.id} -> ${rec.status} ${rec.elapsed_ms}ms`);
      await sleep(1000); // 1 RPS
    }
  }
}

async function runPaginationProbe(component) {
  // segue next até fim para a primeira playlist da amostra
  const p = SAMPLE_PLAYLISTS[0];
  let pathRel = `/v1/playlists/${p.id}/tracks?limit=50`;
  let total = null, fetched = 0, pages = 0;
  while (pathRel) {
    const rec = await callOnce({
      component, phase: "pagination", endpointKey: "playlist_tracks_paged",
      method: "GET", path: pathRel, playlistId: p.id, run: 0,
    });
    pages++;
    if (!rec.ok) break;
    try {
      const j = JSON.parse(rec.body_preview ? "" : ""); // body_preview é truncado; refetch leve
      void j;
    } catch { /* ignore */ }
    // refetch completo só pra contar (mantém read-only)
    try {
      const headers = await COMPONENTS[component].headers();
      const r = await fetch(COMPONENTS[component].base + pathRel, { headers });
      const j = await r.json();
      total = j.total ?? total;
      fetched += (j.items?.length ?? 0);
      pathRel = j.next ? j.next.replace(COMPONENTS[component].base, "") : null;
    } catch (e) {
      log(`    pagination parse err: ${e.message}`);
      break;
    }
    await sleep(500);
  }
  records.push({
    ts: new Date().toISOString(), correlation_id: randomUUID(),
    component, phase: "pagination_summary", endpointKey: "playlist_tracks_paged",
    playlist_id: p.id, pages, fetched, declared_total: total,
    complete: total != null && fetched === total,
  });
  log(`  pagination ${component}: pages=${pages} fetched=${fetched} total=${total}`);
}

async function runLoad(component, rps, seconds) {
  log(`  load ${component} @ ${rps} RPS x ${seconds}s`);
  const p = SAMPLE_PLAYLISTS[0];
  const path = `/v1/playlists/${p.id}`;
  const endAt = Date.now() + seconds * 1000;
  const intervalMs = 1000 / rps;
  const inflight = [];
  while (Date.now() < endAt) {
    inflight.push(callOnce({
      component, phase: `load_${rps}rps`, endpointKey: "playlist_meta",
      method: "GET", path, playlistId: p.id, run: 0,
    }));
    await sleep(intervalMs);
  }
  await Promise.allSettled(inflight);
}

async function runWrites(component) {
  const comp = COMPONENTS[component];
  if (!comp.supportsWrites) {
    // evidência negativa esperada para CC
    const p = SAMPLE_PLAYLISTS[0];
    const rec = await callOnce({
      component, phase: "write_negative", endpointKey: "playlist_add_negative",
      method: "POST", path: `/v1/playlists/${p.id}/tracks`,
      body: { uris: [`spotify:track:${p.track}`] }, playlistId: p.id, run: 0,
    });
    log(`  write_negative ${component}: ${rec.status} (esperado falhar)`);
    return;
  }
  if (!INCLUDE_WRITES) {
    log(`  writes pulados para ${component} (sem --include-writes)`);
    return;
  }
  const sandbox = process.env[comp.sandboxEnv];
  if (!sandbox) {
    log(`  writes pulados para ${component} (${comp.sandboxEnv} ausente)`);
    return;
  }
  const trackUri = `spotify:track:${SAMPLE_PLAYLISTS[0].track}`;
  // add
  const addRec = await callOnce({
    component, phase: "write_add", endpointKey: "playlist_add",
    method: "POST", path: `/v1/playlists/${sandbox}/tracks`,
    body: { uris: [trackUri] }, playlistId: sandbox, run: 0,
  });
  log(`  write_add ${component}: ${addRec.status}`);
  // reorder (no-op range)
  const reorderRec = await callOnce({
    component, phase: "write_reorder", endpointKey: "playlist_reorder",
    method: "PUT", path: `/v1/playlists/${sandbox}/tracks`,
    body: { range_start: 0, insert_before: 1, range_length: 1 },
    playlistId: sandbox, run: 0,
  });
  log(`  write_reorder ${component}: ${reorderRec.status}`);
  // delete (limpa o que foi adicionado)
  const delRec = await callOnce({
    component, phase: "write_delete", endpointKey: "playlist_delete",
    method: "DELETE", path: `/v1/playlists/${sandbox}/tracks`,
    body: { tracks: [{ uri: trackUri }] }, playlistId: sandbox, run: 0,
  });
  log(`  write_delete ${component}: ${delRec.status}`);
}

// ---------- orquestração ----------
async function runForComponent(component) {
  log(`=== componente: ${component} ===`);
  await runReadPass(component, "T0", 0);
  log(`  aguardando ${T1_DELAY_SEC}s para T1`);
  await sleep(T1_DELAY_SEC * 1000);
  await runReadPass(component, "T1", 1);
  await runPaginationProbe(component);
  for (const rps of [1, 5, 10]) {
    await runLoad(component, rps, LOAD_DURATION_SEC);
    log(`  cooldown 60s`);
    await sleep(60_000);
  }
  await runWrites(component);
}

// ---------- relatório ----------
function summarize() {
  const groups = new Map();
  for (const r of records) {
    if (!r.endpointKey || r.phase === "pagination_summary") continue;
    const k = `${r.component}|${r.endpointKey}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  const rows = [["component", "endpoint", "n", "success_pct", "p50_ms", "p95_ms", "p99_ms", "errors"]];
  const summaries = [];
  for (const [k, list] of groups) {
    const [component, endpoint] = k.split("|");
    const ok = list.filter((x) => x.ok).length;
    const lat = list.map((x) => x.elapsed_ms).filter((x) => typeof x === "number").sort((a, b) => a - b);
    const pct = (q) => lat.length ? lat[Math.min(lat.length - 1, Math.floor(q * lat.length))] : 0;
    const errs = {};
    for (const x of list) if (x.error_class) errs[x.error_class] = (errs[x.error_class] || 0) + 1;
    const row = {
      component, endpoint, n: list.length,
      success_pct: +((ok / list.length) * 100).toFixed(2),
      p50_ms: pct(0.5), p95_ms: pct(0.95), p99_ms: pct(0.99),
      errors: errs,
    };
    summaries.push(row);
    rows.push([row.component, row.endpoint, row.n, row.success_pct, row.p50_ms, row.p95_ms, row.p99_ms,
      Object.entries(errs).map(([k, v]) => `${k}:${v}`).join(";")]);
  }
  writeFileSync(SUMMARY_PATH, rows.map((r) => r.join(",")).join("\n"));
  return summaries;
}

function writeReport(summaries) {
  const total = records.filter((r) => r.endpointKey && r.phase !== "pagination_summary").length;
  const ok = records.filter((r) => r.ok).length;
  const lat = records.map((r) => r.elapsed_ms).filter((x) => typeof x === "number").sort((a, b) => a - b);
  const avg = lat.length ? +(lat.reduce((a, b) => a + b, 0) / lat.length).toFixed(2) : 0;
  const p95 = lat.length ? lat[Math.floor(0.95 * lat.length)] : 0;
  const errors = {};
  for (const r of records) if (r.error_class) errors[r.error_class] = (errors[r.error_class] || 0) + 1;
  const endpoints = [...new Set(records.map((r) => r.endpointKey).filter(Boolean))];
  const lines = [
    "Fase 17-C — Relatório de Benchmark VPS (factual, sem interpretação)",
    `Gerado em: ${new Date().toISOString()}`,
    "",
    `Total de chamadas medidas: ${total}`,
    `Sucessos (HTTP 2xx): ${ok}`,
    `Taxa de sucesso global: ${total ? ((ok / total) * 100).toFixed(2) : 0}%`,
    `Latência média global: ${avg} ms`,
    `Latência P95 global: ${p95} ms`,
    `Endpoints testados (${endpoints.length}): ${endpoints.join(", ")}`,
    "",
    "Erros por classe:",
    ...Object.entries(errors).map(([k, v]) => `  ${k}: ${v}`),
    "",
    "Por componente × endpoint:",
    ...summaries.map((s) =>
      `  ${s.component.padEnd(11)} ${s.endpoint.padEnd(28)} n=${String(s.n).padStart(4)} ` +
      `ok=${String(s.success_pct).padStart(6)}% p50=${String(s.p50_ms).padStart(6)}ms ` +
      `p95=${String(s.p95_ms).padStart(6)}ms errs=${JSON.stringify(s.errors)}`
    ),
    "",
    "Observações:",
    "  - Amostra: 5 playlists oficiais (Fase 17-C §3).",
    `  - T1 delay: ${T1_DELAY_SEC}s; load duration: ${LOAD_DURATION_SEC}s por RPS (1, 5, 10).`,
    "  - Operações de escrita só rodam com --include-writes e sandbox configurada.",
    "  - Este relatório contém apenas fatos medidos. Interpretação ocorre em fase posterior.",
  ];
  writeFileSync(REPORT_PATH, lines.join("\n"));
}

// ---------- main ----------
(async () => {
  log(`Iniciando benchmark. OUT_DIR=${OUT_DIR} skip=[${SKIP.join(",")}] writes=${INCLUDE_WRITES}`);
  for (const name of Object.keys(COMPONENTS)) {
    if (SKIP.includes(name)) { log(`pulando ${name}`); continue; }
    if (!COMPONENTS[name].enabled()) { log(`pulando ${name} (env ausente)`); continue; }
    try {
      await runForComponent(name);
    } catch (e) {
      log(`ERRO componente ${name}: ${e.message}`);
    }
  }
  writeFileSync(RESULTS_PATH, JSON.stringify(records, null, 2));
  const summaries = summarize();
  writeReport(summaries);
  log(`Concluído. Artefatos em ${OUT_DIR}`);
})().catch((e) => { log(`FATAL: ${e.stack || e.message}`); process.exit(1); });
