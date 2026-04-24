// buildFluxo — transforma dados crus (autopilot_run + logs + ajustes + search_results)
// em uma estrutura visual com 7 nós, status, input/output, regras e logs por etapa.
import {
  Music2, Download, Filter, Brain, FileText, Image as ImageIcon, ListMusic,
} from "lucide-react";
import type { FluxoNodeData, FluxoRun, NodeStatus } from "./types";

type RawLog = {
  id: string;
  acao: string;
  status: string;
  mensagem: string | null;
  duracao_ms: number | null;
  created_at: string;
  genre_id: string | null;
};

type RawAdjust = {
  id: string;
  action_type: string;
  status: string;
  error_message: string | null;
  created_at: string;
  triggered_by: string;
};

type RawSearchStats = {
  termsCount: number;
  rawPlaylists: number;
  validPlaylists: number;
  invalidPlaylists: number;
  publishedPlaylists: number;
};

const STEP_ORDER = ["analyze", "briefing", "blueprints", "templates", "covers", "approve", "replicate"];

/** Calcula duração de uma etapa do autopilot olhando steps_completed em ordem. */
function stepDuration(run: FluxoRun, step: string): number | null {
  const steps = run.stepsCompleted ?? [];
  const idx = steps.findIndex((s) => s.step === step);
  if (idx === -1) return null;
  const at = new Date(steps[idx].at).getTime();
  const prev = idx === 0 ? new Date(run.startedAt).getTime() : new Date(steps[idx - 1].at).getTime();
  return Math.max(0, at - prev);
}

function isStepDone(run: FluxoRun, step: string): boolean {
  return (run.stepsCompleted ?? []).some((s) => s.step === step);
}

function isStepActive(run: FluxoRun, step: string): boolean {
  return run.status === "running" && run.currentStep === step;
}

/** Status agregado de uma faixa de etapas do autopilot. */
function aggregateStatus(run: FluxoRun, steps: string[]): NodeStatus {
  if (run.status === "error" && steps.includes(run.currentStep ?? "")) return "error";
  if (steps.some((s) => isStepActive(run, s))) return "running";
  if (steps.every((s) => isStepDone(run, s))) return "success";
  if (steps.some((s) => isStepDone(run, s))) return "running";
  return "idle";
}

function fmtTime(durationMs: number | null | undefined): string | undefined {
  if (durationMs == null) return undefined;
  const s = Math.floor(durationMs / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m${(s % 60).toString().padStart(2, "0")}s`;
}

export function buildFluxoNodes(opts: {
  run: FluxoRun | null;
  logs: RawLog[];
  adjusts: RawAdjust[];
  searchStats: RawSearchStats;
  apifyBlocked: { blocked: boolean; reason?: string };
}): FluxoNodeData[] {
  const { run, logs, adjusts, searchStats, apifyBlocked } = opts;

  // --- Helper para filtrar logs por ação ---
  const logsByAction = (actions: string[]) =>
    logs.filter((l) => actions.some((a) => l.acao?.includes(a)));

  // ============ NÓ 1: SPOTIFY (origem) ============
  const spotifyLogs = logsByAction(["spotify_token", "spotify-auth"]);
  const tokenError = spotifyLogs.find((l) => l.status === "error");
  const node1: FluxoNodeData = {
    id: "spotify",
    label: "Spotify",
    shortLabel: "Origem",
    icon: Music2,
    status: tokenError ? "error" : "success",
    inputCount: undefined,
    outputCount: searchStats.termsCount,
    description: `${searchStats.termsCount} termos de busca`,
    details: {
      input: [{ label: "Gêneros configurados", value: "ativos no sistema" }],
      output: [{ label: "Termos de busca prontos", value: searchStats.termsCount }],
      rules: ["Token Spotify revalidado a cada hora", "Termos vêm de search_terms (curados + automáticos)"],
      logs: spotifyLogs.slice(0, 10).map((l) => ({
        ts: l.created_at, status: l.status, message: l.mensagem ?? l.acao, durationMs: l.duracao_ms,
      })),
      errors: tokenError ? [tokenError.mensagem ?? "Erro no token Spotify"] : [],
    },
  };

  // ============ NÓ 2: COLETA (Apify) ============
  const coletaLogs = logsByAction(["run-search", "enrich-playlists", "fetch-tracks", "test-apify"]);
  const coletaErrors = coletaLogs.filter((l) => l.status === "error");
  const coletaRunning = coletaLogs.find((l) => l.status === "running");
  let coletaStatus: NodeStatus = "success";
  if (apifyBlocked.blocked) coletaStatus = "error";
  else if (coletaRunning) coletaStatus = "running";
  else if (coletaErrors.length > 0 && coletaLogs.length < 3) coletaStatus = "warning";
  const node2: FluxoNodeData = {
    id: "coleta",
    label: "Coleta",
    shortLabel: "Apify",
    icon: Download,
    status: coletaStatus,
    inputCount: searchStats.termsCount,
    outputCount: searchStats.rawPlaylists,
    description: apifyBlocked.blocked ? "Apify bloqueado" : `${searchStats.rawPlaylists} playlists brutas`,
    details: {
      input: [{ label: "Termos pesquisados", value: searchStats.termsCount }],
      output: [
        { label: "Playlists encontradas", value: searchStats.rawPlaylists },
        { label: "Tentativas de coleta (24h)", value: coletaLogs.length },
      ],
      rules: [
        "Usa Apify Actor para buscar playlists no Spotify",
        "Enriquece com seguidores reais via Spotify API",
        "Backoff automático em caso de erro 429",
      ],
      logs: coletaLogs.slice(0, 15).map((l) => ({
        ts: l.created_at, status: l.status, message: l.mensagem ?? l.acao, durationMs: l.duracao_ms,
      })),
      errors: apifyBlocked.blocked
        ? [apifyBlocked.reason ?? "Apify temporariamente bloqueado"]
        : coletaErrors.slice(0, 3).map((e) => e.mensagem ?? "Erro de coleta"),
    },
  };

  // ============ NÓ 3: FILTRO ============
  const filterPct = searchStats.rawPlaylists > 0
    ? Math.round((searchStats.validPlaylists / searchStats.rawPlaylists) * 100)
    : 0;
  const node3: FluxoNodeData = {
    id: "filtro",
    label: "Filtro",
    shortLabel: "Qualidade",
    icon: Filter,
    status: searchStats.rawPlaylists > 0 ? "success" : "idle",
    inputCount: searchStats.rawPlaylists,
    outputCount: searchStats.validPlaylists,
    description: `${filterPct}% aprovadas`,
    details: {
      input: [{ label: "Playlists brutas", value: searchStats.rawPlaylists }],
      output: [
        { label: "Aprovadas", value: searchStats.validPlaylists },
        { label: "Descartadas", value: searchStats.invalidPlaylists },
        { label: "Taxa de aprovação", value: `${filterPct}%` },
      ],
      rules: [
        "Mínimo de seguidores configurado por gênero (genre_filters.min_followers)",
        "Blacklist de termos: workout, gym, sleep, study, lofi, edm, etc.",
        "Limite máximo de playlists por gênero (genre_filters.max_playlists)",
        "Validação de tema (palavras-chave do gênero)",
      ],
      logs: [],
      errors: [],
    },
  };

  // ============ NÓ 4: CÉREBRO (IA) ============
  const cerebroSteps = ["analyze", "briefing", "blueprints"];
  const cerebroStatus: NodeStatus = run ? aggregateStatus(run, cerebroSteps) : "idle";
  const cerebroDuration = run
    ? cerebroSteps.reduce((acc, s) => acc + (stepDuration(run, s) ?? 0), 0)
    : 0;
  const cerebroLogs = logsByAction(["analyze-genre", "generate-briefing", "extract-blueprints", "analyze-visual-dna"]);
  const node4: FluxoNodeData = {
    id: "cerebro",
    label: "Cérebro",
    shortLabel: "IA",
    icon: Brain,
    status: cerebroStatus,
    durationMs: cerebroDuration > 0 ? cerebroDuration : null,
    inputCount: searchStats.validPlaylists,
    outputCount: run?.templatesGenerated ?? 0,
    description: cerebroStatus === "running"
      ? `Etapa: ${run?.currentStep ?? "—"}`
      : cerebroStatus === "success"
      ? "Análise concluída"
      : "Aguardando",
    details: {
      input: [
        { label: "Playlists válidas", value: searchStats.validPlaylists },
        { label: "Cache reaproveitado", value: Object.values(run?.cacheHits ?? {}).filter(Boolean).length },
      ],
      output: [
        { label: "Briefings gerados", value: run?.cacheHits?.briefing ? "cache" : "novos" },
        { label: "Blueprints extraídos", value: run?.cacheHits?.blueprints ? "cache" : "novos" },
      ],
      rules: [
        "Analyze: extrai padrões de nomenclatura, mood, formato e DNA visual",
        "Briefing: gera direção criativa com base nas playlists vencedoras",
        "Blueprints: define moldes replicáveis (tier hot/medium/weak)",
        "Modelo IA: Lovable AI Gateway (Gemini 2.5 + Claude)",
      ],
      logs: cerebroLogs.slice(0, 15).map((l) => ({
        ts: l.created_at, status: l.status, message: l.mensagem ?? l.acao, durationMs: l.duracao_ms,
      })),
      errors: run?.errorMessage && cerebroSteps.includes(run.currentStep ?? "") ? [run.errorMessage] : [],
    },
  };

  // ============ NÓ 5: TEMPLATES ============
  const templStatus: NodeStatus = run ? aggregateStatus(run, ["templates"]) : "idle";
  const templLogs = logsByAction(["generate-templates", "score-templates"]);
  const node5: FluxoNodeData = {
    id: "templates",
    label: "Templates",
    shortLabel: "Geração",
    icon: FileText,
    status: templStatus,
    durationMs: run ? stepDuration(run, "templates") : null,
    inputCount: run?.templatesGenerated ?? 0,
    outputCount: run?.templatesApproved ?? 0,
    description: `${run?.templatesGenerated ?? 0} gerados · ${run?.templatesApproved ?? 0} aprovados`,
    details: {
      input: [{ label: "Briefings disponíveis", value: "do cérebro" }],
      output: [
        { label: "Templates gerados", value: run?.templatesGenerated ?? 0 },
        { label: "Templates aprovados", value: run?.templatesApproved ?? 0 },
        { label: "Score médio", value: "calculado por IA" },
      ],
      rules: [
        "Cada template = nome + descrição + 50 faixas-semente + capa",
        "Score final 0-100 (IA + regras de replicação)",
        "Tier hot (>75) · medium (50-75) · weak (<50)",
        "Auto-aprovação para tier hot, demais aguardam revisão",
      ],
      logs: templLogs.slice(0, 10).map((l) => ({
        ts: l.created_at, status: l.status, message: l.mensagem ?? l.acao, durationMs: l.duracao_ms,
      })),
      errors: run?.errorMessage && run.currentStep === "templates" ? [run.errorMessage] : [],
    },
  };

  // ============ NÓ 6: CAPAS ============
  const capasStatus: NodeStatus = run ? aggregateStatus(run, ["covers"]) : "idle";
  const capasLogs = logsByAction(["generate-cover", "rewatermark"]);
  const node6: FluxoNodeData = {
    id: "capas",
    label: "Capas",
    shortLabel: "IA Visual",
    icon: ImageIcon,
    status: capasStatus,
    durationMs: run ? stepDuration(run, "covers") : null,
    inputCount: run?.templatesApproved ?? 0,
    outputCount: run?.coversGenerated ?? 0,
    description: `${run?.coversGenerated ?? 0} capas geradas`,
    details: {
      input: [{ label: "Templates aprovados", value: run?.templatesApproved ?? 0 }],
      output: [
        { label: "Capas geradas", value: run?.coversGenerated ?? 0 },
        { label: "Marca d'água aplicada", value: "automática" },
      ],
      rules: [
        "Geração via Gemini 2.5 Flash Image (preview)",
        "Briefing visual extraído do DNA do gênero",
        "Watermark NexEngine aplicada antes do upload",
        "Bucket: playlist-covers (público)",
      ],
      logs: capasLogs.slice(0, 10).map((l) => ({
        ts: l.created_at, status: l.status, message: l.mensagem ?? l.acao, durationMs: l.duracao_ms,
      })),
      errors: run?.errorMessage && run.currentStep === "covers" ? [run.errorMessage] : [],
    },
  };

  // ============ NÓ 7: PLAYLIST (publicação) ============
  const pubLogs = logsByAction(["create-spotify-playlist", "replicate-top"]);
  const pubErrors = pubLogs.filter((l) => l.status === "error");
  const pubStatus: NodeStatus = pubErrors.length > 0
    ? "warning"
    : searchStats.publishedPlaylists > 0
    ? "success"
    : "idle";
  const node7: FluxoNodeData = {
    id: "playlist",
    label: "Playlist",
    shortLabel: "No Spotify",
    icon: ListMusic,
    status: pubStatus,
    inputCount: run?.templatesApproved ?? 0,
    outputCount: searchStats.publishedPlaylists,
    description: `${searchStats.publishedPlaylists} no ar`,
    details: {
      input: [{ label: "Templates prontos", value: run?.templatesApproved ?? 0 }],
      output: [
        { label: "Playlists publicadas", value: searchStats.publishedPlaylists },
        { label: "Tentativas (24h)", value: pubLogs.length },
        { label: "Erros (24h)", value: pubErrors.length },
      ],
      rules: [
        "Cria playlist via Spotify Web API (POST /users/{id}/playlists)",
        "Adiciona faixas em lotes de 100",
        "Faz upload da capa (max 256kb JPEG)",
        "Distribui entre contas com capacidade (current < max)",
      ],
      logs: pubLogs.slice(0, 15).map((l) => ({
        ts: l.created_at, status: l.status, message: l.mensagem ?? l.acao, durationMs: l.duracao_ms,
      })),
      errors: pubErrors.slice(0, 3).map((e) => e.mensagem ?? "Erro ao publicar"),
    },
  };

  return [node1, node2, node3, node4, node5, node6, node7];
}
