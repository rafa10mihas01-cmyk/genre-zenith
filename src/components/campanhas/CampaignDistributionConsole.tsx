// CampaignDistributionConsole — console de operação da distribuição da campanha.
// 5 blocos: KPI strip · Dispatch · Lista de playlists com status · Ações em massa · Saúde do bot.
// Sem mudar lógica: lê de playlist_execution_jobs + bot_heartbeats em realtime.

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Rocket, CheckCircle2, Clock, XCircle, Loader2, RefreshCw, ArrowDownUp,
  Bot, ShieldCheck, AlertCircle, ExternalLink, Activity, ArrowDown, Hand, Ban, ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/campaignEngine";
import { timeAgo } from "@/lib/format";
import { toast } from "sonner";
import type { EcoAllocation } from "@/components/campaign-hub/types";
import { buildEcoPlaylistPlan } from "@/lib/campaignOperationalPlan";
import type { CampaignSnapshot } from "@/lib/campaignSnapshot";
import { PlaylistModeBadge, type PlaylistExecutionMode } from "./PlaylistModeBadge";

type JobRow = {
  id: string;
  job_type: string;
  status: string;
  spotify_playlist_id: string;
  attempts: number;
  max_attempts: number;
  scheduled_for: string | null;
  completed_at: string | null;
  last_error: string | null;
  from_position: number | null;
  to_position: number | null;
  last_validated_at: string | null;
  last_validation_status: string | null;
  last_validation_position: number | null;
};

type BotHealth = {
  last_heartbeat: string | null;
  status: string | null;
  spotify_valid: boolean;
};

type ManualQueueRow = {
  id: string;
  status: string;
  spotify_playlist_id: string | null;
  planned_position: number | null;
  executed_position: number | null;
  created_at: string;
  completed_at: string | null;
};

type Props = {
  campaignId: string;
  spotifyTrackId: string | null;
  allocations: EcoAllocation[];
  ecoPositionByAllocation: Map<string, number>;
  ecoDispatchedAt: string | null;
  baselineReady: boolean;
  baselineCollected: number;
  baselineRequired: number;
  baselineCapturedAt: string | null;
  /** Base pra calcular a data prevista de cada playlist (start_day → data). */
  campaignStartedAt: string | null;
  /** Snapshot da campanha — usado pra calcular o primeiro dia REAL com volume por playlist (espelha o mapa). */
  snapshot: CampaignSnapshot;
  /** Multiplicador plays/save/mês da campanha (default 30). */
  engagementMultiplier?: number;
  custoTotal: number;
  dispatching: boolean;
  onDispatch: () => void | Promise<void>;
};


const fmtTime = (iso: string | null) => {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
};

const fmtDateTime = (iso: string | null) => {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
};

const fmtShortDate = (iso: string | null) => {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
};

// Janela do bot — espelha execution-planner (08h–22h BR).
const BOT_WINDOW_START_BR = 8;
const BOT_WINDOW_END_BR = 22;

/**
 * Data prevista = base (started_at OU eco_dispatched_at) + (startDay - 1) dias,
 * ancorada no início da janela do bot (08h BR) pra o "previsto" bater com a
 * realidade de quando o robô vai abrir aquele slot.
 */
function plannedDateFor(startDay: number | null | undefined, baseIso: string | null): string | null {
  if (!baseIso || !startDay || startDay < 1) return null;
  const base = new Date(baseIso);
  if (isNaN(base.getTime())) return null;
  // Soma (startDay - 1) dias preservando o instante; depois força 08h BR (11h UTC).
  base.setUTCDate(base.getUTCDate() + (startDay - 1));
  base.setUTCHours(BOT_WINDOW_START_BR + 3, 0, 0, 0); // BR = UTC-3
  return base.toISOString();
}

function spotifyPlaylistIdFromAllocation(a: EcoAllocation): string | null {
  const direct = a.managed_playlists?.spotify_playlist_id ?? null;
  if (direct) return direct;
  const url = a.managed_playlists?.spotify_url ?? "";
  const m = typeof url === "string" ? url.match(/playlist\/([A-Za-z0-9]+)/) : null;
  return m?.[1] ?? null;
}



export function CampaignDistributionConsole({
  campaignId,
  spotifyTrackId,
  allocations,
  ecoPositionByAllocation,
  ecoDispatchedAt,
  baselineReady,
  baselineCollected,
  baselineRequired,
  baselineCapturedAt,
  campaignStartedAt,
  snapshot,
  engagementMultiplier,
  custoTotal,
  dispatching,
  onDispatch,
}: Props) {


  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [manualItems, setManualItems] = useState<ManualQueueRow[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(true);
  const [loadingManual, setLoadingManual] = useState(true);
  const [bot, setBot] = useState<BotHealth | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [forcing, setForcing] = useState(false);

  // --- carrega jobs ---
  const loadJobs = async () => {
    const { data } = await supabase
      .from("playlist_execution_jobs")
      .select("id, job_type, status, spotify_playlist_id, attempts, max_attempts, scheduled_for, completed_at, last_error, from_position, to_position, last_validated_at, last_validation_status, last_validation_position")
      .eq("campaign_id", campaignId)
      .in("job_type", ["playlist.track.add", "playlist.track.reorder"])
      .order("created_at", { ascending: false })
      .limit(500);
    setJobs((data ?? []) as JobRow[]);
    setLoadingJobs(false);
  };

  const loadManualItems = async () => {
    const { data } = await supabase
      .from("manual_distribution_queue")
      .select("id, status, spotify_playlist_id, planned_position, executed_position, created_at, completed_at")
      .eq("campaign_id", campaignId)
      .in("status", ["MANUAL_PENDING", "AUTO_FAILED_FALLBACK_MANUAL", "MANUAL_DONE"])
      .order("created_at", { ascending: false })
      .limit(500);
    setManualItems((data ?? []) as ManualQueueRow[]);
    setLoadingManual(false);
  };

  useEffect(() => {
    setLoadingJobs(true);
    setLoadingManual(true);
    loadJobs();
    loadManualItems();
    const channelKey = Math.random().toString(36).slice(2);
    const jobsChannel = supabase
      .channel(`distrib-jobs-${campaignId}-${channelKey}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "playlist_execution_jobs", filter: `campaign_id=eq.${campaignId}` },
        () => loadJobs(),
      )
      .subscribe();
    const manualChannel = supabase
      .channel(`distrib-manual-${campaignId}-${channelKey}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "manual_distribution_queue", filter: `campaign_id=eq.${campaignId}` },
        () => loadManualItems(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(jobsChannel);
      supabase.removeChannel(manualChannel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId]);

  // --- carrega heartbeat do bot ---
  const loadBot = async () => {
    const { data } = await supabase
      .from("bot_heartbeats")
      .select("created_at, status, spotify_session_valid")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    setBot({
      last_heartbeat: data?.created_at ?? null,
      status: data?.status ?? null,
      spotify_valid: data?.spotify_session_valid ?? false,
    });
  };

  useEffect(() => {
    loadBot();
    const t = setInterval(loadBot, 60_000);
    return () => clearInterval(t);
  }, []);

  // --- KPIs agregados ---
  const kpis = useMemo(() => {
    const now = Date.now();
    let added = 0, pending = 0, failed = 0, scheduled = 0;
    const latestManualBySpid = new Map<string, ManualQueueRow>();
    for (const it of manualItems) {
      if (it.spotify_playlist_id && !latestManualBySpid.has(it.spotify_playlist_id)) {
        latestManualBySpid.set(it.spotify_playlist_id, it);
      }
    }
    const manualSpids = new Set<string>();
    for (const [spid, it] of latestManualBySpid) {
      manualSpids.add(spid);
      if (it.status === "MANUAL_DONE") {
        added++;
      } else {
        pending++;
      }
    }
    for (const j of jobs) {
      if (j.job_type !== "playlist.track.add") continue;
      if (manualSpids.has(j.spotify_playlist_id)) continue;
      if (j.status === "done") added++;
      else if (j.status === "failed") failed++;
      else if (j.status === "pending" || j.status === "claimed") {
        const sched = j.scheduled_for ? new Date(j.scheduled_for).getTime() : 0;
        if (sched > now) scheduled++;
        else pending++;
      }
    }
    return { added, pending, failed, scheduled };
  }, [jobs, manualItems]);

  // --- estado por spotify_playlist_id (último job ADD por playlist) ---
  type PlaylistState = {
    status: "done" | "manual_done" | "manual_pending" | "pending" | "scheduled" | "failed" | "idle";
    scheduledFor: string | null;
    lastError: string | null;
    jobId: string | null;
    completedAt: string | null;
    executedPosition: number | null;
    validationStatus: string | null;
    validationPosition: number | null;
    validatedAt: string | null;
  };
  const stateBySpid = useMemo(() => {
    const m = new Map<string, PlaylistState>();
    const now = Date.now();
    // ordena por created_at desc já vem do load — pegamos o primeiro add por playlist
    for (const j of jobs) {
      if (j.job_type !== "playlist.track.add") continue;
      if (m.has(j.spotify_playlist_id)) continue;
      let status: PlaylistState["status"] = "pending";
      if (j.status === "done") status = "done";
      else if (j.status === "failed") status = "failed";
      else if (j.status === "pending" || j.status === "claimed") {
        const sched = j.scheduled_for ? new Date(j.scheduled_for).getTime() : 0;
        status = sched > now ? "scheduled" : "pending";
      }
      m.set(j.spotify_playlist_id, {
        status,
        scheduledFor: j.scheduled_for,
        lastError: j.last_error,
        jobId: j.id,
        completedAt: j.completed_at,
        executedPosition: null,
        validationStatus: j.last_validation_status,
        validationPosition: j.last_validation_position,
        validatedAt: j.last_validated_at,
      });
    }
    return m;
  }, [jobs]);

  const manualStateBySpid = useMemo(() => {
    const m = new Map<string, PlaylistState>();
    for (const it of manualItems) {
      if (!it.spotify_playlist_id || m.has(it.spotify_playlist_id)) continue;
      const done = it.status === "MANUAL_DONE";
      m.set(it.spotify_playlist_id, {
        status: done ? "manual_done" : "manual_pending",
        scheduledFor: null,
        lastError: null,
        jobId: null,
        completedAt: it.completed_at ?? it.created_at,
        executedPosition: it.executed_position ?? it.planned_position ?? null,
        validationStatus: null,
        validationPosition: null,
        validatedAt: null,
      });
    }
    return m;
  }, [manualItems]);

  // --- Plano operacional (espelha o mapa) — usado pra saber o PRIMEIRO DIA REAL
  // com volume de cada playlist (alguns slots só entram no D7, D8, etc).
  const realStartByAllocation = useMemo(() => {
    const m = new Map<string, number>();
    try {
      const plans = buildEcoPlaylistPlan(snapshot, allocations as any, {
        engagementMultiplier: engagementMultiplier ?? 35,
        startedAt: campaignStartedAt ?? undefined,
        positions: ecoPositionByAllocation,
      });
      for (const p of plans) {
        // Primeiro dia (1-indexed) com volume > 0; cai pro startDay teórico se nada acumulou.
        const firstWithVolume = (p.daily ?? []).findIndex((v) => v > 0);
        const day = firstWithVolume >= 0 ? firstWithVolume + 1 : p.startDay;
        m.set(p.allocationId, day);
      }
    } catch {
      /* fallback silencioso — usa start_day cru */
    }
    return m;
  }, [snapshot, allocations, engagementMultiplier, campaignStartedAt, ecoPositionByAllocation]);

  // --- linhas de playlist a renderizar (a partir das allocations) ---
  // Base pra "data prevista": prioriza eco_dispatched_at (real). Cai pra
  // started_at quando o eco ainda não foi disparado (planejamento).
  const planBaseIso = ecoDispatchedAt ?? campaignStartedAt;
  const rows = useMemo(() => {
    return allocations
      .map((a) => {
        const url = a.managed_playlists?.spotify_url ?? "";
        const spid = spotifyPlaylistIdFromAllocation(a);
        const idleState: PlaylistState = { status: "idle", scheduledFor: null, lastError: null, jobId: null, completedAt: null, executedPosition: null, validationStatus: null, validationPosition: null, validatedAt: null };
        const state: PlaylistState = spid ? (manualStateBySpid.get(spid) ?? stateBySpid.get(spid) ?? idleState) : idleState;
        const realStart = realStartByAllocation.get(a.id) ?? a.start_day ?? 1;
        const executionMode: PlaylistExecutionMode = (a.managed_playlists?.execution_mode ?? "API_READY") as PlaylistExecutionMode;
        return {
          allocId: a.id,
          spid,
          name: a.managed_playlists?.name ?? "(sem nome)",
          cover: a.managed_playlists?.cover_url ?? null,
          spotifyUrl: url || null,
          plannedPosition: ecoPositionByAllocation.get(a.id) ?? null,
          plannedFor: plannedDateFor(realStart, planBaseIso),
          executionMode,
          state,
        };
      })

      .sort((a, b) => {
        // Ordena pela data prevista de postagem (mais cedo primeiro).
        const ta = a.plannedFor ? new Date(a.plannedFor).getTime() : Number.POSITIVE_INFINITY;
        const tb = b.plannedFor ? new Date(b.plannedFor).getTime() : Number.POSITIVE_INFINITY;
        if (ta !== tb) return ta - tb;
        // Empate de data: posição planejada (menor = mais alta) primeiro.
        const pa = a.plannedPosition ?? 999;
        const pb = b.plannedPosition ?? 999;
        if (pa !== pb) return pa - pb;
        return a.name.localeCompare(b.name);
      });
  }, [allocations, ecoPositionByAllocation, stateBySpid, manualStateBySpid, planBaseIso, realStartByAllocation]);

  // Particionamento por modo de execução — espelha o que o planner decidiu.
  const rowsByMode = useMemo(() => {
    const auto: typeof rows = [];
    const manual: typeof rows = [];
    const disabled: typeof rows = [];
    for (const r of rows) {
      if (r.executionMode === "MANUAL_ONLY") manual.push(r);
      else if (r.executionMode === "DISABLED") disabled.push(r);
      else auto.push(r);
    }
    return { auto, manual, disabled };
  }, [rows]);

  const modeCounts = {
    auto: rowsByMode.auto.length,
    manual: rowsByMode.manual.length,
    disabled: rowsByMode.disabled.length,
  };

  // --- ações ---
  const handleRetryOne = async (jobId: string) => {
    const { error } = await supabase
      .from("playlist_execution_jobs")
      .update({ status: "pending", attempts: 0, last_error: null, scheduled_for: new Date().toISOString(), claimed_at: null, claimed_by: null, lease_expires_at: null })
      .eq("id", jobId);
    if (error) toast.error("Falha ao reenfileirar", { description: error.message });
    else toast.success("Job reenfileirado");
  };

  const handleRetryAllFailed = async () => {
    setRetrying(true);
    try {
      const { error, count } = await supabase
        .from("playlist_execution_jobs")
        .update({ status: "pending", attempts: 0, last_error: null, scheduled_for: new Date().toISOString(), claimed_at: null, claimed_by: null, lease_expires_at: null }, { count: "exact" })
        .eq("campaign_id", campaignId)
        .eq("status", "failed");
      if (error) throw error;
      toast.success(`${count ?? 0} job(s) reenfileirado(s)`);
    } catch (e: any) {
      toast.error("Falha ao reenfileirar", { description: e?.message });
    } finally {
      setRetrying(false);
    }
  };

  const handleForcePositions = async () => {
    if (!spotifyTrackId) {
      toast.error("Track sem spotify_track_id");
      return;
    }
    setForcing(true);
    try {
      // Para cada playlist onde o ADD já foi feito e há posição planejada, enfileira um reorder novo.
      const stamp = Date.now();
      const reorders = rows
        .filter((r) => r.spid && r.state.status === "done" && r.plannedPosition && r.plannedPosition > 0)
        .map((r) => ({
          job_type: "playlist.track.reorder",
          campaign_id: campaignId,
          spotify_playlist_id: r.spid!,
          spotify_track_id: spotifyTrackId,
          allocation_id: r.allocId,
          to_position: r.plannedPosition!,
          status: "pending",
          scheduled_for: new Date().toISOString(),
          dedupe_key: `force-reorder:${campaignId}:${r.spid}:${stamp}`,
          metadata: { source: "manual_force_reorder", forced_at: new Date().toISOString() },
        }));
      if (reorders.length === 0) {
        toast.info("Nenhuma playlist elegível", { description: "Só forço posição em playlists onde o ADD já foi concluído." });
        return;
      }
      const { error } = await supabase.from("playlist_execution_jobs").insert(reorders);
      if (error) throw error;
      toast.success(`${reorders.length} reorder(s) enfileirado(s)`);
    } catch (e: any) {
      toast.error("Falha ao forçar posições", { description: e?.message });
    } finally {
      setForcing(false);
    }
  };

  const failedJobsCount = jobs.filter((j) => j.status === "failed").length;
  const doneAddsCount = jobs.filter((j) => j.job_type === "playlist.track.add" && j.status === "done").length;
  const playlistsCount = allocations.length;

  // --- Rebaixamentos (cronograma de desmame por playlist) ---
  // Fonte de verdade = positionByDay do plano operacional (mesmo mapa).
  // Mostra TODAS as transições de posição (dia em que cai), e enriquece com o
  // status do job real (playlist_execution_jobs) quando já existir um.
  type TransitionStatus = "done" | "scheduled" | "pending" | "failed" | "planned";
  type Transition = {
    day: number;
    dateIso: string | null;
    from: number;
    to: number;
    jobStatus: TransitionStatus;
    jobCompletedAt: string | null;
    jobScheduledFor: string | null;
  };
  const demotionPlan = useMemo(() => {
    let plans: ReturnType<typeof buildEcoPlaylistPlan> = [];
    try {
      plans = buildEcoPlaylistPlan(snapshot, allocations as any, {
        engagementMultiplier: engagementMultiplier ?? 35,
        startedAt: campaignStartedAt ?? undefined,
        positions: ecoPositionByAllocation,
      });
    } catch {
      return [] as Array<{ allocId: string; spid: string | null; name: string; transitions: Transition[] }>;
    }

    const spidByAlloc = new Map<string, string | null>();
    for (const a of allocations) {
      spidByAlloc.set(a.id, spotifyPlaylistIdFromAllocation(a));
    }

    const reorderJobs = jobs.filter((j) => j.job_type === "playlist.track.reorder");
    const now = Date.now();

    return plans
      .map((p) => {
        const spid = spidByAlloc.get(p.allocationId) ?? null;
        const pos = p.positionByDay ?? [];
        const transitions: Transition[] = [];
        for (let i = 1; i < pos.length; i++) {
          const prev = pos[i - 1];
          const cur = pos[i];
          if (cur > prev) {
            const day = i + 1; // 1-indexed
            transitions.push({
              day,
              dateIso: plannedDateFor(day, planBaseIso),
              from: prev,
              to: cur,
              jobStatus: "planned",
              jobCompletedAt: null,
              jobScheduledFor: null,
            });
          }
        }
        if (spid && transitions.length > 0) {
          const matching = reorderJobs.filter((j) => j.spotify_playlist_id === spid);
          for (const t of transitions) {
            const job = matching.find((j) => j.to_position === t.to);
            if (!job) continue;
            t.jobCompletedAt = job.completed_at;
            t.jobScheduledFor = job.scheduled_for;
            if (job.status === "done") t.jobStatus = "done";
            else if (job.status === "failed") t.jobStatus = "failed";
            else {
              const sched = job.scheduled_for ? new Date(job.scheduled_for).getTime() : 0;
              t.jobStatus = sched > now ? "scheduled" : "pending";
            }
          }
        }
        return {
          allocId: p.allocationId,
          spid,
          name: p.playlistName,
          transitions,
        };
      })
      .filter((p) => p.transitions.length > 0)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [snapshot, allocations, engagementMultiplier, campaignStartedAt, ecoPositionByAllocation, planBaseIso, jobs]);

  const totalDemotions = useMemo(
    () => demotionPlan.reduce((acc, p) => acc + p.transitions.length, 0),
    [demotionPlan],
  );

  // --- bot health ---
  const hbAge = bot?.last_heartbeat ? Date.now() - new Date(bot.last_heartbeat).getTime() : Infinity;
  const botOk = hbAge < 5 * 60 * 1000;

  return (
    <div className="space-y-4">
      {/* BLOCO 1 — KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiTile
          icon={CheckCircle2}
          label="Adicionadas"
          value={kpis.added}
          total={playlistsCount}
          tone="success"
        />
        <KpiTile
          icon={Clock}
          label="Pendentes"
          value={kpis.pending}
          tone="warn"
          hint="aguardando bot"
        />
        <KpiTile
          icon={Activity}
          label="Agendadas"
          value={kpis.scheduled}
          tone="neutral"
          hint="no futuro"
        />
        <KpiTile
          icon={XCircle}
          label="Falharam"
          value={kpis.failed}
          tone={kpis.failed > 0 ? "danger" : "neutral"}
        />
      </div>

      {/* Classificação por modo de execução — operador identifica em <3s o que é bot vs manual */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-3 justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <ModeCountChip
                icon={Bot}
                label="Automáticas"
                value={modeCounts.auto}
                tone="primary"
                tooltip="Playlists com acesso OAuth — bot insere/reordena sozinho."
              />
              <ModeCountChip
                icon={Hand}
                label="Manuais"
                value={modeCounts.manual}
                tone="amber"
                tooltip="Playlists sem acesso OAuth — operador insere a faixa manualmente."
              />
              <ModeCountChip
                icon={Ban}
                label="Desabilitadas"
                value={modeCounts.disabled}
                tone="muted"
                tooltip="Owner removido, token inválido ou desativada manualmente. Não entram na distribuição."
              />
            </div>
            {(modeCounts.auto > 0 || modeCounts.manual > 0) && (
              <div className="text-[11px] text-muted-foreground leading-relaxed max-w-md">
                Ao distribuir:{" "}
                {modeCounts.auto > 0 && (
                  <>
                    <span className="text-foreground font-medium">{modeCounts.auto}</span> playlist(s) vão pro bot
                  </>
                )}
                {modeCounts.auto > 0 && modeCounts.manual > 0 && " · "}
                {modeCounts.manual > 0 && (
                  <>
                    <span className="text-amber-400 font-medium">{modeCounts.manual}</span> entram na fila manual
                  </>
                )}
                .
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {!ecoDispatchedAt && (
        <Card className="border-2 border-primary/40 bg-gradient-to-br from-primary/[0.08] via-primary/[0.03] to-transparent overflow-hidden relative">
          <div className="absolute inset-0 pointer-events-none opacity-[0.04]" style={{
            backgroundImage: "radial-gradient(circle at 20% 20%, hsl(var(--primary)) 0%, transparent 50%)",
          }} />
          <CardContent className="p-5 flex flex-wrap items-center justify-between gap-4 relative">
            <div className="flex items-center gap-4 min-w-0">
              <div className="h-12 w-12 rounded-xl bg-primary/15 border border-primary/30 flex items-center justify-center shrink-0">
                <Rocket className="h-5 w-5 text-primary" />
              </div>
              <div className="min-w-0">
                <div className="text-base font-semibold leading-tight">
                  {baselineReady ? "Pronto pra distribuir" : "Aguardando baseline"}
                </div>
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                  {baselineReady ? (
                    <>Baseline capturada{baselineCapturedAt ? <> em <span className="text-foreground font-medium">{fmtDateTime(baselineCapturedAt)}</span></> : null} · enfileira <span className="text-foreground font-medium">{playlistsCount} ADD(s)</span> · custo interno <span className="text-foreground font-medium">{formatBRL(custoTotal)}</span></>
                  ) : (
                    <>Coletadas <span className="text-foreground font-medium">{baselineCollected}/{baselineRequired || playlistsCount}</span> playlist(s). A campanha só inicia depois do marco zero.</>
                  )}
                </p>
              </div>
            </div>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="lg" variant="solid" disabled={dispatching} className="shadow-lg shadow-primary/20">
                  {dispatching ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Rocket className="h-4 w-4 mr-2" />}
                  Distribuir agora
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent className="bg-card border-border max-w-xl">
                <AlertDialogHeader>
                  <AlertDialogTitle>Distribuir campanha?</AlertDialogTitle>
                  <AlertDialogDescription asChild>
                    <div className="space-y-4 text-sm">
                      <p className="text-muted-foreground leading-relaxed">
                        {baselineReady
                          ? "A baseline já foi capturada e será usada como ponto zero."
                          : "A baseline ainda não fechou; a distribuição será liberada agora e o bot seguirá capturando o marco zero em paralelo."} Cada playlist entra no dia previsto, dentro da janela <span className="text-foreground font-medium">08h–22h</span>. Os rebaixamentos rodam automaticamente.
                      </p>

                      <div className="rounded-lg border border-border bg-background/40 divide-y divide-border">
                        <div className="px-3 py-2 text-[10px] uppercase tracking-wider text-muted-foreground font-bold">Resumo</div>
                        <div className="px-3 py-2 flex items-center justify-between"><span className="text-muted-foreground">Baseline</span><span className="font-semibold text-foreground">{baselineCollected}/{baselineRequired || playlistsCount}</span></div>
                        <div className="px-3 py-2 flex items-center justify-between"><span className="text-muted-foreground">Playlists</span><span className="font-semibold text-foreground">{playlistsCount}</span></div>
                        <div className="px-3 py-2 flex items-center justify-between"><span className="text-muted-foreground">Adições agora</span><span className="font-semibold text-foreground">{playlistsCount}</span></div>
                        <div className="px-3 py-2 flex items-center justify-between"><span className="text-muted-foreground">Rebaixamentos programados</span><span className="font-semibold text-foreground">{totalDemotions}</span></div>
                        <div className="px-3 py-2 flex items-center justify-between"><span className="text-muted-foreground">Custo interno</span><span className="font-semibold text-foreground">{formatBRL(custoTotal)}</span></div>
                      </div>

                      <div className="rounded-lg border border-border bg-background/40 max-h-72 overflow-auto scrollbar-none">
                        <div className="px-3 py-2 text-[10px] uppercase tracking-wider text-muted-foreground font-bold border-b border-border sticky top-0 bg-card">
                          Cronograma por playlist
                        </div>
                        <div className="divide-y divide-border">
                          {rows.map((r) => {
                            const dem = demotionPlan.find((d) => d.allocId === r.allocId);
                            return (
                              <div key={r.allocId} className="px-3 py-2.5 space-y-1.5">
                                <div className="text-foreground text-[13px] font-medium truncate">{r.name}</div>
                                <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                                  <span className="inline-flex items-center justify-center h-4 px-1.5 rounded bg-primary/15 text-primary text-[9px] font-bold uppercase tracking-wider shrink-0">ADD</span>
                                  <span>
                                    pos. <span className="text-foreground font-medium">{r.plannedPosition ?? "—"}</span>
                                    {r.plannedFor && <> · entra em <span className="text-foreground font-medium">{fmtShortDate(r.plannedFor)}</span></>}
                                  </span>
                                </div>
                                {dem?.transitions.map((t, i) => (
                                  <div key={i} className="flex items-center gap-2 text-[11px] text-muted-foreground">
                                    <span className="inline-flex items-center justify-center h-4 px-1.5 rounded bg-amber-500/15 text-amber-400 text-[9px] font-bold uppercase tracking-wider shrink-0">↓</span>
                                    <span>
                                      {t.dateIso && <><span className="text-foreground font-medium">{fmtShortDate(t.dateIso)}</span> · </>}
                                      pos. <span className="text-foreground font-medium">{t.from}</span> → <span className="text-foreground font-medium">{t.to}</span>
                                    </span>
                                  </div>
                                ))}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction onClick={() => onDispatch()}>Confirmar e distribuir</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>


            </AlertDialog>
          </CardContent>
        </Card>
      )}


      {/* BLOCO 4 — Ações em massa */}
      {ecoDispatchedAt && (
        <Card>
          <CardContent className="p-3 flex flex-wrap items-center gap-2">
            <div className="text-xs text-muted-foreground mr-auto pl-1">Ações em massa</div>
            <Button
              size="sm"
              variant="outline"
              onClick={handleForcePositions}
              disabled={forcing || doneAddsCount === 0}
              title="Enfileira REORDER pra posição planejada em todas as playlists onde o ADD já foi feito"
            >
              {forcing ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <ArrowDownUp className="h-3.5 w-3.5 mr-1.5" />}
              Forçar posições agora
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleRetryAllFailed}
              disabled={retrying || failedJobsCount === 0}
            >
              {retrying ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-1.5" />}
              Retentar falhas ({failedJobsCount})
            </Button>
          </CardContent>
        </Card>
      )}

      {/* BLOCO 3 — Lista de playlists com status, particionada por modo de execução */}
      {loadingJobs || loadingManual ? (
        <Card>
          <CardContent className="p-4 space-y-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </CardContent>
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            Nenhuma playlist no ecossistema desta campanha.
          </CardContent>
        </Card>
      ) : (
        <>
          {/* SEÇÃO — Execução Automática (API_READY) */}
          {rowsByMode.auto.length > 0 && (
            <Card>
              <CardContent className="p-0">
                <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Bot className="h-4 w-4 text-primary" />
                    <div>
                      <div className="text-sm font-semibold">Execução automática</div>
                      <div className="text-[11px] text-muted-foreground">
                        {rowsByMode.auto.length} playlist(s) · bot insere/reordena dentro da janela 08h–22h
                      </div>
                    </div>
                  </div>
                  <PlaylistModeBadge mode="API_READY" size="sm" />
                </div>
                <div className="max-h-[640px] overflow-y-auto divide-y divide-border">
                  {rowsByMode.auto.map((r) => (
                    <PlaylistRow
                      key={r.allocId}
                      row={r}
                      onRetry={r.state.jobId ? () => handleRetryOne(r.state.jobId!) : undefined}
                    />
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* SEÇÃO — Execução Manual (MANUAL_ONLY) — sempre visível quando existir */}
          {rowsByMode.manual.length > 0 && (
            <Card className="border-amber-500/30">
              <CardContent className="p-0">
                <div className="px-4 py-3 border-b border-amber-500/20 bg-amber-500/[0.03] flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Hand className="h-4 w-4 text-amber-400" />
                    <div>
                      <div className="text-sm font-semibold">Execução manual</div>
                      <div className="text-[11px] text-muted-foreground">
                        {rowsByMode.manual.length} playlist(s) sem OAuth · você precisa inserir a faixa manualmente
                      </div>
                    </div>
                  </div>
                  <PlaylistModeBadge mode="MANUAL_ONLY" size="sm" />
                </div>
                <div className="divide-y divide-border">
                  {rowsByMode.manual.map((r) => (
                    <PlaylistRow
                      key={r.allocId}
                      row={r}
                      onRetry={r.state.jobId ? () => handleRetryOne(r.state.jobId!) : undefined}
                    />
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* SEÇÃO — Desabilitadas (DISABLED) — colapsável, mas contador sempre visível */}
          {rowsByMode.disabled.length > 0 && (
            <Card>
              <CardContent className="p-0">
                <details className="group">
                  <summary className="px-4 py-3 border-b border-transparent group-open:border-border flex items-center justify-between gap-3 cursor-pointer hover:bg-muted/20 list-none">
                    <div className="flex items-center gap-2">
                      <Ban className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <div className="text-sm font-semibold">Desabilitadas</div>
                        <div className="text-[11px] text-muted-foreground">
                          {rowsByMode.disabled.length} playlist(s) · não entram na distribuição (owner removido, token inválido ou desativadas)
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <PlaylistModeBadge mode="DISABLED" size="sm" />
                      <ChevronRight className="h-4 w-4 text-muted-foreground group-open:rotate-90 transition-transform" />
                    </div>
                  </summary>
                  <div className="divide-y divide-border">
                    {rowsByMode.disabled.map((r) => (
                      <PlaylistRow key={r.allocId} row={r} />
                    ))}
                  </div>
                </details>
              </CardContent>
            </Card>
          )}
        </>
      )}



      {/* BLOCO 4b — Rebaixamentos (mesma estrutura do "Status por playlist") */}
      <Card>
        <CardContent className="p-0">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold flex items-center gap-2">
                <ArrowDown className="h-3.5 w-3.5 text-muted-foreground" />
                Rebaixamentos
              </div>
              <div className="text-[11px] text-muted-foreground">
                {totalDemotions === 0
                  ? "Nenhum rebaixamento planejado — posição estável do início ao fim."
                  : `${totalDemotions} degrau(s) em ${demotionPlan.length} playlist(s) · executados automaticamente pelo bot`}
              </div>
            </div>
          </div>
          {demotionPlan.length > 0 && (() => {
            const coverByAlloc = new Map(allocations.map((a) => [a.id, a.managed_playlists?.cover_url ?? null] as const));
            const urlByAlloc = new Map(allocations.map((a) => [a.id, a.managed_playlists?.spotify_url ?? null] as const));
            const flat = demotionPlan.flatMap((p) =>
              p.transitions.map((t, idx) => ({
                key: `${p.allocId}-${idx}`,
                name: p.name,
                cover: coverByAlloc.get(p.allocId) ?? null,
                url: urlByAlloc.get(p.allocId) ?? null,
                t,
              })),
            );
            return (
              <div className="max-h-[420px] overflow-y-auto scrollbar-none divide-y divide-border">
                {flat.map(({ key, name, cover, url, t }) => {
                  const label =
                    t.jobStatus === "done" ? "Rebaixada" :
                    t.jobStatus === "failed" ? "Falhou" :
                    t.jobStatus === "scheduled" ? "Agendada" :
                    t.jobStatus === "pending" ? "Pendente" : "Planejada";
                  const chipCls =
                    t.jobStatus === "done" ? "bg-primary/15 text-primary border-primary/30" :
                    t.jobStatus === "failed" ? "bg-rose-500/15 text-rose-400 border-rose-500/30" :
                    t.jobStatus === "scheduled" ? "bg-blue-500/15 text-blue-400 border-blue-500/30" :
                    t.jobStatus === "pending" ? "bg-amber-500/15 text-amber-400 border-amber-500/30" :
                    "bg-muted text-muted-foreground border-border";
                  const ChipIcon =
                    t.jobStatus === "done" ? CheckCircle2 :
                    t.jobStatus === "failed" ? XCircle :
                    t.jobStatus === "scheduled" ? Activity :
                    t.jobStatus === "pending" ? Clock : ArrowDown;
                  const initial = name.charAt(0).toUpperCase();
                  return (
                    <div key={key} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/20">
                      <div className="h-8 w-8 rounded-md overflow-hidden shrink-0 bg-muted flex items-center justify-center">
                        {cover ? (
                          <img src={cover} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <span className="text-xs font-semibold text-muted-foreground">{initial}</span>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate flex items-center gap-1.5">
                          {url ? (
                            <a href={url} target="_blank" rel="noreferrer" className="hover:underline truncate">{name}</a>
                          ) : (
                            <span className="truncate">{name}</span>
                          )}
                          {url && <ExternalLink className="h-3 w-3 text-muted-foreground/60 shrink-0" />}
                        </div>
                        <div className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-foreground">D{t.day}</span>
                          {t.dateIso && <span>· {fmtShortDate(t.dateIso)}</span>}
                          <span>· rebaixando da <span className="text-foreground font-medium">pos. {t.from}</span> para <span className="text-foreground font-medium">pos. {t.to}</span></span>
                          {t.jobStatus === "done" && t.jobCompletedAt && (
                            <span>· feito em {fmtDateTime(t.jobCompletedAt)}</span>
                          )}
                        </div>
                      </div>
                      <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] border shrink-0", chipCls)}>
                        <ChipIcon className="h-3 w-3" />
                        {label}
                      </span>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </CardContent>
      </Card>



      {/* BLOCO 5 — Saúde do bot */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3">
              <div className={cn(
                "h-9 w-9 rounded-lg border flex items-center justify-center shrink-0",
                botOk ? "border-success/30 bg-success/10 text-success" : "border-destructive/40 bg-destructive/10 text-destructive",
              )}>
                <Bot className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold flex items-center gap-2">
                  Bot Spotify
                  <span className={cn(
                    "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wider font-bold",
                    botOk ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive",
                  )}>
                    {botOk ? "ativo" : "inativo"}
                  </span>
                </div>
                <div className="text-[11px] text-muted-foreground mt-0.5">
                  Último heartbeat: {bot?.last_heartbeat ? timeAgo(bot.last_heartbeat) : "nunca"}
                  {bot?.status ? ` · ${bot.status}` : ""}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 text-[11px]">
              <span className={cn(
                "inline-flex items-center gap-1 px-2 py-1 rounded border",
                bot?.spotify_valid && botOk
                  ? "border-success/30 bg-success/5 text-success"
                  : "border-destructive/40 bg-destructive/5 text-destructive",
              )}>
                <ShieldCheck className="h-3 w-3" />
                Sessão Spotify {bot?.spotify_valid ? "válida" : "inválida"}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ---- KPI tile ----
function KpiTile({
  icon: Icon, label, value, total, tone, hint,
}: {
  icon: any;
  label: string;
  value: number;
  total?: number;
  tone: "success" | "warn" | "danger" | "neutral";
  hint?: string;
}) {
  const toneCls: Record<string, string> = {
    success: "text-success border-success/20",
    warn: "text-amber-400 border-amber-500/20",
    danger: "text-destructive border-destructive/30",
    neutral: "text-foreground border-border",
  };
  return (
    <Card className={cn("border", toneCls[tone])}>
      <CardContent className="p-3">
        <div className="flex items-center gap-2 mb-1">
          <Icon className={cn("h-3.5 w-3.5", toneCls[tone].split(" ")[0])} />
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">{label}</span>
        </div>
        <div className="flex items-baseline gap-1.5">
          <span className="text-2xl font-semibold leading-none">{value}</span>
          {typeof total === "number" && (
            <span className="text-xs text-muted-foreground">/ {total}</span>
          )}
        </div>
        {hint && <div className="text-[10px] text-muted-foreground mt-1">{hint}</div>}
      </CardContent>
    </Card>
  );
}

// ---- Mode count chip (header de classificação) ----
function ModeCountChip({
  icon: Icon,
  label,
  value,
  tone,
  tooltip,
}: {
  icon: typeof Bot;
  label: string;
  value: number;
  tone: "primary" | "amber" | "muted";
  tooltip: string;
}) {
  const cls =
    tone === "primary"
      ? "border-primary/30 bg-primary/[0.06]"
      : tone === "amber"
      ? "border-amber-500/30 bg-amber-500/[0.06]"
      : "border-border bg-muted/30";
  const iconCls =
    tone === "primary" ? "text-primary" : tone === "amber" ? "text-amber-400" : "text-muted-foreground";
  return (
    <div
      className={cn("inline-flex items-center gap-2 px-3 py-2 rounded-lg border", cls)}
      title={tooltip}
    >
      <Icon className={cn("h-4 w-4 shrink-0", iconCls)} />
      <div className="flex items-baseline gap-1.5">
        <span className="text-lg font-semibold leading-none">{value}</span>
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">{label}</span>
      </div>
    </div>
  );
}

// ---- Playlist row ----
type PlaylistRowState = {
  status: "done" | "manual_done" | "manual_pending" | "pending" | "scheduled" | "failed" | "idle";
  scheduledFor: string | null;
  lastError: string | null;
  jobId: string | null;
  completedAt: string | null;
  executedPosition: number | null;
  validationStatus: string | null;
  validationPosition: number | null;
  validatedAt: string | null;
};
function PlaylistRow({
  row,
  onRetry,
}: {
  row: {
    allocId: string;
    spid: string | null;
    name: string;
    cover: string | null;
    spotifyUrl: string | null;
    plannedPosition: number | null;
    plannedFor: string | null;
    executionMode?: PlaylistExecutionMode;
    state: PlaylistRowState;
  };
  onRetry?: () => void | Promise<void>;
}) {

  const initial = row.name.charAt(0).toUpperCase();
  const statusCfg: Record<PlaylistRowState["status"], { label: string; cls: string; icon: typeof Clock }> = {
    done: { label: "Adicionada", cls: "bg-primary/15 text-primary border-primary/30", icon: CheckCircle2 },
    manual_done: { label: "Feito manual", cls: "bg-primary/15 text-primary border-primary/30", icon: Hand },
    manual_pending: { label: "Manual pendente", cls: "bg-amber-500/15 text-amber-400 border-amber-500/30", icon: Hand },
    pending: { label: "Pendente", cls: "bg-amber-500/15 text-amber-400 border-amber-500/30", icon: Clock },
    scheduled: { label: "Agendada", cls: "bg-blue-500/15 text-blue-400 border-blue-500/30", icon: Activity },
    failed: { label: "Falhou", cls: "bg-rose-500/15 text-rose-400 border-rose-500/30", icon: XCircle },
    idle: { label: "Sem job", cls: "bg-muted text-muted-foreground border-border", icon: AlertCircle },
  };
  const cfg = statusCfg[row.state.status];
  const Icon = cfg.icon;


  return (
    <div className="flex items-center gap-3 px-4 py-3 hover:bg-muted/20">
      {/* cover */}
      <div className="h-8 w-8 rounded-md overflow-hidden shrink-0 bg-muted flex items-center justify-center">
        {row.cover ? (
          <img src={row.cover} alt="" className="h-full w-full object-cover" />
        ) : (
          <span className="text-xs font-semibold text-muted-foreground">{initial}</span>
        )}
      </div>

      {/* nome + meta */}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate flex items-center gap-1.5">
          {row.spotifyUrl ? (
            <a href={row.spotifyUrl} target="_blank" rel="noreferrer" className="hover:underline truncate">
              {row.name}
            </a>
          ) : (
            <span className="truncate">{row.name}</span>
          )}
          {row.spotifyUrl && <ExternalLink className="h-3 w-3 text-muted-foreground/60 shrink-0" />}
        </div>
        {/* Modo de execução — informação primária, abaixo do nome */}
        <div className="mt-1">
          <PlaylistModeBadge mode={row.executionMode} size="sm" />
        </div>
        <div className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-2 flex-wrap">
          <span>
            Pos. planejada: <span className="text-foreground font-medium">{row.plannedPosition ?? "—"}</span>
          </span>
          {row.state.status === "manual_done" ? (
            <span>
              · feito manual{row.state.executedPosition ? <> na pos. <span className="text-foreground font-medium">{row.state.executedPosition}</span></> : null}
              {row.state.completedAt ? <> em {fmtDateTime(row.state.completedAt)}</> : null}
            </span>
          ) : row.state.status === "manual_pending" ? (
            <span>· aguardando execução manual</span>
          ) : row.state.status === "scheduled" ? (
            <span>· agendada para {fmtDateTime(row.plannedFor ?? row.state.scheduledFor)}</span>
          ) : row.state.status === "done" && row.state.completedAt ? (
            <span>· {fmtDateTime(row.state.completedAt)}</span>
          ) : row.plannedFor ? (
            <span>· prevista para {fmtShortDate(row.plannedFor)} · janela 08h–22h</span>
          ) : null}

          {row.state.status === "failed" && row.state.lastError && (
            <span className="text-rose-400 truncate" title={row.state.lastError}>· {row.state.lastError}</span>
          )}

        </div>
      </div>

      {/* badge status */}
      <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] border shrink-0", cfg.cls)}>
        <Icon className="h-3 w-3" />
        {cfg.label}
      </span>

      {/* badge revalidação — só quando job está done */}
      {row.state.status === "done" && row.state.validationStatus && (() => {
        const vs = row.state.validationStatus;
        const map: Record<string, { label: string; cls: string; icon: typeof Clock; tooltip: string }> = {
          present: { label: "Presente", cls: "bg-primary/15 text-primary border-primary/30", icon: CheckCircle2, tooltip: "Faixa segue na posição planejada" },
          moved: { label: `Pos. ${row.state.validationPosition ?? "?"}`, cls: "bg-amber-500/15 text-amber-400 border-amber-500/30", icon: AlertCircle, tooltip: `Faixa mudou de posição (planejado: ${row.plannedPosition ?? "?"} · real: ${row.state.validationPosition ?? "?"})` },
          duplicate: { label: "Duplicada", cls: "bg-amber-500/15 text-amber-400 border-amber-500/30", icon: AlertCircle, tooltip: "Faixa aparece mais de uma vez na playlist" },
          removed: { label: "Removida", cls: "bg-rose-500/15 text-rose-400 border-rose-500/30", icon: XCircle, tooltip: "Faixa não está mais na playlist (curador removeu)" },
          error: { label: "Sem checagem", cls: "bg-muted text-muted-foreground border-border", icon: AlertCircle, tooltip: "Não foi possível verificar (token/erro Spotify)" },
        };
        const v = map[vs] ?? map.error;
        const VIcon = v.icon;
        return (
          <span
            className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] border shrink-0", v.cls)}
            title={`${v.tooltip}${row.state.validatedAt ? ` · checado ${fmtDateTime(row.state.validatedAt)}` : ""}`}
          >
            <VIcon className="h-3 w-3" />
            {v.label}
          </span>
        );
      })()}

      {/* retry */}
      {row.state.status === "failed" && onRetry && (
        <Button size="sm" variant="ghost" onClick={() => onRetry()} className="h-7 px-2 text-[11px] shrink-0">
          <RefreshCw className="h-3 w-3 mr-1" />
          Retentar
        </Button>
      )}
    </div>
  );
}
