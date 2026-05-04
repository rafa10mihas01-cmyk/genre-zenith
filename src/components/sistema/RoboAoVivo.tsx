// Painel ao vivo do robô: mostra cada passo que o bot da VPS está executando agora.
// Lê de `bot_events` em tempo real, agrupa por sessão e renderiza estilo timeline/terminal.
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { timeAgo } from "@/lib/format";
import { Button } from "@/components/ui/button";
import {
  Bot, Play, CheckCircle2, AlertTriangle, XCircle, Loader2,
  LogIn, Search, User, Music2, ListMusic, Filter, Image as ImageIcon,
  Globe, ArrowRight, Activity, Eye,
} from "lucide-react";
import { Empty } from "@/components/cerebro/_shared";

type BotEvent = {
  id: string;
  bot_name: string;
  session_id: string | null;
  deal_id: string | null;
  song_id: string | null;
  step: string;
  status: "running" | "success" | "error" | "warning";
  message: string | null;
  screenshot_url: string | null;
  url: string | null;
  duration_ms: number | null;
  metadata: any;
  created_at: string;
};

const STEP_META: Record<string, { label: string; icon: any }> = {
  start:              { label: "Iniciou sessão",       icon: Play },
  login:              { label: "Login Spotify",        icon: LogIn },
  search_artist:      { label: "Buscando artista",     icon: Search },
  open_artist:        { label: "Abriu artista",        icon: User },
  click_music_tab:    { label: "Aba Músicas",          icon: Music2 },
  click_tracks_tab:   { label: "Aba Faixas",           icon: ListMusic },
  select_track:       { label: "Selecionou faixa",     icon: Music2 },
  click_playlists_tab:{ label: "Aba Playlists",        icon: ListMusic },
  filter_7d:          { label: "Filtro 7 dias",        icon: Filter },
  scrape_playlists:   { label: "Coletando playlists",  icon: ListMusic },
  screenshot:         { label: "Print",                icon: ImageIcon },
  navigate:           { label: "Navegando",            icon: Globe },
  finish:             { label: "Finalizou",            icon: CheckCircle2 },
};

function meta(step: string) {
  return STEP_META[step] ?? { label: step.replace(/_/g, " "), icon: Activity };
}

const STATUS_DOT: Record<BotEvent["status"], string> = {
  running: "bg-primary animate-pulse",
  success: "bg-primary",
  error: "bg-destructive",
  warning: "bg-warning",
};

const STATUS_ICON: Record<BotEvent["status"], any> = {
  running: Loader2,
  success: CheckCircle2,
  error: XCircle,
  warning: AlertTriangle,
};

export function RoboAoVivo() {
  const [events, setEvents] = useState<BotEvent[]>([]);
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    const { data } = await supabase
      .from("bot_events")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    setEvents((data ?? []) as BotEvent[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel("bot-events-live")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "bot_events" },
        (payload) => setEvents((prev) => [payload.new as BotEvent, ...prev].slice(0, 200)),
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  // Agrupa por sessão
  const sessions = useMemo(() => {
    const map = new Map<string, BotEvent[]>();
    for (const e of events) {
      const key = e.session_id ?? `_:${e.id}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(e);
    }
    return Array.from(map.entries()).map(([id, evts]) => {
      const sorted = [...evts].sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at));
      const last = evts[0]; // events vem desc → o primeiro é o último
      const isRunning = !sorted.some((e) => e.step === "finish") &&
        Date.now() - +new Date(last.created_at) < 5 * 60_000;
      return {
        id,
        events: sorted,
        last,
        isRunning,
        hasError: sorted.some((e) => e.status === "error"),
        startedAt: sorted[0]?.created_at,
      };
    });
  }, [events]);

  const activeSessionId = selectedSession ?? sessions[0]?.id ?? null;
  const activeSession = sessions.find((s) => s.id === activeSessionId);

  const stats = useMemo(() => {
    const running = sessions.filter((s) => s.isRunning).length;
    const errors = events.filter((e) => e.status === "error").length;
    const total = sessions.length;
    return { running, errors, total };
  }, [sessions, events]);

  if (loading) {
    return (
      <div className="nx-card p-12 text-center">
        <Loader2 className="h-5 w-5 animate-spin text-primary mx-auto" />
        <p className="text-xs text-muted-foreground mt-2">Carregando eventos do robô…</p>
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <div className="space-y-4">
        <div className="nx-card p-8">
          <Empty msg="Nenhum evento do robô ainda. Configure o bot da VPS para enviar eventos para a edge function bot-event-ingest." />
        </div>
        <SetupGuide />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Stats topo */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Rodando agora" value={stats.running} accent={stats.running > 0 ? "primary" : "muted"} icon={Bot} />
        <StatCard label="Sessões hoje" value={stats.total} icon={Activity} />
        <StatCard label="Erros" value={stats.errors} accent={stats.errors > 0 ? "danger" : "muted"} icon={XCircle} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4">
        {/* Lista de sessões */}
        <div className="nx-card overflow-hidden">
          <div className="px-3 py-2 border-b border-border">
            <h3 className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground font-bold">
              Sessões
            </h3>
          </div>
          <div className="max-h-[70vh] overflow-y-auto nx-scroll divide-y divide-border">
            {sessions.map((s) => {
              const m = meta(s.last.step);
              const Icon = m.icon;
              const isActive = s.id === activeSessionId;
              return (
                <button
                  key={s.id}
                  onClick={() => setSelectedSession(s.id)}
                  className={cn(
                    "w-full text-left px-3 py-2.5 transition-colors hover:bg-elevated/60",
                    isActive && "bg-elevated",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className={cn("h-2 w-2 rounded-full shrink-0", STATUS_DOT[s.hasError ? "error" : s.isRunning ? "running" : "success"])} />
                    <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="text-xs font-semibold truncate flex-1">
                      {s.id.startsWith("_:") ? "Sessão avulsa" : s.id.slice(0, 12)}
                    </span>
                    {s.isRunning && (
                      <span className="text-[9px] uppercase font-bold text-primary tracking-wider">live</span>
                    )}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-1 truncate pl-4">
                    {m.label} · {timeAgo(s.last.created_at)}
                  </div>
                  <div className="text-[10px] text-muted-foreground/70 mt-0.5 pl-4">
                    {s.events.length} {s.events.length === 1 ? "passo" : "passos"}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Timeline da sessão */}
        <div className="nx-card overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <div>
              <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground font-bold">
                Passos do robô
              </div>
              <div className="text-sm font-bold mt-0.5">
                {activeSession?.id.startsWith("_:") ? "Eventos sem sessão" : activeSession?.id.slice(0, 16) ?? "—"}
              </div>
            </div>
            {activeSession?.isRunning && (
              <div className="flex items-center gap-1.5 text-primary">
                <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                <span className="text-[10px] uppercase font-bold tracking-wider">ao vivo</span>
              </div>
            )}
          </div>

          <div className="max-h-[70vh] overflow-y-auto nx-scroll p-4">
            {activeSession ? (
              <Timeline events={activeSession.events} isRunning={activeSession.isRunning} />
            ) : (
              <Empty msg="Selecione uma sessão." />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Timeline({ events, isRunning }: { events: BotEvent[]; isRunning: boolean }) {
  return (
    <ol className="relative space-y-3">
      {/* linha vertical */}
      <span className="absolute left-[15px] top-2 bottom-2 w-px bg-border" aria-hidden />
      {events.map((e) => {
        const m = meta(e.step);
        const Icon = m.icon;
        const StatusIcon = STATUS_ICON[e.status];
        return (
          <li key={e.id} className="relative pl-10">
            <span className={cn(
              "absolute left-0 top-0.5 h-8 w-8 rounded-full border-2 border-background flex items-center justify-center",
              e.status === "error" ? "bg-destructive/15 text-destructive"
              : e.status === "warning" ? "bg-warning/15 text-warning"
              : e.status === "running" ? "bg-primary/15 text-primary"
              : "bg-elevated text-foreground/70",
            )}>
              <Icon className="h-3.5 w-3.5" />
            </span>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-bold leading-tight">{m.label}</span>
              <StatusIcon className={cn(
                "h-3 w-3",
                e.status === "running" && "animate-spin text-primary",
                e.status === "success" && "text-primary",
                e.status === "error" && "text-destructive",
                e.status === "warning" && "text-warning",
              )} />
              <span className="text-[10px] text-muted-foreground tabular-nums ml-auto">
                {timeAgo(e.created_at)}
                {e.duration_ms != null && (
                  <span className="ml-2 opacity-70">{(e.duration_ms / 1000).toFixed(1)}s</span>
                )}
              </span>
            </div>
            {e.message && (
              <p className="text-[12px] text-foreground/85 mt-0.5 leading-snug">{e.message}</p>
            )}
            {e.url && (
              <a
                href={e.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[10px] text-muted-foreground hover:text-primary inline-flex items-center gap-1 mt-1 truncate max-w-full"
              >
                <Globe className="h-3 w-3 shrink-0" />
                <span className="truncate">{e.url}</span>
              </a>
            )}
            {e.screenshot_url && (
              <a
                href={e.screenshot_url}
                target="_blank"
                rel="noopener noreferrer"
                className="block mt-2 rounded-md overflow-hidden border border-border hover:border-primary/50 transition-colors max-w-xs"
              >
                <img src={e.screenshot_url} alt="screenshot" className="w-full h-auto" loading="lazy" />
              </a>
            )}
          </li>
        );
      })}
      {isRunning && (
        <li className="relative pl-10">
          <span className="absolute left-0 top-0.5 h-8 w-8 rounded-full border-2 border-background bg-primary/15 text-primary flex items-center justify-center">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          </span>
          <div className="text-xs text-muted-foreground italic pt-1.5">aguardando próximo passo…</div>
        </li>
      )}
    </ol>
  );
}

function StatCard({ label, value, icon: Icon, accent = "muted" }: {
  label: string; value: number; icon: any; accent?: "primary" | "danger" | "muted";
}) {
  const cls = accent === "primary" ? "text-primary"
    : accent === "danger" ? "text-destructive"
    : "text-foreground";
  return (
    <div className="nx-card p-4">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
        <Icon className="h-3 w-3" />
        {label}
      </div>
      <div className={cn("text-2xl font-bold mt-1 tabular-nums", cls)}>{value}</div>
    </div>
  );
}

function SetupGuide() {
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/bot-event-ingest`;
  return (
    <div className="nx-card p-5">
      <h3 className="text-sm font-bold mb-1">Como conectar o robô da VPS</h3>
      <p className="text-xs text-muted-foreground mb-3">
        No script Playwright, faça POST para a URL abaixo a cada passo. Use o header
        <code className="mx-1 px-1 py-0.5 rounded bg-elevated text-[10px]">x-bot-token</code>
        com o valor do segredo <code className="mx-1 px-1 py-0.5 rounded bg-elevated text-[10px]">BOT_INGEST_TOKEN</code>.
      </p>
      <pre className="text-[11px] bg-elevated/60 border border-border rounded-md p-3 overflow-auto font-mono whitespace-pre-wrap">
{`POST ${url}
headers: { x-bot-token: <BOT_INGEST_TOKEN>, content-type: application/json }
body: {
  "session_id": "uuid-da-rodada",
  "deal_id": "uuid-do-deal-opcional",
  "step": "search_artist",        // login | search_artist | open_artist |
                                  // click_music_tab | click_tracks_tab |
                                  // select_track | click_playlists_tab |
                                  // filter_7d | scrape_playlists | finish
  "status": "running",            // running | success | error | warning
  "message": "Buscando DJ Cleber",
  "url": "https://artists.spotify.com/...",
  "screenshot_url": "https://...png",  // opcional
  "duration_ms": 1240,                 // opcional
  "metadata": { "candidates": ["DJ CLEBER"] }
}`}
      </pre>
    </div>
  );
}
