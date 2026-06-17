// BotSaudeCard — saúde do bot Spotify (heartbeat, sessão Spotify, fila).
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Bot, Loader2, RefreshCw, Clock, ListChecks, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { timeAgo } from "@/lib/format";
import { humanizeError } from "@/lib/operationalCopy";
import { useLatestBotHeartbeat } from "@/hooks/useLatestBotHeartbeat";

type BotHealth = {
  queue_size: number;
  next_collect_at?: string;
};

export function BotSaudeCard() {
  const { data: hb, isLoading: hbLoading, refetch: refetchHb } = useLatestBotHeartbeat();
  const [data, setData] = useState<BotHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    setRefreshing(true);
    try {
    const [queue, nextSong] = await Promise.all([
      supabase.from("curator_deal_songs").select("id", { count: "exact", head: true })
        .eq("auto_collect", true).in("auto_collect_status", ["idle", "queued"]),
      supabase.from("curator_deal_songs").select("next_auto_collect_at")
        .eq("auto_collect", true).eq("auto_collect_status", "idle")
        .not("next_auto_collect_at", "is", null)
        .order("next_auto_collect_at", { ascending: true }).limit(1).maybeSingle(),
    ]);

    setData({
      queue_size: queue.count ?? 0,
      next_collect_at: nextSong.data?.next_auto_collect_at ?? undefined,
    });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, []);

  const onRefresh = () => { refetchHb(); load(); };

  if (loading || !data) {
    return (
      <div className="nx-card p-4 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando saúde do bot…
      </div>
    );
  }

  const hbAge = data.last_heartbeat ? Date.now() - new Date(data.last_heartbeat).getTime() : Infinity;
  const hbOk = hbAge < 5 * 60 * 1000; // 5min
  const nextDate = data.next_collect_at ? new Date(data.next_collect_at) : null;
  const nextLabel = nextDate
    ? (nextDate.getTime() <= Date.now()
        ? "agora (aguardando ciclo)"
        : `em ${Math.max(1, Math.round((nextDate.getTime() - Date.now()) / 60000))} min`)
    : "nenhuma agendada";

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-bold flex items-center gap-1.5">
          <Bot className="h-3 w-3" /> Sistema de coleta Spotify
        </h3>
        <Button size="sm" variant="ghost" onClick={load} disabled={refreshing} className="h-6 gap-1 text-[11px]">
          <RefreshCw className={cn("h-3 w-3", refreshing && "animate-spin")} /> Atualizar
        </Button>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Cell
          icon={Bot}
          label="Sinal de vida"
          ok={hbOk}
          okText={hbOk ? "ativo" : "sem sinal"}
          errText={data.last_heartbeat ? "sem sinal" : "nunca rodou"}
          detail={data.last_heartbeat ? `último há ${timeAgo(data.last_heartbeat)}` : "—"}
        />
        <Cell
          icon={ShieldCheck}
          label="Sessão Spotify"
          ok={hbOk && data.spotify_valid}
          okText="Conta conectada"
          errText="Reconectar necessária"
          detail={data.spotify_valid ? "tudo certo" : humanizeError(data.message ?? "reautenticar")}
        />

        <Cell
          icon={ListChecks}
          label="Fila de execução"
          ok={data.queue_size < 50}
          okText={`${data.queue_size} na fila`}
          errText={`${data.queue_size} na fila`}
          detail="auto_collect ativo"
          neutral
        />
        <Cell
          icon={Clock}
          label="Próxima execução"
          ok={!!nextDate}
          okText={nextLabel}
          errText="nenhuma"
          detail={nextDate ? nextDate.toLocaleString("pt-BR") : "—"}
          neutral
        />
      </div>
    </div>
  );
}

function Cell({
  icon: Icon, label, ok, okText, errText, detail, neutral,
}: {
  icon: any; label: string; ok: boolean; okText: string; errText: string; detail: string; neutral?: boolean;
}) {
  const tone = neutral ? "border-border bg-card" : ok ? "border-success/30 bg-success/5" : "border-destructive/40 bg-destructive/5";
  const fg = neutral ? "text-foreground" : ok ? "text-success" : "text-destructive";
  return (
    <div className={cn("nx-card border p-3", tone)}>
      <div className="flex items-start gap-2">
        <Icon className={cn("h-4 w-4 shrink-0 mt-0.5", neutral ? "text-muted-foreground" : fg)} />
        <div className="min-w-0 flex-1">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">{label}</p>
          <p className={cn("text-sm font-semibold leading-tight truncate", fg)}>{ok ? okText : errText}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{detail}</p>
        </div>
      </div>
    </div>
  );
}
