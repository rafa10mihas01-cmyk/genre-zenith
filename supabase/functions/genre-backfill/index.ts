// genre-backfill — reprocessa um gênero "dead" (sem playlists válidas há 14d+).
// Encadeia: collect-batch (recovery) → enrich-playlists.
// Não chama analyze/templates: deixa para o autopilot diário.
//
// Rate limit: máximo 3 tentativas por gênero em 24h (count_recent_backfill_attempts).
// Tracking: tabela genre_backfill_attempts.

import { corsHeaders } from "npm:@supabase/supabase-js/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { requireTeamAccess } from "../_shared/auth.ts";

import { deprecationGate } from "../_shared/_deprecation.ts";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const MAX_ATTEMPTS_24H = 3;
const TERMS_PER_GENRE = 8;
const ENRICH_LIMIT = 30;

interface Body {
  genre_id: string;
  triggered_by?: "cron" | "autopilot_hook" | "manual";
  force?: boolean; // bypass rate limit (apenas manual)
}

function jr(p: unknown, status: number): Response {
  return new Response(JSON.stringify(p), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function callFn(name: string, body: unknown) {
  try {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SERVICE_KEY}`,
      },
      body: JSON.stringify(body),
    });
    const text = await r.text();
    let data: unknown = null;
    try { data = JSON.parse(text); } catch { /* keep raw */ }
    return { ok: r.ok, status: r.status, data, raw: text.slice(0, 500) };
  } catch (e) {
    return { ok: false, status: 0, data: null, raw: (e as Error).message };
  }
}

Deno.serve(async (req) => {
  const __dep = await deprecationGate(req, "genre-backfill");
  if (__dep) return __dep;
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jr({ error: "method not allowed" }, 405);

  const guard = await requireTeamAccess(req);
  if (!guard.ok) return guard.resp;

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return jr({ error: "invalid json" }, 400);
  }

  if (!body.genre_id || typeof body.genre_id !== "string") {
    return jr({ error: "genre_id required" }, 400);
  }

  const triggeredBy = body.triggered_by ?? "manual";
  const force = body.force === true && guard.via === "user"; // só usuários humanos podem forçar
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);
  const startedAt = Date.now();

  // 1. Sanity: gênero existe e ainda está "dead"?
  const { data: health, error: hErr } = await sb
    .from("genres_with_health")
    .select("id, nome, health_status, health_last_seen_at")
    .eq("id", body.genre_id)
    .single();

  if (hErr || !health) {
    return jr({ error: "genre not found", details: hErr?.message }, 404);
  }

  // Se não está dead nem unknown, recusa (a menos que force=true)
  if (!force && health.health_status !== "dead" && health.health_status !== "unknown") {
    return jr({
      ok: false,
      skipped: true,
      reason: "genre_not_dead",
      health_status: health.health_status,
    }, 200);
  }

  // 2. Rate limit
  if (!force) {
    const { data: count, error: cErr } = await sb.rpc("count_recent_backfill_attempts", {
      p_genre_id: body.genre_id,
      p_hours: 24,
    });
    if (cErr) console.warn("[backfill] rate-check failed:", cErr.message);
    if ((count ?? 0) >= MAX_ATTEMPTS_24H) {
      // Marca skipped no histórico
      await sb.from("genre_backfill_attempts").insert({
        genre_id: body.genre_id,
        triggered_by: triggeredBy,
        status: "skipped",
        reason: "rate_limited",
        details: { attempts_24h: count, max: MAX_ATTEMPTS_24H },
        finished_at: new Date().toISOString(),
        duracao_ms: Date.now() - startedAt,
      });
      return jr({
        ok: false,
        skipped: true,
        reason: "rate_limited",
        attempts_24h: count,
        max: MAX_ATTEMPTS_24H,
      }, 200);
    }
  }

  // 3. Cria registro running
  const { data: attempt, error: aErr } = await sb
    .from("genre_backfill_attempts")
    .insert({
      genre_id: body.genre_id,
      triggered_by: triggeredBy,
      status: "running",
      details: { genre_nome: health.nome, prev_health: health.health_status },
    })
    .select("id")
    .single();

  if (aErr || !attempt) {
    return jr({ error: "failed to record attempt", details: aErr?.message }, 500);
  }

  const attemptId = attempt.id;
  const steps: Record<string, unknown> = {};

  try {
    // 4. STEP 1 — collect-batch (single genre, recovery mode habilitado dentro dele).
    // P2: backfill SEMPRE força (ignora cooldown de termos do run-search) — sem isso,
    // gêneros dead com termos "frescos" do ponto de vista do cooldown não se mexem.
    // P0: collect-batch agora chama enrich-playlists internamente, então não precisamos
    // mais de um STEP 2 separado aqui.
    const collect = await callFn("collect-batch", {
      genre_ids: [body.genre_id],
      terms_per_genre: TERMS_PER_GENRE,
      max_results: 100,
      delay_ms: 1500,
      force: true,
      enrich_limit: ENRICH_LIMIT,
    });
    steps.collect = {
      ok: collect.ok,
      status: collect.status,
      summary: (collect.data as { results?: unknown })?.results ?? collect.raw,
      total_enriched: (collect.data as { total_enriched?: number })?.total_enriched ?? 0,
    };
    if (!collect.ok) throw new Error(`collect-batch failed (${collect.status})`);

    // 5. STEP 2 — enrich extra (best-effort): pega quaisquer playlists que ainda
    // restaram pendentes de enrich (ex: limit do collect-batch foi atingido).
    const enrich = await callFn("enrich-playlists", {
      genre_id: body.genre_id,
      limit: ENRICH_LIMIT,
      fetch_tracks: true,
      prioritize: true,
    });
    steps.enrich = {
      ok: enrich.ok,
      status: enrich.status,
      summary: (enrich.data as Record<string, unknown>) ?? enrich.raw,
    };
    // enrich falhar não é fatal (pode estar bloqueado por circuit breaker do Apify)
    if (!enrich.ok) {
      steps.enrich_warning = `enrich-playlists não-ok (${enrich.status}) — coleta foi feita, enrich pode rodar depois`;
    }

    // 6. Releitura de saúde
    const { data: after } = await sb
      .from("genres_with_health")
      .select("health_status, health_last_seen_at")
      .eq("id", body.genre_id)
      .single();

    const finalStatus = enrich.ok ? "success" : "partial"; // collect ok; enrich falhou = parcial
    await sb.from("genre_backfill_attempts").update({
      status: finalStatus,
      details: {
        ...(attempt as Record<string, unknown>),
        steps,
        prev_health: health.health_status,
        new_health: after?.health_status,
        new_last_seen: after?.health_last_seen_at,
      },
      finished_at: new Date().toISOString(),
      duracao_ms: Date.now() - startedAt,
    }).eq("id", attemptId);

    return jr({
      ok: true,
      attempt_id: attemptId,
      genre_id: body.genre_id,
      genre_nome: health.nome,
      prev_health: health.health_status,
      new_health: after?.health_status,
      steps,
      duracao_ms: Date.now() - startedAt,
    }, 200);

  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    await sb.from("genre_backfill_attempts").update({
      status: "error",
      reason: msg,
      details: { steps },
      finished_at: new Date().toISOString(),
      duracao_ms: Date.now() - startedAt,
    }).eq("id", attemptId);
    return jr({
      ok: false,
      attempt_id: attemptId,
      error: msg,
      steps,
    }, 500);
  }
});
