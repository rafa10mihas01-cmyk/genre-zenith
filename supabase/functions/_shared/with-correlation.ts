// FASE 4.C.1 — Correlation ID helper compartilhado.
//
// Cadeia única ponta-a-ponta. Toda edge function/worker que tocar a cadeia
// BOT → Gateway → Parser → Match → Writer → Delivery DEVE usar este helper.
//
// Regras:
// 1. Se o request chegou com `x-correlation-id` (header) ou `correlation_id`
//    no body, ele é REUTILIZADO (nunca sobrescrito).
// 2. Caso contrário, geramos um novo `crrl_<uuid-short>` na origem (BOT).
// 3. Toda Response devolve o header `x-correlation-id`.
// 4. Toda Response de ERRO inclui `correlation_id` no JSON body — o frontend
//    exibe pro usuário pra cross-ref com logs.
// 5. Persistir em qualquer tabela com coluna `correlation_id` (ver
//    AUDIT_PHASE_4C1_AFTER.md pra lista).

export type Correlated<T> = T & { correlation_id: string };

const HEADER = "x-correlation-id";

function shortUuid(): string {
  // crypto.randomUUID já existe em Deno edge runtime.
  const u = crypto.randomUUID().replace(/-/g, "");
  return `crrl_${u.slice(0, 16)}`;
}

/** Lê o correlation_id do request (header ou body). Gera se ausente. */
export async function extractCorrelationId(req: Request): Promise<{ correlationId: string; body: any | null }> {
  const headerId = req.headers.get(HEADER) ?? req.headers.get("x-request-id");
  let body: any = null;
  if (req.method !== "GET" && req.method !== "HEAD") {
    try {
      const cloned = req.clone();
      const text = await cloned.text();
      if (text) body = JSON.parse(text);
    } catch { /* body não-JSON, ignora */ }
  }
  const bodyId = body && typeof body === "object" ? (body.correlation_id ?? body.correlationId) : null;
  const correlationId = (headerId || bodyId || shortUuid()) as string;
  return { correlationId, body };
}

/** Envelopa Response adicionando o header de correlation_id. */
export function withCorrelationHeader(res: Response, correlationId: string): Response {
  const headers = new Headers(res.headers);
  headers.set(HEADER, correlationId);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

/** Helper pra retornar erro padronizado com correlation_id no body. */
export function correlatedError(opts: {
  status: number;
  error: string;
  message?: string;
  correlationId: string;
  cors?: Record<string, string>;
}): Response {
  const body = {
    ok: false,
    error: opts.error,
    message: opts.message ?? opts.error,
    correlation_id: opts.correlationId,
  };
  return new Response(JSON.stringify(body), {
    status: opts.status,
    headers: {
      "Content-Type": "application/json",
      [HEADER]: opts.correlationId,
      ...(opts.cors ?? {}),
    },
  });
}

/** Cabeçalho pronto pra repassar a outras edge functions / RPCs HTTP. */
export function propagateHeaders(correlationId: string, extra: Record<string, string> = {}): Record<string, string> {
  return { [HEADER]: correlationId, ...extra };
}

/** Marca metadata pra inserts em tabelas que ainda não têm coluna dedicada. */
export function tagMetadata<T extends Record<string, unknown>>(meta: T, correlationId: string): T & { correlation_id: string } {
  return { ...meta, correlation_id: correlationId };
}

export const CORRELATION_HEADER = HEADER;
