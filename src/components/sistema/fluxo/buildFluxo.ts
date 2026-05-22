// buildFluxo — pipeline real do NexEngine hoje: Spotify → Filtro → Catálogo → Deal → Execução.
import { Search, Filter, Library, Handshake, ListMusic } from "lucide-react";
import type {
  FluxoNodeData, FluxoRun, NodeStatus, LogPretty,
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

type RawSearchStats = {
  termsCount: number;
  rawPlaylists: number;
  validPlaylists: number;
  invalidPlaylists: number;
  avgFollowersValid?: number | null;
};

type GenreFilter = {
  min_followers: number | null;
  max_playlists: number | null;
  briefing_mode: string | null;
  blacklist: string[] | null;
};

export type CatalogStat = { total: number; active: number };
export type DealStat = { activeDeals: number; pendingSongs: number; dueToday: number };
export type ExecStat = { pending: number; claimed: number; doneToday: number; failed24h: number };

// =============== Tradutor de logs técnicos → PT-BR ===============
function prettyLog(action: string, message: string, status: string): string {
  const a = (action || "").toLowerCase();
  const m = message || "";
  if (a.includes("spotify_token") || a.includes("spotify-auth")) {
    return status === "error"
      ? "Falha ao renovar token do Spotify — descoberta pausada."
      : "Token do Spotify renovado.";
  }
  if (a.includes("run-search")) {
    if (status === "error") return "Busca Spotify falhou ao buscar playlists.";
    if (status === "running") return "Busca Spotify rodando.";
    return `Busca Spotify encontrou playlists novas. ${m}`.trim();
  }
  if (a.includes("enrich-playlists")) {
    return status === "error"
      ? "Falha ao buscar seguidores reais via Spotify API."
      : "Playlists enriquecidas com seguidores reais.";
  }
  if (a.includes("fetch-tracks")) return "Faixas das playlists baixadas para análise.";
  // (test-apify removido — não usamos mais Apify)
  return m || `Evento: ${action}`;
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

// =============== Builder ===============
export function buildFluxoNodes(opts: {
  run: FluxoRun | null;
  logs: RawLog[];
  searchStats: RawSearchStats;
  discoveryBlocked: { blocked: boolean; reason?: string };
  genreFilter?: GenreFilter | null;
  catalogStat?: CatalogStat | null;
  dealStat?: DealStat | null;
  execStat?: ExecStat | null;
}): FluxoNodeData[] {
  const { logs, searchStats, discoveryBlocked, genreFilter, catalogStat, dealStat, execStat } = opts;

  const logsByAction = (actions: string[]) =>
    logs.filter((l) => actions.some((a) => (l.acao ?? "").includes(a)));

  // ============ NÓ 1: DESCOBERTA SPOTIFY ============
  const discLogs = logsByAction(["run-search", "enrich-playlists", "fetch-tracks", "test-apify", "spotify_token", "spotify-auth"]);
  const discErrors = discLogs.filter((l) => l.status === "error");
  const discRunning = discLogs.find((l) => l.status === "running");
  const tokenError = discLogs.find((l) => (l.acao ?? "").includes("spotify") && l.status === "error");

  let discStatus: NodeStatus = "success";
  if (discoveryBlocked.blocked || tokenError) discStatus = "error";
  else if (discRunning) discStatus = "running";
  else if (discErrors.length > 0 && discLogs.length < 3) discStatus = "warning";

  const avgPlaylistsPerTerm = searchStats.termsCount > 0
    ? Math.round(searchStats.rawPlaylists / searchStats.termsCount) : 0;

  const node1: FluxoNodeData = {
    id: "descoberta",
    label: "Descoberta",
    shortLabel: "Spotify",
    icon: Search,
    status: discStatus,
    inputCount: searchStats.termsCount,
    outputCount: searchStats.rawPlaylists,
    description: discoveryBlocked.blocked ? "Coleta bloqueada" : `${searchStats.rawPlaylists} playlists brutas`,
    details: {
      summary: "Varre o Spotify usando os termos cadastrados por gênero e enriquece cada playlist com seguidores reais. Ponto de entrada do pipeline.",
      variables: [
        { label: "Termos cadastrados", value: searchStats.termsCount },
        { label: "Enriquecimento", value: "Spotify Web API (followers reais)" },
        { label: "Token Spotify", value: tokenError ? "expirado/erro" : "válido" },
      ],
      process: [
        "Verifica token do Spotify (renovação automática se faltam <10min).",
        "Para cada termo cadastrado, busca playlists no Spotify.",
        "Salva playlists encontradas em search_results.",
        "Chama /playlists/{id} no Spotify para obter seguidores REAIS.",
      ],
      decisions: [
        { kind: "aceito", label: "Playlists coletadas", count: searchStats.rawPlaylists, reason: "Matéria-prima para o filtro." },
        ...(discoveryBlocked.blocked
          ? [{ kind: "descartado" as const, label: "Coletas bloqueadas", reason: discoveryBlocked.reason ?? "Coleta pausada." }]
          : []),
      ],
      output: [
        { label: "Playlists brutas (total)", value: searchStats.rawPlaylists },
        { label: "Média por termo", value: avgPlaylistsPerTerm },
        { label: "Tentativas (24h)", value: discLogs.length },
      ],
      quality: [
        { label: "Erros de descoberta (24h)", value: discErrors.length },
        { label: "Aproveitamento", value: `${pct(discLogs.length - discErrors.length, discLogs.length)}% sucesso` },
      ],
      alerts: [
        ...(tokenError ? [{ level: "error" as const, message: "Token Spotify com erro — descoberta travada.", hint: "Reconectar conta admin." }] : []),
        ...(discoveryBlocked.blocked ? [{ level: "error" as const, message: discoveryBlocked.reason ?? "Coleta Spotify bloqueada.", hint: "Verificar configuração da coleta." }] : []),
      ],
      logs: toPrettyLogs(discLogs, 15),
    },
  };

  // ============ NÓ 2: FILTRO ============
  const filterPct = pct(searchStats.validPlaylists, searchStats.rawPlaylists);
  const minFollowers = genreFilter?.min_followers ?? null;
  const blacklist = genreFilter?.blacklist ?? [];

  const node2: FluxoNodeData = {
    id: "filtro",
    label: "Filtro",
    shortLabel: "Validação",
    icon: Filter,
    status: searchStats.rawPlaylists > 0 ? "success" : "idle",
    inputCount: searchStats.rawPlaylists,
    outputCount: searchStats.validPlaylists,
    description: `${filterPct}% aprovadas`,
    details: {
      summary: "Aplica regras por gênero (seguidores mínimos, blacklist de palavras, limite máximo). Define quais playlists viram candidatas ao catálogo.",
      variables: [
        { label: "Mín. seguidores", value: minFollowers != null ? minFollowers.toLocaleString("pt-BR") : "—" },
        { label: "Máx. playlists/gênero", value: genreFilter?.max_playlists ?? "—" },
        { label: "Blacklist", value: blacklist.length, hint: blacklist.slice(0, 8).join(", ") },
      ],
      process: [
        "Lê playlists brutas do gênero.",
        "Descarta abaixo do mínimo de seguidores.",
        "Verifica blacklist (workout, sleep, lofi, etc.).",
        "Marca is_valid=true/false.",
      ],
      decisions: [
        { kind: "aceito", label: "Aprovadas", count: searchStats.validPlaylists, reason: "Passam nos critérios de seguidores e nome." },
        { kind: "descartado", label: "Reprovadas", count: searchStats.invalidPlaylists, reason: "Poucos seguidores, palavra proibida ou fora do tema." },
      ],
      output: [
        { label: "Válidas", value: searchStats.validPlaylists },
        { label: "Descartadas", value: searchStats.invalidPlaylists },
        { label: "Taxa de aprovação", value: `${filterPct}%` },
      ],
      quality: [
        { label: "Média de seguidores (válidas)", value: searchStats.avgFollowersValid != null ? Math.round(searchStats.avgFollowersValid).toLocaleString("pt-BR") : "—" },
      ],
      alerts: filterPct < 20 && searchStats.rawPlaylists > 50
        ? [{ level: "warning", message: "Taxa de aprovação baixa — filtro apertado ou termos pegando muito lixo.", hint: "Revisar min_followers ou termos." }]
        : [],
      logs: [],
    },
  };

  // ============ NÓ 3: CATÁLOGO ============
  const cat = catalogStat ?? { total: 0, active: 0 };
  const node3: FluxoNodeData = {
    id: "catalogo",
    label: "Catálogo",
    shortLabel: "Playlists ativas",
    icon: Library,
    status: cat.active > 0 ? "success" : "idle",
    inputCount: searchStats.validPlaylists,
    outputCount: cat.active,
    description: `${cat.active} ativas no catálogo`,
    details: {
      summary: "Playlists validadas viram catálogo gerenciável — base para fechar deals com curadores e medir performance.",
      variables: [
        { label: "Total no catálogo", value: cat.total },
        { label: "Ativas (não arquivadas)", value: cat.active },
      ],
      process: [
        "Playlists aprovadas no filtro entram em managed_playlists.",
        "Recebem capa, dono (curador) e configuração de capacidade.",
        "Ficam disponíveis para entrar em deals.",
      ],
      decisions: [
        { kind: "aceito", label: "Ativas", count: cat.active, reason: "Disponíveis para uso operacional." },
        ...(cat.total > cat.active
          ? [{ kind: "descartado" as const, label: "Arquivadas", count: cat.total - cat.active, reason: "Foram tiradas do giro operacional." }]
          : []),
      ],
      output: [
        { label: "Catálogo total", value: cat.total },
        { label: "% ativas", value: `${pct(cat.active, cat.total)}%` },
      ],
      quality: [],
      alerts: cat.active === 0
        ? [{ level: "warning", message: "Catálogo vazio — nenhuma playlist ativa.", hint: "Importar playlists válidas para o catálogo." }]
        : [],
      logs: [],
    },
  };

  // ============ NÓ 4: DEAL ============
  const deal = dealStat ?? { activeDeals: 0, pendingSongs: 0, dueToday: 0 };
  const dealStatus: NodeStatus = deal.activeDeals > 0 ? "success" : "idle";
  const node4: FluxoNodeData = {
    id: "deal",
    label: "Deal",
    shortLabel: "Curador",
    icon: Handshake,
    status: dealStatus,
    inputCount: cat.active,
    outputCount: deal.activeDeals,
    description: `${deal.activeDeals} deals ativos`,
    details: {
      summary: "Acordos com curadores: para cada música contratada, define em quais playlists do catálogo ela deve entrar e por quanto tempo.",
      variables: [
        { label: "Deals ativos", value: deal.activeDeals },
        { label: "Músicas pendentes", value: deal.pendingSongs },
        { label: "A entregar hoje", value: deal.dueToday },
      ],
      process: [
        "Cliente fecha contrato com um curador para uma música.",
        "Sistema distribui a música nas playlists combinadas.",
        "Gera os jobs de execução (adicionar faixa em cada playlist).",
      ],
      decisions: [
        { kind: "aceito", label: "Deals ativos", count: deal.activeDeals, reason: "Em vigor agora, gerando jobs." },
        ...(deal.pendingSongs > 0
          ? [{ kind: "ajustado" as const, label: "Músicas aguardando", count: deal.pendingSongs, reason: "Contratadas mas ainda sem distribuição completa." }]
          : []),
      ],
      output: [
        { label: "Deals ativos", value: deal.activeDeals },
        { label: "Músicas em curso", value: deal.pendingSongs },
        { label: "Entregas marcadas pra hoje", value: deal.dueToday },
      ],
      quality: [],
      alerts: deal.dueToday > 0 && (execStat?.pending ?? 0) === 0
        ? [{ level: "warning", message: `${deal.dueToday} entregas marcadas para hoje mas nenhuma na fila.`, hint: "Verificar gerador de jobs." }]
        : [],
      logs: [],
    },
  };

  // ============ NÓ 5: EXECUÇÃO ============
  const exec = execStat ?? { pending: 0, claimed: 0, doneToday: 0, failed24h: 0 };
  const execTotal = exec.pending + exec.claimed + exec.doneToday + exec.failed24h;
  let execStatus: NodeStatus = "idle";
  if (exec.failed24h > 5) execStatus = "error";
  else if (exec.claimed > 0) execStatus = "running";
  else if (exec.doneToday > 0) execStatus = "success";
  else if (exec.failed24h > 0) execStatus = "warning";

  const node5: FluxoNodeData = {
    id: "execucao",
    label: "Execução",
    shortLabel: "Fila de jobs",
    icon: ListMusic,
    status: execStatus,
    inputCount: deal.activeDeals,
    outputCount: exec.doneToday,
    description: `${exec.doneToday} concluídos hoje`,
    details: {
      summary: "Fila que executa o que foi prometido nos deals: para cada job, o worker (bot/VPS) adiciona a faixa na playlist do curador no Spotify.",
      variables: [
        { label: "Fila (tabela)", value: "playlist_execution_jobs" },
        { label: "Worker", value: "Bot VPS / queue worker" },
        { label: "Pendentes", value: exec.pending },
        { label: "Em execução", value: exec.claimed },
      ],
      process: [
        "Deal gera um job por playlist para a faixa contratada.",
        "Worker reivindica o job (status = claimed).",
        "Worker adiciona a faixa via API do Spotify.",
        "Marca done ou failed e libera o próximo.",
      ],
      decisions: [
        { kind: "aceito", label: "Concluídos hoje", count: exec.doneToday, reason: "Faixa adicionada com sucesso na playlist." },
        ...(exec.failed24h > 0
          ? [{ kind: "descartado" as const, label: "Falhas (24h)", count: exec.failed24h, reason: "Erro do Spotify, conta sem capacidade, rate limit ou playlist removida." }]
          : []),
      ],
      output: [
        { label: "Pendentes", value: exec.pending },
        { label: "Em execução", value: exec.claimed },
        { label: "Concluídos hoje", value: exec.doneToday },
        { label: "Falhas (24h)", value: exec.failed24h },
      ],
      quality: [
        { label: "Volume total no painel", value: execTotal },
        { label: "Taxa de sucesso (24h)", value: `${pct(exec.doneToday, exec.doneToday + exec.failed24h)}%` },
      ],
      alerts: exec.failed24h > 5
        ? [{ level: "error", message: `${exec.failed24h} jobs falharam nas últimas 24h.`, hint: "Ver fila em Execução para retry." }]
        : exec.pending > 200
        ? [{ level: "warning", message: `${exec.pending} jobs acumulados na fila.`, hint: "Worker pode estar lento ou parado." }]
        : [],
      logs: [],
    },
  };

  return [node1, node2, node3, node4, node5];
}
