// auto-replicate-playlists — escala automaticamente o que está funcionando.
//
// Regra:
//   1) Busca playlist_templates com performance_class='alta', publicadas há >=24h,
//      e que NÃO foram usadas como semente de blueprint nas últimas 7 dias.
//   2) Para cada uma (até MAX por execução), aciona `extract-blueprints` no
//      gênero correspondente — isso gera/atualiza blueprints, e a lógica de
//      `extract-blueprints` já herda performance_source='alta' + priority='alta'
//      pra esses padrões vencedores.
//   3) NÃO cria playlist no Spotify. Apenas gera blueprint.
//
// POST {} → {ok, processed, skipped, results}
// Pode ser chamado por cron ou manualmente.
import { corsHeaders } from "npm:@supabase/supabase-js/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { requireTeamAccess } from "../_shared/auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const MAX_PER_RUN = 5;
const MIN_AGE_HOURS = 24;
const COOLDOWN_DAYS = 7;

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function callFn(name: string, body: unknown) {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
    body: JSON.stringify(body),
  });
  const txt = await r.text();
  let data: any = null;
  try { data = JSON.parse(txt); } catch { /* ignore */ }
  return { ok: r.ok, status: r.status, data };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  if (req.method !== "OPTIONS") {
    const guard = await requireTeamAccess(req);
    if (!guard.ok) return guard.resp;
  }
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  const startedAt = Date.now();

  // 1) Templates "alta" prontos pra escalar
  //    - status='created' (publicado no Spotify)
  //    - performance_class='alta'
  //    - created_on_spotify_at <= now() - 24h
  const minAge = new Date(Date.now() - MIN_AGE_HOURS * 3600 * 1000).toISOString();

  const { data: winners, error: wErr } = await supabase
    .from("playlist_templates")
    .select("id, genre_id, name, blueprint_id, performance_class, created_on_spotify_at, performance_evaluated_at")
    .eq("performance_class", "alta")
    .eq("status", "created")
    .lte("created_on_spotify_at", minAge)
    .order("performance_evaluated_at", { ascending: false })
    .limit(50);

  if (wErr) return jr({ ok: false, error: wErr.message }, 500);
  if (!winners || winners.length === 0) {
    return jr({ ok: true, processed: 0, skipped: 0, reason: "nenhum template 'alta' elegível", results: [] });
  }

  // 2) Cooldown — gêneros que já tiveram extract-blueprints rodando nos últimos 7 dias são pulados
  const cooldown = new Date(Date.now() - COOLDOWN_DAYS * 86400 * 1000).toISOString();
  const genreIds = [...new Set(winners.map(w => w.genre_id))];
  const { data: recentExtracts } = await supabase
    .from("collection_logs")
    .select("genre_id, created_at")
    .in("genre_id", genreIds)
    .eq("acao", "extract-blueprints")
    .eq("status", "sucesso")
    .gte("created_at", cooldown);

  const cooledDown = new Set((recentExtracts ?? []).map(r => r.genre_id));

  // 3) Seleciona até MAX_PER_RUN gêneros distintos (1 extract por gênero, mais eficiente)
  const seenGenres = new Set<string>();
  const queue: typeof winners = [];
  const skipped: any[] = [];
  for (const w of winners) {
    if (seenGenres.has(w.genre_id)) continue; // 1 por gênero/execução evita duplicação
    if (cooledDown.has(w.genre_id)) {
      skipped.push({ template: w.name, reason: `cooldown ${COOLDOWN_DAYS}d` });
      continue;
    }
    seenGenres.add(w.genre_id);
    queue.push(w);
    if (queue.length >= MAX_PER_RUN) break;
  }

  if (queue.length === 0) {
    await supabase.from("collection_logs").insert({
      acao: "auto-replicate-playlists",
      status: "ok",
      mensagem: `Nenhum gênero elegível (todos em cooldown). Skipped=${skipped.length}`,
      duracao_ms: Date.now() - startedAt,
    });
    return jr({ ok: true, processed: 0, skipped: skipped.length, results: [], skip_details: skipped });
  }

  // 4) Para cada gênero vencedor, dispara extract-blueprints
  const results: any[] = [];
  for (const w of queue) {
    const t0 = Date.now();
    try {
      const ext = await callFn("extract-blueprints", {
        genre_id: w.genre_id,
        max_per_tier: 5,
        force: false,
      });
      const created = ext.data?.created?.length ?? 0;
      const updated = ext.data?.updated?.length ?? 0;
      results.push({
        genre_id: w.genre_id,
        seed_template: w.name,
        ok: ext.ok && ext.data?.ok !== false,
        blueprints_created: created,
        blueprints_updated: updated,
        duration_ms: Date.now() - t0,
        error: ext.data?.error ?? null,
      });
    } catch (e) {
      results.push({
        genre_id: w.genre_id,
        seed_template: w.name,
        ok: false,
        error: (e as Error).message,
      });
    }
  }

  const succeeded = results.filter(r => r.ok).length;
  await supabase.from("collection_logs").insert({
    acao: "auto-replicate-playlists",
    status: succeeded > 0 ? "sucesso" : "erro",
    mensagem: `Auto-replicate: ${succeeded}/${queue.length} gêneros processados • skipped=${skipped.length}`,
    duracao_ms: Date.now() - startedAt,
  });

  return jr({
    ok: true,
    processed: queue.length,
    succeeded,
    skipped: skipped.length,
    results,
    skip_details: skipped,
  });
});
