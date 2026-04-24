// buildFluxo — transforma dados crus em 7 nós ricos com:
// summary, variables, process, decisions, output, quality, alerts, logs.
// Cada etapa tem CONTEÚDO ESPECÍFICO, em PT-BR claro.
import {
  Music2, Download, Filter, Brain, FileText, Image as ImageIcon, ListMusic,
} from "lucide-react";
import type {
  FluxoNodeData, FluxoRun, NodeStatus, LogPretty, KV, DecisionItem, AlertItem,
} from "./types";

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
  avgFollowersValid?: number | null;
  templatesTotal?: number;
  templatesHot?: number;
  templatesMedium?: number;
  templatesWeak?: number;
};

type GenreFilter = {
  min_followers: number | null;
  max_playlists: number | null;
  min_daily: number | null;
  base_daily: number | null;
  max_daily: number | null;
  briefing_mode: string | null;
  blacklist: string[] | null;
};

type AccountStat = {
  total: number;
  active: number;
  capacityUsed: number;   // soma de current_playlists
  capacityMax: number;    // soma de max_playlists
};

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

function aggregateStatus(run: FluxoRun, steps: string[]): NodeStatus {
  if (run.status === "error" && steps.includes(run.currentStep ?? "")) return "error";
  if (steps.some((s) => isStepActive(run, s))) return "running";
  if (steps.every((s) => isStepDone(run, s))) return "success";
  if (steps.some((s) => isStepDone(run, s))) return "running";
  return "idle";
}

// =============== Tradutor de logs técnicos → PT-BR humano ===============
function prettyLog(action: string, message: string, status: string): string {
  const a = (action || "").toLowerCase();
  const m = message || "";

  // Tabela de traduções por padrão de ação
  if (a.includes("spotify_token") || a.includes("spotify-auth")) {
    if (status === "error") return "Falha ao renovar token do Spotify — automação pausada até resolver.";
    return "Token do Spotify renovado com sucesso (válido por 1 hora).";
  }
  if (a.includes("run-search")) {
    if (status === "error") return "Apify falhou ao buscar playlists. Sistema vai tentar de novo.";
    if (status === "running") return "Apify rodando: buscando playlists no Spotify para um termo.";
    return `Apify trouxe playlists novas para análise. ${m}`.trim();
  }
  if (a.includes("enrich-playlists")) {
    if (status === "error") return "Falha ao buscar seguidores reais via Spotify API.";
    return "Playlists enriquecidas com seguidores reais (não mais o número estimado pelo Apify).";
  }
  if (a.includes("fetch-tracks")) {
    return "Faixas das playlists baixadas para análise (nome, artista, posição).";
  }
  if (a.includes("test-apify")) {
    return status === "error" ? "Teste de saúde do Apify falhou." : "Apify respondeu — está saudável.";
  }
  if (a.includes("analyze-genre") || a.includes("analyze-visual-dna")) {
    if (status === "error") return "IA falhou ao analisar o gênero. Pode ser limite de créditos ou modelo fora.";
    return "IA analisou padrões do gênero (palavras, mood, capas).";
  }
  if (a.includes("generate-briefing") || a.includes("playlists-briefing")) {
    return "Briefing criativo gerado pela IA — virá direção para os templates.";
  }
  if (a.includes("extract-blueprints")) {
    return "Moldes (blueprints) extraídos das playlists vencedoras.";
  }
  if (a.includes("generate-templates")) {
    if (status === "error") return "IA falhou ao gerar templates. Verificar prompt ou créditos.";
    return "Templates de playlist gerados (nome + descrição + 50 faixas).";
  }
  if (a.includes("score-templates")) {
    return "Templates pontuados (0-100). Só os melhores viram playlist.";
  }
  if (a.includes("generate-cover")) {
    if (status === "error") return "Falha ao gerar capa via IA.";
    return "Capa criada por IA, com marca d'água NexEngine.";
  }
  if (a.includes("rewatermark")) {
    return "Marca d'água re-aplicada em capas existentes.";
  }
  if (a.includes("create-spotify-playlist")) {
    if (status === "error") return "Falha ao criar playlist no Spotify (rate limit, conta cheia ou token).";
    return "Playlist publicada no Spotify e disponível para os ouvintes.";
  }
  if (a.includes("replicate-top")) {
    return "Top playlists replicadas em outras contas.";
  }
  if (a.includes("auto-adjust")) {
    return "Ajuste automático aplicado em playlist de baixa performance.";
  }
  // Fallback
  return m || `Evento técnico: ${action}`;
}

function toPrettyLogs(logs: RawLog[], limit = 15): LogPretty[] {
  return logs.slice(0, limit).map((l) => ({
    ts: l.created_at,
    status: l.status,
    raw: l.mensagem ?? l.acao,
    pretty: prettyLog(l.acao, l.mensagem ?? "", l.status),
    durationMs: l.duracao_ms,
  }));
}

function pct(n: number, d: number): number {
  return d > 0 ? Math.round((n / d) * 100) : 0;
}

// =============== Builder principal ===============
export function buildFluxoNodes(opts: {
  run: FluxoRun | null;
  logs: RawLog[];
  adjusts: RawAdjust[];
  searchStats: RawSearchStats;
  apifyBlocked: { blocked: boolean; reason?: string };
  genreFilter?: GenreFilter | null;
  accountStat?: AccountStat | null;
}): FluxoNodeData[] {
  const { run, logs, adjusts, searchStats, apifyBlocked, genreFilter, accountStat } = opts;

  const logsByAction = (actions: string[]) =>
    logs.filter((l) => actions.some((a) => (l.acao ?? "").includes(a)));

  // ============ NÓ 1: SPOTIFY (origem) ============
  const spotifyLogs = logsByAction(["spotify_token", "spotify-auth", "watchdog"]);
  const tokenError = spotifyLogs.find((l) => l.status === "error");
  const tokenOk = spotifyLogs.find((l) => l.status === "success");

  const node1: FluxoNodeData = {
    id: "spotify",
    label: "Spotify",
    shortLabel: "Origem",
    icon: Music2,
    status: tokenError ? "error" : "success",
    outputCount: searchStats.termsCount,
    description: `${searchStats.termsCount} termos prontos`,
    details: {
      summary:
        "Ponto de partida: o sistema autentica no Spotify e prepara a lista de termos de busca que serão usados para descobrir playlists.",
      variables: [
        { label: "Gênero focado", value: run?.genreName ?? "—" },
        { label: "Termos cadastrados (search_terms)", value: searchStats.termsCount },
        { label: "Token Spotify", value: tokenError ? "expirado/erro" : "válido" },
        { label: "Renovação automática", value: "a cada hora (watchdog)" },
      ],
      process: [
        "Verifica se o token de acesso ao Spotify ainda é válido.",
        "Se faltam menos de 10min para expirar, dispara renovação automática.",
        "Carrega da tabela search_terms todos os termos de busca do gênero.",
        "Entrega a lista de termos para a próxima etapa (Coleta).",
      ],
      decisions: [
        {
          kind: "aceito",
          label: "Termos válidos",
          count: searchStats.termsCount,
          reason: "Termos que estão ativos no banco, prontos para serem buscados via Apify.",
        },
        ...(tokenError
          ? [{
              kind: "descartado" as const,
              label: "Token expirado",
              reason: "Sem token válido o sistema não consegue autenticar no Spotify e bloqueia toda a esteira.",
            }]
          : []),
      ],
      output: [
        { label: "Termos enviados para Apify", value: searchStats.termsCount },
        { label: "Status do token", value: tokenError ? "❌ erro" : "✅ ok" },
      ],
      quality: [
        { label: "Última renovação OK", value: tokenOk ? "registrada" : "—" },
        { label: "Erros de auth (24h)", value: spotifyLogs.filter((l) => l.status === "error").length },
      ],
      alerts: tokenError
        ? [{ level: "error", message: "Token do Spotify com erro — automação travada.", hint: "Reconectar conta admin nas configurações." }]
        : [],
      logs: toPrettyLogs(spotifyLogs, 10),
    },
  };

  // ============ NÓ 2: COLETA (Apify) ============
  const coletaLogs = logsByAction(["run-search", "enrich-playlists", "fetch-tracks", "test-apify", "collect"]);
  const coletaErrors = coletaLogs.filter((l) => l.status === "error");
  const coletaRunning = coletaLogs.find((l) => l.status === "running");
  const enrichLogs = logsByAction(["enrich-playlists"]);
  const tracksLogs = logsByAction(["fetch-tracks"]);

  let coletaStatus: NodeStatus = "success";
  if (apifyBlocked.blocked) coletaStatus = "error";
  else if (coletaRunning) coletaStatus = "running";
  else if (coletaErrors.length > 0 && coletaLogs.length < 3) coletaStatus = "warning";

  const avgPlaylistsPerTerm = searchStats.termsCount > 0
    ? Math.round(searchStats.rawPlaylists / searchStats.termsCount)
    : 0;

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
      summary:
        "O Apify (raspador) varre o Spotify usando os termos enviados, traz playlists brutas e enriquece cada uma com seguidores reais.",
      variables: [
        { label: "API usada", value: "Apify Actor (Spotify Scraper)" },
        { label: "Enriquecimento", value: "Spotify Web API (followers reais)" },
        { label: "Termos pesquisados", value: searchStats.termsCount },
        { label: "Backoff em erro 429", value: "automático" },
      ],
      process: [
        "Para cada termo, dispara um run no Apify e aguarda resultado.",
        "Salva cada playlist encontrada na tabela search_results.",
        "Chama o endpoint /playlists/{id} do Spotify para obter seguidores REAIS (não os estimados pelo Apify).",
        "Baixa a lista de faixas de cada playlist (search_tracks).",
      ],
      decisions: [
        {
          kind: "aceito",
          label: "Playlists coletadas",
          count: searchStats.rawPlaylists,
          reason: "Vieram do Apify e foram salvas como matéria-prima para a etapa de Filtro.",
        },
        {
          kind: "aceito",
          label: "Playlists enriquecidas",
          count: enrichLogs.filter((l) => l.status === "success").length,
          reason: "Receberam seguidores reais via Spotify API — número confiável.",
        },
        ...(apifyBlocked.blocked
          ? [{
              kind: "descartado" as const,
              label: "Coletas bloqueadas",
              reason: apifyBlocked.reason ?? "Flag apify_blocked está ativa — sistema pausou para evitar custo.",
            }]
          : []),
      ],
      output: [
        { label: "Playlists brutas (total)", value: searchStats.rawPlaylists },
        { label: "Média por termo", value: avgPlaylistsPerTerm },
        { label: "Tentativas de coleta (24h)", value: coletaLogs.length },
        { label: "Faixas coletadas (eventos)", value: tracksLogs.length },
      ],
      quality: [
        { label: "Erros de coleta (24h)", value: coletaErrors.length },
        { label: "Aproveitamento", value: `${pct(coletaLogs.length - coletaErrors.length, coletaLogs.length)}% sucesso` },
      ],
      alerts: apifyBlocked.blocked
        ? [{ level: "error", message: apifyBlocked.reason ?? "Apify bloqueado.", hint: "Liberar nas configurações do sistema." }]
        : coletaErrors.slice(0, 3).map((e) => ({
            level: "warning" as const,
            message: e.mensagem ?? "Erro de coleta",
          })),
      logs: toPrettyLogs(coletaLogs, 15),
    },
  };

  // ============ NÓ 3: FILTRO ============
  const filterPct = pct(searchStats.validPlaylists, searchStats.rawPlaylists);
  const minFollowers = genreFilter?.min_followers ?? null;
  const maxPlaylists = genreFilter?.max_playlists ?? null;
  const blacklist = genreFilter?.blacklist ?? [];

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
      summary:
        "Filtra as playlists brutas aplicando regras do gênero: seguidores mínimos, blacklist de termos proibidos e limites por gênero.",
      variables: [
        { label: "Mín. seguidores", value: minFollowers != null ? minFollowers.toLocaleString("pt-BR") : "—" },
        { label: "Máx. playlists/gênero", value: maxPlaylists ?? "—" },
        { label: "Modo briefing", value: genreFilter?.briefing_mode ?? "strict" },
        { label: "Blacklist (palavras)", value: blacklist.length, hint: blacklist.slice(0, 8).join(", ") },
      ],
      process: [
        "Lê todas as playlists brutas do gênero em search_results.",
        "Aplica regra de seguidores mínimos (descarta abaixo).",
        "Verifica se o nome contém alguma palavra da blacklist (workout, sleep, lofi, etc.).",
        "Marca como is_valid=true (passou) ou is_valid=false (descartada).",
        "Limita ao teto máximo configurado para o gênero.",
      ],
      decisions: [
        {
          kind: "aceito",
          label: "Aprovadas para análise",
          count: searchStats.validPlaylists,
          reason: "Atendem aos critérios de seguidores e não estão na blacklist.",
        },
        {
          kind: "descartado",
          label: "Reprovadas",
          count: searchStats.invalidPlaylists,
          reason: minFollowers
            ? `Tipicamente: poucos seguidores (<${minFollowers.toLocaleString("pt-BR")}), nome com palavra proibida ou tema fora do gênero.`
            : "Poucos seguidores, blacklist ou tema fora do gênero.",
        },
      ],
      output: [
        { label: "Playlists válidas", value: searchStats.validPlaylists },
        { label: "Playlists descartadas", value: searchStats.invalidPlaylists },
        { label: "Taxa de aprovação", value: `${filterPct}%` },
      ],
      quality: [
        { label: "Média de seguidores (válidas)", value: searchStats.avgFollowersValid != null ? Math.round(searchStats.avgFollowersValid).toLocaleString("pt-BR") : "—" },
        { label: "Volume bruto analisado", value: searchStats.rawPlaylists },
      ],
      alerts: filterPct < 20 && searchStats.rawPlaylists > 50
        ? [{ level: "warning", message: "Taxa de aprovação muito baixa — talvez o filtro esteja apertado demais ou os termos pegam muito lixo.", hint: "Revisar min_followers ou termos de busca." }]
        : [],
      logs: [],
    },
  };

  // ============ NÓ 4: CÉREBRO (IA) ============
  const cerebroSteps = ["analyze", "briefing", "blueprints"];
  const cerebroStatus: NodeStatus = run ? aggregateStatus(run, cerebroSteps) : "idle";
  const cerebroDuration = run
    ? cerebroSteps.reduce((acc, s) => acc + (stepDuration(run, s) ?? 0), 0)
    : 0;
  const cerebroLogs = logsByAction(["analyze-genre", "generate-briefing", "playlists-briefing", "extract-blueprints", "analyze-visual-dna"]);
  const cerebroErrors = cerebroLogs.filter((l) => l.status === "error");
  const cacheHits = Object.entries(run?.cacheHits ?? {}).filter(([, v]) => v).map(([k]) => k);

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
      summary:
        "A IA estuda as playlists válidas para entender o DNA do gênero (palavras, capas, mood) e gera direções criativas que vão guiar a criação dos templates.",
      variables: [
        { label: "Modelos usados", value: "Gemini 2.5 Pro/Flash + Claude Sonnet" },
        { label: "Provedor", value: "Lovable AI Gateway" },
        { label: "Playlists analisadas", value: searchStats.validPlaylists },
        { label: "Cache reutilizado", value: cacheHits.length > 0 ? cacheHits.join(", ") : "nenhum (rodada nova)" },
      ],
      process: [
        "Analyze: extrai padrões de nomenclatura, mood e DNA visual das capas.",
        "Briefing: gera direção criativa (tom, estilo, público) com base nas vencedoras.",
        "Blueprints: cria moldes replicáveis classificados em hot/medium/weak.",
        "Salva tudo em genre_models, playlist_briefings e playlist_blueprints.",
      ],
      decisions: [
        {
          kind: "aceito",
          label: "Briefings criados",
          count: run?.cacheHits?.briefing ? "via cache" : "novos",
          reason: "Briefings servem como direção criativa para a etapa de Templates.",
        },
        {
          kind: "aceito",
          label: "Blueprints extraídos",
          count: run?.cacheHits?.blueprints ? "via cache" : "novos",
          reason: "Blueprints definem moldes que serão replicados nas próximas execuções.",
        },
        ...(cerebroErrors.length > 0
          ? [{ kind: "descartado" as const, label: "Análises falhas", count: cerebroErrors.length, reason: "Modelo IA recusou ou estourou limite de créditos." }]
          : []),
      ],
      output: [
        { label: "Etapas IA concluídas", value: cerebroSteps.filter((s) => run && isStepDone(run, s)).length + "/3" },
        { label: "Tempo total IA", value: cerebroDuration > 0 ? `${(cerebroDuration / 1000).toFixed(1)}s` : "—" },
        { label: "Cache hits", value: cacheHits.length },
      ],
      quality: [
        { label: "Erros de IA (24h)", value: cerebroErrors.length },
        { label: "Sucessos de IA (24h)", value: cerebroLogs.filter((l) => l.status === "success").length },
      ],
      alerts: run?.errorMessage && cerebroSteps.includes(run.currentStep ?? "")
        ? [{ level: "error", message: run.errorMessage, hint: "Verificar créditos do Lovable AI ou prompt." }]
        : [],
      logs: toPrettyLogs(cerebroLogs, 15),
    },
  };

  // ============ NÓ 5: TEMPLATES ============
  const templStatus: NodeStatus = run ? aggregateStatus(run, ["templates"]) : "idle";
  const templLogs = logsByAction(["generate-templates", "score-templates"]);
  const templErrors = templLogs.filter((l) => l.status === "error");
  const tg = run?.templatesGenerated ?? 0;
  const ta = run?.templatesApproved ?? 0;
  const approvalRate = pct(ta, tg);

  const node5: FluxoNodeData = {
    id: "templates",
    label: "Templates",
    shortLabel: "Geração",
    icon: FileText,
    status: templStatus,
    durationMs: run ? stepDuration(run, "templates") : null,
    inputCount: tg,
    outputCount: ta,
    description: `${tg} gerados · ${ta} aprovados`,
    details: {
      summary:
        "A IA monta os templates de playlist (nome + descrição + 50 faixas-semente + briefing de capa). Cada template recebe nota 0-100 e só os melhores avançam.",
      variables: [
        { label: "Faixas-semente por template", value: 50 },
        { label: "Score auto-aprovação", value: "≥75 (tier hot)" },
        { label: "Tier medium", value: "50-75 (revisão)" },
        { label: "Tier weak", value: "<50 (descartado)" },
      ],
      process: [
        "Lê briefings + blueprints do Cérebro.",
        "Para cada blueprint, gera N variações de template via IA.",
        "Calcula score final (combina IA + regras de replicação).",
        "Define quality_tier: hot, medium ou weak.",
        "Salva em playlist_templates com status pending/approved.",
      ],
      decisions: [
        {
          kind: "aceito",
          label: "Templates aprovados (hot)",
          count: ta,
          reason: "Score ≥75 — auto-aprovados e seguem para criação de capas.",
        },
        {
          kind: "ajustado",
          label: "Aguardando revisão (medium)",
          count: Math.max(tg - ta, 0),
          reason: "Score entre 50 e 75 — ficam na fila de aprovação manual em Criação.",
        },
        ...(searchStats.templatesWeak
          ? [{ kind: "descartado" as const, label: "Templates fracos (weak)", count: searchStats.templatesWeak, reason: "Score abaixo de 50 — arquivados automaticamente." }]
          : []),
      ],
      output: [
        { label: "Total gerados nesta execução", value: tg },
        { label: "Aprovados nesta execução", value: ta },
        { label: "Taxa de aprovação", value: `${approvalRate}%` },
        { label: "Hot existentes (gênero)", value: searchStats.templatesHot ?? "—" },
      ],
      quality: [
        { label: "Erros de geração (24h)", value: templErrors.length },
        { label: "Templates totais (gênero)", value: searchStats.templatesTotal ?? "—" },
      ],
      alerts: tg > 0 && approvalRate < 30
        ? [{ level: "warning", message: "Pouquíssimos templates aprovados — qualidade dos blueprints pode estar baixa.", hint: "Rever briefing ou aumentar amostra de playlists válidas." }]
        : run?.errorMessage && run.currentStep === "templates"
        ? [{ level: "error", message: run.errorMessage }]
        : [],
      logs: toPrettyLogs(templLogs, 12),
    },
  };

  // ============ NÓ 6: CAPAS ============
  const capasStatus: NodeStatus = run ? aggregateStatus(run, ["covers"]) : "idle";
  const capasLogs = logsByAction(["generate-cover", "rewatermark"]);
  const capasErrors = capasLogs.filter((l) => l.status === "error");
  const cg = run?.coversGenerated ?? 0;

  const node6: FluxoNodeData = {
    id: "capas",
    label: "Capas",
    shortLabel: "IA Visual",
    icon: ImageIcon,
    status: capasStatus,
    durationMs: run ? stepDuration(run, "covers") : null,
    inputCount: ta,
    outputCount: cg,
    description: `${cg} capas geradas`,
    details: {
      summary:
        "Para cada template aprovado, a IA gera variações de capa, aplica a marca d'água NexEngine e sobe para o storage público.",
      variables: [
        { label: "Modelo de imagem", value: "Gemini 2.5 Flash Image (preview)" },
        { label: "Variações por template", value: "3-4" },
        { label: "Marca d'água", value: "NexEngine (automática)" },
        { label: "Bucket de destino", value: "playlist-covers (público)" },
      ],
      process: [
        "Lê o cover_brief de cada template aprovado.",
        "Pede para a IA gerar variações de capa baseadas no DNA visual do gênero.",
        "Aplica watermark NexEngine no canto da imagem.",
        "Faz upload no storage e salva URL no template.",
      ],
      decisions: [
        {
          kind: "aceito",
          label: "Capas geradas",
          count: cg,
          reason: "Subiram com sucesso para o bucket e estão prontas para o Spotify.",
        },
        ...(capasErrors.length > 0
          ? [{ kind: "descartado" as const, label: "Capas com erro", count: capasErrors.length, reason: "Falha na geração da imagem ou no upload." }]
          : []),
      ],
      output: [
        { label: "Capas geradas nesta execução", value: cg },
        { label: "Templates pendentes de capa", value: Math.max(ta - cg, 0) },
      ],
      quality: [
        { label: "Erros de capa (24h)", value: capasErrors.length },
        { label: "Aproveitamento", value: `${pct(capasLogs.length - capasErrors.length, capasLogs.length)}%` },
      ],
      alerts: run?.errorMessage && run.currentStep === "covers"
        ? [{ level: "error", message: run.errorMessage }]
        : capasErrors.length > 5
        ? [{ level: "warning", message: "Muitas falhas de capa — modelo de imagem pode estar instável." }]
        : [],
      logs: toPrettyLogs(capasLogs, 12),
    },
  };

  // ============ NÓ 7: PLAYLIST (publicação) ============
  const pubLogs = logsByAction(["create-spotify-playlist", "replicate-top", "auto-adjust", "auto-replicate"]);
  const pubErrors = pubLogs.filter((l) => l.status === "error");
  const pubSuccess = pubLogs.filter((l) => l.status === "success").length;
  const pubStatus: NodeStatus = pubErrors.length > 0
    ? "warning"
    : searchStats.publishedPlaylists > 0
    ? "success"
    : "idle";

  const capPct = accountStat && accountStat.capacityMax > 0
    ? pct(accountStat.capacityUsed, accountStat.capacityMax)
    : 0;

  const node7: FluxoNodeData = {
    id: "playlist",
    label: "Playlist",
    shortLabel: "No Spotify",
    icon: ListMusic,
    status: pubStatus,
    inputCount: ta,
    outputCount: searchStats.publishedPlaylists,
    description: `${searchStats.publishedPlaylists} no ar`,
    details: {
      summary:
        "Cria a playlist no Spotify usando o template aprovado, adiciona as faixas em lotes e sobe a capa. Distribui entre as contas com capacidade.",
      variables: [
        { label: "API usada", value: "Spotify Web API (POST /users/{id}/playlists)" },
        { label: "Lote de faixas", value: "100 por chamada" },
        { label: "Tamanho máx. capa", value: "256 KB JPEG" },
        { label: "Contas ativas", value: accountStat?.active ?? "—" },
        { label: "Capacidade usada", value: accountStat ? `${accountStat.capacityUsed}/${accountStat.capacityMax} (${capPct}%)` : "—" },
      ],
      process: [
        "Escolhe uma conta com capacidade disponível (current_playlists < max_playlists).",
        "Cria a playlist via API do Spotify e captura o ID.",
        "Adiciona as faixas-semente em lotes de 100.",
        "Faz upload da capa gerada na etapa anterior.",
        "Incrementa o contador da conta e salva playlist_id no template.",
      ],
      decisions: [
        {
          kind: "aceito",
          label: "Playlists publicadas (total)",
          count: searchStats.publishedPlaylists,
          reason: "Estão no ar no Spotify e disponíveis para os ouvintes.",
        },
        {
          kind: "aceito",
          label: "Sucessos (24h)",
          count: pubSuccess,
          reason: "Eventos de criação que retornaram 201/200.",
        },
        ...(pubErrors.length > 0
          ? [{ kind: "descartado" as const, label: "Falhas de publicação", count: pubErrors.length, reason: "Token expirado, conta sem capacidade ou rate limit do Spotify." }]
          : []),
      ],
      output: [
        { label: "No ar agora", value: searchStats.publishedPlaylists },
        { label: "Tentativas (24h)", value: pubLogs.length },
        { label: "Sucessos (24h)", value: pubSuccess },
        { label: "Ajustes automáticos (24h)", value: adjusts.length },
      ],
      quality: [
        { label: "Taxa de sucesso (24h)", value: `${pct(pubSuccess, pubLogs.length)}%` },
        { label: "Capacidade restante", value: accountStat ? `${accountStat.capacityMax - accountStat.capacityUsed} slots` : "—" },
      ],
      alerts: [
        ...(capPct > 90
          ? [{ level: "warning" as const, message: `Contas quase no limite (${capPct}% da capacidade).`, hint: "Adicionar nova conta Spotify." }]
          : []),
        ...pubErrors.slice(0, 3).map((e) => ({
          level: "error" as const,
          message: e.mensagem ?? "Erro ao publicar",
        })),
      ] as AlertItem[],
      logs: toPrettyLogs(pubLogs, 15),
    },
  };

  return [node1, node2, node3, node4, node5, node6, node7];
}
