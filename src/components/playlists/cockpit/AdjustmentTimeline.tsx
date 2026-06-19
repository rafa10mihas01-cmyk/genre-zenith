import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  TrendingUp, TrendingDown, Minus, Hourglass, CircleHelp, History,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

type Verdict = "pending" | "positive" | "neutral" | "negative" | "inconclusive";

type Impact = {
  id: string;
  action_type: string;
  observation_window_days: number;
  observation_ends_at: string;
  snapshot_before: any;
  snapshot_after: any | null;
  delta: any | null;
  verdict: Verdict;
  editorial_note: string | null;
  evaluated_at: string | null;
  created_at: string;
};

const verdictMeta: Record<Verdict, { icon: LucideIcon; label: string; tone: string }> = {
  pending:      { icon: Hourglass,   label: "Observando",   tone: "bg-amber-500/10 text-amber-300 border-amber-500/30" },
  positive:     { icon: TrendingUp,  label: "Impacto positivo", tone: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30" },
  neutral:      { icon: Minus,       label: "Sem impacto",  tone: "bg-zinc-500/10 text-zinc-300 border-zinc-500/30" },
  negative:     { icon: TrendingDown, label: "Impacto negativo", tone: "bg-rose-500/10 text-rose-300 border-rose-500/30" },
  inconclusive: { icon: CircleHelp,  label: "Inconclusivo", tone: "bg-zinc-500/10 text-zinc-300 border-zinc-500/30" },
};

const actionLabel: Record<string, string> = {
  cover: "Capa",
  description: "Descrição",
  tracks_structural: "Reciclagem estrutural",
  tracks_moderate: "Reciclagem moderada",
  tracks_light: "Ajuste leve de faixas",
  name: "Nome",
};

export function AdjustmentTimeline({ playlistId }: { playlistId: string }) {
  const [items, setItems] = useState<Impact[] | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data } = await supabase
        .from("playlist_adjustment_impacts")
        .select("*")
        .eq("playlist_id", playlistId)
        .order("created_at", { ascending: false })
        .limit(15);
      if (active) setItems((data as Impact[]) ?? []);
    })();
    return () => { active = false; };
  }, [playlistId]);

  if (items === null) {
    return (
      <Card className="p-4 text-xs text-muted-foreground">Carregando histórico…</Card>
    );
  }
  if (items.length === 0) {
    return (
      <Card className="p-4">
        <div className="flex items-center gap-3">
          <History className="h-4 w-4 text-muted-foreground shrink-0" />
          <div className="min-w-0">
            <div className="text-sm font-medium">Sem ajustes ainda</div>
            <div className="text-xs text-muted-foreground">Suas mudanças aparecem aqui.</div>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-3 space-y-2">
      <div className="flex items-center gap-2 px-1">
        <History className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <h3 className="text-xs font-semibold">Histórico de impacto editorial</h3>
        <span className="text-[11px] text-muted-foreground tabular-nums">
          · {items.length} {items.length === 1 ? "mudança" : "mudanças"}
        </span>
      </div>

      <div className="space-y-2">
        {items.map((it) => {
          const meta = verdictMeta[it.verdict];
          const Icon = meta.icon;
          const deltaFollowers = it.delta?.followers ?? null;
          const deltaPct = it.delta?.followers_pct ?? null;
          const beforeFollowers = it.snapshot_before?.followers ?? 0;
          const action = actionLabel[it.action_type] ?? it.action_type;

          return (
            <div
              key={it.id}
              className="flex items-start gap-3 rounded-lg border border-border/40 bg-card/40 p-3"
            >
              <div className={cn("mt-0.5 rounded-md border p-1.5", meta.tone)}>
                <Icon className="h-3.5 w-3.5" />
              </div>
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{action}</span>
                  <Badge variant="outline" className={cn("text-[10px] uppercase", meta.tone)}>
                    {meta.label}
                  </Badge>
                  <span className="text-[11px] text-muted-foreground">
                    {formatDistanceToNow(new Date(it.created_at), { addSuffix: true, locale: ptBR })}
                  </span>
                </div>

                {it.verdict === "pending" ? (
                  <p className="text-xs text-muted-foreground">
                    Janela de {it.observation_window_days}d · termina {formatDistanceToNow(new Date(it.observation_ends_at), { addSuffix: true, locale: ptBR })}. Baseline: {beforeFollowers.toLocaleString("pt-BR")} seguidores.
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {it.editorial_note}
                    {deltaFollowers !== null && deltaPct !== null && (
                      <span className="ml-1 text-foreground/70">
                        ({beforeFollowers.toLocaleString("pt-BR")} → {(it.snapshot_after?.followers ?? 0).toLocaleString("pt-BR")})
                      </span>
                    )}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <p className="px-1 pt-1 text-[10px] text-muted-foreground/70 leading-snug">
        O NexEngine observa cada mudança por uma janela definida e registra o resultado antes de recomendar a próxima.
      </p>
    </Card>
  );
}

