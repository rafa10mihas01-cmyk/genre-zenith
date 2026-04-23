import { TrendingUp, TrendingDown, Sparkles, Brain, CheckCircle2, AlertTriangle, ArrowRight } from "lucide-react";
import { Card } from "@/components/ui/card";
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

  const vencedores = insight.insights.padroes_vencedores ?? [];
  const fracos = insight.insights.padroes_fracos ?? [];
  const recomendacoes = insight.recomendacoes ?? [];

  return (
    <div className="grid md:grid-cols-2 gap-4">
      {/* Padrões vencedores */}
      <Card className="p-5 space-y-4">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-success" />
          <h3 className="font-bold text-sm uppercase tracking-wide">Padrões vencedores</h3>
          <span className="text-[10px] text-muted-foreground ml-auto">{vencedores.length}</span>
        </div>
        {vencedores.length === 0 ? (
          <p className="text-xs text-muted-foreground">Sem padrões identificados.</p>
        ) : (
          <ul className="space-y-3">
            {vencedores.map((p, i) => (
              <PatternItem key={i} text={p} tone="success" />
            ))}
          </ul>
        )}
      </Card>

      {/* Padrões fracos */}
      <Card className="p-5 space-y-4">
        <div className="flex items-center gap-2">
          <TrendingDown className="h-4 w-4 text-destructive" />
          <h3 className="font-bold text-sm uppercase tracking-wide">Padrões fracos</h3>
          <span className="text-[10px] text-muted-foreground ml-auto">{fracos.length}</span>
        </div>
        {fracos.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nenhum padrão fraco detectado.</p>
        ) : (
          <ul className="space-y-3">
            {fracos.map((p, i) => (
              <PatternItem key={i} text={p} tone="destructive" />
            ))}
          </ul>
        )}
      </Card>

      {/* Recomendações */}
      <Card className="p-5 space-y-4 md:col-span-2">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <h3 className="font-bold text-sm uppercase tracking-wide">Recomendações para replicação</h3>
          <span className="text-[10px] text-muted-foreground ml-auto">{recomendacoes.length}</span>
        </div>
        {recomendacoes.length === 0 ? (
          <p className="text-xs text-muted-foreground">Sem recomendações.</p>
        ) : (
          <ul className="grid md:grid-cols-2 gap-2.5">
            {recomendacoes.map((r, i) => (
              <li
                key={i}
                className="flex items-start gap-2.5 p-3 rounded-lg bg-elevated/40 border border-border/50 hover:border-primary/40 transition-colors"
              >
                <span className="h-5 w-5 rounded-full bg-primary/10 text-primary text-[10px] font-bold flex items-center justify-center shrink-0 tabular-nums mt-0.5">
                  {i + 1}
                </span>
                <span className="text-sm leading-relaxed">{r}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

/**
 * Quebra textos no formato "Título - descrição" ou "Título: descrição"
 * em duas partes visuais (título bold + descrição mais leve).
 */
function PatternItem({ text, tone }: { text: string; tone: "success" | "destructive" }) {
  const Icon = tone === "success" ? CheckCircle2 : AlertTriangle;
  const colorCls = tone === "success" ? "text-success" : "text-destructive";

  // tenta separar "Título - descrição" / "Título: descrição"
  const match = text.match(/^([^:\-–—]{2,80}?)\s*[:\-–—]\s*(.+)$/s);
  const title = match ? match[1].trim() : text;
  const description = match ? match[2].trim() : null;

  return (
    <li className="flex items-start gap-2.5">
      <Icon className={`h-4 w-4 ${colorCls} shrink-0 mt-0.5`} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium leading-snug">{title}</p>
        {description && (
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{description}</p>
        )}
      </div>
    </li>
  );
}
