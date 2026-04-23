import { TrendingUp, TrendingDown, Sparkles, Brain } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { Insight } from "./types";

export function InsightsPanel({ insight }: { insight: Insight | null }) {
  if (!insight) {
    return (
      <Card className="p-8 text-center">
        <Brain className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
        <p className="text-sm text-muted-foreground">
          Sem análise ainda. Clique em <strong className="text-foreground">Analisar com Claude</strong> para gerar.
        </p>
      </Card>
    );
  }

  return (
    <div className="grid md:grid-cols-2 gap-4">
      <Card className="p-5 space-y-3">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-success" />
          <h3 className="font-bold text-sm uppercase tracking-wide">Padrões vencedores</h3>
        </div>
        <ul className="space-y-2">
          {(insight.insights.padroes_vencedores ?? []).map((p, i) => (
            <li key={i} className="text-sm flex gap-2">
              <span className="text-success mt-1">▸</span>
              <span>{p}</span>
            </li>
          ))}
          {!insight.insights.padroes_vencedores?.length && (
            <li className="text-xs text-muted-foreground">Sem padrões identificados.</li>
          )}
        </ul>
      </Card>

      <Card className="p-5 space-y-3">
        <div className="flex items-center gap-2">
          <TrendingDown className="h-4 w-4 text-destructive" />
          <h3 className="font-bold text-sm uppercase tracking-wide">Padrões fracos</h3>
        </div>
        <ul className="space-y-2">
          {(insight.insights.padroes_fracos ?? []).map((p, i) => (
            <li key={i} className="text-sm flex gap-2">
              <span className="text-destructive mt-1">▸</span>
              <span>{p}</span>
            </li>
          ))}
          {!insight.insights.padroes_fracos?.length && (
            <li className="text-xs text-muted-foreground">Nenhum padrão fraco detectado.</li>
          )}
        </ul>
      </Card>

      <Card className="p-5 space-y-3 md:col-span-2">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <h3 className="font-bold text-sm uppercase tracking-wide">Recomendações para replicação</h3>
        </div>
        <div className="flex flex-wrap gap-2">
          {(insight.recomendacoes ?? []).map((r, i) => (
            <Badge key={i} variant="outline" className="text-xs py-1.5 px-3">
              {r}
            </Badge>
          ))}
          {!insight.recomendacoes?.length && (
            <span className="text-xs text-muted-foreground">Sem recomendações.</span>
          )}
        </div>
      </Card>
    </div>
  );
}
