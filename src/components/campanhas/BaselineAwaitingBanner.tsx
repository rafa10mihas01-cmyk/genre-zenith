import { useEffect, useState } from "react";
import { Clock, RefreshCcw, CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useLatestBotHeartbeat } from "@/hooks/useLatestBotHeartbeat";


type Props = {
  dealState: string | null;
  baselineCapturedAt: string | null;
  dealId: string | null;
};

type SongStatus = {
  auto_collect_status: string | null;
  auto_collect_error: string | null;
  last_auto_collect_at: string | null;
  next_auto_collect_at: string | null;
  queued_at: string | null;
};

type BotPing = { created_at: string; status: string | null } | null;

function fmtAgo(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `há ${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `há ${m}min`;
  const h = Math.round(m / 60);
  return `há ${h}h`;
}

function fmtIn(iso: string | null): string {
  if (!iso) return "—";
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "a qualquer momento";
  const s = Math.round(ms / 1000);
  if (s < 60) return `em ${s}s`;
  const m = Math.round(s / 60);
  return `em ${m}min`;
}

const STATUS_LABEL: Record<string, { label: string; tone: "info" | "warn" | "err" }> = {
  idle: { label: "Aguardando próximo ciclo", tone: "info" },
  queued: { label: "Na fila do robô", tone: "info" },
  dispatched: { label: "Enviado pro robô", tone: "info" },
  running: { label: "Robô coletando agora", tone: "info" },
  error: { label: "Erro na última tentativa", tone: "err" },
};

export function BaselineAwaitingBanner({ dealState, baselineCapturedAt, dealId }: Props) {
  const [retrying, setRetrying] = useState(false);
  const [song, setSong] = useState<SongStatus | null>(null);
  const { data: hbRow } = useLatestBotHeartbeat();
  const bot: BotPing = hbRow ? { created_at: hbRow.created_at ?? "", status: hbRow.status } : null;
  const [, setTick] = useState(0);

  // Re-render a cada 15s pra atualizar contadores "há Xs / em Xmin"
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 15_000);
    return () => clearInterval(t);
  }, []);

  // Polling de status (60s) enquanto aguardando baseline — só da música.
  useEffect(() => {
    if (!dealId || baselineCapturedAt || dealState !== "awaiting_baseline") return;
    let cancel = false;

    async function load() {
      const { data: s } = await supabase
        .from("curator_deal_songs")
        .select("auto_collect_status, auto_collect_error, last_auto_collect_at, next_auto_collect_at, queued_at")
        .eq("deal_id", dealId)
        .order("position", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (cancel) return;
      setSong((s as SongStatus) ?? null);
    }
    load();
    const t = setInterval(load, 60_000);
    return () => {
      cancel = true;
      clearInterval(t);
    };
  }, [dealId, baselineCapturedAt, dealState]);


  if (!dealState) return null;

  // Baseline já chegou: mostra confirmação compacta (só nos primeiros minutos depois)
  if (baselineCapturedAt) {
    const captured = new Date(baselineCapturedAt);
    const ageMin = (Date.now() - captured.getTime()) / 60_000;
    if (ageMin > 60) return null;
    return (
      <div className="rounded-2xl border border-primary/30 bg-primary/5 px-5 py-3 flex items-center gap-3">
        <CheckCircle2 className="h-5 w-5 text-primary" />
        <div className="flex-1 text-sm">
          <span className="font-medium text-foreground">Baseline capturada — campanha ativada.</span>
          <span className="text-muted-foreground ml-2">
            {captured.toLocaleString("pt-BR")}. Agora pode mandar o link pro curador.
          </span>
        </div>
      </div>
    );
  }

  if (dealState !== "awaiting_baseline") return null;

  async function retry() {
    if (!dealId) return;
    setRetrying(true);
    try {
      const { error } = await supabase.functions.invoke("bot-collect-queue", {
        body: { deal_id: dealId, priority: "baseline" },
      });
      if (error) throw error;
      toast.success("Baseline reenfileirada. Aguarde o robô.");
    } catch (e: any) {
      toast.error(e?.message ?? "Falha ao reexecutar baseline");
    } finally {
      setRetrying(false);
    }
  }

  const status = (song?.auto_collect_status ?? "idle").toLowerCase();
  const meta = STATUS_LABEL[status] ?? { label: status, tone: "info" as const };
  const isError = meta.tone === "err";

  // Bot saudável se heartbeat há menos de 90s
  const botFresh = bot?.created_at ? Date.now() - new Date(bot.created_at).getTime() < 90_000 : false;

  return (
    <div
      className={`rounded-2xl border px-5 py-4 space-y-3 ${
        isError ? "border-destructive/40 bg-destructive/5" : "border-amber-500/40 bg-amber-500/10"
      }`}
    >
      <div className="flex items-start gap-4">
        {isError ? (
          <AlertTriangle className="h-5 w-5 text-destructive mt-0.5 shrink-0" />
        ) : status === "running" ? (
          <Loader2 className="h-5 w-5 text-amber-400 mt-0.5 shrink-0 animate-spin" />
        ) : (
          <Clock className="h-5 w-5 text-amber-400 mt-0.5 shrink-0" />
        )}
        <div className="flex-1 space-y-1">
          <div className="text-sm font-medium text-foreground flex items-center gap-2">
            Aguardando bot capturar baseline
            <span
              className={`text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded border leading-none ${
                isError
                  ? "border-destructive/50 text-destructive"
                  : "border-amber-500/50 text-amber-300"
              }`}
            >
              {meta.label}
            </span>
          </div>
          <div className="text-xs text-muted-foreground leading-relaxed">
            O robô abre o Spotify for Artists e tira a foto inicial das playlists que já tocam a música.
            A campanha ativa sozinha quando a foto chegar — aí libera o link pro curador.
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={retry}
          disabled={retrying}
          className="shrink-0"
        >
          <RefreshCcw className={`h-3.5 w-3.5 mr-2 ${retrying ? "animate-spin" : ""}`} />
          Reexecutar
        </Button>
      </div>

      {/* Linha de telemetria */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-[11px] pt-2 border-t border-border/40">
        <div>
          <div className="text-muted-foreground uppercase tracking-wider text-[9px]">Na fila</div>
          <div className="text-foreground font-medium tabular-nums">{fmtAgo(song?.queued_at ?? null)}</div>
        </div>
        <div>
          <div className="text-muted-foreground uppercase tracking-wider text-[9px]">Última tentativa</div>
          <div className="text-foreground font-medium tabular-nums">
            {song?.last_auto_collect_at ? fmtAgo(song.last_auto_collect_at) : "nenhuma"}
          </div>
        </div>
        <div>
          <div className="text-muted-foreground uppercase tracking-wider text-[9px]">Próximo ciclo</div>
          <div className="text-foreground font-medium tabular-nums">
            {fmtIn(song?.next_auto_collect_at ?? null)}
          </div>
        </div>
        <div>
          <div className="text-muted-foreground uppercase tracking-wider text-[9px]">Robô</div>
          <div className={`font-medium ${botFresh ? "text-primary" : "text-destructive"}`}>
            {botFresh ? "online" : "offline"}
            <span className="text-muted-foreground ml-1 font-normal">
              ({fmtAgo(bot?.created_at ?? null)})
            </span>
          </div>
        </div>
      </div>

      {isError && song?.auto_collect_error && (
        <div className="text-[11px] text-destructive/90 bg-destructive/10 rounded px-2 py-1.5 border border-destructive/30">
          {song.auto_collect_error}
        </div>
      )}
      {!isError && song?.auto_collect_error && (
        <div className="text-[11px] text-muted-foreground italic">{song.auto_collect_error}</div>
      )}
    </div>
  );
}
