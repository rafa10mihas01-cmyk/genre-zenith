import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Sparkles, FlaskConical, Check, X, ArrowRight, TrendingUp, TrendingDown, Minus } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { usePlaylistOnboarding } from "@/hooks/usePlaylistOnboarding";
import {
  useSeoExperiments,
  useSuggestSeoExperiment,
  useApplySeoExperiment,
  useRejectSeoExperiment,
  type SeoExperiment,
} from "@/hooks/useSeoExperiments";

type Props = { managedId: string };

const OUTCOME_META: Record<string, { Icon: LucideIcon; tone: string; label: string }> = {
  positive: { Icon: TrendingUp, tone: "text-primary", label: "Positivo" },
  neutral: { Icon: Minus, tone: "text-muted-foreground", label: "Neutro" },
  negative: { Icon: TrendingDown, tone: "text-destructive", label: "Negativo" },
};

export function SeoExperimentCard({ managedId }: Props) {
  const { data: lifecycle } = usePlaylistOnboarding(managedId);
  const { data: experiments, isLoading } = useSeoExperiments(managedId);
  const suggest = useSuggestSeoExperiment();
  const apply = useApplySeoExperiment();
  const reject = useRejectSeoExperiment();

  const proposed = useMemo(() => experiments?.find((e) => e.status === "proposed") ?? null, [experiments]);
  const active = useMemo(() => experiments?.find((e) => e.status === "active") ?? null, [experiments]);
  const history = useMemo(
    () => (experiments ?? []).filter((e) => e.status === "completed" || e.status === "rejected" || e.status === "rolled_back").slice(0, 5),
    [experiments],
  );

  // Não mostra pra playlists em onboarding
  if (lifecycle?.lifecycle_stage === "onboarding") return null;
  if (isLoading) return null;

  const canSuggest = !proposed && !active;

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <FlaskConical className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold">Experimentos SEO</h3>
            <Badge variant="outline" className="text-[10px] h-5">
              {lifecycle?.lifecycle_stage === "mature" ? "ciclo longo" : "em testes"}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            Testes editoriais 1×/14d. Cada resultado alimenta o cérebro do nicho.
          </p>
        </div>
        {canSuggest && (
          <Button
            size="sm"
            className="h-8 gap-1.5"
            disabled={suggest.isPending}
            onClick={() => suggest.mutate({ playlistId: managedId })}
          >
            {suggest.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            Gerar sugestão
          </Button>
        )}
      </div>

      {proposed && <ProposedRow exp={proposed} managedId={managedId} apply={apply} reject={reject} />}
      {active && <ActiveRow exp={active} />}

      {!proposed && !active && history.length === 0 && (
        <p className="text-xs text-muted-foreground border border-dashed border-border/60 rounded-md p-3">
          Nenhum experimento ainda. Clique em <strong>Gerar sugestão</strong> para a IA propor uma micro-mudança no título ou descrição.
        </p>
      )}

      {history.length > 0 && (
        <div className="border-t border-border/60 pt-2 space-y-1.5">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
            Histórico
          </div>
          <ul className="space-y-1">
            {history.map((e) => <HistoryRow key={e.id} exp={e} />)}
          </ul>
        </div>
      )}
    </Card>
  );
}

function ProposedRow({
  exp, managedId, apply, reject,
}: {
  exp: SeoExperiment;
  managedId: string;
  apply: ReturnType<typeof useApplySeoExperiment>;
  reject: ReturnType<typeof useRejectSeoExperiment>;
}) {
  const isApplying = apply.isPending;
  return (
    <div className="rounded-md border border-primary/30 bg-primary/5 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="text-[10px] border-primary/40 text-primary">Proposto · {exp.field}</Badge>
        {exp.pattern_label && <span className="text-[10px] text-muted-foreground">{exp.pattern_label}</span>}
      </div>
      <div className="flex items-center gap-2 text-xs flex-wrap">
        <span className="text-muted-foreground line-through truncate max-w-[280px]">{exp.version_before}</span>
        <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
        <span className="text-foreground font-medium truncate max-w-[280px]">{exp.version_after}</span>
      </div>
      {exp.reasoning && <p className="text-[11px] text-muted-foreground">{exp.reasoning}</p>}
      <div className="flex gap-2">
        <Button
          size="sm"
          className="h-7 gap-1.5"
          disabled={isApplying}
          onClick={() => {
            if (confirm(`Aplicar nova ${exp.field === "name" ? "nome" : "descrição"} no Spotify?`)) {
              apply.mutate({ experimentId: exp.id, playlistId: managedId });
            }
          }}
        >
          {isApplying ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
          Aplicar
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1.5"
          disabled={reject.isPending}
          onClick={() => reject.mutate({ experimentId: exp.id, playlistId: managedId })}
        >
          <X className="h-3 w-3" />
          Descartar
        </Button>
      </div>
    </div>
  );
}

function ActiveRow({ exp }: { exp: SeoExperiment }) {
  const daysLeft = exp.measure_due_at
    ? Math.max(0, Math.ceil((new Date(exp.measure_due_at).getTime() - Date.now()) / 86_400_000))
    : null;
  return (
    <div className="rounded-md border border-border bg-elevated/60 p-3 space-y-1.5">
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="text-[10px]">Ativo · {exp.field}</Badge>
        {daysLeft !== null && (
          <span className="text-[10px] text-muted-foreground tabular-nums">
            {daysLeft === 0 ? "medindo hoje" : `mede em ${daysLeft}d`}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2 text-xs flex-wrap">
        <span className="text-muted-foreground line-through truncate max-w-[280px]">{exp.version_before}</span>
        <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
        <span className="text-foreground font-medium truncate max-w-[280px]">{exp.version_after}</span>
      </div>
      <div className="text-[10px] text-muted-foreground tabular-nums">
        baseline: {(exp.baseline_followers ?? 0).toLocaleString("pt-BR")} seguidores
      </div>
    </div>
  );
}

function HistoryRow({ exp }: { exp: SeoExperiment }) {
  const outcome = exp.outcome ?? "neutral";
  const meta = OUTCOME_META[outcome];
  const Icon = meta.Icon;
  return (
    <li className="flex items-center gap-2 text-xs">
      <Icon className={`h-3 w-3 shrink-0 ${meta.tone}`} />
      <span className="text-muted-foreground capitalize w-16 shrink-0">{exp.field}</span>
      <span className="truncate flex-1 text-muted-foreground">{exp.pattern_label ?? exp.version_after}</span>
      {exp.delta_pct !== null && (
        <span className={`tabular-nums font-medium ${meta.tone}`}>
          {Number(exp.delta_pct) >= 0 ? "+" : ""}{Number(exp.delta_pct).toFixed(1)}%
        </span>
      )}
    </li>
  );
}
