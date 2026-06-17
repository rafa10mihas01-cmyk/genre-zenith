// FASE 4.D — Registry oficial de integrações externas.
// Cada entrada documenta política de timeout, retry, breaker, rate-limit,
// cache e fallback. Esta é a FONTE ÚNICA DE VERDADE consultada por
// _shared/external-call.ts, painéis NOC e runbooks.

export type IntegrationPolicy = {
  id: string;
  vendor: string;
  consumers: string[];          // edge functions / módulos que chamam
  frequency: string;            // ex: "alto (real-time)", "baixo (cron 1h)"
  timeout_ms: number;
  retries: number;
  backoff: "exp+jitter" | "fixed" | "none";
  circuit_breaker: "official" | "external-call" | "none";
  rate_limit: string;           // ex: "180 rpm + burst 30"
  cache: string;                // ex: "30s TTL Redis-like via spotify_*_cache"
  fallback: string;             // comportamento quando down
  health_probe: string;         // nome da probe em health_probes
};

export const INTEGRATIONS: IntegrationPolicy[] = [
  {
    id: "spotify",
    vendor: "Spotify Web API",
    consumers: ["spotify-client.ts", "search-tracks", "playlist-* edges"],
    frequency: "alto (real-time)",
    timeout_ms: 12_000,
    retries: 3,
    backoff: "exp+jitter",
    circuit_breaker: "official",  // spotify_circuit_breaker
    rate_limit: "180 rpm/app + burst 30 (token bucket via spotify_apps)",
    cache: "spotify_track_cache / spotify_artist_cache / spotify_playlist_cache (TTL configurável por tipo)",
    fallback: "Circuit breaker + multi-app rotation. Em down total: cron pausa, fila persiste em playlist_operation_queue.",
    health_probe: "spotify",
  },
  {
    id: "spotify_for_artists",
    vendor: "Spotify for Artists (scraping autenticado)",
    consumers: ["bot worker (VPS)"],
    frequency: "médio (cron 15min por artista monitorado)",
    timeout_ms: 30_000,
    retries: 2,
    backoff: "exp+jitter",
    circuit_breaker: "external-call",
    rate_limit: "1 req/2s por conta (sequencial)",
    cache: "raw_chart_daily + bot_print_batches (snapshot 24h)",
    fallback: "Fila local no worker. BOT continua heartbeat; jobs ficam pending.",
    health_probe: "spotify_for_artists",
  },
  {
    id: "browserless",
    vendor: "Browserless / Playwright self-host",
    consumers: ["bot worker"],
    frequency: "alto (sob demanda do BOT)",
    timeout_ms: 45_000,
    retries: 2,
    backoff: "exp+jitter",
    circuit_breaker: "external-call",
    rate_limit: "5 sessões concorrentes",
    cache: "n/a (sessões efêmeras)",
    fallback: "Manual fallback (manual-fallback.ts) — operador completa coleta.",
    health_probe: "browser",
  },
  {
    id: "ocr",
    vendor: "OCR worker (interno)",
    consumers: ["bot worker"],
    frequency: "alto (por print)",
    timeout_ms: 20_000,
    retries: 2,
    backoff: "exp+jitter",
    circuit_breaker: "external-call",
    rate_limit: "fila interna 10/s",
    cache: "ai_print_cache (TTL 24h por hash do print)",
    fallback: "Reenfileira em manual_distribution_queue; alerta crítico após 3 falhas.",
    health_probe: "ocr",
  },
  {
    id: "smtp",
    vendor: "SMTP transacional",
    consumers: ["send-email edges", "delivery_proofs", "ops-alerts"],
    frequency: "médio",
    timeout_ms: 10_000,
    retries: 3,
    backoff: "exp+jitter",
    circuit_breaker: "external-call",
    rate_limit: "100/min (provedor)",
    cache: "email_send_state (dedupe por hash 24h)",
    fallback: "email_send_log queda → reenvio via deliver-system-alerts-cron; fallback webhook/Slack.",
    health_probe: "smtp",
  },
  {
    id: "supabase_rest",
    vendor: "Supabase PostgREST",
    consumers: ["frontend + todas as edges"],
    frequency: "crítico (toda request)",
    timeout_ms: 15_000,
    retries: 2,
    backoff: "exp+jitter",
    circuit_breaker: "none (banco primário)",
    rate_limit: "conforme plano Supabase",
    cache: "React Query (frontend) + cache por edge.",
    fallback: "Sem fallback — banco é fonte de verdade. Modo degradado: read-only via cache local.",
    health_probe: "supabase_rest",
  },
  {
    id: "supabase_storage",
    vendor: "Supabase Storage",
    consumers: ["upload de prints", "label_spreadsheet_uploads", "ai_print_cache"],
    frequency: "médio",
    timeout_ms: 30_000,
    retries: 2,
    backoff: "exp+jitter",
    circuit_breaker: "external-call",
    rate_limit: "conforme plano",
    cache: "URLs assinadas com TTL 1h",
    fallback: "Upload falho → fila local no worker; reprocessa em 5min.",
    health_probe: "storage",
  },
  {
    id: "supabase_auth",
    vendor: "Supabase Auth (GoTrue)",
    consumers: ["frontend login", "edges com verify_jwt"],
    frequency: "alto (cada sessão)",
    timeout_ms: 8_000,
    retries: 1,
    backoff: "fixed",
    circuit_breaker: "none",
    rate_limit: "conforme plano",
    cache: "JWT cache no client (anon key) + refresh automático",
    fallback: "Token expirado → refresh transparente. Auth down → portal público continua via OTP/token.",
    health_probe: "supabase_auth",
  },
  {
    id: "openai",
    vendor: "OpenAI / Lovable AI Gateway",
    consumers: ["ai_service.ts", "ai_print_cache", "edges de IA"],
    frequency: "médio",
    timeout_ms: 30_000,
    retries: 2,
    backoff: "exp+jitter",
    circuit_breaker: "external-call",
    rate_limit: "ai_quota_user (quota por usuário/dia)",
    cache: "ai_print_cache + ai_quota_user (dedupe por hash do input)",
    fallback: "Falha de IA → fallback heurístico (rule-based) onde existir; caso contrário, marca job como needs_review.",
    health_probe: "openai",
  },
  {
    id: "kworb",
    vendor: "Kworb.net (scraping)",
    consumers: ["scrape-kworb cron"],
    frequency: "baixo (cron diário)",
    timeout_ms: 20_000,
    retries: 2,
    backoff: "exp+jitter",
    circuit_breaker: "external-call",
    rate_limit: "1 req/3s (educado)",
    cache: "raw_chart_daily snapshot 24h",
    fallback: "Skip ciclo; reprograma próximo cron. Sem impacto operacional crítico.",
    health_probe: "kworb",
  },
  {
    id: "webhook",
    vendor: "Webhooks de saída (ops-alerts, Slack)",
    consumers: ["deliver-system-alerts-cron"],
    frequency: "médio (por alerta)",
    timeout_ms: 8_000,
    retries: 5,
    backoff: "exp+jitter",
    circuit_breaker: "external-call",
    rate_limit: "respeita 429 do destino",
    cache: "n/a",
    fallback: "DLQ em system_alerts.delivery_attempts; troca de canal (email ↔ slack).",
    health_probe: "webhook",
  },
];

export function findIntegration(id: string): IntegrationPolicy | undefined {
  return INTEGRATIONS.find((i) => i.id === id);
}
