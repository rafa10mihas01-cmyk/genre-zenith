// AoVivoFeed — feed cronológico em tempo real de TUDO que está acontecendo
// no sistema. Junta autopilot_runs, collection_logs e playlist_adjustments
// em um só stream PT-BR, com ícones e linguagem para leigo.
// - Agrupa eventos repetidos consecutivos (ex: "create-spotify-playlist-lock ×5")
// - Filtros rápidos: tudo / erros / cérebro / coleta / ajustes
// - Mostra 20 por vez; "carregar mais" até 200; container com scroll interno
import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Brain, Music2, Wrench, CheckCircle2, AlertTriangle, Loader2,
  Activity, Clock, RefreshCw, Filter,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { timeAgo } from "@/lib/format";

type FeedItem = {
  id: string;
  source: "autopilot" | "coleta" | "ajuste";
  status: "running" | "success" | "error" | "warning" | "info";
  icon: any;
  title: string;
  detail: string;
  meta?: string;
  timestamp: string;
  genre_nome?: string;
  groupKey?: string; // para agrupar repetições consecutivas
  count?: number;    // quantos eventos esse item agrupa (default 1)
};

type FilterKey = "all" | "errors" | "cerebro" | "coleta" | "ajustes";
const PAGE_SIZE = 20;

const STEP_LABELS_PT: Record<string, string> = {
  analyze: "analisando o gênero",
  briefing: "criando o briefing",
  blueprints: "extraindo os moldes",
  templates: "gerando os templates",
  covers: "desenhando as capas",
  approve: "aprovando os melhores",
  replicate: "preparando a replicação",
  done: "finalizou",
};

const ACAO_LABELS_PT: Record<string, string> = {
  search: "Buscando playlists",
  enrich: "Enriquecendo dados",
  validate: "Validando playlist",
  collect: "Coletando faixas",
  expire_stale: "Arquivando template antigo",
  approve_template: "Aprovando template",
  reject_template: "Rejeitando template",
  publish: "Publicando no Spotify",
};

export function AoVivoFeed() {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [genres, setGenres] = useState<Record<string, string>>({});

  const loadGenres = async () => {
    const { data } = await supabase.from("genres").select("id, nome");
    const map: Record<string, string> = {};
    (data ?? []).forEach((g: any) => { map[g.id] = g.nome; });
    setGenres(map);
  };

  const load = async () => {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const [runs, logs, adjs] = await Promise.all([
      supabase.from("autopilot_runs").select("*").gte("started_at", since).order("started_at", { ascending: false }).limit(30),
      supabase.from("collection_logs").select("*").gte("created_at", since).order("created_at", { ascending: false }).limit(50),
      supabase.from("playlist_adjustments").select("*").gte("created_at", since).order("created_at", { ascending: false }).limit(30),
    ]);

    const all: FeedItem[] = [];

    (runs.data ?? []).forEach((r: any) => {
      const genreNome = genres[r.genre_id] ?? "—";
      if (r.status === "running") {
        all.push({
          id: `run-${r.id}`,
          source: "autopilot",
          status: "running",
          icon: Brain,
          title: `Cérebro do ${genreNome} ${STEP_LABELS_PT[r.current_step ?? ""] ?? "rodando"}…`,
          detail: `Etapa atual: ${r.current_step ?? "iniciando"} · ${r.progress_pct ?? 0}% concluído`,
          meta: `${r.templates_generated} templates · ${r.covers_generated} capas`,
          timestamp: r.started_at,
          genre_nome: genreNome,
        });
      } else if (r.status === "success") {
        all.push({
          id: `run-${r.id}`,
          source: "autopilot",
          status: "success",
          icon: CheckCircle2,
          title: `Cérebro do ${genreNome} concluiu`,
          detail: r.summary ?? "Inteligência atualizada com sucesso",
          meta: `${r.templates_generated} templates · ${r.covers_generated} capas · ${r.templates_approved} aprovados`,
          timestamp: r.finished_at ?? r.started_at,
          genre_nome: genreNome,
        });
      } else if (r.status === "error") {
        all.push({
          id: `run-${r.id}`,
          source: "autopilot",
          status: "error",
          icon: AlertTriangle,
          title: `Cérebro do ${genreNome} falhou`,
          detail: r.error_message ?? "Erro desconhecido",
          timestamp: r.finished_at ?? r.started_at,
          genre_nome: genreNome,
        });
      }
    });

    (logs.data ?? []).forEach((l: any) => {
      const genreNome = l.genre_id ? genres[l.genre_id] ?? "—" : "Global";
      const acaoLabel = ACAO_LABELS_PT[l.acao] ?? l.acao;
      const isError = l.status === "error" || l.status === "failed";
      all.push({
        id: `log-${l.id}`,
        source: "coleta",
        status: isError ? "error" : l.status === "warning" ? "warning" : "info",
        icon: isError ? AlertTriangle : Music2,
        title: `${acaoLabel} (${genreNome})`,
        detail: l.mensagem ?? `Ação: ${l.acao}`,
        meta: l.duracao_ms ? `${(l.duracao_ms / 1000).toFixed(1)}s` : undefined,
        timestamp: l.created_at,
        genre_nome: genreNome,
        groupKey: `coleta:${l.acao}:${l.genre_id ?? "g"}:${l.status}`,
      });
    });

    (adjs.data ?? []).forEach((a: any) => {
      const genreNome = a.genre_id ? genres[a.genre_id] ?? "—" : "—";
      const acaoLabel = ACAO_LABELS_PT[a.action_type] ?? a.action_type;
      const isError = a.status === "error" || a.status === "failed";
      all.push({
        id: `adj-${a.id}`,
        source: "ajuste",
        status: isError ? "error" : "success",
        icon: isError ? AlertTriangle : Wrench,
        title: `${acaoLabel} (${genreNome})`,
        detail: a.error_message ?? `Disparado por ${a.triggered_by}`,
        timestamp: a.created_at,
        genre_nome: genreNome,
        groupKey: `ajuste:${a.action_type}:${a.genre_id ?? "g"}:${a.status}`,
      });
    });

    all.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    // Agrupar repetições consecutivas (mesmo groupKey seguidos)
    const grouped: FeedItem[] = [];
    for (const item of all) {
      const last = grouped[grouped.length - 1];
      if (last && item.groupKey && last.groupKey === item.groupKey) {
        last.count = (last.count ?? 1) + 1;
      } else {
        grouped.push({ ...item, count: 1 });
      }
    }

    setItems(grouped.slice(0, 200));
    setLoading(false);
  };

  useEffect(() => {
    loadGenres();
  }, []);

  useEffect(() => {
    if (Object.keys(genres).length === 0) return;
    load();

    // Realtime subscriptions nas 3 tabelas
    const ch = supabase
      .channel(`sistema-feed:${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "autopilot_runs" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "collection_logs" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "playlist_adjustments" }, () => load())
      .subscribe();

    // Refresh defensivo a cada 30s (pra atualizar timeAgo + fallback)
    const t = setInterval(load, 30_000);
    return () => { supabase.removeChannel(ch); clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [genres]);

  const stats = useMemo(() => {
    return {
      total: items.length,
      running: items.filter((i) => i.status === "running").length,
      errors: items.filter((i) => i.status === "error").length,
    };
  }, [items]);

  return (
    <div className="space-y-3">
      {/* Header com stats */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3 text-xs">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <Activity className="h-3.5 w-3.5 text-primary" />
            <strong className="text-foreground">{stats.total}</strong> eventos nas últimas 24h
          </span>
          {stats.running > 0 && (
            <Badge variant="outline" className="border-primary/40 bg-primary/5 text-primary gap-1">
              <Loader2 className="h-3 w-3 animate-spin" />
              {stats.running} rodando agora
            </Badge>
          )}
          {stats.errors > 0 && (
            <Badge variant="outline" className="border-destructive/40 bg-destructive/5 text-destructive gap-1">
              <AlertTriangle className="h-3 w-3" />
              {stats.errors} com erro
            </Badge>
          )}
        </div>
        <Button size="sm" variant="ghost" onClick={load} className="h-7 gap-1.5 text-xs">
          <RefreshCw className="h-3.5 w-3.5" /> Atualizar
        </Button>
      </div>

      {/* Feed */}
      {loading ? (
        <div className="nx-card p-6 flex items-center justify-center text-sm text-muted-foreground gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando atividade…
        </div>
      ) : items.length === 0 ? (
        <div className="nx-card p-8 text-center">
          <Clock className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">Nenhuma atividade nas últimas 24 horas.</p>
        </div>
      ) : (
        <ol className="space-y-1.5">
          {items.map((item) => (
            <FeedRow key={item.id} item={item} />
          ))}
        </ol>
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
  return (
    <li className={cn("nx-card border p-3 flex items-start gap-3", colorMap[item.status])}>
      <div className="shrink-0 mt-0.5">
        {item.status === "running" ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Icon className="h-4 w-4" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2 flex-wrap">
          <p className="text-sm font-semibold text-foreground leading-tight">{item.title}</p>
          <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">
            {timeAgo(item.timestamp)}
          </span>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5 break-words">{item.detail}</p>
        {item.meta && (
          <p className="text-[11px] text-muted-foreground/80 mt-1 tabular-nums">{item.meta}</p>
        )}
      </div>
    </li>
  );
}
