import { Brain, AlertCircle, ArrowRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { Insight } from "./types";

export function PriorityActionsCard({ insight }: { insight: Insight | null }) {
  const acoes = insight?.acoes_sugeridas ?? [];
  const top3 = acoes
    .slice()
    .sort((a, b) => prioRank(a.prioridade) - prioRank(b.prioridade))
    .slice(0, 3);

  if (!insight) {
    return (
      <Card className="p-5 flex items-center gap-3">
        <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center shrink-0">
          <Brain className="h-5 w-5 text-muted-foreground" />
        </div>
        <div className="min-w-0">
          <h3 className="font-bold text-sm">Sem análise ainda</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Clique em <strong className="text-foreground">Analisar com Claude</strong> para gerar recomendações.
          </p>
        </div>
      </Card>
    );
  }

  if (top3.length === 0) {
    return (
      <Card className="p-5 flex items-center gap-3">
        <div className="h-10 w-10 rounded-full bg-success/10 flex items-center justify-center shrink-0">
          <Brain className="h-5 w-5 text-success" />
        </div>
        <div className="min-w-0">
          <h3 className="font-bold text-sm">Tudo sob controle</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Última análise em {new Date(insight.created_at).toLocaleString("pt-BR")} — nenhuma ação urgente.
          </p>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-5 space-y-3">
      <div className="flex items-center gap-2">
        <AlertCircle className="h-4 w-4 text-warning" />
        <h3 className="font-bold text-sm uppercase tracking-wide">Próximas ações</h3>
        <Badge variant="outline" className="text-[10px] ml-auto">
          {acoes.length} sugestões
        </Badge>
      </div>
      <ul className="space-y-2.5">
        {top3.map((a, i) => (
          <li key={i} className="flex items-start gap-3 text-sm">
            <Badge
              variant={a.prioridade === "alta" ? "default" : a.prioridade === "baixa" ? "outline" : "secondary"}
              className="uppercase text-[9px] mt-0.5 shrink-0"
            >
              {a.prioridade}
            </Badge>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <ArrowRight className="h-3 w-3 text-primary shrink-0" />
                <span className="font-medium truncate">{a.acao ?? a.motivo}</span>
              </div>
              {a.playlist && (
                <p className="text-xs text-muted-foreground mt-0.5 truncate pl-4">{a.playlist}</p>
              )}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function prioRank(p: string) {
  return p === "alta" ? 0 : p === "media" ? 1 : 2;
}
