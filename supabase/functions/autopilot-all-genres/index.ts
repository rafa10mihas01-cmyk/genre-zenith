// autopilot-all-genres — Orquestrador multi-gênero.
//
// Dispara `genre-autopilot` para TODOS os gêneros ativos em sequência,
// respeitando o `target_today` de cada um (calculado dinamicamente em
// `get_genre_daily_target_v2`). Cada gênero roda no seu próprio cooldown
// e é skippado automaticamente pelo genre-autopilot se já atingiu a meta.
//
// POST { skip_cooldown?: boolean, delay_ms?: number, only?: string[] }
//   → { ok, results: [{ genre_id, slug, status, run_id?, error? }] }
//
// Idempotente: chamar 2x seguidas não duplica trabalho — o cooldown
// individual de cada gênero (1h em genre-autopilot) bloqueia.
import { corsHeaders } from "npm:@supabase/supabase-js/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { requireTeamAccess } from "../_shared/auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface Body {
  skip_cooldown?: boolean;
  delay_ms?: number;
  only?: string[]; // slugs específicos (ex: ["funk","piseiro"]); vazio = todos
}

interface GenreResult {
  genre_id: string;
  slug: string;
  nome: string;
  status: "started" | "skipped_meta" | "skipped_cooldown" | "skipped_lock" | "skipped_stale" | "error";
  run_id?: string;
  will_generate?: number;
  target?: Record<string, unknown>;
  error?: string;
  http_status?: number;
}

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function callGenreAutopilot(genreId: string, force: boolean) {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/genre-autopilot`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SERVICE_KEY}`,
    },
    body: JSON.stringify({ genre_id: genreId, force }),
  });
  const text = await r.text();
  let data: any = null;
  try { data = JSON.parse(text); } catch { /* ignore */ }
  return { status: r.status, ok: r.ok, data, raw: text };
}

const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jr({ error: "POST only" }, 405);

  // Aceita CRON_SECRET via header x-cron-secret (chamadas agendadas pg_cron),
  // OU service_role / usuário admin via Authorization Bearer.
  const cronHeader = req.headers.get("x-cron-secret");
  const isCron = CRON_SECRET && cronHeader && cronHeader === CRON_SECRET;
  if (!isCron) {
    const guard = await requireTeamAccess(req);
    if (!guard.ok) return guard.resp;
  }

  let body: Body = {};
  try { body = await req.json(); } catch { /* body opcional */ }

  const skipCooldown = body.skip_cooldown === true;
  const delayMs = Math.max(0, body.delay_ms ?? 1500);
  const onlySlugs = Array.isArray(body.only) && body.only.length > 0
    ? body.only.map((s) => String(s).toLowerCase().trim())
    : null;

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Lista gêneros ativos
  let q = sb.from("genres").select("id, slug, nome").eq("ativo", true);
  const { data: genres, error: gErr } = await q.order("slug", { ascending: true });
  if (gErr) return jr({ error: `Falha ao listar gêneros: ${gErr.message}` }, 500);

  const targets = (genres ?? []).filter((g) =>
    onlySlugs ? onlySlugs.includes(String(g.slug).toLowerCase()) : true
  );

  if (targets.length === 0) {
    return jr({ ok: true, results: [], message: "Nenhum gênero ativo para processar" });
  }

  // 🆕 PRÉ-FILTRO DE FRESCOR — descarta gêneros sem playlists vistas nos últimos 14 dias.
  // Evita HTTP wasteful pro genre-autopilot, que abortaria de qualquer jeito no gate.
  const FRESHNESS_WINDOW_DAYS = 14;
  const sinceISO = new Date(Date.now() - FRESHNESS_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const freshChecks = await Promise.all(targets.map(async (g) => {
    const { count } = await sb
      .from("search_results")
      .select("id", { count: "exact", head: true })
      .eq("genre_id", g.id)
      .eq("is_valid", true)
      .gte("last_seen_at", sinceISO);
    return { genre: g, fresh: (count ?? 0) > 0 };
  }));

  const skippedStale: GenreResult[] = freshChecks
    .filter((c) => !c.fresh)
    .map((c) => ({
      genre_id: c.genre.id,
      slug: c.genre.slug,
      nome: c.genre.nome,
      status: "skipped_stale" as const,
      error: `sem dados recentes em ${FRESHNESS_WINDOW_DAYS}d — pulado`,
    }));

  // Log skipped em batch (sem bloquear)
  if (skippedStale.length > 0) {
    sb.from("collection_logs").insert(
      skippedStale.map((s) => ({
        genre_id: s.genre_id,
        acao: "autopilot-all-genres",
        status: "info",
        mensagem: `${s.slug}: skipped_stale — ${s.error}`.slice(0, 500),
      }))
    ).then(() => {}, () => {});
  }

  const freshTargets = freshChecks.filter((c) => c.fresh).map((c) => c.genre);

  const results: GenreResult[] = [];
  const startedAt = Date.now();

  for (let i = 0; i < targets.length; i++) {
    const g = targets[i];
    const item: GenreResult = { genre_id: g.id, slug: g.slug, nome: g.nome, status: "error" };

    try {
      const r = await callGenreAutopilot(g.id, skipCooldown);
      item.http_status = r.status;

      // Sucesso: pipeline disparado
      if (r.ok && r.data?.ok === true && r.data?.run_id) {
        item.status = "started";
        item.run_id = r.data.run_id;
        item.will_generate = r.data.will_generate;
        item.target = r.data.target;
      }
      // 200 com ok:false → meta diária já atingida (não é erro)
      else if (r.status === 200 && r.data?.ok === false && r.data?.target) {
        item.status = "skipped_meta";
        item.target = r.data.target;
        item.error = r.data.error;
      }
      // 429 → cooldown ativo
      else if (r.status === 429) {
        item.status = "skipped_cooldown";
        item.run_id = r.data?.run_id;
        item.error = r.data?.error;
      }
      // 409 → lock (run em andamento)
      else if (r.status === 409) {
        item.status = "skipped_lock";
        item.run_id = r.data?.run_id;
        item.error = r.data?.error;
      }
      else {
        item.status = "error";
        item.error = r.data?.error ?? r.raw?.slice(0, 300) ?? `HTTP ${r.status}`;
      }
    } catch (e) {
      item.status = "error";
      item.error = e instanceof Error ? e.message : String(e);
    }

    results.push(item);

    // Log individual em collection_logs para auditoria
    await sb.from("collection_logs").insert({
      genre_id: g.id,
      acao: "autopilot-all-genres",
      status: item.status === "started" ? "sucesso" : (item.status === "error" ? "erro" : "info"),
      mensagem: `${item.slug}: ${item.status}${item.run_id ? ` (run ${item.run_id.slice(0, 8)})` : ""}${item.error ? ` — ${item.error}` : ""}`.slice(0, 500),
    }).then(() => {}, () => {});

    // Delay entre gêneros para não saturar IA / evitar rate limit
    if (i < targets.length - 1 && delayMs > 0) {
      await new Promise((res) => setTimeout(res, delayMs));
    }
  }

  const summary = {
    ok: true,
    duration_ms: Date.now() - startedAt,
    total_genres: targets.length,
    started: results.filter((r) => r.status === "started").length,
    skipped_meta: results.filter((r) => r.status === "skipped_meta").length,
    skipped_cooldown: results.filter((r) => r.status === "skipped_cooldown").length,
    skipped_lock: results.filter((r) => r.status === "skipped_lock").length,
    errors: results.filter((r) => r.status === "error").length,
    results,
  };

  return jr(summary);
});
