import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CheckCircle2, Clock, XCircle, Loader2, ArrowDownUp, Plus,
  AlertCircle, ChevronDown, ChevronRight, Activity, Hand,
} from "lucide-react";
import { cn } from "@/lib/utils";

type JobRow = {
  id: string;
  job_type: string;
  status: string;
  spotify_playlist_id: string;
  spotify_track_id: string;
  attempts: number;
  max_attempts: number;
  scheduled_for: string | null;
  claimed_at: string | null;
  completed_at: string | null;
  last_error: string | null;
  from_position: number | null;
  to_position: number | null;
  created_at: string;
};

type EcoRow = {
  managed_playlist_id: string;
  position: number | null;
  managed_playlists: { name: string | null; spotify_playlist_id: string | null } | null;
};

type ManualRow = {
  id: string;
  status: string;
  spotify_playlist_id: string | null;
  playlist_name: string | null;
  planned_position: number | null;
  executed_position: number | null;
  created_at: string;
  completed_at: string | null;
};

type Props = { campaignId: string };

const fmtDate = (iso: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
};

function StatusBadge({ status }: { status: string }) {
  const cfg: Record<string, { label: string; icon: typeof Clock; cls: string }> = {
    pending: { label: "Pendente", icon: Clock, cls: "bg-amber-500/15 text-amber-400 border-amber-500/30" },
    claimed: { label: "Executando", icon: Loader2, cls: "bg-blue-500/15 text-blue-400 border-blue-500/30" },
    done: { label: "Concluído", icon: CheckCircle2, cls: "bg-primary/15 text-primary border-primary/30" },
    failed: { label: "Falhou", icon: XCircle, cls: "bg-rose-500/15 text-rose-400 border-rose-500/30" },
  };
  const c = cfg[status] ?? { label: status, icon: AlertCircle, cls: "bg-muted text-muted-foreground border-border" };
  const Icon = c.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] border", c.cls)}>
      <Icon className={cn("h-3 w-3", status === "claimed" && "animate-spin")} />
      {c.label}
    </span>
  );
}

function JobTypeBadge({ type }: { type: string }) {
  if (type === "playlist.track.add") {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
        <Plus className="h-3 w-3" /> ADD
      </span>
    );
  }
  if (type === "playlist.track.reorder") {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
        <ArrowDownUp className="h-3 w-3" /> REORDER
      </span>
    );
  }
  return <span className="text-[11px] text-muted-foreground">{type}</span>;
}

export function CampaignExecutionStatus({ campaignId }: Props) {
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [manualItems, setManualItems] = useState<ManualRow[]>([]);
  const [ecoMap, setEcoMap] = useState<Map<string, { name: string; position: number | null }>>(new Map());
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const load = async () => {
    const [jobsRes, manualRes, ecoRes] = await Promise.all([
      supabase
        .from("playlist_execution_jobs")
        .select("id, job_type, status, spotify_playlist_id, spotify_track_id, attempts, max_attempts, scheduled_for, claimed_at, completed_at, last_error, from_position, to_position, created_at")
        .eq("campaign_id", campaignId)
        .in("job_type", ["playlist.track.add", "playlist.track.reorder"])
        .order("created_at", { ascending: false })
        .limit(500),
      supabase
        .from("manual_distribution_queue")
        .select("id, status, spotify_playlist_id, playlist_name, planned_position, executed_position, created_at, completed_at")
        .eq("campaign_id", campaignId)
        .in("status", ["MANUAL_PENDING", "AUTO_FAILED_FALLBACK_MANUAL", "MANUAL_DONE"])
        .order("created_at", { ascending: false })
        .limit(500),
      supabase
        .from("campaign_eco_allocations")
        .select("managed_playlist_id, position, managed_playlists(name, spotify_playlist_id)")
        .eq("campaign_id", campaignId),
    ]);
    setJobs((jobsRes.data ?? []) as JobRow[]);
    setManualItems((manualRes.data ?? []) as ManualRow[]);
    const map = new Map<string, { name: string; position: number | null }>();
    for (const r of (ecoRes.data ?? []) as unknown as EcoRow[]) {
      const spid = r.managed_playlists?.spotify_playlist_id;
      if (spid) map.set(spid, { name: r.managed_playlists?.name ?? spid, position: r.position });
    }
    setEcoMap(map);
    setLoading(false);
  };

  useEffect(() => {
    setLoading(true);
    load();
    const channelKey = Math.random().toString(36).slice(2);
    const jobsChannel = supabase
      .channel(`camp-exec-jobs-${campaignId}-${channelKey}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "playlist_execution_jobs", filter: `campaign_id=eq.${campaignId}` },
        () => load(),
      )
      .subscribe();
    const manualChannel = supabase
      .channel(`camp-exec-manual-${campaignId}-${channelKey}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "manual_distribution_queue", filter: `campaign_id=eq.${campaignId}` },
        () => load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(jobsChannel);
      supabase.removeChannel(manualChannel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId]);

  const grouped = useMemo(() => {
    const m = new Map<string, { jobs: JobRow[]; manual: ManualRow[] }>();
    for (const j of jobs) {
      const entry = m.get(j.spotify_playlist_id) ?? { jobs: [], manual: [] };
      entry.jobs.push(j);
      m.set(j.spotify_playlist_id, entry);
    }
    for (const it of manualItems) {
      if (!it.spotify_playlist_id) continue;
      const entry = m.get(it.spotify_playlist_id) ?? { jobs: [], manual: [] };
      entry.manual.push(it);
      m.set(it.spotify_playlist_id, entry);
    }
    // Ordena playlists: com falhas primeiro, depois pendentes, depois concluídas
    return Array.from(m.entries()).sort(([aId, aEntry], [bId, bEntry]) => {
      const rank = (entry: { jobs: JobRow[]; manual: ManualRow[] }) => {
        if (entry.jobs.some(j => j.status === "failed")) return 0;
        if (entry.jobs.some(j => j.status === "pending" || j.status === "claimed") || entry.manual.some(it => it.status !== "MANUAL_DONE")) return 1;
        return 2;
      };
      const ra = rank(aEntry), rb = rank(bEntry);
      if (ra !== rb) return ra - rb;
      const na = ecoMap.get(aId)?.name ?? aId;
      const nb = ecoMap.get(bId)?.name ?? bId;
      return na.localeCompare(nb);
    });
  }, [jobs, ecoMap]);

  const totals = useMemo(() => {
    return jobs.reduce(
      (acc, j) => {
        acc[j.status] = (acc[j.status] ?? 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );
  }, [jobs]);

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="p-5 space-y-3">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-32 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (jobs.length === 0 && manualItems.length === 0) {
    return (
      <Card>
        <CardContent className="p-8 text-center space-y-2">
          <Activity className="h-8 w-8 mx-auto text-muted-foreground" />
          <div className="text-sm font-medium">Nenhum job de execução ainda</div>
          <div className="text-xs text-muted-foreground">
            Quando a campanha for distribuída, os ADDs e REORDERs aparecem aqui em tempo real.
          </div>
        </CardContent>
      </Card>
    );
  }

  if (jobs.length === 0 && manualItems.length > 0) {
    return (
      <Card>
        <CardContent className="p-0">
          <div className="px-4 py-3 border-b border-border">
            <div className="text-sm font-semibold">Status manual por playlist</div>
            <div className="text-xs text-muted-foreground">
              {manualItems.length} registro(s) manual(is) · sem job de bot
            </div>
          </div>
          <div className="divide-y divide-border">
            {manualItems.map((it) => {
              const done = it.status === "MANUAL_DONE";
              return (
                <div key={it.id} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/20">
                  <Hand className={cn("h-4 w-4 shrink-0", done ? "text-primary" : "text-amber-400")} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{it.playlist_name ?? it.spotify_playlist_id ?? "Playlist"}</div>
                    <div className="text-[11px] text-muted-foreground">
                      Pos. planejada: {it.planned_position ?? "—"}
                      {done ? <> · pos. feita: <span className="text-foreground font-medium">{it.executed_position ?? it.planned_position ?? "—"}</span></> : null}
                      {done && it.completed_at ? <> · {fmtDate(it.completed_at)}</> : <> · aguardando execução manual</>}
                    </div>
                  </div>
                  <span className={cn(
                    "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] border shrink-0",
                    done ? "bg-primary/15 text-primary border-primary/30" : "bg-amber-500/15 text-amber-400 border-amber-500/30",
                  )}>
                    <CheckCircle2 className="h-3 w-3" />
                    {done ? "Feito manual" : "Manual pendente"}
                  </span>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <div className="text-sm font-semibold">Status das adições por playlist</div>
              <div className="text-xs text-muted-foreground">
                Atualiza em tempo real. {jobs.length} job(s) · {grouped.length} playlist(s)
              </div>
            </div>
            <div className="flex items-center gap-2 text-[11px]">
              {(["pending", "claimed", "done", "failed"] as const).map((s) =>
                totals[s] ? (
                  <span key={s} className="inline-flex items-center gap-1">
                    <StatusBadge status={s} />
                    <span className="text-muted-foreground">{totals[s]}</span>
                  </span>
                ) : null,
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="divide-y divide-border">
            {grouped.map(([spid, plJobs]) => {
              const eco = ecoMap.get(spid);
              const name = eco?.name ?? spid;
              const planned = eco?.position ?? null;
              const open = expanded.has(spid);
              const done = plJobs.filter((j) => j.status === "done").length;
              const failed = plJobs.filter((j) => j.status === "failed").length;
              const pending = plJobs.filter((j) => j.status === "pending" || j.status === "claimed").length;
              return (
                <div key={spid}>
                  <button
                    onClick={() => toggle(spid)}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/30 text-left"
                  >
                    {open ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{name}</div>
                      <div className="text-[11px] text-muted-foreground">
                        Pos. planejada: {planned ?? "—"} · {plJobs.length} job(s)
                      </div>
                    </div>
                    <div className="flex items-center gap-2 text-[11px]">
                      {done > 0 && <span className="inline-flex items-center gap-1 text-primary"><CheckCircle2 className="h-3 w-3" />{done}</span>}
                      {pending > 0 && <span className="inline-flex items-center gap-1 text-amber-400"><Clock className="h-3 w-3" />{pending}</span>}
                      {failed > 0 && <span className="inline-flex items-center gap-1 text-rose-400"><XCircle className="h-3 w-3" />{failed}</span>}
                    </div>
                  </button>
                  {open && (
                    <div className="px-4 pb-3 overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-left text-muted-foreground border-b border-border">
                            <th className="py-2 pr-3 font-medium">Tipo</th>
                            <th className="py-2 pr-3 font-medium">Status</th>
                            <th className="py-2 pr-3 font-medium">Pos.</th>
                            <th className="py-2 pr-3 font-medium">Agendado</th>
                            <th className="py-2 pr-3 font-medium">Executado</th>
                            <th className="py-2 pr-3 font-medium">Tent.</th>
                            <th className="py-2 font-medium">Erro</th>
                          </tr>
                        </thead>
                        <tbody>
                          {plJobs.map((j) => (
                            <tr key={j.id} className="border-b border-border/50 last:border-0">
                              <td className="py-2 pr-3"><JobTypeBadge type={j.job_type} /></td>
                              <td className="py-2 pr-3"><StatusBadge status={j.status} /></td>
                              <td className="py-2 pr-3 text-muted-foreground">
                                {j.job_type === "playlist.track.reorder" && j.from_position && j.to_position
                                  ? `${j.from_position}→${j.to_position}`
                                  : planned ?? "—"}
                              </td>
                              <td className="py-2 pr-3 text-muted-foreground">{fmtDate(j.scheduled_for)}</td>
                              <td className="py-2 pr-3 text-muted-foreground">{fmtDate(j.completed_at ?? j.claimed_at)}</td>
                              <td className="py-2 pr-3 text-muted-foreground">{j.attempts}/{j.max_attempts}</td>
                              <td className="py-2 text-rose-400 max-w-[280px] truncate" title={j.last_error ?? undefined}>
                                {j.last_error ?? "—"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
