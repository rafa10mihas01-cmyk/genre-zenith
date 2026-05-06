// _shared/deal-access.ts
// Gate operacional do ciclo de vida do deal de curador.
// Usado em todas as edge functions que MUTAM dados do deal (importação, ingestão, prints, paste-import).
// Leitura continua livre — apenas mutações respeitam o estado.

export type DealLifecycle = {
  id: string;
  state: string | null;
  closed_at: string | null;
  token_revoked_at?: string | null;
  token_expires_at?: string | null;
};

export type DealGateResult =
  | { ok: true }
  | { ok: false; status: number; code: string; error: string };

/**
 * Valida se o deal está em estado operável (aceita mutações).
 * - closed/completed → 403 deal_closed
 * - paused → 403 deal_paused
 * - token_revoked_at preenchido → 403 token_revoked
 * - token_expires_at no passado → 403 token_expired
 */
export function assertDealOperable(deal: DealLifecycle | null | undefined): DealGateResult {
  if (!deal) return { ok: false, status: 404, code: "deal_not_found", error: "Deal não encontrado" };

  const state = (deal.state ?? "").toLowerCase();

  if (state === "closed" || state === "completed") {
    return {
      ok: false,
      status: 403,
      code: "deal_closed",
      error: "Este deal foi encerrado e não aceita mais alterações.",
    };
  }

  if (state === "paused") {
    return {
      ok: false,
      status: 403,
      code: "deal_paused",
      error: "Este deal está pausado. Reative-o para retomar a operação.",
    };
  }

  if (deal.token_revoked_at) {
    return {
      ok: false,
      status: 403,
      code: "token_revoked",
      error: "O link público deste deal foi revogado.",
    };
  }

  if (deal.token_expires_at) {
    const exp = new Date(deal.token_expires_at).getTime();
    if (Number.isFinite(exp) && exp < Date.now()) {
      return {
        ok: false,
        status: 403,
        code: "token_expired",
        error: "O link público deste deal expirou.",
      };
    }
  }

  return { ok: true };
}

/** Estados que entram na fila de coleta automática. */
export const COLLECTABLE_STATES = ["awaiting_playlists", "collecting", "active"] as const;
