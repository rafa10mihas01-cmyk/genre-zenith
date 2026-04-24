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
  // Detalhes para o drawer
  details: {
    input: { label: string; value: string | number }[];
    output: { label: string; value: string | number }[];
    rules: string[];
    logs: { ts: string; status: string; message: string; durationMs?: number | null }[];
    errors: string[];
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
