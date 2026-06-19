// Painel "ao vivo" do robô em linguagem humana.
// Sem código, sem jargão. Cartões por etapa + estado "dormindo".
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { timeAgo, formatDate } from "@/lib/format";
import {
  Bot, CheckCircle2, AlertTriangle, XCircle, Loader2, Moon,
  LogIn, Search, User, Music2, ListMusic, Filter, Image as ImageIcon,
  Play, Flag, Activity, Circle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

type BotEvent = {
  id: string;
  session_id: string | null;
  step: string;
  status: "running" | "success" | "error" | "warning";
  message: string | null;
  screenshot_url: string | null;
  url: string | null;
  duration_ms: number | null;
  created_at: string;
};

// Etapas em ordem natural do fluxo, com nome humano e ícone
const STAGES: { key: string; label: string; description: string; icon: LucideIcon }[] = [
  { key: "start",               label: "Acordando",         description: "Iniciando o navegador",                  icon: Play },
  { key: "login",               label: "Entrando no Spotify", description: "Fazendo login na conta de artista",     icon: LogIn },
  { key: "search_artist",       label: "Procurando o artista", description: "Buscando o nome no Spotify",          icon: Search },
  { key: "open_artist",         label: "Abrindo o artista",  description: "Entrando na página do artista",          icon: User },
  { key: "click_music_tab",     label: "Aba Músicas",        description: "Indo para a área de músicas",            icon: Music2 },
  { key: "click_tracks_tab",    label: "Aba Faixas",         description: "Listando as faixas do artista",          icon: ListMusic },
  { key: "select_track",        label: "Escolhendo a faixa", description: "Abrindo a música certa",                 icon: Music2 },
  { key: "click_playlists_tab", label: "Aba Playlists",      description: "Vendo as playlists em que a música tá",  icon: ListMusic },
  { key: "filter_7d",           label: "Filtro 7 dias",      description: "Aplicando filtro dos últimos 7 dias",    icon: Filter },
  { key: "scrape_playlists",    label: "Coletando playlists", description: "Lendo cada playlist e os streams",      icon: ListMusic },
  { key: "screenshot",          label: "Salvando print",     description: "Tirando print pra registro",             icon: ImageIcon },
  { key: "finish",              label: "Terminou",           description: "Coleta concluída",                       icon: Flag },
];

function humanStep(step: string) {
  return STAGES.find((s) => s.key === step) ?? {
    key: step,
    label: step.replace(/_/g, " "),
    description: "",
    icon: Activity,
  };
}

export function RoboAoVivo() {
  const [events, setEvents] = useState<BotEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data } = await supabase
        .from("bot_events")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(300);
      if (!mounted) return;
      setEvents((data ?? []) as BotEvent[]);
      setLoading(false);
    })();

    const ch = supabase
      .channel("bot-events-live")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "bot_events" },
        (payload) => setEvents((prev) => [payload.new as BotEvent, ...prev].slice(0, 300)),
      )
      .subscribe();
    return () => { mounted = false; supabase.removeChannel(ch); };
  }, []);

  // Sessão atual = a mais recente que ainda não terminou e teve evento nos últimos 5 min
  const { activeEvents, lastEvent, isAwake, lastSessionEnd } = useMemo(() => {
    if (events.length === 0) {
      return { activeEvents: [] as BotEvent[], lastEvent: null, isAwake: false, lastSessionEnd: null as string | null };
    }
    const last = events[0];
    const fresh = Date.now() - +new Date(last.created_at) < 5 * 60_000;
    const finished = events.some(
      (e) => e.session_id === last.session_id && e.step === "finish",
    );
    const awake = fresh && !finished;

    const sessionId = last.session_id;
    const ofSession = sessionId
      ? events.filter((e) => e.session_id === sessionId)
      : [last];

    // Última vez que o robô terminou alguma coisa (qualquer sessão)
    const lastFinish = events.find((e) => e.step === "finish");
    const lastEnd = lastFinish?.created_at ?? events[events.length - 1]?.created_at ?? null;

    return {
      activeEvents: [...ofSession].sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at)),
      lastEvent: last,
      isAwake: awake,
      lastSessionEnd: lastEnd,
    };
  }, [events]);

  if (loading) {
    return (
      <div className="nx-card p-12 text-center">
        <Loader2 className="h-5 w-5 animate-spin text-primary mx-auto" />
        <p className="text-xs text-muted-foreground mt-3">Carregando…</p>
      </div>
    );
  }

  // Estado "dormindo"
  if (!isAwake) {
    return (
      <div className="nx-card p-10 text-center">
        <div className="inline-flex h-14 w-14 rounded-full bg-elevated items-center justify-center mb-4">
          <Moon className="h-6 w-6 text-muted-foreground" />
        </div>
        <h3 className="text-lg font-bold">Robô dormindo</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Nada acontecendo agora. Quando ele acordar, cada passo aparece aqui ao vivo.
        </p>
        {lastSessionEnd && (
          <div className="mt-5 inline-flex items-center gap-2 text-xs text-muted-foreground bg-elevated px-3 py-1.5 rounded-full">
            <Activity className="h-3 w-3" />
            Última atividade: <span className="text-foreground font-medium">{timeAgo(lastSessionEnd)}</span>
            <span className="opacity-50">·</span>
            <span>{formatDate(lastSessionEnd)}</span>
          </div>
        )}
      </div>
    );
  }

  // Estado "acordado" → cartões por etapa
  const stepStatusMap = new Map<string, BotEvent>();
  for (const e of activeEvents) stepStatusMap.set(e.step, e); // último evento por etapa

  const currentStep = lastEvent?.step ?? "";
  const currentMeta = humanStep(currentStep);

  return (
    <div className="space-y-5">
      {/* Hero: o que ele tá fazendo agora */}
      <div className="nx-card p-6 relative overflow-hidden">
        <div className="absolute top-4 right-4 flex items-center gap-1.5 text-primary">
          <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
          <span className="text-[10px] uppercase font-bold tracking-wider">ao vivo</span>
        </div>
        <div className="flex items-center gap-4">
          <div className="h-14 w-14 rounded-2xl bg-primary/15 text-primary flex items-center justify-center shrink-0">
            <currentMeta.icon className="h-7 w-7" />
          </div>
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground font-bold">
              Agora
            </div>
            <h2 className="text-2xl font-bold leading-tight mt-0.5 truncate">
              {currentMeta.label}
            </h2>
            <p className="text-sm text-muted-foreground mt-1 truncate">
              {lastEvent?.message || currentMeta.description}
            </p>
          </div>
        </div>
      </div>

      {/* Cartões por etapa */}
      <div>
        <h3 className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground font-bold mb-3">
          Etapas
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {STAGES.map((stage, idx) => {
            const evt = stepStatusMap.get(stage.key);
            const currentIdx = STAGES.findIndex((s) => s.key === currentStep);
            const lastEvtForStage = evt;
            // Progressão linear: tudo antes do atual = feito; atual = rodando; depois = aguardando.
            // Se o evento da etapa registrou erro/warning, preserva esse status.
            let status: "pending" | "running" | "success" | "error" | "warning";
            if (lastEvtForStage?.status === "error") status = "error";
            else if (lastEvtForStage?.status === "warning") status = "warning";
            else if (currentIdx === -1) status = (evt?.status as any) ?? "pending";
            else if (idx < currentIdx) status = "success";
            else if (idx === currentIdx) status = "running";
            else status = "pending";

            return (
              <StageCard
                key={stage.key}
                label={stage.label}
                description={stage.description}
                icon={stage.icon}
                status={status}
                detail={evt?.message ?? undefined}
                when={evt?.created_at ?? undefined}
                screenshot={evt?.screenshot_url ?? undefined}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

function StageCard({
  label, description, icon: Icon, status, detail, when, screenshot,
}: {
  label: string;
  description: string;
  icon: LucideIcon;
  status: "pending" | "running" | "success" | "error" | "warning";
  detail?: string;
  when?: string;
  screenshot?: string;
}) {
  const palette = {
    pending: { ring: "border-border", bg: "bg-elevated/40", icon: "text-muted-foreground/50", dot: "bg-muted-foreground/30", label: "Aguardando" },
    running: { ring: "border-primary ring-2 ring-primary/40 shadow-[0_0_24px_-4px_hsl(var(--primary)/0.45)] animate-pulse", bg: "bg-primary/10", icon: "text-primary", dot: "bg-primary animate-pulse", label: "Fazendo agora" },
    success: { ring: "border-border", bg: "bg-card", icon: "text-primary", dot: "bg-primary", label: "Feito" },
    error:   { ring: "border-destructive/40", bg: "bg-destructive/5", icon: "text-destructive", dot: "bg-destructive", label: "Falhou" },
    warning: { ring: "border-warning/40", bg: "bg-warning/5", icon: "text-warning", dot: "bg-warning", label: "Atenção" },
  }[status];

  const StatusIcon =
    status === "running" ? Loader2
    : status === "success" ? CheckCircle2
    : status === "error" ? XCircle
    : status === "warning" ? AlertTriangle
    : Circle;

  return (
    <div className={cn("rounded-2xl border p-4 transition-colors", palette.ring, palette.bg)}>
      <div className="flex items-start gap-3">
        <div className={cn("h-10 w-10 rounded-xl bg-elevated flex items-center justify-center shrink-0", palette.icon)}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", palette.dot)} />
            <span className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground">
              {palette.label}
            </span>
            {when && status !== "pending" && (
              <span className="text-[10px] text-muted-foreground/70 ml-auto tabular-nums">
                {timeAgo(when)}
              </span>
            )}
          </div>
          <div className="text-sm font-bold leading-tight mt-0.5 flex items-center gap-1.5">
            {label}
            <StatusIcon className={cn(
              "h-3.5 w-3.5 shrink-0",
              status === "running" && "animate-spin text-primary",
              status === "success" && "text-primary",
              status === "error" && "text-destructive",
              status === "warning" && "text-warning",
              status === "pending" && "text-muted-foreground/40",
            )} />
          </div>
          <p className="text-[12px] text-muted-foreground mt-0.5 leading-snug line-clamp-2">
            {detail || description}
          </p>
          {screenshot && (
            <a
              href={screenshot}
              target="_blank"
              rel="noopener noreferrer"
              className="block mt-2 rounded-md overflow-hidden border border-border hover:border-primary/50 transition-colors"
            >
              <img src={screenshot} alt="" className="w-full h-auto" loading="lazy" />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
