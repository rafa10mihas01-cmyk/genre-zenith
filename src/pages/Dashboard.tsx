import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Zap, Music, Search, ListMusic, Activity, Clock, Sparkles, Play } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/StatusBadge";
import { formatNumber, timeAgo } from "@/lib/format";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";

interface Stats {
  totalGenres: number;
  analyzed: number;
  searchesRun: number;
  playlists: number;
  tracks: number;
  lastActivity: string | null;
}

interface Genre {
  id: string;
  nome: string;
  slug: string;
  status: string;
}

interface LogRow {
  id: string;
  acao: string;
  status: string;
  mensagem: string | null;
  created_at: string;
  genre_id: string | null;
}

export default function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [genres, setGenres] = useState<Genre[]>([]);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    const [{ count: totalGenres }, { count: analyzed }, { count: searchesRun }, { count: playlists }, { count: tracks }, { data: lastLog }, { data: gs }, { data: ls }] = await Promise.all([
      supabase.from("genres").select("*", { count: "exact", head: true }),
      supabase.from("genres").select("*", { count: "exact", head: true }).eq("status", "analisado"),
      supabase.from("search_terms").select("*", { count: "exact", head: true }).eq("executado", true),
      supabase.from("search_results").select("*", { count: "exact", head: true }),
      supabase.from("search_tracks").select("*", { count: "exact", head: true }),
      supabase.from("collection_logs").select("created_at").order("created_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("genres").select("id,nome,slug,status").order("nome"),
      supabase.from("collection_logs").select("id,acao,status,mensagem,created_at,genre_id").order("created_at", { ascending: false }).limit(10),
    ]);
    setStats({
      totalGenres: totalGenres ?? 0,
      analyzed: analyzed ?? 0,
      searchesRun: searchesRun ?? 0,
      playlists: playlists ?? 0,
      tracks: tracks ?? 0,
      lastActivity: lastLog?.created_at ?? null,
    });
    setGenres(gs ?? []);
    setLogs(ls ?? []);
    setLoading(false);
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, []);

  const pct = stats && stats.totalGenres ? Math.round((stats.analyzed / stats.totalGenres) * 100) : 0;

  const generateAllTerms = async () => {
    toast.info("Geração de termos será disponibilizada na Fase 2", {
      description: "A edge function generate-terms ainda está sendo construída.",
    });
  };
  const startNext = async () => {
    toast.info("Coleta automática será disponibilizada na Fase 2");
  };

  return (
    <div className="space-y-6 max-w-[1400px] mx-auto">
      <div>
        <div className="flex items-center gap-2.5">
          <Zap className="h-7 w-7 text-primary" />
          <h1 className="text-2xl font-bold tracking-tight">NexEngine</h1>
        </div>
        <p className="text-sm text-muted-foreground mt-1">Motor de Inteligência de Playlists</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard icon={Music} label="Total Gêneros" value={stats?.totalGenres ?? 0} />
        <StatCard icon={Sparkles} label="Analisados" value={stats?.analyzed ?? 0} accent />
        <StatCard icon={Search} label="Buscas Executadas" value={stats?.searchesRun ?? 0} />
        <StatCard icon={ListMusic} label="Playlists Coletadas" value={stats?.playlists ?? 0} />
        <StatCard icon={Activity} label="Músicas Mapeadas" value={stats?.tracks ?? 0} />
        <StatCard icon={Clock} label="Última Atividade" valueRaw={stats?.lastActivity ? timeAgo(stats.lastActivity) : "—"} />
      </div>

      {/* Progress + Quick actions */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="nx-card p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-xs text-muted-foreground uppercase tracking-wider">Progresso de Análise</div>
              <div className="text-2xl font-bold mt-0.5">{pct}%</div>
            </div>
            <div className="text-right text-sm text-muted-foreground">
              {stats?.analyzed ?? 0} / {stats?.totalGenres ?? 0} gêneros
            </div>
          </div>
          <Progress value={pct} className="h-2" />
        </div>

        <div className="nx-card p-5 space-y-2">
          <div className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Ações rápidas</div>
          <Button onClick={startNext} className="w-full justify-start gap-2">
            <Play className="h-4 w-4" /> Iniciar próxima coleta
          </Button>
          <Button onClick={generateAllTerms} variant="outline" className="w-full justify-start gap-2">
            <Sparkles className="h-4 w-4" /> Gerar todos os termos
          </Button>
        </div>
      </div>

      {/* Genre grid */}
      <div className="nx-card p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="font-semibold">Status por gênero</h2>
            <p className="text-xs text-muted-foreground">{genres.length} gêneros cadastrados</p>
          </div>
          <Link to="/genres" className="text-xs text-primary hover:underline">Gerenciar →</Link>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {loading && <span className="text-xs text-muted-foreground">Carregando…</span>}
          {genres.map((g) => (
            <Link
              key={g.id}
              to={`/models/${g.id}`}
              className="group inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-elevated border border-border hover:border-primary/40 transition-colors text-xs"
              title={g.status}
            >
              <span className={`nx-status-dot ${dotForStatus(g.status)} ${g.status === "coletando" ? "animate-pulse-soft" : ""}`} />
              <span className="group-hover:text-primary">{g.nome}</span>
            </Link>
          ))}
        </div>
      </div>

      {/* Recent activity */}
      <div className="nx-card p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold">Atividade recente</h2>
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">auto-refresh 15s</span>
        </div>
        {logs.length === 0 ? (
          <p className="text-xs text-muted-foreground py-6 text-center">Nenhuma atividade ainda. Inicie uma coleta para ver os logs.</p>
        ) : (
          <ul className="divide-y divide-border">
            {logs.map((l) => (
              <li key={l.id} className="py-2.5 flex items-center justify-between gap-3 text-sm">
                <div className="flex items-center gap-2 min-w-0">
                  <StatusBadge status={l.status === "sucesso" ? "analisado" : l.status === "erro" ? "erro" : "coletando"} />
                  <span className="font-medium">{l.acao}</span>
                  {l.mensagem && <span className="text-muted-foreground truncate">— {l.mensagem}</span>}
                </div>
                <span className="text-xs text-muted-foreground shrink-0">{timeAgo(l.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function dotForStatus(s: string) {
  switch (s) {
    case "analisado": return "bg-success";
    case "coletando": return "bg-primary";
    case "analisando": return "bg-warning";
    case "erro": return "bg-destructive";
    default: return "bg-neutral";
  }
}

function StatCard({ icon: Icon, label, value, valueRaw, accent }: { icon: any; label: string; value?: number; valueRaw?: string; accent?: boolean }) {
  return (
    <div className={`nx-card p-4 ${accent ? "ring-1 ring-primary/20" : ""}`}>
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
        <Icon className={`h-3.5 w-3.5 ${accent ? "text-primary" : "text-muted-foreground"}`} />
      </div>
      <div className="text-2xl font-bold mt-1.5 tabular-nums">
        {valueRaw ?? formatNumber(value ?? 0)}
      </div>
    </div>
  );
}
