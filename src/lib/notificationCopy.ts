/**
 * Traduz títulos/mensagens técnicas de notificações para linguagem simples.
 * Aplicado em tempo de exibição (presentation only) — não altera o banco
 * nem a lógica das edge functions que disparam o alerta.
 *
 * Estratégia:
 * 1. Tenta casar por `metadata.kind` (chave estável).
 * 2. Cai em regex sobre o título original (compatibilidade com alertas antigos).
 * 3. Se nada bater, devolve o texto original.
 */
import type { NotificationRow } from "@/hooks/useNotifications";
import { formatRelativeFuture, humanizeError, humanizeFunctionName } from "@/lib/operationalCopy";

export type FriendlyTone = "critical" | "warning" | "info" | "success";

export interface FriendlyCopy {
  title: string;
  message?: string;
  tone?: FriendlyTone;
  /** Frase curta de impacto na operação. */
  impact?: string;
  /** O sistema continua funcionando apesar desse alerta? */
  systemWorking?: boolean;
  /** Precisa fazer algo manualmente? */
  actionRequired?: boolean;
  /** Quando o sistema vai tentar novamente (texto humano). */
  nextAttempt?: string;
  /** Texto do botão de ação (se houver). */
  actionLabel?: string;
  /** Para onde levar quando clicar (sobrescreve action_url da notificação). */
  actionUrl?: string;
}

type Rewriter = (n: NotificationRow) => FriendlyCopy;

const BY_KIND: Record<string, Rewriter> = {
  bot_silent: (n) => {
    const hours = (n.metadata as any)?.hours_silent;
    return {
      title: hours
        ? `Sistema de coleta sem atividade há ${hours}h`
        : "Sistema de coleta sem atividade",
      message: "A coleta automática de dados está ligada, mas parou de receber informações novas.",
      tone: "warning",
      impact: "Métricas novas podem demorar mais para aparecer.",
      systemWorking: true,
      actionRequired: true,
      actionLabel: "Abrir saúde do sistema",
      actionUrl: "/sistema?tab=saude",
    };
  },
  ops_bot_events_silent: () => ({
    title: "Coleta automática sem atividade",
    message: "A coleta de dados está sem registrar eventos novos.",
    tone: "warning",
    impact: "Métricas novas podem demorar mais para aparecer.",
    systemWorking: true,
    actionRequired: false,
  }),
  ops_heartbeat_missing: () => ({
    title: "Sistema de coleta parado",
    message: "O sistema de coleta deixou de enviar sinal de vida. Pode estar offline.",
    tone: "critical",
    impact: "Nenhuma nova coleta de métricas até voltar ao ar.",
    systemWorking: false,
    actionRequired: true,
    actionLabel: "Abrir saúde do sistema",
    actionUrl: "/sistema?tab=saude",
  }),
  vps_offline: (n) => ({
    title: "Servidor de coleta offline",
    message: "Um servidor parou de enviar sinal de vida há mais de 15 minutos.",
    tone: "critical",
    impact: "Coletas atribuídas a esse servidor estão pausadas.",
    systemWorking: (n.metadata as any)?.has_backup ?? true,
    actionRequired: true,
    actionLabel: "Ver servidores",
    actionUrl: "/sistema?tab=saude",
  }),
  spotify_token_invalid: () => ({
    title: "Conta Spotify precisa ser reconectada",
    message: "Uma das contas conectadas perdeu a autorização.",
    tone: "critical",
    impact: "Coletas que dependem dessa conta estão paradas.",
    systemWorking: true,
    actionRequired: true,
    actionLabel: "Reconectar conta",
    actionUrl: "/configuracoes",
  }),
  spotify_token_refresh_failed: () => ({
    title: "Conta Spotify precisa ser reconectada",
    message: "Não foi possível renovar o acesso de uma conta Spotify.",
    tone: "critical",
    impact: "Coletas que dependem dessa conta estão paradas.",
    systemWorking: true,
    actionRequired: true,
    actionLabel: "Reconectar conta",
    actionUrl: "/configuracoes",
  }),
  spotify_circuit_open: (n) => {
    const until = (n.metadata as any)?.blocked_until ?? (n.metadata as any)?.retry_at;
    return {
      title: "Spotify temporariamente bloqueado",
      message: "Spotify bloqueou novas consultas. O sistema está aguardando liberação automática.",
      tone: "warning",
      impact: "Algumas coletas podem atrasar alguns minutos.",
      systemWorking: true,
      actionRequired: false,
      nextAttempt: formatRelativeFuture(until),
    };
  },
  spotify_403_burst: () => ({
    title: "Conta Spotify sem permissão",
    message: "Uma conta Spotify recebeu muitas respostas de 'sem permissão' seguidas.",
    tone: "critical",
    impact: "Algumas coletas estão sendo rejeitadas pelo Spotify.",
    systemWorking: true,
    actionRequired: true,
    actionLabel: "Reconectar conta",
    actionUrl: "/configuracoes",
  }),
  cron_stale: (n) => {
    const fn = (n.metadata as any)?.function_name ?? (n.metadata as any)?.cron_name;
    return {
      title: fn ? `Rotina automática atrasada: ${humanizeFunctionName(fn)}` : "Rotina automática atrasada",
      message: "Uma tarefa automática está sem executar há mais tempo do que o esperado.",
      tone: "warning",
      impact: "Tarefas dependentes podem ficar desatualizadas.",
      systemWorking: true,
      actionRequired: false,
    };
  },
  jobs_scheduler_retry: () => ({
    title: "Recuperação automática de tarefas executada",
    message: "O sistema reagendou tarefas que estavam travadas.",
    tone: "info",
    impact: "Nenhum impacto — recuperação preventiva.",
    systemWorking: true,
    actionRequired: false,
  }),
  email_queue_stuck: (n) => ({
    title: "Fila de e-mails parada",
    message: `Mensagens pendentes não estão sendo enviadas${(n.metadata as any)?.backlog ? ` (${(n.metadata as any).backlog} na fila)` : ""}.`,
    tone: "critical",
    impact: "Convites e relatórios não estão chegando aos destinatários.",
    systemWorking: false,
    actionRequired: true,
    actionLabel: "Abrir saúde do sistema",
    actionUrl: "/sistema?tab=saude",
  }),
  snapshot_suspicious: () => ({
    title: "Dados inconsistentes em uma playlist",
    message: "Um registro recente parece fora do padrão e foi marcado para revisão manual.",
    tone: "warning",
    impact: "O registro foi isolado — nenhum efeito em outras playlists.",
    systemWorking: true,
    actionRequired: false,
  }),
  playlist_not_matched: () => ({
    title: "Playlist não identificada em um deal",
    message: "Recebemos dados de uma playlist que não está vinculada a nenhum deal ativo.",
    tone: "warning",
    impact: "Esses dados não foram contabilizados em nenhum deal.",
    systemWorking: true,
    actionRequired: true,
    actionLabel: "Ver curadores",
    actionUrl: "/curadores",
  }),
  curator_no_playlists: () => ({
    title: "Curador sem playlists cadastradas",
    message: "Um curador foi consultado mas não tem playlists registradas para coleta.",
    tone: "info",
    systemWorking: true,
    actionRequired: false,
  }),
  algorithmic_in: () => ({
    title: "Música entrou em playlist algorítmica",
    message: "O Spotify adicionou uma faixa de campanha em uma playlist algorítmica.",
    tone: "success",
  }),
  algorithmic_out: () => ({
    title: "Música saiu de playlist algorítmica",
    message: "Uma faixa que estava em playlist algorítmica foi removida.",
    tone: "warning",
  }),
  meta_batida: () => ({
    title: "Meta de streams batida",
    message: "Um deal atingiu a meta combinada com o curador.",
    tone: "success",
  }),
  deal_overdue: () => ({
    title: "Deal atrasado",
    message: "Um deal passou do prazo combinado sem entregar a meta.",
    tone: "critical",
  }),
  deal_created: () => ({
    title: "Novo deal criado",
    message: "Uma campanha foi aprovada e gerou um deal novo.",
    tone: "info",
  }),
  campaign_expired: () => ({
    title: "Rascunho de campanha expirou",
    message: "Uma campanha em rascunho passou de 48h sem ser aprovada e foi cancelada. O inventário foi liberado.",
    tone: "info",
  }),
  playlist_published: () => ({
    title: "Playlist publicada no Spotify",
    message: "Uma playlist nova foi criada e está disponível no Spotify.",
    tone: "success",
  }),
  apify_blocked: () => ({
    title: "Serviço de enriquecimento bloqueado",
    message: "O serviço externo usado para buscar dados extras de playlists está bloqueado.",
    tone: "warning",
  }),
  metrics_collection_failed: () => ({
    title: "Falha na coleta de métricas",
    message: "A coleta automática de métricas de playlists falhou de forma sistêmica.",
    tone: "critical",
  }),
  performance_high: () => ({
    title: "Playlists com alta performance",
    message: "Uma ou mais playlists estão entregando acima do esperado.",
    tone: "success",
  }),
  performance_low: () => ({
    title: "Playlists com baixa performance",
    message: "Uma ou mais playlists estão entregando abaixo do esperado.",
    tone: "warning",
  }),
  template_hot: () => ({
    title: "Novo modelo de alta performance",
    message: "Um padrão de playlist foi identificado como modelo replicável.",
    tone: "success",
  }),
  autopilot_no_data: () => ({
    title: "Análise automática sem dados recentes",
    message: "A análise automática não encontrou dados suficientes para rodar.",
    tone: "info",
  }),
  autopilot_started: () => ({
    title: "Análise automática iniciada",
    message: "Uma rodada de análise automática começou.",
    tone: "info",
  }),
  autopilot_collection_failed: () => ({
    title: "Análise automática: coleta falhou",
    message: "A coleta de dados para a análise automática não conseguiu rodar.",
    tone: "warning",
  }),
  autopilot_collection_partial: () => ({
    title: "Análise automática: coleta parcial",
    message: "A coleta rodou parcialmente — análise feita com dados incompletos.",
    tone: "info",
  }),
  autopilot_collection_blocked: () => ({
    title: "Análise automática: coleta bloqueada",
    message: "A análise automática parou para evitar repetição de coleta.",
    tone: "warning",
  }),
  autopilot_no_templates: () => ({
    title: "Análise automática: nenhum modelo aprovado",
    message: "A rodada terminou sem encontrar modelos replicáveis.",
    tone: "info",
  }),
};

// Padrões para alertas antigos sem `kind` setado.
const TITLE_PATTERNS: Array<{ re: RegExp; copy: FriendlyCopy }> = [
  {
    re: /heartbeat/i,
    copy: { title: "Sistema de coleta sem sinal", message: "O sistema de coleta parou de enviar sinais de vida.", tone: "warning" },
  },
  {
    re: /bot online mas sem coletar/i,
    copy: { title: "Coleta ligada mas sem atividade", message: "O sistema está ligado mas não está coletando dados novos.", tone: "warning" },
  },
  {
    re: /reautenticar|token/i,
    copy: { title: "Conta Spotify precisa ser reconectada", message: "Uma conta Spotify perdeu o acesso. Reconecte em Configurações.", tone: "critical" },
  },
  {
    re: /snapshot/i,
    copy: { title: "Dados inconsistentes em uma playlist", message: "Um registro recente parece fora do padrão.", tone: "warning" },
  },
  {
    re: /apify/i,
    copy: { title: "Serviço de enriquecimento bloqueado", message: "O serviço externo de dados extras está bloqueado.", tone: "warning" },
  },
  {
    re: /algorítmica|algoritmica/i,
    copy: { title: "Atualização em playlist algorítmica", tone: "info" },
  },
  {
    re: /autopilot/i,
    copy: { title: "Análise automática", message: "Atualização da rotina de análise automática.", tone: "info" },
  },
  {
    re: /ocr/i,
    copy: { title: "Leitura de imagem com problema", message: "A leitura automática de uma imagem (print) precisa de revisão.", tone: "warning" },
  },
];

/** Termos técnicos que devem ser ofuscados se aparecerem cru. */
const TECH_WORDS = /\b(bot|heartbeat|cron|snapshot|ocr|webhook|payload|token|api|rpc)\b/gi;

function softenTechnicalText(s: string): string {
  return s.replace(TECH_WORDS, (m) => {
    const lower = m.toLowerCase();
    if (lower === "bot") return "sistema de coleta";
    if (lower === "heartbeat") return "sinal de vida";
    if (lower === "cron") return "rotina automática";
    if (lower === "snapshot") return "registro";
    if (lower === "ocr") return "leitura de imagem";
    if (lower === "webhook") return "integração";
    if (lower === "payload") return "dados recebidos";
    if (lower === "token") return "acesso";
    if (lower === "api") return "serviço";
    if (lower === "rpc") return "chamada interna";
    return m;
  });
}

export function friendlyNotification(n: NotificationRow): FriendlyCopy {
  const kind = (n.metadata as any)?.kind as string | undefined;
  if (kind && BY_KIND[kind]) return BY_KIND[kind](n);

  // Casa pelo dedupe_key prefixado (ex: bot_silent:nome:1h)
  const dedupe = (n.metadata as any)?.dedupe_key as string | undefined;
  if (dedupe) {
    const prefix = dedupe.split(":")[0];
    if (BY_KIND[prefix]) return BY_KIND[prefix](n);
  }

  for (const { re, copy } of TITLE_PATTERNS) {
    if (re.test(n.title) || (n.message && re.test(n.message))) return copy;
  }

  return {
    title: softenTechnicalText(n.title),
    message: humanizeError(softenTechnicalText(n.message)),
  };
}

/** Detecta se a notificação representa um sucesso/positivo (vinculado a meta atingida etc). */
export function notificationTone(n: NotificationRow): FriendlyTone {
  const copy = friendlyNotification(n);
  if (copy.tone) return copy.tone;
  if (n.type === "critical") return "critical";
  if (n.type === "warning") return "warning";
  return "info";
}

/** Agrupa notificações por bucket de data relativa. */
export type DateBucket = "today" | "yesterday" | "thisWeek" | "older";

export const DATE_BUCKET_LABEL: Record<DateBucket, string> = {
  today: "Hoje",
  yesterday: "Ontem",
  thisWeek: "Esta semana",
  older: "Mais antigo",
};

export function bucketOf(iso: string): DateBucket {
  const d = new Date(iso);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000;
  const startOfWeek = startOfToday - 7 * 24 * 60 * 60 * 1000;
  const t = d.getTime();
  if (t >= startOfToday) return "today";
  if (t >= startOfYesterday) return "yesterday";
  if (t >= startOfWeek) return "thisWeek";
  return "older";
}

export function groupByBucket<T extends { created_at: string }>(items: T[]): Array<{ bucket: DateBucket; items: T[] }> {
  const groups: Record<DateBucket, T[]> = { today: [], yesterday: [], thisWeek: [], older: [] };
  for (const it of items) groups[bucketOf(it.created_at)].push(it);
  const order: DateBucket[] = ["today", "yesterday", "thisWeek", "older"];
  return order.filter((b) => groups[b].length > 0).map((b) => ({ bucket: b, items: groups[b] }));
}
