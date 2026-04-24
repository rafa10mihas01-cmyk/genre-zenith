// fluxoInsights — camada de inteligência por etapa do pipeline.
// Recebe o FluxoNodeData (já calculado) e devolve diagnóstico humano:
// saúde, insights automáticos, ações rápidas e fonte dos dados.
// Puro: sem side effects, sem chamadas de rede.
import type { FluxoNodeData, FluxoNodeId, KV } from "./types";

export type HealthLevel = "excelente" | "atencao" | "problema" | "neutro";

export type StepHealth = {
  level: HealthLevel;
  label: string;        // "Excelente" | "Atenção" | "Problema" | "Sem sinal"
  score: number;        // 0-100
  reasons: string[];    // bullets curtos justificando a nota
};

export type StepAction = {
  id: string;
  label: string;
  kind: "link" | "invoke" | "scroll" | "copy";
  // Para "link":
  to?: string;
  // Para "invoke":
  fn?: string;
  payload?: Record<string, unknown>;
  // Para "scroll":
  selector?: string;
  // Para "copy":
  text?: string;
  // visual
  variant?: "default" | "outline" | "ghost" | "destructive";
  hint?: string;
};

export type DataSource = {
  type: "table" | "function" | "api" | "storage";
  name: string;       // ex: "autopilot_runs", "run-search", "Spotify Web API"
  detail?: string;    // ex: "filtrado por genre_id"
};

export type StepIntel = {
  health: StepHealth;
  insights: string[];      // frases inteligentes
  sources: DataSource[];   // de onde vieram os dados
  actions: StepAction[];   // botões
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

  // Ajuste por volume de erros/warnings
  if (errors > 0 && base !== "problema") base = "problema";
  else if (warnings > 0 && base === "excelente") base = "atencao";

  // Heurísticas específicas por nó
  const reasons: string[] = [];
  let score = base === "excelente" ? 90 : base === "atencao" ? 60 : base === "problema" ? 25 : 50;

  switch (node.id) {
    case "spotify": {
      const termos = num(findKV(node.details.variables, "Termos cadastrados")?.value);
      const tokenStatus = String(findKV(node.details.variables, "Token Spotify")?.value ?? "");
      if (tokenStatus.includes("válido")) reasons.push("Token Spotify válido");
      else { reasons.push("Token Spotify com problema"); score -= 30; }
      if (termos != null) {
        if (termos >= 30) { reasons.push(`${termos} termos cadastrados — volume saudável`); score = Math.max(score, 90); }
        else if (termos >= 10) { reasons.push(`${termos} termos — pouco para diversidade ideal (30+)`); base = base === "excelente" ? "atencao" : base; score = Math.min(score, 70); }
        else { reasons.push(`Apenas ${termos} termos — abaixo do mínimo recomendado`); base = "problema"; score = Math.min(score, 40); }
      }
      if (errors === 0) reasons.push("Sem erros de autenticação nas últimas 24h");
      break;
    }
    case "coleta": {
      const brutas = num(node.outputCount);
      const erros24 = num(findKV(node.details.quality, "Erros de coleta")?.value) ?? 0;
      const aprov = String(findKV(node.details.quality, "Aproveitamento")?.value ?? "");
      const aprovPct = parseFloat(aprov);
      if (brutas != null) reasons.push(`${brutas} playlists brutas coletadas`);
      if (erros24 === 0) reasons.push("Coleta sem erros nas últimas 24h");
      else { reasons.push(`${erros24} erros de coleta nas últimas 24h`); base = base === "excelente" ? "atencao" : base; score -= 10 * erros24; }
      if (Number.isFinite(aprovPct)) {
        if (aprovPct >= 90) reasons.push(`Aproveitamento alto (${aprov}) — Apify estável`);
        else if (aprovPct < 60) { reasons.push(`Aproveitamento baixo (${aprov}) — investigar Apify`); base = "atencao"; score -= 15; }
      }
      break;
    }
    case "filtro": {
      const aprov = num(node.outputCount) ?? 0;
      const desc = num(findKV(node.details.output, "descartadas")?.value) ?? 0;
      const taxa = num(String(findKV(node.details.output, "Taxa de aprovação")?.value).replace("%", ""));
      const total = aprov + desc;
      if (total > 0 && taxa != null) {
        if (taxa >= 60) { reasons.push(`Taxa de aprovação saudável (${taxa}%)`); score = Math.max(score, 85); }
        else if (taxa >= 30) { reasons.push(`Taxa de aprovação média (${taxa}%) — dá pra afinar`); }
        else { reasons.push(`Taxa de aprovação baixa (${taxa}%) — filtro apertado ou termos ruins`); base = "atencao"; score = Math.min(score, 55); }
      } else if (total === 0) {
        reasons.push("Sem dados — coleta ainda não rodou para esse gênero");
        base = "neutro"; score = 50;
      }
      break;
    }
    case "cerebro": {
      const errs = num(findKV(node.details.quality, "Erros de IA")?.value) ?? 0;
      const sucs = num(findKV(node.details.quality, "Sucessos de IA")?.value) ?? 0;
      if (errs === 0 && sucs > 0) reasons.push(`${sucs} sucessos de IA · 0 erros`);
      else if (errs > 0) { reasons.push(`${errs} erros de IA — verificar créditos ou prompt`); base = "atencao"; score -= 15; }
      const cache = String(findKV(node.details.variables, "Cache reutilizado")?.value ?? "");
      if (cache && !cache.includes("nenhum")) reasons.push(`Cache aproveitado: ${cache}`);
      break;
    }
    case "templates": {
      const tg = num(node.inputCount) ?? 0;
      const ta = num(node.outputCount) ?? 0;
      const taxa = tg > 0 ? Math.round((ta / tg) * 100) : null;
      if (tg === 0) { reasons.push("Nenhum template gerado nesta execução"); base = "neutro"; score = 50; }
      else if (taxa != null) {
        if (taxa >= 50) { reasons.push(`${ta}/${tg} aprovados (${taxa}%) — produção forte`); score = Math.max(score, 85); }
        else if (taxa >= 20) { reasons.push(`${taxa}% aprovados — qualidade média`); base = "atencao"; }
        else { reasons.push(`Apenas ${taxa}% aprovados — blueprints fracos`); base = "atencao"; score = Math.min(score, 50); }
      }
      const hot = num(findKV(node.details.output, "Hot")?.value);
      if (hot != null && hot > 0) reasons.push(`${hot} templates hot existentes no gênero`);
      break;
    }
    case "capas": {
      const cg = num(node.outputCount) ?? 0;
      const pend = num(findKV(node.details.output, "pendentes")?.value) ?? 0;
      const errs = num(findKV(node.details.quality, "Erros de capa")?.value) ?? 0;
      if (cg > 0) reasons.push(`${cg} capas geradas`);
      if (pend > 0) { reasons.push(`${pend} templates aguardando capa`); if (base === "excelente") base = "atencao"; }
      if (errs === 0) reasons.push("Geração de imagem estável");
      else if (errs > 5) { reasons.push(`${errs} falhas de capa — modelo instável`); base = "atencao"; }
      break;
    }
    case "playlist": {
      const noAr = num(node.outputCount) ?? 0;
      const cap = String(findKV(node.details.variables, "Capacidade usada")?.value ?? "");
      const m = cap.match(/(\d+)\/(\d+)\s*\((\d+)%/);
      if (m) {
        const usedPct = parseInt(m[3], 10);
        if (usedPct >= 90) { reasons.push(`Capacidade quase cheia (${usedPct}%) — adicionar conta`); base = "problema"; score = Math.min(score, 35); }
        else if (usedPct >= 70) { reasons.push(`Capacidade em ${usedPct}% — monitorar`); if (base === "excelente") base = "atencao"; }
        else reasons.push(`Capacidade saudável (${usedPct}%)`);
      }
      if (noAr > 0) reasons.push(`${noAr} playlists no ar`);
      else { reasons.push("Nenhuma playlist publicada nesta janela"); base = base === "excelente" ? "atencao" : base; }
      break;
    }
  }

  // Normaliza
  score = Math.max(0, Math.min(100, score));
  const labelMap: Record<HealthLevel, string> = {
    excelente: "Excelente",
    atencao: "Atenção",
    problema: "Problema",
    neutro: "Sem sinal",
  };
  return {
    level: base,
    label: labelMap[base],
    score,
    reasons: reasons.slice(0, 4),
  };
}

// =============== Insights automáticos ===============
function buildInsights(node: FluxoNodeData): string[] {
  const out: string[] = [];
  const errors = countErrors(node);

  switch (node.id) {
    case "spotify": {
      const termos = num(findKV(node.details.variables, "Termos cadastrados")?.value);
      const tokenStatus = String(findKV(node.details.variables, "Token Spotify")?.value ?? "");
      if (termos != null) {
        if (termos < 30) out.push(`Poucos termos para esse gênero (${termos}). Ideal: 30+ para boa diversidade.`);
        else if (termos >= 50) out.push(`Excelente cobertura: ${termos} termos cadastrados.`);
      }
      if (tokenStatus.includes("válido") && errors === 0) out.push("Token estável sem falhas nas últimas 24h.");
      if (errors === 0) out.push("Sem erros de autenticação no período analisado.");
      break;
    }
    case "coleta": {
      const brutas = num(node.outputCount) ?? 0;
      const media = num(findKV(node.details.output, "Média por termo")?.value) ?? 0;
      const erros = num(findKV(node.details.quality, "Erros de coleta")?.value) ?? 0;
      if (media > 0) out.push(`Apify devolveu em média ${media} playlists por termo.`);
      if (brutas > 500) out.push(`Volume bruto alto (${brutas}) — IA terá amostra rica.`);
      else if (brutas < 50 && brutas > 0) out.push(`Coleta enxuta (${brutas} playlists) — pode faltar variedade.`);
      if (erros === 0) out.push("Apify rodou sem nenhum erro no período.");
      break;
    }
    case "filtro": {
      const taxa = num(String(findKV(node.details.output, "Taxa de aprovação")?.value ?? "").replace("%", ""));
      const media = num(findKV(node.details.quality, "Média de seguidores")?.value);
      if (taxa != null) {
        if (taxa < 20) out.push("Taxa de aprovação muito baixa — talvez o min_followers esteja alto demais ou termos pegando muito lixo.");
        else if (taxa >= 70) out.push("Filtro está bem calibrado — quase tudo que entra passa.");
      }
      if (media != null && media > 50000) out.push(`Playlists válidas têm média de ${media.toLocaleString("pt-BR")} seguidores — público forte.`);
      break;
    }
    case "cerebro": {
      const cache = String(findKV(node.details.variables, "Cache reutilizado")?.value ?? "");
      const errs = num(findKV(node.details.quality, "Erros de IA")?.value) ?? 0;
      if (cache && !cache.includes("nenhum")) out.push(`Cache aproveitado em: ${cache} — economizou tempo e créditos.`);
      else out.push("Rodada nova sem cache — pode demorar um pouco mais.");
      if (errs === 0) out.push("IA respondeu 100% das chamadas sem erro.");
      break;
    }
    case "templates": {
      const tg = num(node.inputCount) ?? 0;
      const ta = num(node.outputCount) ?? 0;
      const hot = num(findKV(node.details.output, "Hot")?.value);
      if (tg > 0) {
        const taxa = Math.round((ta / tg) * 100);
        if (taxa >= 60) out.push(`Aproveitamento alto: ${taxa}% dos templates passaram no score.`);
        else if (taxa < 30) out.push(`Apenas ${taxa}% aprovados — vale revisar briefings ou aumentar amostra.`);
      }
      if (hot != null && hot > 5) out.push(`${hot} templates hot disponíveis para replicação.`);
      break;
    }
    case "capas": {
      const cg = num(node.outputCount) ?? 0;
      const pend = num(findKV(node.details.output, "pendentes")?.value) ?? 0;
      if (pend > 0) out.push(`${pend} templates aprovados sem capa — fila parada?`);
      if (cg > 0) out.push("Geração de imagem com marca d'água rodando normalmente.");
      break;
    }
    case "playlist": {
      const cap = String(findKV(node.details.variables, "Capacidade usada")?.value ?? "");
      const m = cap.match(/(\d+)\/(\d+)\s*\((\d+)%/);
      if (m) {
        const used = parseInt(m[1], 10);
        const max = parseInt(m[2], 10);
        const free = max - used;
        if (free <= 5) out.push(`Apenas ${free} slots livres — adicionar nova conta Spotify em breve.`);
        else out.push(`${free} slots de playlist disponíveis nas contas ativas.`);
      }
      const txSucesso = String(findKV(node.details.quality, "Taxa de sucesso")?.value ?? "");
      if (txSucesso.startsWith("100")) out.push("Publicações com 100% de sucesso nas últimas 24h.");
      break;
    }
  }

  if (out.length === 0) out.push("Sem insights relevantes no período — etapa silenciosa.");
  return out.slice(0, 4);
}

// =============== Origem dos dados por nó ===============
function buildSources(node: FluxoNodeData): DataSource[] {
  switch (node.id) {
    case "spotify":
      return [
        { type: "table", name: "spotify_tokens", detail: "token de aplicação (singleton)" },
        { type: "table", name: "search_terms", detail: "termos cadastrados por gênero" },
        { type: "function", name: "spotify-token-watchdog", detail: "renovação automática horária" },
      ];
    case "coleta":
      return [
        { type: "api", name: "Apify Actor (Spotify Scraper)", detail: "raspagem de playlists" },
        { type: "function", name: "run-search", detail: "dispara o actor por termo" },
        { type: "function", name: "enrich-playlists", detail: "seguidores reais via Spotify API" },
        { type: "table", name: "search_results", detail: "playlists brutas coletadas" },
      ];
    case "filtro":
      return [
        { type: "table", name: "search_results", detail: "is_valid + validation_reason" },
        { type: "table", name: "genre_filters", detail: "min_followers, blacklist, max_playlists" },
      ];
    case "cerebro":
      return [
        { type: "function", name: "analyze-genre / generate-briefing / extract-blueprints" },
        { type: "table", name: "genre_models · playlist_briefings · playlist_blueprints" },
        { type: "api", name: "Lovable AI Gateway", detail: "Gemini + Claude" },
      ];
    case "templates":
      return [
        { type: "function", name: "generate-templates · score-templates" },
        { type: "table", name: "playlist_templates", detail: "status + quality_tier + final_score" },
      ];
    case "capas":
      return [
        { type: "function", name: "generate-cover-variations" },
        { type: "storage", name: "playlist-covers (bucket público)" },
        { type: "api", name: "Gemini 2.5 Flash Image", detail: "geração visual" },
      ];
    case "playlist":
      return [
        { type: "function", name: "create-spotify-playlist" },
        { type: "api", name: "Spotify Web API", detail: "POST /users/{id}/playlists" },
        { type: "table", name: "accounts", detail: "controle de capacidade por conta" },
      ];
  }
}

// =============== Ações rápidas por nó ===============
function buildActions(node: FluxoNodeData): StepAction[] {
  const common: StepAction[] = [
    {
      id: "logs",
      label: "Ver feed completo",
      kind: "scroll",
      selector: "#feed-ao-vivo",
      variant: "ghost",
    },
  ];

  switch (node.id) {
    case "spotify":
      return [
        { id: "ver-termos", label: "Ver termos", kind: "link", to: "/operacao?tab=termos", variant: "outline" },
        { id: "add-termos", label: "Adicionar termos", kind: "link", to: "/operacao?tab=termos&action=novo", variant: "outline" },
        { id: "refresh-token", label: "Forçar refresh do token", kind: "invoke", fn: "spotify-token-watchdog", payload: { force: true }, variant: "default", hint: "Renova mesmo que ainda não tenha expirado" },
        ...common,
      ];
    case "coleta":
      return [
        { id: "test-apify", label: "Testar Apify agora", kind: "invoke", fn: "test-apify", variant: "default" },
        { id: "ver-resultados", label: "Ver coleta", kind: "scroll", selector: "[data-tab='coleta']", variant: "outline" },
        ...common,
      ];
    case "filtro":
      return [
        { id: "ver-filtros", label: "Ajustar filtros do gênero", kind: "link", to: "/operacao?tab=generos", variant: "outline" },
        { id: "revalidar", label: "Revalidar dataset", kind: "invoke", fn: "revalidate-dataset", variant: "outline" },
        ...common,
      ];
    case "cerebro":
      return [
        { id: "rodar-cerebro", label: "Rodar análise do gênero", kind: "invoke", fn: "analyze-genre", variant: "default" },
        { id: "ver-cerebro", label: "Abrir Cérebro", kind: "link", to: "/cerebro", variant: "outline" },
        ...common,
      ];
    case "templates":
      return [
        { id: "ver-criacao", label: "Abrir Criação", kind: "link", to: "/criacao", variant: "outline" },
        { id: "expirar", label: "Expirar templates parados", kind: "invoke", fn: "expire-stale-templates", variant: "ghost" },
        ...common,
      ];
    case "capas":
      return [
        { id: "ver-criacao", label: "Ver capas em Criação", kind: "link", to: "/criacao?tab=capas", variant: "outline" },
        { id: "rewatermark", label: "Reaplicar marca d'água", kind: "invoke", fn: "rewatermark-existing-covers", variant: "ghost" },
        ...common,
      ];
    case "playlist":
      return [
        { id: "ver-contas", label: "Gerenciar contas", kind: "link", to: "/operacao?tab=contas", variant: "outline" },
        { id: "ver-performance", label: "Abrir Performance", kind: "link", to: "/performance", variant: "outline" },
        ...common,
      ];
  }
}

// =============== Comparação leve (snapshot por sessão) ===============
const SNAP_KEY = "fluxo:snap:v1";

type Snap = Record<string, { in: number | null; out: number | null; errors: number; ts: number }>;

function readSnap(): Snap {
  try {
    return JSON.parse(sessionStorage.getItem(SNAP_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function writeSnap(s: Snap) {
  try {
    sessionStorage.setItem(SNAP_KEY, JSON.stringify(s));
  } catch { /* noop */ }
}

export type StepDiff = {
  hasBaseline: boolean;
  baselineAgeMs?: number;
  inDelta?: number | null;
  outDelta?: number | null;
  errorsDelta?: number;
};

/** Lê diff vs snapshot anterior. NÃO grava (use commit separado para evitar race). */
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

/** Grava snapshot para esse nó (chame ao abrir o drawer pela primeira vez). */
export function commitStepSnapshot(node: FluxoNodeData) {
  const snap = readSnap();
  // Só grava se não existe baseline ainda OU se já passou mais de 5 min
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

// =============== API pública ===============
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
