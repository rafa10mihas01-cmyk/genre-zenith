// fluxoInsights — camada de inteligência por etapa do pipeline.
// Pipeline atual: Descoberta → Filtro → Catálogo → Deal → Execução.
import type { FluxoNodeData, KV } from "./types";

export type HealthLevel = "excelente" | "atencao" | "problema" | "neutro";

export type StepHealth = {
  level: HealthLevel;
  label: string;
  score: number;
  reasons: string[];
};

export type StepAction = {
  id: string;
  label: string;
  kind: "link" | "invoke" | "scroll" | "copy";
  to?: string;
  fn?: string;
  payload?: Record<string, unknown>;
  selector?: string;
  text?: string;
  variant?: "default" | "outline" | "ghost" | "destructive";
  hint?: string;
};

export type DataSource = {
  type: "table" | "function" | "api" | "storage";
  name: string;
  detail?: string;
};

export type StepIntel = {
  health: StepHealth;
  insights: string[];
  sources: DataSource[];
  actions: StepAction[];
};

// =============== Helpers ===============
function num(v: KV["value"] | undefined | null): number | null {
  if (v == null) return null;
  if (typeof v === "number") return v;
  const n = parseFloat(String(v).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function findKV(items: KV[] | undefined, label: string): KV | undefined {
  if (!items) return undefined;
  const l = label.toLowerCase();
  return items.find((i) => i.label.toLowerCase().includes(l));
}

function countErrors(node: FluxoNodeData): number {
  return (node.details.alerts ?? []).filter((a) => a.level === "error").length
    + (node.details.logs ?? []).filter((l) => l.status === "error" || l.status === "failed").length;
}

function countWarnings(node: FluxoNodeData): number {
  return (node.details.alerts ?? []).filter((a) => a.level === "warning").length;
}

function statusToHealth(node: FluxoNodeData): HealthLevel {
  if (node.status === "error") return "problema";
  if (node.status === "warning") return "atencao";
  if (node.status === "success" || node.status === "running") return "excelente";
  return "neutro";
}

// =============== Saúde por etapa ===============
function buildHealth(node: FluxoNodeData): StepHealth {
  const errors = countErrors(node);
  const warnings = countWarnings(node);
  let base = statusToHealth(node);
  if (errors > 0 && base !== "problema") base = "problema";
  else if (warnings > 0 && base === "excelente") base = "atencao";

  const reasons: string[] = [];
  let score = base === "excelente" ? 90 : base === "atencao" ? 60 : base === "problema" ? 25 : 50;

  switch (node.id) {
    case "descoberta": {
      const termos = num(findKV(node.details.variables, "Termos cadastrados")?.value);
      const token = String(findKV(node.details.variables, "Token Spotify")?.value ?? "");
      if (token.includes("válido")) reasons.push("Token Spotify válido");
      else { reasons.push("Token Spotify com problema"); score -= 30; }
      if (termos != null) {
        if (termos >= 30) reasons.push(`${termos} termos cadastrados — volume saudável`);
        else if (termos > 0) reasons.push(`${termos} termos — pouco para boa diversidade`);
      }
      const brutas = num(node.outputCount);
      if (brutas != null && brutas > 0) reasons.push(`${brutas} playlists brutas coletadas`);
      break;
    }
    case "filtro": {
      const aprov = num(node.outputCount) ?? 0;
      const desc = num(findKV(node.details.output, "Descartadas")?.value) ?? 0;
      const taxa = num(String(findKV(node.details.output, "Taxa")?.value ?? "").replace("%", ""));
      const total = aprov + desc;
      if (total > 0 && taxa != null) {
        if (taxa >= 60) { reasons.push(`Taxa de aprovação saudável (${taxa}%)`); score = Math.max(score, 85); }
        else if (taxa >= 30) reasons.push(`Taxa de aprovação média (${taxa}%)`);
        else { reasons.push(`Taxa baixa (${taxa}%) — filtro apertado ou termos ruins`); base = "atencao"; score = Math.min(score, 55); }
      } else if (total === 0) {
        reasons.push("Sem dados — descoberta ainda não rodou");
        base = "neutro"; score = 50;
      }
      break;
    }
    case "catalogo": {
      const ativas = num(node.outputCount) ?? 0;
      const total = num(findKV(node.details.variables, "Total")?.value) ?? 0;
      if (ativas > 0) reasons.push(`${ativas} playlists ativas no catálogo`);
      else { reasons.push("Catálogo vazio"); base = "atencao"; score = 40; }
      if (total > ativas) reasons.push(`${total - ativas} arquivadas`);
      break;
    }
    case "deal": {
      const ativos = num(node.outputCount) ?? 0;
      const hoje = num(findKV(node.details.variables, "hoje")?.value) ?? 0;
      if (ativos > 0) reasons.push(`${ativos} deals em vigor`);
      else { reasons.push("Nenhum deal ativo"); base = "neutro"; score = 50; }
      if (hoje > 0) reasons.push(`${hoje} entregas marcadas para hoje`);
      break;
    }
    case "execucao": {
      const done = num(node.outputCount) ?? 0;
      const fail = num(findKV(node.details.output, "Falhas")?.value) ?? 0;
      const pend = num(findKV(node.details.output, "Pendentes")?.value) ?? 0;
      if (done > 0) reasons.push(`${done} concluídos hoje`);
      if (fail > 0) { reasons.push(`${fail} falhas (24h)`); if (fail > 5) base = "problema"; }
      if (pend > 200) { reasons.push(`${pend} pendentes — fila acumulando`); if (base === "excelente") base = "atencao"; }
      break;
    }
  }

  score = Math.max(0, Math.min(100, score));
  const labelMap: Record<HealthLevel, string> = {
    excelente: "Excelente", atencao: "Atenção", problema: "Problema", neutro: "Sem sinal",
  };
  return { level: base, label: labelMap[base], score, reasons: reasons.slice(0, 4) };
}

// =============== Insights ===============
function buildInsights(node: FluxoNodeData): string[] {
  const out: string[] = [];
  switch (node.id) {
    case "descoberta": {
      const termos = num(findKV(node.details.variables, "Termos cadastrados")?.value);
      if (termos != null) {
        if (termos < 10) out.push(`Apenas ${termos} termos — diversidade muito baixa.`);
        else if (termos >= 30) out.push(`Boa cobertura: ${termos} termos.`);
      }
      const brutas = num(node.outputCount) ?? 0;
      if (brutas > 500) out.push(`Volume bruto alto (${brutas}) — base ampla pro filtro.`);
      else if (brutas > 0 && brutas < 50) out.push(`Coleta enxuta (${brutas}) — pode faltar variedade.`);
      break;
    }
    case "filtro": {
      const taxa = num(String(findKV(node.details.output, "Taxa")?.value ?? "").replace("%", ""));
      if (taxa != null && taxa < 20) out.push("Muito poucas aprovadas — filtro apertado ou termos pegando lixo.");
      else if (taxa != null && taxa >= 70) out.push("Filtro bem calibrado.");
      break;
    }
    case "catalogo": {
      const ativas = num(node.outputCount) ?? 0;
      if (ativas === 0) out.push("Catálogo zerado — sem playlists para fechar deals.");
      else if (ativas < 20) out.push(`Catálogo pequeno (${ativas}) — limita o que dá pra prometer.`);
      break;
    }
    case "deal": {
      const ativos = num(node.outputCount) ?? 0;
      const pend = num(findKV(node.details.variables, "pendentes")?.value) ?? 0;
      if (ativos === 0) out.push("Nenhum deal ativo — sem demanda para a fila de execução.");
      if (pend > 0) out.push(`${pend} músicas aguardando distribuição.`);
      break;
    }
    case "execucao": {
      const fail = num(findKV(node.details.output, "Falhas")?.value) ?? 0;
      const done = num(findKV(node.details.output, "Concluídos")?.value) ?? 0;
      if (fail > done && done > 0) out.push("Mais falhas que sucessos hoje — investigar worker ou contas.");
      else if (done > 0 && fail === 0) out.push("Execução 100% verde nas últimas 24h.");
      break;
    }
  }
  if (out.length === 0) out.push("Sem alertas no período — etapa silenciosa.");
  return out.slice(0, 4);
}

// =============== Origem dos dados ===============
function buildSources(node: FluxoNodeData): DataSource[] {
  switch (node.id) {
    case "descoberta":
      return [
        { type: "table", name: "search_terms", detail: "termos por gênero" },
        { type: "function", name: "run-search · enrich-playlists" },
        { type: "api", name: "Apify Actor + Spotify Web API" },
        { type: "table", name: "search_results", detail: "playlists brutas" },
      ];
    case "filtro":
      return [
        { type: "table", name: "search_results", detail: "is_valid + validation_reason" },
        { type: "table", name: "genre_filters", detail: "min_followers, blacklist" },
      ];
    case "catalogo":
      return [
        { type: "table", name: "managed_playlists", detail: "ativas + arquivadas" },
      ];
    case "deal":
      return [
        { type: "table", name: "curator_deals", detail: "deals em vigor" },
        { type: "table", name: "curator_deal_songs", detail: "músicas contratadas" },
      ];
    case "execucao":
      return [
        { type: "table", name: "playlist_execution_jobs", detail: "fila de jobs" },
        { type: "api", name: "Spotify Web API", detail: "adicionar faixa" },
      ];
  }
  return [];
}

// =============== Ações rápidas ===============
function buildActions(node: FluxoNodeData): StepAction[] {
  switch (node.id) {
    case "descoberta":
      return [
        { id: "ver-termos", label: "Ver termos", kind: "link", to: "/operacao?tab=termos", variant: "outline" },
        { id: "test-apify", label: "Testar Apify", kind: "invoke", fn: "test-apify", variant: "outline" },
      ];
    case "filtro":
      return [
        { id: "ver-filtros", label: "Ajustar filtros do gênero", kind: "link", to: "/operacao?tab=generos", variant: "outline" },
      ];
    case "catalogo":
      return [
        { id: "ver-catalogo", label: "Abrir catálogo", kind: "link", to: "/operacao?tab=playlists", variant: "outline" },
      ];
    case "deal":
      return [
        { id: "ver-deals", label: "Abrir deals", kind: "link", to: "/deals", variant: "outline" },
      ];
    case "execucao":
      return [
        { id: "ver-fila", label: "Ver fila", kind: "link", to: "/sistema?tab=execucao", variant: "outline" },
      ];
  }
  return [];
}

// =============== Snapshot por sessão ===============
const SNAP_KEY = "fluxo:snap:v2";
type Snap = Record<string, { in: number | null; out: number | null; errors: number; ts: number }>;

function readSnap(): Snap {
  try { return JSON.parse(sessionStorage.getItem(SNAP_KEY) ?? "{}"); } catch { return {}; }
}
function writeSnap(s: Snap) {
  try { sessionStorage.setItem(SNAP_KEY, JSON.stringify(s)); } catch { /* noop */ }
}

export type StepDiff = {
  hasBaseline: boolean;
  baselineAgeMs?: number;
  inDelta?: number | null;
  outDelta?: number | null;
  errorsDelta?: number;
};

export function readStepDiff(node: FluxoNodeData): StepDiff {
  const snap = readSnap();
  const prev = snap[node.id];
  const errsNow = countErrors(node);
  if (!prev) return { hasBaseline: false };
  return {
    hasBaseline: true,
    baselineAgeMs: Date.now() - prev.ts,
    inDelta: node.inputCount != null && prev.in != null ? node.inputCount - prev.in : null,
    outDelta: node.outputCount != null && prev.out != null ? node.outputCount - prev.out : null,
    errorsDelta: errsNow - prev.errors,
  };
}

export function commitStepSnapshot(node: FluxoNodeData) {
  const snap = readSnap();
  const prev = snap[node.id];
  const shouldUpdate = !prev || (Date.now() - prev.ts > 5 * 60 * 1000);
  if (!shouldUpdate) return;
  snap[node.id] = {
    in: node.inputCount ?? null,
    out: node.outputCount ?? null,
    errors: countErrors(node),
    ts: Date.now(),
  };
  writeSnap(snap);
}

export function buildStepIntel(node: FluxoNodeData): StepIntel {
  return {
    health: buildHealth(node),
    insights: buildInsights(node),
    sources: buildSources(node),
    actions: buildActions(node),
  };
}

export function healthBadgeClass(level: HealthLevel): string {
  switch (level) {
    case "excelente": return "bg-success/15 text-success border-success/30";
    case "atencao":   return "bg-warning/15 text-warning border-warning/30";
    case "problema":  return "bg-destructive/15 text-destructive border-destructive/30";
    default:          return "bg-muted text-muted-foreground border-border";
  }
}

export function healthBarClass(level: HealthLevel): string {
  switch (level) {
    case "excelente": return "bg-success";
    case "atencao":   return "bg-warning";
    case "problema":  return "bg-destructive";
    default:          return "bg-muted-foreground/40";
  }
}
