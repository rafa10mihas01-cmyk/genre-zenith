// Helpers de gating dos portais públicos (cliente e curador).
//
// Regra opt-in por entidade:
//   - Campanha tem ≥1 e-mail em `campaign_access_emails` → portal exige JWT
//     emitido por `verify-campaign-otp` para AQUELA campanha.
//   - Deal de curador tem ≥1 e-mail em `curator_deal_access_emails` OU o curador
//     ligado tem `email` cadastrado → portal exige JWT emitido por
//     `verify-curator-otp` para AQUELE deal.
//   - Se nenhuma allowlist existe, o portal abre só com o token (legado).
//
// Hardening 4.B.1.A (17/06/2026): reativa o gate (antes retornava ok:true).
import { verifyAccessJwt } from "./campaign-access-jwt.ts";
import { verifyCuratorAccessJwt } from "./curator-access-jwt.ts";

export interface GateResult {
  ok: boolean;
  status?: number;
  error?: string;
  email?: string;
}

function bearer(req: Request): string {
  const h = req.headers.get("x-portal-jwt") ?? req.headers.get("authorization") ?? "";
  if (!h) return "";
  if (h.toLowerCase().startsWith("bearer ")) return h.slice(7).trim();
  return h.trim();
}

// deno-lint-ignore no-explicit-any
async function campaignHasAllowlist(admin: any, campaignId: string): Promise<boolean> {
  const { count, error } = await admin
    .from("campaign_access_emails")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaignId);
  if (error) return false;
  return (count ?? 0) > 0;
}

// deno-lint-ignore no-explicit-any
async function dealHasAllowlist(admin: any, dealId: string, curatorId: string | null): Promise<boolean> {
  const [{ count: emails }, curatorRes] = await Promise.all([
    admin
      .from("curator_deal_access_emails")
      .select("id", { count: "exact", head: true })
      .eq("deal_id", dealId),
    curatorId
      ? admin.from("curators").select("email").eq("id", curatorId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  if ((emails ?? 0) > 0) return true;
  // deno-lint-ignore no-explicit-any
  const curEmail = (curatorRes as any)?.data?.email;
  return !!(curEmail && String(curEmail).trim());
}

/**
 * Gating do portal do cliente.
 * - Sem allowlist → passa (compat legada com links sem PIN configurado).
 * - Com allowlist → exige JWT válido pra esta campanha+token.
 */
export async function gateCampaignAccess(
  req: Request,
  // deno-lint-ignore no-explicit-any
  admin: any,
  campaignId: string,
  expectedToken?: string,
): Promise<GateResult> {
  if (!campaignId) return { ok: false, status: 400, error: "missing_campaign" };

  const required = await campaignHasAllowlist(admin, campaignId);
  if (!required) return { ok: true };

  const jwt = bearer(req);
  if (!jwt) return { ok: false, status: 401, error: "otp_required" };

  const payload = await verifyAccessJwt(jwt);
  if (!payload) return { ok: false, status: 401, error: "invalid_jwt" };
  if (payload.campaign_id !== campaignId) {
    return { ok: false, status: 403, error: "jwt_scope_mismatch" };
  }
  if (expectedToken && payload.token && payload.token !== expectedToken) {
    return { ok: false, status: 403, error: "jwt_token_mismatch" };
  }
  return { ok: true, email: payload.email };
}

/**
 * Gating do portal do curador (Onda 1 do hardening 4.B.1.A).
 * - Sem allowlist (deal sem e-mails autorizados nem curador com e-mail) → passa.
 * - Com allowlist → exige JWT válido pra este deal+token.
 */
export async function gateCuratorAccess(
  req: Request,
  // deno-lint-ignore no-explicit-any
  admin: any,
  dealId: string,
  curatorId: string | null,
  expectedToken?: string,
): Promise<GateResult> {
  if (!dealId) return { ok: false, status: 400, error: "missing_deal" };

  const required = await dealHasAllowlist(admin, dealId, curatorId);
  if (!required) return { ok: true };

  const jwt = bearer(req);
  if (!jwt) return { ok: false, status: 401, error: "otp_required" };

  const payload = await verifyCuratorAccessJwt(jwt);
  if (!payload) return { ok: false, status: 401, error: "invalid_jwt" };
  if (payload.deal_id !== dealId) {
    return { ok: false, status: 403, error: "jwt_scope_mismatch" };
  }
  if (expectedToken && payload.token && payload.token !== expectedToken) {
    return { ok: false, status: 403, error: "jwt_token_mismatch" };
  }

  // Autoridade final de expiração = estado do deal, não o relógio do JWT.
  // O link permanece válido enquanto o deal estiver aberto. Bloqueia quando:
  //   - admin/operador encerrou o deal (closed_at preenchido), ou
  //   - o share token foi revogado manualmente (token_revoked_at), ou
  //   - foi marcado um closed_status final (ex.: 'concluido', 'encerrado', 'cancelado').
  const { data: dealRow } = await admin
    .from("curator_deals")
    .select("id, closed_at, closed_status, token_revoked_at")
    .eq("id", dealId)
    .maybeSingle();
  if (!dealRow) return { ok: false, status: 404, error: "deal_not_found" };
  if (dealRow.token_revoked_at) return { ok: false, status: 403, error: "deal_revoked" };
  if (dealRow.closed_at || dealRow.closed_status) {
    return { ok: false, status: 403, error: "deal_closed" };
  }

  return { ok: true, email: payload.email };
}
