// execution-planner — Compara alocações de campanha com a fila e enfileira ADDs faltantes.
// Idempotente via dedupe_key. Roda via pg_cron (1/min).
//
// Pacing anti-spam (3 camadas) aplicado no scheduled_for de cada job:
//   1. MIN_SPACING_MIN     — intervalo mínimo entre ADDs na mesma playlist
//   2. MAX_ADDS_PER_DAY    — cap diário de ADDs por playlist (dia em horário BR)
//   3. WINDOW [start,end)  — só agenda dentro da janela horária BR (UTC-3)
// + jitter de ±JITTER_MIN minutos pra não cravar horário batido.
import { createClient } from "npm:@supabase/supabase-js@2";
import { reportCronHealth } from "../_shared/cron-health.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// === Config de pacing ===
const RAMP_DAYS = 5;
const MIN_SPACING_MIN = 25;       // intervalo mínimo entre 2 ADDs na MESMA playlist
const MAX_ADDS_PER_DAY = 4;       // cap diário de ADDs por playlist
const WINDOW_START_HOUR_BR = 8;   // 08:00 BR (UTC-3)
const WINDOW_END_HOUR_BR = 22;    // 22:00 BR (exclusivo)
const JITTER_MIN = 7;             // ±7min de variação aleatória
const BR_OFFSET_MS = 3 * 60 * 60 * 1000; // UTC-3

// === Desmame por posição (espelha src/lib/campaignOperationalPlan.ts) ===
// Degraus do rebaixamento na fase de saída: pos → ×1 → ×2 → ×5 → ×15 → ×30 (cap 100).
function tailPositionMultiplier(t: number): number {
  if (t < 0.25) return 1;
  if (t < 0.5) return 2;
  if (t < 0.75) return 5;
  if (t < 1) return 15;
  return 30;
}
function positionForDay(basePos: number, dayNum: number, tailStart: number, tailDays: number): number {
  if (dayNum < tailStart) return basePos;
  const denom = Math.max(1, tailDays - 1);
  const t = (dayNum - tailStart) / denom;
  return Math.min(100, Math.max(1, basePos * tailPositionMultiplier(t)));
}

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Hash determinístico simples pra seed de jitter (mesma chave sempre gera mesmo jitter)
function seededJitterMs(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  const norm = ((h >>> 0) % 1000) / 1000; // 0..1
  return Math.round((norm * 2 - 1) * JITTER_MIN * 60_000);
}

// Retorna "YYYY-MM-DD" no fuso BR pra uma data UTC
function brDayKey(date: Date): string {
  const br = new Date(date.getTime() - BR_OFFSET_MS);
  return br.toISOString().slice(0, 10);
}

// Retorna a hora BR (0–23)
function brHour(date: Date): number {
  return new Date(date.getTime() - BR_OFFSET_MS).getUTCHours();
}

// Empurra a data pra dentro da janela [WINDOW_START, WINDOW_END) BR.
// Se cair antes do início → vai pro WINDOW_START do mesmo dia BR.
// Se cair em/depois do fim → vai pro WINDOW_START do dia BR seguinte.
function clampToWindow(date: Date): Date {
  const h = brHour(date);
  if (h >= WINDOW_START_HOUR_BR && h < WINDOW_END_HOUR_BR) return date;

  const br = new Date(date.getTime() - BR_OFFSET_MS);
  let dayShift = 0;
  if (h >= WINDOW_END_HOUR_BR) dayShift = 1;
  br.setUTCDate(br.getUTCDate() + dayShift);
  br.setUTCHours(WINDOW_START_HOUR_BR, 0, 0, 0);
  return new Date(br.getTime() + BR_OFFSET_MS);
}

// Gap 15 — backoff adaptativo:
// • Após 5 execuções consecutivas sem candidatos, pula as próximas 4 execuções
//   (retorna imediatamente sem trabalho). Na 5ª tenta de novo e reseta se achar.
// • Estado persistido em cron_health.metrics: { empty_streak, cooldown_remaining }.
const EMPTY_STREAK_LIMIT = 5;
const COOLDOWN_SKIPS = 4;

async function readPlannerBackoffState(supabase: any): Promise<{ empty_streak: number; cooldown_remaining: number }> {
  const { data } = await supabase
    .from("cron_health")
    .select("metrics")
    .eq("job_name", "execution-planner")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const m = (data as any)?.metrics ?? {};
  return {
    empty_streak: Number.isFinite(Number(m.empty_streak)) ? Number(m.empty_streak) : 0,
    cooldown_remaining: Number.isFinite(Number(m.cooldown_remaining)) ? Number(m.cooldown_remaining) : 0,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const cronT0 = Date.now();
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  // EXECUTION_FREEZE_MODE: kill-switch global. Não cria novos jobs enquanto frozen.
  {
    const { data: frozenFlag } = await supabase
      .from("system_flags")
      .select("execution_frozen")
      .eq("singleton_key", "app")
      .maybeSingle();
    if (frozenFlag?.execution_frozen) {
      await reportCronHealth(supabase, {
        job_name: "execution-planner",
        status: "ok",
        startedAt: cronT0,
        metrics: { skipped: true, reason: "execution_frozen" },
        message: "skipped: EXECUTION_FROZEN",
      });
      return jr({ ok: true, skipped: true, reason: "execution_frozen" });
    }
  }

  // Backoff adaptativo: se ainda estamos em cooldown, sai imediatamente.
  const backoff = await readPlannerBackoffState(supabase);
  if (backoff.cooldown_remaining > 0) {
    const next = backoff.cooldown_remaining - 1;
    await reportCronHealth(supabase, {
      job_name: "execution-planner",
      status: "ok",
      startedAt: cronT0,
      metrics: { skipped: true, empty_streak: backoff.empty_streak, cooldown_remaining: next },
      message: `cooldown ${next}/${COOLDOWN_SKIPS}`,
    });
    return jr({ ok: true, skipped: true, cooldown_remaining: next });
  }

  // 1. Allocations elegíveis — fonte canônica única: campaign_eco_allocations.
  // A campanha só vira execução depois de plan_approved_at, evitando disparo de rascunho.
  const ecoRes = await supabase
    .from("campaign_eco_allocations")
    .select(`
      id, campaign_id, managed_playlist_id, status, position, start_day, created_at,
      campaigns!inner ( id, status, spotify_track_id, started_at, plan_approved_at, eco_dispatched_at ),
      managed_playlists!inner ( id, spotify_playlist_id, execution_mode, name )
    `)
    .in("status", ["pending", "approved", "active", "dispatched"])
    .in("campaigns.status", ["active", "running", "live"])
    .order("created_at", { ascending: true });

  const aErr = ecoRes.error;
  if (aErr) {
    await reportCronHealth(supabase, {
      job_name: "execution-planner",
      status: "error",
      startedAt: cronT0,
      metrics: { empty_streak: backoff.empty_streak, cooldown_remaining: 0 },
      message: aErr.message,
    });
    return jr({ error: aErr.message }, 500);
  }

  const allocs = ((ecoRes.data ?? []) as any[])
    .map((a) => ({
      source: "eco" as const,
      allocation_id: a.id,
      campaign_id: a.campaign_id,
      playlist_id: null,
      managed_playlist_id: a.managed_playlist_id,
      spotify_playlist_id: a.managed_playlists?.spotify_playlist_id,
      playlist_name: a.managed_playlists?.name ?? null,
      execution_mode: a.managed_playlists?.execution_mode ?? null,
      spotify_track_id: a.campaigns?.spotify_track_id,
      started_at: a.campaigns?.started_at,
      plan_approved_at: a.campaigns?.plan_approved_at,
      eco_dispatched_at: a.campaigns?.eco_dispatched_at,
      position: a.position,
      start_day: Math.max(1, Number(a.start_day ?? 1)),
      created_at: a.created_at,
    }))
    .filter((a) => !!a.plan_approved_at && !!a.eco_dispatched_at);




  // 1b. Ramp-up de aquecimento (motor único, espalha no tempo)
  const now = Date.now();
  const byCampaign = new Map<string, any[]>();
  for (const a of allocs) {
    const arr = byCampaign.get(a.campaign_id) ?? [];
    arr.push(a);
    byCampaign.set(a.campaign_id, arr);
  }

  const candidates: any[] = [];
  const manualCandidates: any[] = [];
  for (const [, list] of byCampaign) {
    const startedAt = (list[0] as any).started_at;
    const startMs = startedAt ? new Date(startedAt).getTime() : now;
    const daysSinceStart = Math.max(0, Math.floor((now - startMs) / 86_400_000));
    // Rampa de aquecimento (legacy / fallback): só limita quando alloc não tem start_day próprio.
    const releasedFrac = Math.min(1, (daysSinceStart + 1) / RAMP_DAYS);
    const total = list.length;
    const releasedCount = Math.max(1, Math.ceil(total * releasedFrac));
    // Ordena por start_day asc pra rampa legacy bater com prioridade.
    const sorted = [...list].sort((a, b) => (a.start_day ?? 1) - (b.start_day ?? 1));
    sorted.forEach((a, idx) => {
      const trackId = (a as any).spotify_track_id;
      const plId = (a as any).spotify_playlist_id;
      if (!trackId || !plId) return;

      // Gating por start_day: respeita o cronograma do mapa.
      // Eco SEMPRE tem start_day; legacy default = 1 (não muda comportamento).
      const startDay = Math.max(1, Number(a.start_day ?? 1));
      const allocSlotMs = startMs + (startDay - 1) * 86_400_000;
      if (now < allocSlotMs) return; // ainda não chegou o dia desta playlist

      // EXECUTION_MODE gating (Família B removida — agora todas allocs são "eco").
      // DISABLED → ignora silenciosamente. MANUAL_ONLY → roteia direto pra fila manual
      // sem criar job automático (evita tentar OAuth que sabemos não existir).
      const mode = (a as any).execution_mode as string | null | undefined;
      if (mode === "DISABLED") return;
      if (mode === "MANUAL_ONLY") {
        manualCandidates.push({
          allocation_id: a.allocation_id,
          campaign_id: a.campaign_id,
          spotify_playlist_id: plId,
          spotify_track_id: trackId,
          playlist_name: (a as any).playlist_name ?? null,
          planned_position: a.position ? Number(a.position) : null,
          dedupe_key: `manual:${a.campaign_id}:${plId}:${trackId}`,
        });
        return;
      }

      candidates.push({
        allocation_source: a.source,
        allocation_id: a.allocation_id,
        campaign_id: a.campaign_id,
        playlist_id: a.playlist_id,
        spotify_playlist_id: plId,
        spotify_track_id: trackId,
        to_position: a.position ? Number(a.position) : null,
        dedupe_key: `add:${plId}:${trackId}`,
        // Floor pro scheduled_for: nunca antes do slot planejado (08h BR daquele dia).
        slot_floor_ms: allocSlotMs,
      });
    });
  }

  // Enfileira MANUAL_ONLY no painel (idempotente por campanha+playlist+track aberto).
  let manualEnqueued = 0;
  if (manualCandidates.length > 0) {
    const uniqManual = Array.from(new Map(manualCandidates.map((m) => [m.dedupe_key, m])).values());
    // Dedupe: inclui MANUAL_DONE pra NÃO recriar item depois que o admin marcou como feito.
    // Sem isso a alloc fica pending pra sempre e o planner recriaria em loop a cada ciclo.
    const { data: openManual } = await supabase
      .from("manual_distribution_queue")
      .select("campaign_id, spotify_playlist_id, spotify_track_id")
      .in("status", ["MANUAL_PENDING", "AUTO_FAILED_FALLBACK_MANUAL", "MANUAL_DONE"])
      .in("campaign_id", uniqManual.map((m) => m.campaign_id));
    const openSet = new Set(
      (openManual ?? []).map((r: any) => `${r.campaign_id}|${r.spotify_playlist_id}|${r.spotify_track_id}`),
    );
    const toInsertManual = uniqManual
      .filter((m) => !openSet.has(`${m.campaign_id}|${m.spotify_playlist_id}|${m.spotify_track_id}`))
      .map((m) => ({
        campaign_id: m.campaign_id,
        spotify_playlist_id: m.spotify_playlist_id,
        spotify_track_id: m.spotify_track_id,
        playlist_name: m.playlist_name,
        job_type: "playlist.track.add",
        position: m.planned_position,
        planned_position: m.planned_position,
        motivo: "owner_without_token",
        status: "MANUAL_PENDING",
      }));
    if (toInsertManual.length > 0) {
      const { count, error: mErr } = await supabase
        .from("manual_distribution_queue")
        .insert(toInsertManual, { count: "exact" });
      if (mErr) {
        console.warn(`[execution-planner] manual enqueue failed: ${mErr.message}`);
      } else {
        manualEnqueued = count ?? toInsertManual.length;
      }
    }
  }



  const uniqueCandidates = Array.from(new Map(candidates.map((c) => [c.dedupe_key, c])).values());
  candidates.splice(0, candidates.length, ...uniqueCandidates);

  // Helper local: avança o streak quando a execução não enfileirou ADDs.
  const nextEmpty = () => {
    const streak = backoff.empty_streak + 1;
    const cooldown = streak >= EMPTY_STREAK_LIMIT ? COOLDOWN_SKIPS : 0;
    return { empty_streak: cooldown > 0 ? 0 : streak, cooldown_remaining: cooldown };
  };

  if (candidates.length === 0) {
    const r = await runEcoReorderPass(supabase, new Date(now));
    const bo = nextEmpty();
    await reportCronHealth(supabase, { job_name: "execution-planner", status: "ok", startedAt: cronT0, metrics: { enqueued: 0, considered: 0, reorder_enqueued: r.enqueued, ...bo }, message: `no candidates (streak ${bo.empty_streak}, cooldown ${bo.cooldown_remaining})` });
    return jr({ ok: true, enqueued: 0, considered: 0, reorder: r, backoff: bo });
  }

  // 2. Filtra os que já têm job aberto/feito
  const dedupeKeys = candidates.map((c) => c.dedupe_key);
  const { data: existing } = await supabase
    .from("playlist_execution_jobs")
    .select("dedupe_key, status")
    .in("dedupe_key", dedupeKeys);

  const skip = new Set(
    (existing ?? [])
      .filter((e: any) => ["pending", "claimed", "failed", "done"].includes(e.status))
      .map((e: any) => e.dedupe_key),
  );

  const fresh = candidates.filter((c) => !skip.has(c.dedupe_key));
  if (fresh.length === 0) {
    const r = await runEcoReorderPass(supabase, new Date(now));
    const bo = nextEmpty();
    await reportCronHealth(supabase, { job_name: "execution-planner", status: "ok", startedAt: cronT0, metrics: { enqueued: 0, considered: candidates.length, dedupe_skipped: candidates.length, reorder_enqueued: r.enqueued, ...bo } });
    return jr({ ok: true, enqueued: 0, considered: candidates.length, reorder: r, backoff: bo });
  }

  // 3. Pacing: pra cada playlist envolvida, busca histórico recente pra
  //    calcular MIN_SPACING e CAP DIÁRIO.
  const playlistIds = Array.from(new Set(fresh.map((c) => c.spotify_playlist_id)));
  const since = new Date(now - 7 * 86_400_000).toISOString();
  const { data: history } = await supabase
    .from("playlist_execution_jobs")
    .select("spotify_playlist_id, scheduled_for, status")
    .in("spotify_playlist_id", playlistIds)
    .in("status", ["pending", "claimed", "done"])
    .gte("scheduled_for", since);

  // Por playlist: ordena scheduled_for asc e mantém contagem por dia BR
  const histByPl = new Map<string, Date[]>();
  for (const h of history ?? []) {
    const arr = histByPl.get((h as any).spotify_playlist_id) ?? [];
    arr.push(new Date((h as any).scheduled_for));
    histByPl.set((h as any).spotify_playlist_id, arr);
  }
  for (const [k, arr] of histByPl) {
    arr.sort((a, b) => a.getTime() - b.getTime());
    histByPl.set(k, arr);
  }

  // 4. Calcula scheduled_for de cada novo job e VAI ACUMULANDO no histByPl
  //    pra que candidatos posteriores na mesma rodada respeitem os anteriores.
  const toInsert: any[] = [];
  // Ordena candidatos por playlist pra distribuir de forma estável
  fresh.sort((a, b) =>
    a.spotify_playlist_id.localeCompare(b.spotify_playlist_id) ||
    a.dedupe_key.localeCompare(b.dedupe_key)
  );

  for (const c of fresh) {
    const hist = histByPl.get(c.spotify_playlist_id) ?? [];

    // Base: max(agora, slot_floor do start_day, último job dessa playlist + MIN_SPACING)
    let base = Math.max(now, Number(c.slot_floor_ms ?? 0));
    if (hist.length > 0) {
      const last = hist[hist.length - 1].getTime();
      base = Math.max(base, last + MIN_SPACING_MIN * 60_000);
    }
    let when = new Date(base);


    // Janela horária BR
    when = clampToWindow(when);

    // Cap diário: se o dia-BR alvo já tem MAX_ADDS_PER_DAY agendados,
    // empurra pro próximo dia 08:00 BR (e reaplica spacing se necessário).
    let safety = 0;
    while (safety++ < 14) {
      const dayKey = brDayKey(when);
      const sameDay = hist.filter((d) => brDayKey(d) === dayKey).length;
      if (sameDay < MAX_ADDS_PER_DAY) break;
      // Próximo dia 08:00 BR
      const br = new Date(when.getTime() - BR_OFFSET_MS);
      br.setUTCDate(br.getUTCDate() + 1);
      br.setUTCHours(WINDOW_START_HOUR_BR, 0, 0, 0);
      when = new Date(br.getTime() + BR_OFFSET_MS);
    }

    // Jitter determinístico (mesma key → mesmo offset; permite reproduzir)
    const jitter = seededJitterMs(c.dedupe_key);
    when = new Date(when.getTime() + jitter);
    // Reaplica clamp caso o jitter tenha cruzado a borda da janela
    when = clampToWindow(when);

    // Registra no histórico local pra próximos candidatos da mesma playlist
    hist.push(when);
    hist.sort((a, b) => a.getTime() - b.getTime());
    histByPl.set(c.spotify_playlist_id, hist);

    toInsert.push({
      job_type: "playlist.track.add",
      allocation_id: c.allocation_id,
      campaign_id: c.campaign_id,
      playlist_id: c.playlist_id,
      spotify_playlist_id: c.spotify_playlist_id,
      spotify_track_id: c.spotify_track_id,
      to_position: c.to_position,
      dedupe_key: c.dedupe_key,
      metadata: {
        allocation_source: c.allocation_source,
        campaign_eco_allocation_id: c.allocation_source === "eco" ? c.allocation_id : null,
      },
      status: "pending",
      scheduled_for: when.toISOString(),
    });
  }

  if (toInsert.length === 0) {
    const r = await runEcoReorderPass(supabase, new Date(now));
    const bo = nextEmpty();
    await reportCronHealth(supabase, { job_name: "execution-planner", status: "ok", startedAt: cronT0, metrics: { enqueued: 0, considered: candidates.length, reorder_enqueued: r.enqueued, ...bo } });
    return jr({ ok: true, enqueued: 0, considered: candidates.length, reorder: r, backoff: bo });
  }

  const { error: insErr, count } = await supabase
    .from("playlist_execution_jobs")
    .insert(toInsert, { count: "exact" });

  if (insErr) {
    await reportCronHealth(supabase, { job_name: "execution-planner", status: "error", startedAt: cronT0, metrics: { empty_streak: backoff.empty_streak, cooldown_remaining: 0 }, message: insErr.message });
    return jr({ error: insErr.message }, 500);
  }

  const enqueued = count ?? toInsert.length;

  // Fix #3: marcar as eco allocations efetivamente enfileiradas como
  // 'dispatched'. Sem isso, replan/auditoria veem alocações como 'pending'
  // mesmo após o ADD ter ido pra fila. Só atualiza quem ainda está 'pending'
  // — não regride 'active'/'dispatched' e ignora as origens legacy.
  const dispatchedEcoIds = candidates
    .filter((c) => c.allocation_source === "eco" && c.allocation_id)
    .map((c) => c.allocation_id as string);
  if (dispatchedEcoIds.length > 0) {
    const { error: updErr, count: updCount } = await supabase
      .from("campaign_eco_allocations")
      .update({ status: "dispatched", dispatched_at: new Date().toISOString() }, { count: "exact" })
      .in("id", dispatchedEcoIds)
      .eq("status", "pending");
    if (updErr) {
      console.warn(`[execution-planner] failed to mark dispatched: ${updErr.message}`);
    } else {
      console.info(`[execution-planner] marked dispatched: ${updCount ?? 0}/${dispatchedEcoIds.length}`);
    }
  }


  // 5. Desmame: enfileira playlist.track.reorder quando hoje é um dia de
  //    transição de posição planejada (eco allocations + simulation_snapshot).
  const reorderResult = await runEcoReorderPass(supabase, new Date(now));

  // Sucesso com ADDs enfileirados — reseta o backoff.
  await reportCronHealth(supabase, {
    job_name: "execution-planner",
    status: "ok",
    startedAt: cronT0,
    metrics: {
      enqueued,
      considered: candidates.length,
      reorder_enqueued: reorderResult.enqueued,
      reorder_considered: reorderResult.considered,
      empty_streak: 0,
      cooldown_remaining: 0,
    },
    message: `enqueued=${enqueued} considered=${candidates.length} reorder=${reorderResult.enqueued}/${reorderResult.considered}`,
  });

  return jr({
    ok: true,
    enqueued,
    considered: candidates.length,
    reorder: reorderResult,
    pacing: {
      min_spacing_min: MIN_SPACING_MIN,
      max_adds_per_day: MAX_ADDS_PER_DAY,
      window_br: `${WINDOW_START_HOUR_BR}:00–${WINDOW_END_HOUR_BR}:00`,
      jitter_min: JITTER_MIN,
    },
  });
});

// ============================================================================
// Passo de desmame: lê campaign_eco_allocations ativas, calcula a posição
// planejada para hoje vs. ontem (via positionForDay) e, se houver transição,
// enfileira um job playlist.track.reorder com from_position/to_position.
// Idempotente via dedupe_key `reorder:{spId}:{trackId}:d{dayNum}` — uma única
// reordenação por dia de transição.
// ============================================================================
async function runEcoReorderPass(
  supabase: ReturnType<typeof createClient>,
  now: Date,
): Promise<{ enqueued: number; considered: number; transitions: number }> {
  const { data: ecos, error } = await supabase
    .from("campaign_eco_allocations")
    .select(`
      id, campaign_id, position, start_day, status,
      managed_playlists!inner ( spotify_playlist_id ),
      campaigns!inner ( status, started_at, spotify_track_id, simulation_snapshot, eco_dispatched_at )
    `)
    .in("status", ["dispatched", "active"])
    .in("campaigns.status", ["active", "running", "live"]);

  if (error) return { enqueued: 0, considered: 0, transitions: 0 };
  if (!ecos || ecos.length === 0) return { enqueued: 0, considered: 0, transitions: 0 };

  const candidates: Array<{
    dedupe_key: string;
    allocation_id: string;
    campaign_id: string;
    spotify_playlist_id: string;
    spotify_track_id: string;
    from_position: number;
    to_position: number;
    dayNum: number;
  }> = [];

  for (const e of ecos as any[]) {
    const basePos = Number(e.position ?? 0);
    if (!Number.isFinite(basePos) || basePos < 1) continue;
    const spId = e.managed_playlists?.spotify_playlist_id as string | null;
    const trackId = e.campaigns?.spotify_track_id as string | null;
    const startedAt = e.campaigns?.started_at as string | null;
    const dispatchedAt = e.campaigns?.eco_dispatched_at as string | null;
    const snap = e.campaigns?.simulation_snapshot as { days?: number; effectiveDays?: number } | null;
    if (!spId || !trackId || !startedAt || !dispatchedAt || !snap) continue;
    const planDays = Math.max(1, Number(snap.effectiveDays ?? snap.days ?? 0));
    if (planDays <= 0) continue;

    const start = new Date(startedAt);
    if (isNaN(start.getTime())) continue;
    const daysSinceStart = Math.floor((now.getTime() - start.getTime()) / 86_400_000) + 1; // 1-indexed
    if (daysSinceStart < 1 || daysSinceStart > planDays) continue;

    const allocStart = Math.max(1, Math.min(planDays, Number(e.start_day || 1)));
    const runLen = Math.max(1, planDays - (allocStart - 1));
    const tailDays = Math.max(1, Math.round(runLen * 0.2));
    const tailStart = planDays - tailDays + 1;
    if (daysSinceStart < tailStart) continue; // ainda no platô — sem rebaixamento

    const posToday = positionForDay(basePos, daysSinceStart, tailStart, tailDays);
    const posYesterday = positionForDay(basePos, daysSinceStart - 1, tailStart, tailDays);
    if (posToday <= posYesterday) continue; // sem transição

    candidates.push({
      dedupe_key: `reorder:${spId}:${trackId}:d${daysSinceStart}`,
      allocation_id: e.id,
      campaign_id: e.campaign_id,
      spotify_playlist_id: spId,
      spotify_track_id: trackId,
      from_position: posYesterday,
      to_position: posToday,
      dayNum: daysSinceStart,
    });
  }

  if (candidates.length === 0) {
    return { enqueued: 0, considered: ecos.length, transitions: 0 };
  }

  // Filtra dedupe — mesmo critério dos ADDs (jobs em qualquer estado bloqueiam).
  const keys = candidates.map((c) => c.dedupe_key);
  const { data: existing } = await supabase
    .from("playlist_execution_jobs")
    .select("dedupe_key, status")
    .in("dedupe_key", keys);
  const skip = new Set(
    (existing ?? [])
      .filter((e: any) => ["pending", "claimed", "failed", "done"].includes(e.status))
      .map((e: any) => e.dedupe_key),
  );
  const fresh = candidates.filter((c) => !skip.has(c.dedupe_key));
  if (fresh.length === 0) {
    return { enqueued: 0, considered: ecos.length, transitions: candidates.length };
  }

  // Agenda dentro da janela horária BR (sem cap diário — reorder é raro).
  const toInsert = fresh.map((c) => {
    const when = clampToWindow(new Date(now.getTime() + seededJitterMs(c.dedupe_key)));
    return {
      job_type: "playlist.track.reorder",
      allocation_id: c.allocation_id,
      campaign_id: c.campaign_id,
      spotify_playlist_id: c.spotify_playlist_id,
      spotify_track_id: c.spotify_track_id,
      from_position: c.from_position,
      to_position: c.to_position,
      dedupe_key: c.dedupe_key,
      status: "pending",
      scheduled_for: when.toISOString(),
      metadata: { reason: "desmame", day_num: c.dayNum },
    };
  });

  const { error: insErr, count } = await supabase
    .from("playlist_execution_jobs")
    .insert(toInsert, { count: "exact" });

  if (insErr) return { enqueued: 0, considered: ecos.length, transitions: candidates.length };
  return { enqueued: count ?? toInsert.length, considered: ecos.length, transitions: candidates.length };
}
