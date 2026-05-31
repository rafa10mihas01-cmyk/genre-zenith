import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Bot, Clock, RefreshCcw, CheckCircle2, AlertTriangle, Loader2, Camera, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type Props = {
  campaignId: string;
  dealId: string | null;
};

type SongStatus = {
  auto_collect_status: string | null;
  auto_collect_error: string | null;
  last_auto_collect_at: string | null;
  next_auto_collect_at: string | null;
  queued_at: string | null;
};

function fmtAgo(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `há ${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `há ${m}min`;
  const h = Math.round(m / 60);
  if (h < 24) return `há ${h}h`;
  const d = Math.round(h / 24);
  return `há ${d}d`;
}

function fmtIn(iso: string | null): string {
  if (!iso) return "—";
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "a qualquer momento";
  const s = Math.round(ms / 1000);
  if (s < 60) return `em ${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `em ${m}min`;
  const h = Math.round(m / 60);
  return `em ${h}h`;
}

const STATUS_LABEL: Record<string, { label: string; tone: "info" | "ok" | "warn" | "err" }> = {
  idle: { label: "Aguardando ciclo", tone: "info" },
  queued: { label: "Na fila", tone: "info" },
  dispatched: { label: "Enviado pro robô", tone: "info" },
  running: { label: "Coletando agora", tone: "ok" },
  error: { label: "Erro na última", tone: "err" },
};

export function BotCollectionStatus({ campaignId, dealId }: Props) {
  const [song, setSong] = useState<SongStatus | null>(null);
  const [botFresh, setBotFresh] = useState<{ at: string | null; fresh: boolean }>({ at: null, fresh: false });
  const [lastSnap, setLastSnap] = useState<string | null>(null);
  const [snapCount, setSnapCount] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const [, setTick] = useState(0);

  // Re-render a cada 15s pra atualizar contadores
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 15_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!campaignId) return;
    let cancel = false;

    async function load() {
      const [songRes, botRes, snapRes, snapCountRes] = await Promise.all([
        dealId
          ? supabase
              .from("curator_deal_songs")
              .select("auto_collect_status, auto_collect_error, last_auto_collect_at, next_auto_collect_at, queued_at")
              .eq("deal_id", dealId)
              .order("position", { ascending: true })
              .limit(1)
              .maybeSingle()
          : Promise.resolve({ data: null }),
        supabase
          .from("bot_heartbeats")
          .select("created_at")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("campaign_eco_snapshots")
          .select("captured_at")
          .eq("campaign_id", campaignId)
          .order("captured_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("campaign_eco_snapshots")
          .select("*", { count: "exact", head: true })
          .eq("campaign_id", campaignId),
      ]);

      if (cancel) return;
      setSong((songRes.data as SongStatus) ?? null);
      const heartbeatAt = (botRes.data as any)?.created_at ?? null;
      setBotFresh({
        at: heartbeatAt,
        fresh: heartbeatAt ? Date.now() - new Date(heartbeatAt).getTime() < 90_000 : false,
      });
      setLastSnap((snapRes.data as any)?.captured_at ?? null);
      setSnapCount(snapCountRes.count ?? 0);
    }
    load();
    const t = setInterval(load, 15_000);
    return () => {
      cancel = true;
      clearInterval(t);
    };
  }, [campaignId, dealId]);

  async function forceCollect() {
    if (!dealId) {
      toast.error("Deal ainda não vinculado à campanha");
      return;
    }
    setRetrying(true);
    try {
      // Zera next_auto_collect_at — o trigger garante elegibilidade imediata
      const { error } = await supabase
        .from("curator_deal_songs")
        .update({
          next_auto_collect_at: new Date().toISOString(),
          auto_collect_status: "idle",
        } as any)
        .eq("deal_id", dealId);
      if (error) throw error;
      toast.success("Coleta forçada. Próxima passada do robô já pega.");
    } catch (e: any) {
      toast.error(e?.message ?? "Falha ao forçar coleta");
    } finally {
      setRetrying(false);
    }
  }

  const status = (song?.auto_collect_status ?? "idle").toLowerCase();
  const meta = STATUS_LABEL[status] ?? { label: status, tone: "info" as const };
  const isError = meta.tone === "err";
  const isRunning = status === "running" || status === "queued" || status === "dispatched";

  return (
    <div className="rounded-2xl border border-border bg-card px-5 py-4 space-y-3">
      <div className="flex items-start gap-4">
        <div className="shrink-0 mt-0.5">
          {isError ? (
            <AlertTriangle className="h-5 w-5 text-destructive" />
          ) : isRunning ? (
            <Loader2 className="h-5 w-5 text-primary animate-spin" />
          ) : snapCount > 0 ? (
            <CheckCircle2 className="h-5 w-5 text-primary" />
          ) : (
            <Bot className="h-5 w-5 text-muted-foreground" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-foreground flex items-center gap-2 flex-wrap">
            Coleta do robô
            <span
              className={`text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded border leading-none ${
                isError
                  ? "border-destructive/50 text-destructive"
                  : meta.tone === "ok"
                    ? "border-primary/50 text-primary"
                    : "border-border text-muted-foreground"
              }`}
            >
              {meta.label}
            </span>
            <span
              className={`text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded border leading-none ${
                botFresh.fresh ? "border-primary/50 text-primary" : "border-destructive/50 text-destructive"
              }`}
            >
              Robô {botFresh.fresh ? "online" : "offline"}
            </span>
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {snapCount > 0
              ? `${snapCount} foto${snapCount > 1 ? "s" : ""} já capturada${snapCount > 1 ? "s" : ""} · última ${fmtAgo(lastSnap)}`
              : "Nenhuma foto capturada ainda — aguardando primeira passada"}
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={forceCollect}
          disabled={retrying || !dealId}
          className="shrink-0"
        >
          <RefreshCcw className={`h-3.5 w-3.5 mr-2 ${retrying ? "animate-spin" : ""}`} />
          Forçar coleta
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-[11px] pt-2 border-t border-border/40">
        <div>
          <div className="text-muted-foreground uppercase tracking-wider text-[9px]">Última passada</div>
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
          <div className="text-muted-foreground uppercase tracking-wider text-[9px]">Na fila desde</div>
          <div className="text-foreground font-medium tabular-nums">
            {status === "queued" ? fmtAgo(song?.queued_at ?? null) : "—"}
          </div>
        </div>
        <div>
          <div className="text-muted-foreground uppercase tracking-wider text-[9px]">Heartbeat robô</div>
          <div className={`font-medium tabular-nums ${botFresh.fresh ? "text-foreground" : "text-destructive"}`}>
            {fmtAgo(botFresh.at)}
          </div>
        </div>
      </div>

      {isError && song?.auto_collect_error && (
        <div className="text-[11px] text-destructive/90 bg-destructive/10 rounded px-2 py-1.5 border border-destructive/30 flex items-start gap-1.5">
          <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
          <span>{song.auto_collect_error}</span>
        </div>
      )}

      {snapCount > 0 && (
        <div className="text-[11px] text-muted-foreground flex items-center gap-1.5">
          <Camera className="h-3 w-3" />
          Cada passada gera uma foto das playlists onde a música aparece — clique em "Provas" pra ver o histórico.
        </div>
      )}
    </div>
  );
}
