// Tipos compartilhados do Fluxo Visual.
import type { LucideIcon } from "lucide-react";

export type NodeStatus = "idle" | "running" | "success" | "error" | "warning";

export type FluxoNodeId =
  | "descoberta"
  | "filtro"
  | "catalogo"
  | "deal"
  | "execucao";

export type KV = { label: string; value: string | number; hint?: string };

export type DecisionItem = {
  kind: "aceito" | "descartado" | "ajustado";
  label: string;
  count?: number | string;
  reason: string;
};

export type AlertItem = {
  level: "info" | "warning" | "error";
  message: string;
  hint?: string;
};

export type LogPretty = {
  ts: string;
  status: string;
  raw: string;
  pretty: string;
  durationMs?: number | null;
};

export type FluxoNodeData = {
  id: FluxoNodeId;
  label: string;
  shortLabel: string;
  icon: LucideIcon;
  status: NodeStatus;
  inputCount?: number;
  outputCount?: number;
  durationMs?: number | null;
  description?: string;
  details: {
    summary: string;
    variables: KV[];
    process: string[];
    decisions: DecisionItem[];
    output: KV[];
    quality: KV[];
    alerts: AlertItem[];
    logs: LogPretty[];
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
