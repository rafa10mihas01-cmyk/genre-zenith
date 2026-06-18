// AoVivoFeed — feed cronológico do sistema atual: Spotify, bot e execução.
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Music2, ListChecks, Bot, CheckCircle2, AlertTriangle, Loader2, Activity, Clock, RefreshCw, Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { timeAgo } from "@/lib/format";

type FeedItem = {
  id: string;
  source: "spotify" | "execucao" | "bot";
  status: "running" | "success" | "error" | "warning" | "info";
  icon: any;
  title: string;
  detail: string;
  meta?: string;
  timestamp: string;
  groupKey?: string;
  count?: number;
};

type FilterKey = "all" | "errors" | "spotify" | "execucao" | "bot";
const PAGE_SIZE = 20;

const ACTION_LABELS: Record<string, string> = {
  spotify_token_watchdog: "Token Spotify verificado",
  fetch_tracks_spotify: "Faixas Spotify verificadas",
  "fetch-tracks-spotify": "Faixas Spotify verificadas",
  track_playlist_metrics: "Métricas de playlist atualizadas",
  track_external_metrics: "Métricas externas atualizadas",
  recover_print_batches: "Lotes de evidência processados",
  bot_ingest_dom: "Bot leu dados do Spotify",
  bot_collect: "Bot coletou dados do Spotify",
};

function jobLabel(jobType: string) {
  if (jobType.includes("remove")) return "Remover faixa da playlist";
  if (jobType.includes("add")) return "Adicionar faixa na playlist";
  return jobType.split(".").join(" ");
}

export function AoVivoFeed() {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [visible, setVisible] = useState(PAGE_SIZE);

  const load = async () => {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const [logs, jobs, heartbeats] = await Promise.all([
      supabase.from("collection_logs").select("*").gte("created_at", since).order("created_at", { ascending: false }).limit(80),
      supabase.from("playlist_execution_jobs").select("id, job_type, status, attempts, max_attempts, last_error, created_at, updated_at, completed_at").gte("updated_at", since).order("updated_at", { ascending: false }).limit(80),
      supabase.from("bot_heartbeats").select("id, status, spotify_session_valid, message, created_at").gte("created_at", since).order("created_at", { ascending: false }).limit(20),
    ]);

    const all: FeedItem[] = [];

    (logs.data ?? []).forEach((l) => {
      const isError = ["error", "failed", "erro"].includes(l.status);
      all.push({
        id: `log-${l.id}`,
        source: "spotify",
        status: isError ? "error" : l.status === "warning" || l.status === "parcial" ? "warning" : "info",
        icon: isError ? AlertTriangle : Music2,
        title: ACTION_LABELS[l.acao] ?? l.acao,
        detail: l.mensagem ?? `Status: ${l.status}`,
        meta: l.duracao_ms ? `${(l.duracao_ms / 1000).toFixed(1)}s` : undefined,
        timestamp: l.created_at,
        groupKey: `spotify:${l.acao}:${l.status}`,
      });
    });

    (jobs.data ?? []).forEach((j) => {
      const isError = j.status === "failed";
      all.push({
        id: `job-${j.id}`,
        source: "execucao",
        status: isError ? "error" : j.status === "claimed" ? "running" : j.status === "done" ? "success" : "info",
        icon: isError ? AlertTriangle : j.status === "done" ? CheckCircle2 : ListChecks,
        title: jobLabel(j.job_type),
        detail: j.last_error ?? `Status: ${j.status}`,
        meta: `${j.attempts ?? 0}/${j.max_attempts ?? 0} tentativas`,
        timestamp: j.updated_at ?? j.completed_at ?? j.created_at,
        groupKey: `job:${j.job_type}:${j.status}`,
      });
    });

    (heartbeats.data ?? []).forEach((h) => {
      all.push({
        id: `hb-${h.id}`,
        source: "bot",
        status: h.spotify_session_valid ? "success" : "warning",
        icon: Bot,
        title: "Bot Spotify online",
        detail: h.message ?? h.status ?? "Heartbeat recebido",
        meta: h.spotify_session_valid ? "sessão válida" : "sessão inválida",
        timestamp: h.created_at,
        groupKey: `bot:${h.status}:${h.spotify_session_valid}`,
      });
    });

    all.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    const grouped: FeedItem[] = [];
    for (const item of all) {
      const last = grouped[grouped.length - 1];
      if (last && item.groupKey && last.groupKey === item.groupKey) last.count = (last.count ?? 1) + 1;
      else grouped.push({ ...item, count: 1 });
    }
    setItems(grouped.slice(0, 200));
    setLoading(false);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel("sistema-feed-atual")
      .on("postgres_changes", { event: "*", schema: "public", table: "collection_logs" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "playlist_execution_jobs" }, () => load())
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "bot_heartbeats" }, () => load())
      .subscribe();
    // Polling de fallback raro — realtime cobre o tempo real
    const t = setInterval(load, 90_000);
    return () => { supabase.removeChannel(ch); clearInterval(t); };
  }, []);

  useEffect(() => { setVisible(PAGE_SIZE); }, [filter]);

  const filtered = useMemo(() => {
    if (filter === "all") return items;
    if (filter === "errors") return items.filter((i) => i.status === "error");
    return items.filter((i) => i.source === filter);
  }, [items, filter]);

  const stats = useMemo(() => ({
    total: items.length,
    running: items.filter((i) => i.status === "running").length,
    errors: items.filter((i) => i.status === "error").length,
  }), [items]);

  const visibleItems = filtered.slice(0, visible);
  const hasMore = visible < filtered.length;
  const filters: { key: FilterKey; label: string; count: number }[] = [
    { key: "all", label: "Tudo", count: items.length },
    { key: "errors", label: "Erros", count: stats.errors },
    { key: "spotify", label: "Spotify", count: items.filter((i) => i.source === "spotify").length },
    { key: "execucao", label: "Execução", count: items.filter((i) => i.source === "execucao").length },
    { key: "bot", label: "Bot", count: items.filter((i) => i.source === "bot").length },
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3 text-xs">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <Activity className="h-3.5 w-3.5 text-primary" />
            <strong className="text-foreground">{stats.total}</strong> eventos nas últimas 24h
          </span>
          {stats.running > 0 && <Badge variant="outline" className="border-primary/40 bg-primary/5 text-primary gap-1"><Loader2 className="h-3 w-3 animate-spin" />{stats.running} rodando</Badge>}
          {stats.errors > 0 && <Badge variant="outline" className="border-destructive/40 bg-destructive/5 text-destructive gap-1"><AlertTriangle className="h-3 w-3" />{stats.errors} com erro</Badge>}
        </div>
        <Button size="sm" variant="ghost" onClick={load} className="h-7 gap-1.5 text-xs"><RefreshCw className="h-3.5 w-3.5" /> Atualizar</Button>
      </div>

      <div className="flex items-center gap-1.5 flex-wrap">
        <Filter className="h-3 w-3 text-muted-foreground shrink-0" />
        {filters.map((f) => (
          <button key={f.key} type="button" onClick={() => setFilter(f.key)} className={cn("px-2.5 py-1 rounded-full text-[11px] font-semibold uppercase tracking-wider border transition-all", filter === f.key ? "border-primary bg-primary/10 text-primary" : "border-border bg-card text-muted-foreground hover:text-foreground hover:border-foreground/20")}>
            {f.label}<span className="ml-1.5 tabular-nums opacity-70">{f.count}</span>
          </button>
        ))}
      </div>

      {loading ? (
        <div className="nx-card p-6 flex items-center justify-center text-sm text-muted-foreground gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Carregando atividade…</div>
      ) : filtered.length === 0 ? (
        <div className="nx-card p-8 text-center"><Clock className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" /><p className="text-sm text-muted-foreground">{filter === "all" ? "Nenhuma atividade nas últimas 24 horas." : "Nenhum evento nesse filtro."}</p></div>
      ) : (
        <div className="nx-card p-2 sm:p-3">
          <ol className="space-y-1.5 max-h-[560px] overflow-y-auto nx-scroll pr-1">{visibleItems.map((item) => <FeedRow key={item.id} item={item} />)}</ol>
          {hasMore && <div className="pt-2 mt-2 border-t border-border/40 flex items-center justify-between gap-2"><span className="text-[11px] text-muted-foreground tabular-nums">Mostrando {visibleItems.length} de {filtered.length}</span><Button size="sm" variant="ghost" onClick={() => setVisible((v) => Math.min(v + PAGE_SIZE, filtered.length))} className="h-7 text-xs">Carregar mais</Button></div>}
        </div>
      )}
    </div>
  );
}

function FeedRow({ item }: { item: FeedItem }) {
  const Icon = item.icon;
  const colorMap = {
    running: "border-primary/40 bg-primary/5 text-primary",
    success: "border-success/30 bg-success/5 text-success",
    error: "border-destructive/40 bg-destructive/5 text-destructive",
    warning: "border-warning/40 bg-warning/5 text-warning",
    info: "border-border bg-card text-foreground",
  };
  const count = item.count ?? 1;
  return (
    <li className={cn("nx-card border p-3 flex items-start gap-3", colorMap[item.status])}>
      <div className="shrink-0 mt-0.5">{item.status === "running" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}</div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2 flex-wrap">
          <p className="text-sm font-semibold text-foreground leading-tight flex items-center gap-1.5">{item.title}{count > 1 && <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-elevated border border-border text-[10px] font-bold tabular-nums text-muted-foreground">×{count}</span>}</p>
          <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">{timeAgo(item.timestamp)}</span>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5 break-words">{item.detail}</p>
        {item.meta && <p className="text-[11px] text-muted-foreground/80 mt-1 tabular-nums">{item.meta}</p>}
      </div>
    </li>
  );
}
