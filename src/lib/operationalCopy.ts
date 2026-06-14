/**
 * Tradução central de termos técnicos para linguagem humana.
 * Usado em todo o painel /sistema pra esconder nomes de funções, códigos HTTP,
 * payloads e logs crus do usuário não-técnico.
 *
 * Regra: o usuário nunca vê função-de-banco, ID, JSON, código de status ou kind.
 */

// ---------- 1. Nomes de funções / crons / workers / jobs ----------

const FUNCTION_LABELS: Record<string, string> = {
  // Workers / crons backend
  "jobs_scheduler_retry": "Recuperação automática de tarefas",
  "playlist-queue-processor": "Processamento da fila de playlists",
  "process-email-queue": "Envio de e-mails",
  "monitor-critical-crons": "Monitoramento de rotinas críticas",
  "ops-alerts-cron-every-5min": "Verificador de alertas (5 em 5 min)",
  "spotify-token-watchdog": "Renovação de tokens Spotify",
  "sync-managed-playlists-6h": "Sincronização de playlists (a cada 6h)",
  "track-external-metrics": "Coleta de métricas externas",
  "refresh-search-tracks": "Atualização do catálogo de faixas",
  "wave1-enrich-batch": "Enriquecimento de catálogo (lote)",
  "reap-zombie-jobs": "Limpeza de tarefas travadas",
  "engine-health": "Saúde do motor editorial",
  "spotify-circuit-breaker": "Proteção contra excesso de chamadas Spotify",
  "spotify-oauth": "Autenticação Spotify",
  "close_expired_spotify_circuit_breakers": "Liberação automática de bloqueio Spotify",
  "detect_silent_vps": "Detecção de servidor offline",
  // Job types (playlist_execution_jobs.job_type)
  "enrich_track": "Enriquecer faixa",
  "enrich_playlist": "Enriquecer playlist",
  "sync_playlist": "Sincronizar playlist",
  "collect_followers": "Coletar seguidores",
  "collect_metrics": "Coletar métricas",
  "process_print": "Processar print",
  "import_playlist": "Importar playlist",
  // Ações de collection_logs
  "spotify_token_refresh": "Renovação de token Spotify",
  "playlist_sync": "Sincronização de playlist",
  "metrics_collection": "Coleta de métricas",
  "search_tracks": "Busca de faixas",
  "enrich_release": "Enriquecimento de lançamento",
};

export function humanizeFunctionName(name?: string | null): string {
  if (!name) return "—";
  const k = String(name).trim();
  if (!k) return "—";
  if (FUNCTION_LABELS[k]) return FUNCTION_LABELS[k];
  // Fallback: converte snake_case / kebab-case em Title Case legível
  return k
    .replace(/[-_]+/g, " ")
    .replace(/\b([a-z])/g, (_, c) => c.toUpperCase())
    .replace(/\s+/g, " ")
    .trim();
}

// ---------- 2. Códigos de erro / mensagens cruas → frase humana ----------

const ERROR_PATTERNS: Array<{ re: RegExp; msg: string }> = [
  { re: /spotify[_\s-]*circuit[_\s-]*open|circuit[_\s-]*open/i, msg: "Spotify foi colocado em pausa de proteção. Liberação automática em alguns minutos." },
  { re: /\b403\b|forbidden|insufficient[_\s-]*scope/i, msg: "A conta Spotify não tem permissão para acessar esse recurso." },
  { re: /\b429\b|rate[_\s-]*limit|too many requests/i, msg: "Spotify bloqueou temporariamente novas consultas. O sistema está aguardando liberação automática." },
  { re: /\b401\b|unauthorized|token[_\s-]*expired|invalid[_\s-]*token|invalid[_\s-]*grant/i, msg: "Sessão Spotify expirou. Reconecte a conta." },
  { re: /\b5\d{2}\b|server error|internal error|bad gateway|service unavailable/i, msg: "Um serviço externo respondeu com erro. O sistema vai tentar novamente automaticamente." },
  { re: /timeout|timed out|ETIMEDOUT|ESOCKETTIMEDOUT/i, msg: "A consulta demorou demais e foi cancelada. Será refeita automaticamente." },
  { re: /econnreset|econnrefused|network|fetch failed|ENOTFOUND/i, msg: "Falha temporária de rede. O sistema tentará novamente." },
  { re: /not[_\s-]*found|\b404\b/i, msg: "O item buscado não está mais disponível." },
  { re: /duplicate|already exists/i, msg: "Item já existia — nada precisava ser feito." },
  { re: /cron[_\s-]*stale|never[_\s-]*ran/i, msg: "Uma rotina automática está sem executar há mais tempo do que o esperado." },
  { re: /heartbeat[_\s-]*(missing|silent|stale)/i, msg: "O sistema de coleta parou de enviar sinal de vida. Pode estar offline." },
  { re: /vps[_\s-]*offline/i, msg: "Um servidor de coleta ficou offline." },
  { re: /dlq|dead[_\s-]*letter/i, msg: "Algumas tarefas falharam várias vezes e foram movidas pra revisão manual." },
];

/** Converte mensagens cruas de erro em uma linha curta e humana. */
export function humanizeError(raw?: string | null): string {
  if (raw == null) return "Sem detalhes";
  const s = String(raw).trim();
  if (!s) return "Sem detalhes";
  for (const { re, msg } of ERROR_PATTERNS) if (re.test(s)) return msg;
  // JSON cru → não mostrar
  if (s.startsWith("{") || s.startsWith("[")) return "Erro técnico registrado (veja os detalhes para a equipe).";
  // Stack trace → primeira linha legível
  if (/\n\s*at\s/.test(s)) return s.split(/\n/)[0].slice(0, 140);
  if (s.length > 140) return s.slice(0, 140) + "…";
  return s;
}

// ---------- 2b. Mensagens de logs técnicos (collection_logs) → linguagem humana ----------

/**
 * Converte um par (acao, mensagem) — onde mensagem pode ser JSON cru, string com
 * `key=value`, payload técnico ou stack trace — em UMA frase operacional curta.
 * Nunca devolve JSON, nunca devolve nomes internos.
 */
export function humanizeLogMessage(acao?: string | null, status?: string | null, mensagem?: string | null): string {
  const action = humanizeFunctionName(acao ?? "");
  const raw = (mensagem ?? "").trim();
  const isError = status === "erro" || status === "error" || status === "failed";

  if (isError && raw) return humanizeError(raw);

  // Tenta interpretar payload JSON pra extrair sinais relevantes
  if (raw.startsWith("{") || raw.startsWith("[")) {
    try {
      const obj = JSON.parse(raw);
      if (obj && typeof obj === "object") {
        const dispatched = Array.isArray(obj.dispatched) ? obj.dispatched : null;
        if (obj.noop === true || (dispatched && dispatched.length === 0)) {
          return `${action} sem pendências.`;
        }
        if (dispatched && dispatched.length > 0) {
          return `${action}: ${dispatched.length} rotina${dispatched.length === 1 ? "" : "s"} executada${dispatched.length === 1 ? "" : "s"}.`;
        }
        if (typeof obj.checked === "number") {
          const fail = obj.fail ?? 0;
          if (fail === 0) return `${action}: ${obj.checked} verificad${obj.checked === 1 ? "o" : "os"}, tudo OK.`;
          return `${action}: ${obj.checked} verificad${obj.checked === 1 ? "o" : "os"}, ${fail} com falha.`;
        }
      }
      return `${action} executad${action.endsWith("a") ? "a" : "o"}.`;
    } catch {
      return `${action} executad${action.endsWith("a") ? "a" : "o"}.`;
    }
  }

  // Padrão "key=value key=value"
  if (/=/.test(raw) && !/\s/.test(raw.split("=")[0])) {
    const m = raw.match(/(\w+)=(\d+)/g);
    if (m && m.length > 0) {
      const parts: string[] = [];
      for (const kv of m.slice(0, 3)) {
        const [k, v] = kv.split("=");
        const num = Number(v);
        if (num === 0) continue;
        parts.push(`${num} ${k.replace(/_/g, " ")}`);
      }
      if (parts.length === 0) return `${action} sem pendências.`;
      return `${action}: ${parts.join(", ")}.`;
    }
  }

  // Linha humana curta — devolve com a ação como prefixo
  if (raw && raw.length < 120 && !/[{}\[\]]/.test(raw)) {
    return `${action}: ${raw}`;
  }
  if (!raw) return `${action} executad${action.endsWith("a") ? "a" : "o"}.`;
  return `${action} executad${action.endsWith("a") ? "a" : "o"}.`;
}

// ---------- 3. Status executivo (Nível 1) ----------

export type ExecutiveStatus = "ok" | "attention" | "urgent";

export const EXEC_LABEL: Record<ExecutiveStatus, { title: string; subtitle: string; emoji: string }> = {
  ok:        { emoji: "✅", title: "Tudo funcionando",   subtitle: "Nenhuma ação necessária." },
  attention: { emoji: "🟡", title: "Atenção necessária", subtitle: "Algo está fora do padrão, mas o sistema continua operando." },
  urgent:    { emoji: "🔴", title: "Ação urgente",       subtitle: "Há falhas que precisam de intervenção agora." },
};

/** Combina contadores de alertas + estados de serviço em um status geral. */
export function deriveExecutiveStatus(input: {
  criticalOpen: number;
  warningOpen: number;
  spotifyBlocked?: number;
  vpsOffline?: number;
}): ExecutiveStatus {
  if (input.criticalOpen > 0 || (input.vpsOffline ?? 0) > 0) return "urgent";
  if (input.warningOpen > 0 || (input.spotifyBlocked ?? 0) > 0) return "attention";
  return "ok";
}

// ---------- 4. Helpers de tempo "próxima tentativa" ----------

export function formatRelativeFuture(iso?: string | null): string | undefined {
  if (!iso) return undefined;
  const target = new Date(iso).getTime();
  const now = Date.now();
  const diff = target - now;
  if (diff <= 0) return "a qualquer momento";
  const mins = Math.round(diff / 60_000);
  if (mins < 1) return "em menos de 1 minuto";
  if (mins < 60) return `em ${mins} minuto${mins === 1 ? "" : "s"}`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `em ${hours} hora${hours === 1 ? "" : "s"}`;
  const days = Math.round(hours / 24);
  return `em ${days} dia${days === 1 ? "" : "s"}`;
}
