// Tipos compartilhados do Fluxo Visual.
import type { LucideIcon } from "lucide-react";

export type NodeStatus = "idle" | "running" | "success" | "error" | "warning";

export type FluxoNodeId =
  | "spotify"
  | "coleta"
  | "filtro"
  | "cerebro"
  | "templates"
  | "capas"
  | "playlist";

export type KV = { label: string; value: string | number; hint?: string };

export type DecisionItem = {
  kind: "aceito" | "descartado" | "ajustado";
  label: string;
  count?: number | string;
  reason: string; // motivo claro em PT-BR
};

export type AlertItem = {
  level: "info" | "warning" | "error";
  message: string;
  hint?: string;
};

export type LogPretty = {
  ts: string;
  status: string;
  raw: string;        // mensagem técnica
  pretty: string;     // tradução em PT-BR
  durationMs?: number | null;
};

export type FluxoNodeData = {
  id: FluxoNodeId;
  label: string;
  shortLabel: string;
  icon: LucideIcon;
  status: NodeStatus;
  inputCount?: number;   // o que entrou
  outputCount?: number;  // o que saiu
  durationMs?: number | null;
  description?: string;  // sub-texto curto
  // Detalhes ricos para o drawer (7 seções)
  details: {
    summary: string;                 // 1-2 linhas: o que essa etapa fez
    variables: KV[];                 // VARIÁVEIS UTILIZADAS (parâmetros, limites, filtros)
    process: string[];               // PROCESSO EXECUTADO (passos internos + APIs)
    decisions: DecisionItem[];       // DECISÕES TOMADAS (aceito / descartado / motivo)
    output: KV[];                    // SAÍDA DETALHADA (quantidade + resumo)
    quality: KV[];                   // QUALIDADE DOS DADOS (médias, volume, aproveitamento)
    alerts: AlertItem[];             // ALERTAS (erros, falhas, comportamento estranho)
    logs: LogPretty[];               // LOG EXPLICADO (técnico + tradução)
  };
};

export type FluxoRun = {
  id: string;
  genreId: string;
  genreName: string;
  status: "running" | "success" | "error" | "partial";
  currentStep: string | null;
  progressPct: number;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  triggeredBy: string;
  templatesGenerated: number;
  templatesApproved: number;
  coversGenerated: number;
  cacheHits: Record<string, boolean>;
  stepsCompleted: Array<{ step: string; at: string; [k: string]: unknown }>;
  summary: string | null;
  errorMessage: string | null;
};
