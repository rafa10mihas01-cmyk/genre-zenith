// cron-backfill-dead — varre gêneros com health_status='dead' ou 'unknown'
// e dispara genre-backfill para cada um (rate limit aplicado dentro de genre-backfill).
//
// Limita N gêneros por execução para evitar avalanche no Apify.
// Acionado por pg_cron a cada 6h.

import { corsHeaders } from "npm:@supabase/supabase-js/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET")!;

const MAX_GENRES_PER_RUN = 5; // teto por execução (a cada 6h → 20/dia max)
const DELAY_BETWEEN_MS = 1500;

function jr(p: unknown, status: number): Response {
  return new Response(JSON.stringify(p), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Auth: aceita CRON_SECRET (header x-cron-secret) OU service_role
  const cronHeader = req.headers.get("x-cron-secret");
  const authHeader = req.headers.get("authorization") ?? "";
  const isService = authHeader === `Bearer ${SERVICE_KEY}`;
  const isCron = cronHeader === CRON_SECRET;
  if (!isService && !isCron) return jr({ error: "unauthorized" }, 401);

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);
  const startedAt = Date.now();

  // Pega gêneros dead/unknown ativos, mais antigos primeiro
  const { data: candidates, error } = await sb
    .from("genres_with_health")
    .select("id, nome, health_status, health_last_seen_at, ativo")
    .eq("ativo", true)
    .in("health_status", ["dead", "unknown"])
    .order("health_last_seen_at", { ascending: true, nullsFirst: true })
    .limit(MAX_GENRES_PER_RUN * 4); // pega mais e filtra por rate limit

  if (error) return jr({ error: error.message }, 500);
  if (!candidates || candidates.length === 0) {
    return jr({ ok: true, scanned: 0, dispatched: 0, message: "no dead genres" }, 200);
  }

  const dispatched: Array<Record<string, unknown>> = [];
  const skipped: Array<Record<string, unknown>> = [];

  for (const g of candidates) {
    if (dispatched.length >= MAX_GENRES_PER_RUN) break;

    // Pré-check de rate limit (evita estourar log de skipped no backfill)
    const { data: count } = await sb.rpc("count_recent_backfill_attempts", {
      p_genre_id: g.id,
      p_hours: 24,
    });
    if ((count ?? 0) >= 3) {
      skipped.push({ genre_id: g.id, nome: g.nome, reason: "rate_limited", attempts_24h: count });
      continue;
    }

    try {
      const r = await fetch(`${SUPABASE_URL}/functions/v1/genre-backfill`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SERVICE_KEY}`,
        },
        body: JSON.stringify({ genre_id: g.id, triggered_by: "cron" }),
      });
      const data = await r.json().catch(() => ({}));
      dispatched.push({
        genre_id: g.id,
        nome: g.nome,
        prev_health: g.health_status,
        ok: r.ok,
        status: r.status,
        new_health: (data as { new_health?: string })?.new_health,
      });
    } catch (e) {
      dispatched.push({
        genre_id: g.id,
        nome: g.nome,
        ok: false,
        error: (e as Error).message,
      });
    }

    if (dispatched.length < MAX_GENRES_PER_RUN) await sleep(DELAY_BETWEEN_MS);
  }

  // log resumo
  await sb.from("collection_logs").insert({
    acao: "cron:backfill-dead",
    status: "ok",
    mensagem: JSON.stringify({
      scanned: candidates.length,
      dispatched: dispatched.length,
      skipped: skipped.length,
    }),
    duracao_ms: Date.now() - startedAt,
  }).then(() => {}, () => {});

  return jr({
    ok: true,
    scanned: candidates.length,
    dispatched: dispatched.length,
    skipped: skipped.length,
    duracao_ms: Date.now() - startedAt,
    results: dispatched,
    skipped_details: skipped,
  }, 200);
});
