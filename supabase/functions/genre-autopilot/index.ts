// genre-autopilot — Pipeline completo "Usar inteligência"
//
// Orquestra em sequência (sem intervenção manual):
//   1. analyze-genre              (cache 24h)
//   2. generate-playlists-briefing (cache 7d)
//   3. extract-blueprints         (reusa se já existe blueprint ativo)
//   4. generate-templates         (sempre novos, máx 5)
//   5. generate-cover-variations  (1 por template, só se faltar)
//   6. auto-aprovar templates HOT (score≥75 + tier=hot + ≥25 tracks)
//   7. replicate-top              (gera pacote, NÃO publica)
//
// Atualiza public.autopilot_runs a cada passo (frontend escuta via realtime).
//
// POST { genre_id: string, max_templates?: number }
//   → { ok, run_id }                (resposta imediata; trabalho continua em background)
//
// Cooldown: 1 execução por gênero por hora.
import { corsHeaders } from "npm:@supabase/supabase-js/cors";
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";
import { requireTeamAccess } from "../_shared/auth.ts";

import { deprecationGate } from "../_shared/_deprecation.ts";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Cooldown adaptativo: 6h padrão, mas reduz pra 1h se houve coleta nova desde a última run.
const COOLDOWN_MS_DEFAULT = 6 * 60 * 60 * 1000;     // 6h sem coleta nova
const COOLDOWN_MS_AFTER_COLLECT = 60 * 60 * 1000;   // 1h se houve coleta
const ANALYZE_CACHE_MS = 24 * 60 * 60 * 1000;       // 24h
const BRIEFING_CACHE_MS = 7 * 24 * 60 * 60 * 1000;  // 7d
const HARD_CAP_TEMPLATES = 10;
const FALLBACK_TEMPLATES = 4;

// 🔒 GATE DE MASSA — playlists válidas são a métrica principal.
// Termos executados continuam como telemetria/cobertura, mas não bloqueiam a IA
// quando já existe massa suficiente de playlists no gênero.
const MIN_TERMS_EXECUTED = 30;
const MIN_PLAYLISTS_VALID = 50;
// 🆕 GATE DE FRESCOR — exige atividade recente (alguma playlist vista nos últimos N dias).
// Evita rodar pipeline em "modo vazio" sobre dataset stale, marcando run como success
// sem trabalho real. Tolera 1-2 falhas semanais de daily-collect sem travar tudo.
const FRESHNESS_WINDOW_DAYS = 14;
const FRESHNESS_WINDOW_MS = FRESHNESS_WINDOW_DAYS * 24 * 60 * 60 * 1000;
// Auto-coleta: máximo de termos por run. Precisa ser ≥ MIN_TERMS_EXECUTED
// pra um único ciclo conseguir bater o gate completo. Cap de Apify ≈ 30 chamadas/run.
const AUTO_COLLECT_MAX_TERMS = 30;
// 🛡️ LOOP PROTECTION — máximo de auto-coletas disparadas por gênero em janela de 24h
const AUTO_COLLECT_MAX_PER_DAY = 3;
const AUTO_COLLECT_WINDOW_MS = 24 * 60 * 60 * 1000;
// 🆕 COLD START — anti-loop pra disparo inicial de coleta
const COLD_START_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutos
const COLD_START_ACAO = "autopilot:cold-start";

// Aprovação — afrouxada pra resgatar templates 'medium' bons que ficavam em limbo.
// Aprova se: (tier=hot AND score≥75) OR (tier=medium AND score≥80). Sempre exige ≥25 tracks.
const APPROVE_HOT_MIN_SCORE = 75;
const APPROVE_MEDIUM_MIN_SCORE = 80;
const APPROVE_MIN_TRACKS = 25;

type Step =
  | "analyze"
  | "briefing"
  | "blueprints"
  | "templates"
  | "covers"
  | "approve"
  | "replicate"
  | "done";

const STEP_ORDER: Step[] = [
  "analyze", "briefing", "blueprints", "templates", "covers", "approve", "replicate", "done",
];

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function progressFor(step: Step): number {
  const idx = STEP_ORDER.indexOf(step);
  return Math.round((idx / (STEP_ORDER.length - 1)) * 100);
}

async function updateRun(
  sb: SupabaseClient,
  runId: string,
  patch: Record<string, unknown>,
) {
  const { error } = await sb.from("autopilot_runs").update(patch).eq("id", runId);
  if (error) console.error("[autopilot] updateRun error:", error.message);
}

async function setStep(
  sb: SupabaseClient,
  runId: string,
  step: Step,
  extra: Record<string, unknown> = {},
) {
  await updateRun(sb, runId, {
    current_step: step,
    progress_pct: progressFor(step),
    ...extra,
  });
}

async function pushCompleted(
  sb: SupabaseClient,
  runId: string,
  step: Step,
  meta: Record<string, unknown> = {},
) {
  const { data } = await sb.from("autopilot_runs").select("steps_completed").eq("id", runId).maybeSingle();
  const arr = Array.isArray(data?.steps_completed) ? data!.steps_completed : [];
  arr.push({ step, at: new Date().toISOString(), ...meta });
  await updateRun(sb, runId, { steps_completed: arr });
}

async function invokeFn<T = any>(
  fnName: string,
  body: Record<string, unknown>,
  timeoutMs = 60000,
): Promise<{ ok: boolean; data?: T; error?: string; status?: number }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(`${SUPABASE_URL}/functions/v1/${fnName}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await resp.text();
    let data: any;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    if (!resp.ok) return { ok: false, error: data?.error ?? `HTTP ${resp.status}`, status: resp.status };
    return { ok: true, data, status: resp.status };
  } catch (e) {
    const isAbort = e instanceof Error && e.name === "AbortError";
    return { ok: false, error: isAbort ? `timeout após ${timeoutMs}ms` : (e instanceof Error ? e.message : String(e)) };
  } finally {
    clearTimeout(t);
  }
}

// ============================================================
// HELPERS — gate de massa, coleta nova, auto-coleta
// ============================================================
async function checkMassa(sb: SupabaseClient, genreId: string): Promise<{
  ok: boolean;
  termsExecuted: number;
  playlistsValid: number;
  freshPlaylists: number;
  lastSeenAt: string | null;
  stale: boolean;
  recovery: boolean;
  hasHistorical: boolean;
  reason?: string;
}> {
  const sinceISO = new Date(Date.now() - FRESHNESS_WINDOW_MS).toISOString();
  const [
    { count: termsExecuted },
    { count: playlistsValid },
    { count: freshPlaylists },
    { data: lastSeenRow },
  ] = await Promise.all([
    sb.from("search_terms").select("id", { count: "exact", head: true })
      .eq("genre_id", genreId).eq("executado", true),
    sb.from("search_results").select("id", { count: "exact", head: true })
      .eq("genre_id", genreId).eq("is_valid", true),
    sb.from("search_results").select("id", { count: "exact", head: true })
      .eq("genre_id", genreId).eq("is_valid", true)
      .gte("last_seen_at", sinceISO),
    sb.from("search_results").select("last_seen_at")
      .eq("genre_id", genreId).eq("is_valid", true)
      .order("last_seen_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const t = termsExecuted ?? 0;
  const p = playlistsValid ?? 0;
  const f = freshPlaylists ?? 0;
  const lastSeenAt = lastSeenRow?.last_seen_at ?? null;
  // 🚑 RECOVERY MODE — alinhado com collect-batch/run-search:
  // < 50 playlists frescas em 14d ⇒ gênero "starving", relaxa validações de cobertura.
  const recovery = f < 50;
  // hasHistorical = QUALQUER playlist válida no histórico (mesmo fora da janela de 14d).
  const hasHistorical = p > 0;
  // Freshness gate: padrão = sem playlist fresca na janela.
  // Em recovery, só barra se também não houver NENHUM dado histórico
  // (gênero 100% vazio continua bloqueado para evitar runs sem trabalho real).
  const stale = recovery
    ? (f === 0 && !hasHistorical)
    : f === 0;
  const reasons: string[] = [];
  if (stale) {
    reasons.push(
      `sem playlists vistas nos últimos ${FRESHNESS_WINDOW_DAYS}d` +
      (lastSeenAt ? ` (última: ${new Date(lastSeenAt).toISOString().slice(0,10)})` : " (nunca coletado)")
    );
  }
  if (p < MIN_PLAYLISTS_VALID) {
    reasons.push(`playlists válidas ${p}/${MIN_PLAYLISTS_VALID}`);
    // Em recovery, "termos executados" sai da lista de motivos —
    // não deve bloquear gêneros novos/zerados que ainda nem rodaram massa de termos.
    if (!recovery && t < MIN_TERMS_EXECUTED) {
      reasons.push(`termos executados ${t}/${MIN_TERMS_EXECUTED}`);
    }
  }
  return {
    ok: !stale && p >= MIN_PLAYLISTS_VALID,
    termsExecuted: t,
    playlistsValid: p,
    freshPlaylists: f,
    lastSeenAt,
    stale,
    recovery,
    hasHistorical,
    reason: reasons.length > 0 ? reasons.join(" + ") : undefined,
  };
}

async function lastCollectionAt(sb: SupabaseClient, genreId: string): Promise<Date | null> {
  const { data } = await sb
    .from("search_results")
    .select("coletado_em")
    .eq("genre_id", genreId)
    .order("coletado_em", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.coletado_em ? new Date(data.coletado_em) : null;
}

/**
 * Conta auto-coletas disparadas pelo autopilot nas últimas 24h pra esse gênero.
 * Usado pra evitar loop infinito quando coleta sucessiva não traz playlists novas.
 */
async function countRecentAutoCollects(sb: SupabaseClient, genreId: string): Promise<number> {
  const since = new Date(Date.now() - AUTO_COLLECT_WINDOW_MS).toISOString();
  const { count } = await sb
    .from("collection_logs")
    .select("id", { count: "exact", head: true })
    .eq("genre_id", genreId)
    .eq("acao", "autopilot:auto-collect")
    .gte("created_at", since);
  return count ?? 0;
}

/**
 * Dispara auto-coleta em background usando collect-batch (1 gênero, N termos pendentes).
 * Não aguarda — autopilot retorna imediatamente. Quando coleta termina, autopilot é re-disparado
 * SOMENTE se a massa atingir o mínimo (evita loop infinito sobre mesmo cache).
 */
async function triggerAutoCollect(
  sb: SupabaseClient,
  runId: string,
  genreId: string,
  templatesToGenerate: number,
): Promise<void> {
  // Garante que existem termos pendentes (gera se não tem nenhum)
  const { count: pendingTerms } = await sb
    .from("search_terms")
    .select("id", { count: "exact", head: true })
    .eq("genre_id", genreId)
    .eq("executado", false);

  if ((pendingTerms ?? 0) < AUTO_COLLECT_MAX_TERMS) {
    await invokeFn("generate-terms", { genre_id: genreId }, 30000)
      .catch((e) => console.warn("[autopilot] generate-terms falhou:", e?.message ?? e));
  }

  // 📋 Log estruturado: início da auto-coleta
  await sb.from("collection_logs").insert({
    genre_id: genreId,
    acao: "autopilot:auto-collect",
    status: "iniciado",
    mensagem: JSON.stringify({
      event: "auto_collect_start",
      run_id: runId,
      max_terms: AUTO_COLLECT_MAX_TERMS,
      pending_terms: pendingTerms ?? 0,
      target_templates: templatesToGenerate,
    }),
  }).then(() => {}, (e) => console.warn("[autopilot] log start failed:", e?.message));

  // Dispara collect-batch e depois re-invoca o próprio autopilot (chained)
  // deno-lint-ignore no-explicit-any
  const ER: any = (globalThis as any).EdgeRuntime;
  const work = (async () => {
    const tStart = Date.now();
    try {
      const r = await invokeFn<{
        total_terms_run?: number;
        total_playlists?: number;
        total_tracks?: number;
      }>("collect-batch", {
        genre_ids: [genreId],
        terms_per_genre: AUTO_COLLECT_MAX_TERMS,
        max_results: 100,
        delay_ms: 1500,
      }, 20 * 60 * 1000); // até 20min

      // 🔒 BLOQUEIO REFORÇADO PÓS-COLETA — revalida massa antes de re-disparar IA
      const massaPos = await checkMassa(sb, genreId);
      // Critério relaxado pós-coleta: se playlists ≥ mínimo, IA já tem dados pra trabalhar
      // (termos é só proxy de cobertura — Apify pode trazer 100+ playlists em poucos termos).
      const hasEnoughPostCollect = massaPos.playlistsValid >= MIN_PLAYLISTS_VALID;

      const shouldRetrigger = hasEnoughPostCollect;
      const collectionError = r.error ?? "Falha desconhecida na auto-coleta";

      // 📋 Log estruturado: fim da auto-coleta
      await sb.from("collection_logs").insert({
        genre_id: genreId,
        acao: "autopilot:auto-collect",
        status: r.ok ? "sucesso" : "erro",
        duracao_ms: Date.now() - tStart,
        mensagem: JSON.stringify({
          event: "auto_collect_end",
          run_id: runId,
          ok: r.ok,
          terms_run: r.data?.total_terms_run ?? 0,
          playlists_saved: r.data?.total_playlists ?? 0,
          tracks_saved: r.data?.total_tracks ?? 0,
          massa_pos: {
            terms: massaPos.termsExecuted,
            playlists: massaPos.playlistsValid,
            ok: massaPos.ok,
            relaxed_ok: hasEnoughPostCollect,
          },
          will_retrigger: shouldRetrigger,
          error: r.ok ? null : collectionError,
        }),
      });

      // Se massa AINDA insuficiente após coleta → não re-dispara IA.
      // Se a coleta ainda falhou, converte a run órfã em erro claro pra liberar retry manual.
      if (!hasEnoughPostCollect) {
        const failMsg = r.ok
          ? `Após auto-coleta, ainda faltam playlists (${massaPos.playlistsValid}/${MIN_PLAYLISTS_VALID}). IA não será disparada — colete manualmente ou aguarde próxima execução.`
          : `Auto-coleta falhou (${collectionError}) e a massa ainda é insuficiente (${massaPos.playlistsValid}/${MIN_PLAYLISTS_VALID} playlists válidas). Tente novamente mais tarde.`;

        await updateRun(sb, runId, {
          status: "error",
          current_step: "analyze",
          error_message: failMsg,
          summary: failMsg,
          finished_at: new Date().toISOString(),
          duracao_ms: Date.now() - tStart,
        });

        await sb.rpc("create_notification", {
          p_type: r.ok ? "warning" : "error",
          p_title: r.ok ? "Autopilot: coleta insuficiente" : "Autopilot: coleta falhou",
          p_message: failMsg,
          p_action_url: "/cerebro",
          p_metadata: { run_id: runId, genre_id: genreId, terms: massaPos.termsExecuted, playlists: massaPos.playlistsValid },
        }).then(() => {}, (e) => console.error("[autopilot] notif failed:", e?.message));
        return;
      }

      if (!r.ok) {
        await sb.rpc("create_notification", {
          p_type: "warning",
          p_title: "Autopilot: coleta parcial aproveitada",
          p_message: `A coleta retornou erro (${collectionError}), mas a massa já está suficiente (${massaPos.playlistsValid} playlists válidas). Prosseguindo com a IA.`,
          p_action_url: "/cerebro",
          p_metadata: { run_id: runId, genre_id: genreId, terms: massaPos.termsExecuted, playlists: massaPos.playlistsValid },
        }).then(() => {}, (e) => console.error("[autopilot] notif failed:", e?.message));
      }

      // ✅ Massa OK — re-dispara autopilot
      await invokeFn("genre-autopilot", {
        genre_id: genreId,
        max_templates: templatesToGenerate,
        force: true, // bypass cooldown — já passamos pelo gate
      }, 10000).catch((e) => console.warn("[autopilot] re-trigger falhou:", e?.message ?? e));
    } catch (e) {
      console.error("[autopilot] auto-collect background error:", e instanceof Error ? e.message : String(e));
    }
  })();

  if (ER && typeof ER.waitUntil === "function") ER.waitUntil(work);
}

// ============================================================
// PIPELINE — roda em background depois que respondemos ao cliente
// ============================================================
async function runPipeline(
  sb: SupabaseClient,
  runId: string,
  genreId: string,
  maxTemplates: number,
  targetMeta: Record<string, unknown> = {},
) {
  const startedAt = Date.now();
  const cacheHits: Record<string, boolean> = {};
  let templatesGenerated = 0;
  let templatesApproved = 0;
  let coversGenerated = 0;
  const generatedIds: string[] = []; // 🔄 rastreia ids p/ cleanup em caso de falha

  try {
    // ─── 0. GATE DE MASSA ────────────────────────────────────────
    // Bloqueia IA se gênero não tem dados mínimos. Dispara auto-coleta em background
    // e marca run como 'waiting_collection' (será re-disparada quando coleta concluir).
    const massa = await checkMassa(sb, genreId);

    // ─── 0a. COLD START ─────────────────────────────────────────
    // Gênero 100% zerado (nenhuma playlist válida no histórico) → dispara coleta
    // inicial automática e marca run como waiting_collection (sem error, sem retry no front).
    const isColdStart = massa.playlistsValid === 0;
    if (isColdStart) {
      // Anti-loop: só dispara se não houve coleta nos últimos 5min
      const since = new Date(Date.now() - COLD_START_COOLDOWN_MS).toISOString();
      const { count: recentColdCollects } = await sb
        .from("collection_logs")
        .select("id", { count: "exact", head: true })
        .eq("genre_id", genreId)
        .eq("acao", COLD_START_ACAO)
        .gte("created_at", since);

      const skipCollect = (recentColdCollects ?? 0) > 0;
      const summary = skipCollect
        ? "Coletando dados iniciais… (aguardando coleta em andamento)"
        : "Coletando dados iniciais…";

      await pushCompleted(sb, runId, "analyze", {
        gate: "cold_start",
        playlists: massa.playlistsValid,
        action: skipCollect ? "skip_recent_collect" : "trigger_initial_collect",
      });
      await updateRun(sb, runId, {
        status: "waiting_collection",
        current_step: "analyze",
        summary,
        finished_at: new Date().toISOString(),
        duracao_ms: Date.now() - startedAt,
      });

      if (!skipCollect) {
        await sb.from("collection_logs").insert({
          genre_id: genreId,
          acao: COLD_START_ACAO,
          status: "iniciado",
          mensagem: JSON.stringify({
            event: "cold_start_collect",
            run_id: runId,
            playlists_before: massa.playlistsValid,
          }),
        }).then(() => {}, (e) => console.warn("[autopilot] cold-start log failed:", e?.message));

        await invokeFn("generate-terms", { genre_id: genreId }, 30000)
          .catch((e) => console.warn("[autopilot] cold-start generate-terms failed:", e?.message ?? e));

        // deno-lint-ignore no-explicit-any
        const ER: any = (globalThis as any).EdgeRuntime;
        const work = (async () => {
          try {
            const { data: term } = await sb
              .from("search_terms")
              .select("id, termo")
              .eq("genre_id", genreId)
              .eq("executado", false)
              .order("created_at")
              .limit(1)
              .maybeSingle();
            if (term) {
              await invokeFn("run-search", {
                genre_id: genreId,
                term_id: term.id,
                search_term: term.termo,
                max_results: 50,
              }, 5 * 60 * 1000);
            }
            await invokeFn("enrich-playlists", {
              genre_id: genreId,
              limit: 50,
              fetch_tracks: false,
            }, 5 * 60 * 1000);
          } catch (e) {
            console.error("[autopilot] cold-start background error:",
              e instanceof Error ? e.message : String(e));
          }
        })();
        if (ER && typeof ER.waitUntil === "function") ER.waitUntil(work);
      }
      return;
    }

    // 🆕 GATE DE FRESCOR — em modo normal, aborta se não houver atividade recente.
    // Em recovery (< 50 frescas em 14d), só aborta se NÃO houver nenhum dado histórico
    // (gênero 100% vazio). Isso permite destravar gêneros com playlists antigas.
    if (massa.stale) {
      const staleMsg =
        `🛑 Pipeline abortado: gênero sem dados históricos` +
        (massa.lastSeenAt
          ? ` (última coleta: ${new Date(massa.lastSeenAt).toISOString().slice(0, 10)})`
          : " (gênero nunca coletado)") +
        `. Rode coleta manual em /sistema antes de tentar autopilot.`;

      await pushCompleted(sb, runId, "analyze", {
        gate: "frescor",
        fresh_playlists: massa.freshPlaylists,
        last_seen_at: massa.lastSeenAt,
        window_days: FRESHNESS_WINDOW_DAYS,
        recovery: massa.recovery,
        has_historical: massa.hasHistorical,
        action: "aborted_no_data",
      });
      await updateRun(sb, runId, {
        status: "error",
        current_step: "analyze",
        error_message: staleMsg,
        summary: staleMsg,
        finished_at: new Date().toISOString(),
        duracao_ms: Date.now() - startedAt,
      });
      await sb.from("collection_logs").insert({
        genre_id: genreId,
        acao: "autopilot:freshness-gate",
        status: "bloqueado",
        mensagem: JSON.stringify({
          event: "no_fresh_data",
          run_id: runId,
          window_days: FRESHNESS_WINDOW_DAYS,
          fresh_playlists: massa.freshPlaylists,
          last_seen_at: massa.lastSeenAt,
          total_playlists_valid: massa.playlistsValid,
        }),
      }).then(() => {}, (e) => console.warn("[autopilot] log stale failed:", e?.message));
      await sb.rpc("create_notification", {
        p_type: "error",
        p_title: "Autopilot: sem dados recentes",
        p_message: staleMsg,
        p_action_url: "/sistema",
        p_metadata: {
          run_id: runId,
          genre_id: genreId,
          window_days: FRESHNESS_WINDOW_DAYS,
          last_seen_at: massa.lastSeenAt,
        },
      }).then(() => {}, (e) => console.error("[autopilot] notif failed:", e?.message));

      // 🆕 HOOK: agendar backfill automático (fire-and-forget, respeita rate limit interno).
      // Não bloqueia o autopilot — só dispara reprocessamento em background pra próxima rodada.
      invokeFn("genre-backfill", {
        genre_id: genreId,
        triggered_by: "autopilot_hook",
      }, 5000).then(
        (r) => console.log("[autopilot] backfill scheduled:", r.ok, r.status),
        (e) => console.warn("[autopilot] backfill schedule failed:", e?.message),
      );
      return;
    }

    if (!massa.ok) {
      // 🛡️ LOOP PROTECTION — se já houve N auto-coletas em 24h e ainda falta massa,
      // para de coletar (provavelmente Apify não está trazendo playlists novas).
      const recentCollects = await countRecentAutoCollects(sb, genreId);
      if (recentCollects >= AUTO_COLLECT_MAX_PER_DAY) {
        const blockMsg = `🛑 Auto-coleta bloqueada: ${recentCollects} tentativas em 24h sem atingir mínimo (${massa.reason}). Verifique termos manualmente.`;
        await pushCompleted(sb, runId, "analyze", {
          gate: "massa",
          terms: massa.termsExecuted,
          playlists: massa.playlistsValid,
          recovery: massa.recovery,
          action: "blocked_loop_protection",
          recent_auto_collects: recentCollects,
        });
        await updateRun(sb, runId, {
          status: "error",
          current_step: "analyze",
          error_message: blockMsg,
          summary: blockMsg,
          finished_at: new Date().toISOString(),
          duracao_ms: Date.now() - startedAt,
        });
        await sb.from("collection_logs").insert({
          genre_id: genreId,
          acao: "autopilot:auto-collect",
          status: "bloqueado",
          mensagem: JSON.stringify({
            event: "loop_protection_triggered",
            run_id: runId,
            recent_auto_collects: recentCollects,
            window_hours: AUTO_COLLECT_WINDOW_MS / 3600000,
            terms: massa.termsExecuted,
            playlists: massa.playlistsValid,
          }),
        }).then(() => {}, (e) => console.warn("[autopilot] log block failed:", e?.message));
        await sb.rpc("create_notification", {
          p_type: "error",
          p_title: "Autopilot: loop de coleta bloqueado",
          p_message: `${recentCollects} auto-coletas em 24h não trouxeram playlists suficientes. Revise termos manualmente em /cerebro.`,
          p_action_url: "/cerebro",
          p_metadata: { run_id: runId, genre_id: genreId, recent_auto_collects: recentCollects },
        }).then(() => {}, (e) => console.error("[autopilot] notif failed:", e?.message));
        return;
      }

      await pushCompleted(sb, runId, "analyze", {
        gate: "massa",
        terms: massa.termsExecuted,
        playlists: massa.playlistsValid,
        recovery: massa.recovery,
        action: "auto-collect",
        recent_auto_collects: recentCollects,
      });
      const summary = `📡 Coleta automática iniciada (${recentCollects + 1}/${AUTO_COLLECT_MAX_PER_DAY} em 24h) — ${massa.reason}.`;
      await updateRun(sb, runId, {
        status: "waiting_collection",
        current_step: "analyze",
        summary,
        finished_at: new Date().toISOString(),
        duracao_ms: Date.now() - startedAt,
      });
      await sb.rpc("create_notification", {
        p_type: "info",
        p_title: "Autopilot: coleta automática iniciada",
        p_message: `${massa.reason}. Tentativa ${recentCollects + 1}/${AUTO_COLLECT_MAX_PER_DAY} em 24h.`,
        p_action_url: "/cerebro",
        p_metadata: { run_id: runId, genre_id: genreId, terms: massa.termsExecuted, playlists: massa.playlistsValid },
      }).then(() => {}, (e) => console.error("[autopilot] notif failed:", e?.message ?? e));

      // Dispara auto-coleta + re-trigger em background
      await triggerAutoCollect(sb, runId, genreId, maxTemplates);
      return;
    }

    // ─── 1. ANALYZE ──────────────────────────────────────────────
    await setStep(sb, runId, "analyze");
    const { data: model } = await sb
      .from("genre_models")
      .select("ultima_analise")
      .eq("genre_id", genreId)
      .maybeSingle();

    const analyzeAge = model?.ultima_analise
      ? Date.now() - new Date(model.ultima_analise).getTime()
      : Number.POSITIVE_INFINITY;

    if (analyzeAge < ANALYZE_CACHE_MS) {
      cacheHits.analyze = true;
      await pushCompleted(sb, runId, "analyze", { cached: true });
    } else {
      // Pre-enrich guard: garante massa mínima de playlists verificadas antes de analisar.
      // Sem isso, analyze-genre pode rodar em cima de dados crus de busca (followers do Apify).
      const { count: enrichedCount } = await sb
        .from("search_results")
        .select("id", { count: "exact", head: true })
        .eq("genre_id", genreId)
        .eq("is_valid", true)
        .eq("followers_source", "spotify_api");

      if ((enrichedCount ?? 0) < 30) {
        const preEnrich = await invokeFn("enrich-playlists", {
          genre_id: genreId,
          limit: 50,
          fetch_tracks: false,
        });
        const enrichedNow = (preEnrich.data as { enriched?: number } | null)?.enriched ?? 0;
        await sb.from("collection_logs").insert({
          genre_id: genreId,
          acao: "autopilot:pre-enrich",
          status: "sucesso",
          mensagem: `pre-enrich: ${enrichedNow} playlists enriquecidas (tinha ${enrichedCount ?? 0}/30 verificadas)`,
        });
        if (!preEnrich.ok) {
          console.warn(`[autopilot] pre-enrich não-ok (${preEnrich.error}) — seguindo para analyze mesmo assim`);
        }
      }

      const r = await invokeFn("analyze-genre", { genre_id: genreId });
      if (!r.ok) throw new Error(`analyze-genre falhou: ${r.error}`);
      await pushCompleted(sb, runId, "analyze", { cached: false });
    }

    // ─── 2. BRIEFING ─────────────────────────────────────────────
    await setStep(sb, runId, "briefing");
    const { data: brief } = await sb
      .from("playlist_briefings")
      .select("created_at")
      .eq("genre_id", genreId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const briefingAge = brief?.created_at
      ? Date.now() - new Date(brief.created_at).getTime()
      : Number.POSITIVE_INFINITY;

    if (briefingAge < BRIEFING_CACHE_MS) {
      cacheHits.briefing = true;
      await pushCompleted(sb, runId, "briefing", { cached: true });
    } else {
      const r = await invokeFn("generate-playlists-briefing", { genre_id: genreId });
      if (!r.ok) throw new Error(`generate-playlists-briefing falhou: ${r.error}`);
      await pushCompleted(sb, runId, "briefing", { cached: false });
    }

    // ─── 3. BLUEPRINTS ───────────────────────────────────────────
    await setStep(sb, runId, "blueprints");
    const { data: existingBps } = await sb
      .from("playlist_blueprints")
      .select("id, replication_score, replication_priority, tier")
      .eq("genre_id", genreId)
      .eq("status", "active");

    let blueprints = existingBps ?? [];
    if (blueprints.length === 0) {
      const r = await invokeFn("extract-blueprints", { genre_id: genreId, max_per_tier: 5 });
      if (!r.ok) throw new Error(`extract-blueprints falhou: ${r.error}`);
      const { data: fresh } = await sb
        .from("playlist_blueprints")
        .select("id, replication_score, replication_priority, tier")
        .eq("genre_id", genreId)
        .eq("status", "active");
      blueprints = fresh ?? [];
      await pushCompleted(sb, runId, "blueprints", { count: blueprints.length, cached: false });
    } else {
      cacheHits.blueprints = true;
      await pushCompleted(sb, runId, "blueprints", { count: blueprints.length, cached: true });
    }

    if (blueprints.length === 0) {
      throw new Error("Nenhum blueprint disponível após extração — gênero sem dados suficientes");
    }

    // Top blueprints: prioridade alta primeiro, depois score
    const PRI: Record<string, number> = { alta: 2, media: 1, baixa: 0 };
    const ranked = [...blueprints].sort(
      (a, b) =>
        (PRI[b.replication_priority ?? "media"] - PRI[a.replication_priority ?? "media"]) ||
        (Number(b.replication_score) - Number(a.replication_score)),
    );

    // ─── 4. TEMPLATES ────────────────────────────────────────────
    // Sempre gera novos. Distribui maxTemplates entre top blueprints (1-2 por blueprint).
    await setStep(sb, runId, "templates");
    const remaining = maxTemplates;
    const generated: string[] = generatedIds; // alias — escreve no array compartilhado
    const perBp = Math.max(1, Math.ceil(remaining / Math.min(ranked.length, 3)));
    for (const bp of ranked) {
      if (generated.length >= maxTemplates) break;
      const needed = Math.min(perBp, maxTemplates - generated.length);
      const r = await invokeFn<{ templates?: { id: string }[] }>("generate-templates", {
        blueprint_id: bp.id,
        count: needed,
      });
      if (!r.ok) {
        console.warn(`[autopilot] generate-templates falhou pro blueprint ${bp.id}: ${r.error}`);
        continue;
      }
      const ids = (r.data?.templates ?? []).map((t) => t.id).filter(Boolean);
      generated.push(...ids);
    }
    templatesGenerated = generated.length;
    await updateRun(sb, runId, { templates_generated: templatesGenerated });
    await pushCompleted(sb, runId, "templates", { count: templatesGenerated });

    if (templatesGenerated === 0) {
      throw new Error("Nenhum template foi gerado — verificar blueprints/IA");
    }

    // ─── 5. CAPAS ────────────────────────────────────────────────
    await setStep(sb, runId, "covers");
    const { data: tplsForCovers } = await sb
      .from("playlist_templates")
      .select("id, cover_image_url, cover_variations")
      .in("id", generated);

    for (const tpl of tplsForCovers ?? []) {
      const hasCover = tpl.cover_image_url || (Array.isArray(tpl.cover_variations) && tpl.cover_variations.length > 0);
      if (hasCover) continue;
      const r = await invokeFn("generate-cover-variations", { template_id: tpl.id });
      if (!r.ok) {
        console.warn(`[autopilot] generate-cover-variations falhou pro template ${tpl.id}: ${r.error}`);
        continue;
      }

      // 🔧 FIX race condition: NÃO confia no retorno da função.
      // Relê cover_variations do banco (fonte de verdade) — generate-cover-variations
      // já persistiu o append antes de retornar. Só então faz o update do main URL.
      // Pequeno retry pra cobrir lag de replicação.
      let firstUrl: string | null = null;
      let firstIndex = 0;
      for (let attempt = 0; attempt < 3; attempt++) {
        const { data: fresh } = await sb
          .from("playlist_templates")
          .select("cover_variations, cover_image_url")
          .eq("id", tpl.id)
          .maybeSingle();
        const variations = Array.isArray(fresh?.cover_variations) ? fresh!.cover_variations : [];
        if (variations.length > 0) {
          // Usa a variação mais recente que tem url válida
          for (let i = variations.length - 1; i >= 0; i--) {
            const url = (variations[i] as any)?.url;
            if (typeof url === "string" && url.length > 0) {
              firstUrl = url;
              firstIndex = i;
              break;
            }
          }
          if (firstUrl) break;
        }
        if (attempt < 2) await new Promise((res) => setTimeout(res, 800));
      }

      if (!firstUrl) {
        console.warn(`[autopilot] template ${tpl.id}: cover_variations vazio após retry — pulando update do main URL`);
        continue;
      }

      const { error: updErr } = await sb
        .from("playlist_templates")
        .update({
          cover_image_url: firstUrl,
          cover_selected_index: firstIndex,
        })
        .eq("id", tpl.id);

      if (updErr) {
        console.warn(`[autopilot] update cover_image_url falhou pro template ${tpl.id}: ${updErr.message}`);
        continue;
      }

      // ✅ Só incrementa quando capa foi efetivamente persistida + linkada
      coversGenerated++;
    }
    await updateRun(sb, runId, { covers_generated: coversGenerated });
    await pushCompleted(sb, runId, "covers", { count: coversGenerated });

    // ─── 6. AUTO-APROVAR ─────────────────────────────────────────
    // 🎯 score-templates roda em background (disparado por generate-templates).
    // Aguarda até ~30s pelos scores (poll a cada 2s). Sem isso, lê final_score=0 e nada é aprovado.
    await setStep(sb, runId, "approve");
    let candidates: any[] | null = null;
    for (let attempt = 0; attempt < 15; attempt++) {
      const { data } = await sb
        .from("playlist_templates")
        .select("id, final_score, quality_tier, tracks_added, track_seeds, status, scored_at")
        .in("id", generated);
      candidates = data ?? [];
      const allScored = candidates.length > 0 && candidates.every((t) => t.scored_at != null);
      if (allScored) break;
      await new Promise((r) => setTimeout(r, 2000));
    }

    for (const t of candidates ?? []) {
      if (t.status !== "pending") continue;
      const score = Number(t.final_score ?? 0);
      const tier = String(t.quality_tier ?? "");
      const tracksCount =
        Number(t.tracks_added ?? 0) ||
        (Array.isArray(t.track_seeds) ? t.track_seeds.length : 0);

      // ✅ Aprovação afrouxada: hot≥75 OU medium≥80 (resgata templates bons que ficavam em limbo)
      const passesHot = tier === "hot" && score >= APPROVE_HOT_MIN_SCORE;
      const passesMedium = tier === "medium" && score >= APPROVE_MEDIUM_MIN_SCORE;
      if ((passesHot || passesMedium) && tracksCount >= APPROVE_MIN_TRACKS) {
        const { error } = await sb
          .from("playlist_templates")
          .update({
            status: "approved",
            approved_at: new Date().toISOString(),
          })
          .eq("id", t.id);
        if (!error) templatesApproved++;
      }
    }
    await updateRun(sb, runId, { templates_approved: templatesApproved });
    await pushCompleted(sb, runId, "approve", {
      approved: templatesApproved,
      total: candidates?.length ?? 0,
    });

    // B.4 — alerta quando geramos templates mas nenhum foi aprovado
    // (sintoma de score-templates não rodou a tempo, ou critérios não atingidos)
    if (templatesGenerated > 0 && templatesApproved === 0) {
      const allScored = (candidates ?? []).every((t) => t.scored_at != null);
      const reason = allScored
        ? "Templates pontuados mas nenhum atingiu critério (hot≥75 ou medium≥80, ≥25 tracks)"
        : "score-templates não concluiu em 30s — templates ficaram sem score";
      await sb.rpc("create_notification", {
        p_type: "warning",
        p_title: "Autopilot: 0 templates aprovados",
        p_message: `${templatesGenerated} gerados, 0 aprovados. ${reason}.`,
        p_action_url: "/cerebro",
        p_metadata: { run_id: runId, genre_id: genreId, generated: templatesGenerated, all_scored: allScored },
      }).then(() => {}, (e) => console.error("[genre-autopilot] log/op failed:", e?.message ?? e));
    }

    // ─── 7. REPLICATE-TOP (pacote, não publica) ─────────────────
    await setStep(sb, runId, "replicate");
    const r = await invokeFn("replicate-top", {
      genre_id: genreId,
      top_n: maxTemplates,
      triggered_by: "autopilot",
    });
    if (!r.ok) {
      // Não é fatal — só logamos; pacote pode ser regerado depois
      console.warn(`[autopilot] replicate-top falhou: ${r.error}`);
      await pushCompleted(sb, runId, "replicate", { ok: false, error: r.error });
    } else {
      await pushCompleted(sb, runId, "replicate", { ok: true });
    }

    // ─── DONE ────────────────────────────────────────────────────
    const tierLabel = targetMeta.performance_tier ? ` · perf=${targetMeta.performance_tier}` : "";
    const scoreLabel = targetMeta.final_score != null ? ` (score=${Number(targetMeta.final_score).toFixed(2)})` : "";
    const targetLabel = targetMeta.target_today != null
      ? ` · alvo=${targetMeta.target_today}/dia (gerar=${maxTemplates})`
      : ` · gerar=${maxTemplates}`;
    const summary =
      `${templatesGenerated} templates gerados · ${templatesApproved} aprovados automaticamente · ${coversGenerated} capas criadas` +
      targetLabel + tierLabel + scoreLabel +
      (Object.keys(cacheHits).length ? ` · cache: ${Object.keys(cacheHits).join(", ")}` : "");

    await updateRun(sb, runId, {
      status: "success",
      current_step: "done",
      progress_pct: 100,
      cache_hits: cacheHits,
      summary,
      finished_at: new Date().toISOString(),
      duracao_ms: Date.now() - startedAt,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[autopilot] pipeline error:", msg);

    // 🔄 B.3 — arquiva templates 'pending' órfãos criados nesta run
    if (generatedIds.length > 0) {
      await sb
        .from("playlist_templates")
        .update({
          status: "archived",
          archived_at: new Date().toISOString(),
          archived_reason: `autopilot_failed: ${msg.slice(0, 120)}`,
        })
        .in("id", generatedIds)
        .eq("status", "pending")
        .then(() => {}, (err) => console.warn("[autopilot] cleanup pending failed:", err?.message));
    }

    await updateRun(sb, runId, {
      status: "error",
      error_message: msg,
      finished_at: new Date().toISOString(),
      duracao_ms: Date.now() - startedAt,
      cache_hits: cacheHits,
      templates_generated: templatesGenerated,
      templates_approved: templatesApproved,
      covers_generated: coversGenerated,
    });
  }
}

// ============================================================
// HTTP handler
// ============================================================
Deno.serve(async (req) => {
  const __dep = await deprecationGate(req, "genre-autopilot");
  if (__dep) return __dep;
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jr({ error: "method not allowed" }, 405);

  // 🔐 Exige sessão válida com role admin/curador (evita disparo anônimo de IA cara)
  const guard = await requireTeamAccess(req);
  if (!guard.ok) return guard.resp;

  let body: { genre_id?: string; max_templates?: number; force?: boolean };
  try {
    body = await req.json();
  } catch {
    return jr({ error: "invalid json" }, 400);
  }

  const genreId = body.genre_id;
  if (!genreId || typeof genreId !== "string") {
    return jr({ error: "genre_id obrigatório" }, 400);
  }

  // Override opcional do client (limitado a 1..HARD_CAP). Quando ausente, target é 100% dinâmico.
  const explicitMax = body.max_templates != null
    ? Math.min(Math.max(1, Number(body.max_templates)), HARD_CAP_TEMPLATES)
    : null;

  // Permite ignorar o cooldown via flag explícita do client
  const force = body.force === true;

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 🧹 Limpa runs zumbis antes de checar concorrência (>30min sem update vira 'error')
  await sb.rpc("cleanup_stale_autopilot_runs", { p_minutes: 30 })
    .then(() => {}, (e) => console.warn("[autopilot] cleanup_stale failed:", e?.message));

  // ─ Cooldown ADAPTATIVO: 6h padrão, 1h se houve coleta nova desde a última run ─
  // Pega última run de sucesso pra comparar com data da última coleta
  const { data: lastSuccessRun } = await sb
    .from("autopilot_runs")
    .select("id, started_at")
    .eq("genre_id", genreId)
    .eq("status", "success")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Última coleta de playlist deste gênero
  const lastCollect = await lastCollectionAt(sb, genreId);
  const hadFreshCollection = lastSuccessRun?.started_at && lastCollect
    ? lastCollect.getTime() > new Date(lastSuccessRun.started_at).getTime()
    : !lastSuccessRun; // se nunca rodou com sucesso, considera "fresca"

  const cooldownMs = hadFreshCollection ? COOLDOWN_MS_AFTER_COLLECT : COOLDOWN_MS_DEFAULT;
  const cooldownLabel = hadFreshCollection ? "1h (coleta recente)" : "6h (sem coleta nova)";

  // 🆕 COLD START — gênero zerado bypassa cooldown automaticamente.
  // Checa apenas presença mínima de playlists válidas (head count, barato).
  const { count: coldCheckPlaylists } = await sb
    .from("search_results")
    .select("id", { count: "exact", head: true })
    .eq("genre_id", genreId)
    .eq("is_valid", true);
  const isColdStart = (coldCheckPlaylists ?? 0) === 0;

  // Bloqueia se há run RUNNING (sempre) ou run SUCCESS dentro da janela adaptativa
  const { data: recent } = await sb
    .from("autopilot_runs")
    .select("id, status, started_at")
    .eq("genre_id", genreId)
    .in("status", ["running", "waiting_collection", "success"])
    .order("started_at", { ascending: false })
    .limit(1);

  if (recent && recent.length > 0) {
    const r = recent[0];
    const ageMs = Date.now() - new Date(r.started_at).getTime();
    // Runs em "running" ou "waiting_collection" há mais de 15min são consideradas
    // abandonadas (auto-coleta máx ~12min). Marca como erro e libera nova execução.
    const STALE_MS = 15 * 60 * 1000;
    if ((r.status === "running" || r.status === "waiting_collection") && ageMs > STALE_MS) {
      await sb.from("autopilot_runs").update({
        status: "error",
        error_message: `Run abandonada (${Math.round(ageMs / 60000)}min sem progresso) — liberada automaticamente.`,
        finished_at: new Date().toISOString(),
      }).eq("id", r.id);
    } else {
      if (r.status === "running") {
        return jr({ ok: false, error: "Já existe uma execução em andamento", run_id: r.id }, 409);
      }
      if (r.status === "waiting_collection" && !force) {
        return jr({ ok: false, error: "Coleta automática em andamento — aguarde concluir", run_id: r.id }, 409);
      }
      if (r.status === "success" && !force && !isColdStart) {
        if (ageMs < cooldownMs) {
          const minutesAgo = Math.round(ageMs / 60000);
          const minutesLeft = Math.max(1, Math.round((cooldownMs - ageMs) / 60000));
          return jr(
            {
              ok: false,
              error: `Cooldown ativo (${cooldownLabel}): última run há ${minutesAgo}min. Aguarde ${minutesLeft}min.`,
              run_id: r.id,
              cooldown: true,
              cooldown_type: hadFreshCollection ? "after_collect" : "default",
            },
            429,
          );
        }
      }
    }
  }

  // ─ Valida gênero ─
  const { data: genre } = await sb
    .from("genres")
    .select("id, nome")
    .eq("id", genreId)
    .maybeSingle();
  if (!genre) return jr({ error: "Gênero não encontrado" }, 404);

  // ─ Calcula target dinâmico v2 (média ponderada por followers, mix 3d+7d, contagem hoje em SP) ─
  let targetMeta: Record<string, unknown> = {};
  let dynamicRemaining: number | null = null;
  try {
    const { data: targetRows, error: targetErr } = await sb.rpc("get_genre_daily_target_v2", {
      p_genre_id: genreId,
    });
    if (targetErr) {
      console.warn("[autopilot] get_genre_daily_target_v2 erro:", targetErr.message);
    } else if (Array.isArray(targetRows) && targetRows.length > 0) {
      targetMeta = targetRows[0] as Record<string, unknown>;
      dynamicRemaining = Number(targetMeta.remaining ?? 0);
    }
  } catch (e) {
    console.warn("[autopilot] get_genre_daily_target_v2 exception:", e instanceof Error ? e.message : String(e));
  }

  // Se já atingiu o alvo do dia (e não é override manual), não cria run nem gasta IA
  if (explicitMax == null && dynamicRemaining != null && dynamicRemaining <= 0) {
    return jr({
      ok: false,
      error: `Meta diária já atingida (${targetMeta.generated_today}/${targetMeta.target_today}). Tente novamente após 00h (horário de Brasília).`,
      target: targetMeta,
    }, 200);
  }

  // Decide quanto gerar:
  //   - explicit override → respeita (clampado pelo HARD_CAP)
  //   - senão usa o `remaining` do dia
  //   - fallback se RPC falhou
  let toGenerate: number;
  if (explicitMax != null) {
    toGenerate = explicitMax;
  } else if (dynamicRemaining != null) {
    toGenerate = dynamicRemaining;
  } else {
    toGenerate = FALLBACK_TEMPLATES;
  }
  toGenerate = Math.min(Math.max(1, toGenerate), HARD_CAP_TEMPLATES);

  // ─ Cria run (com lock atômico via unique partial index em status='running') ─
  const { data: run, error: createErr } = await sb
    .from("autopilot_runs")
    .insert({
      genre_id: genreId,
      status: "running",
      current_step: "analyze",
      progress_pct: 0,
      triggered_by: "manual",
    })
    .select("id")
    .single();

  if (createErr || !run) {
    // 23505 = unique_violation → outra run já está 'running' pra esse gênero (corrida)
    const isLock = (createErr as any)?.code === "23505";
    if (isLock) {
      return jr({ ok: false, error: "Já existe uma execução em andamento", lock: true }, 409);
    }
    return jr({ error: `Falha ao criar run: ${createErr?.message ?? "unknown"}` }, 500);
  }

  // ─ Dispara pipeline em background e responde imediatamente ─
  // deno-lint-ignore no-explicit-any
  const ER: any = (globalThis as any).EdgeRuntime;
  if (ER && typeof ER.waitUntil === "function") {
    ER.waitUntil(runPipeline(sb, run.id, genreId, toGenerate, targetMeta));
  } else {
    // Fallback (não deveria ocorrer no Supabase Edge)
    runPipeline(sb, run.id, genreId, toGenerate, targetMeta);
  }

  return jr({ ok: true, run_id: run.id, target: targetMeta, will_generate: toGenerate });
});
