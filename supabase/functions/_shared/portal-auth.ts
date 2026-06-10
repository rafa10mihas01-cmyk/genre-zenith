// Helper de gating do portal do cliente.
// Se a campanha tem AO MENOS 1 e-mail em campaign_access_emails, o endpoint
// exige um JWT válido (Authorization: Bearer <jwt>) emitido por
// verify-campaign-otp para AQUELA campanha. Caso contrário, deixa passar
// (legado — campanhas sem PIN continuam abertas por token).
import { verifyAccessJwt } from "./campaign-access-jwt.ts";

export interface GateResult {
  ok: boolean;
  status?: number;
  error?: string;
  email?: string;
}

export async function gateCampaignAccess(
  _req: Request,
  // deno-lint-ignore no-explicit-any
  _admin: any,
  campaignId: string,
): Promise<GateResult> {
  if (!campaignId) return { ok: false, status: 400, error: "missing_campaign" };
  // OTP gate temporariamente desabilitado — sempre libera.
  return { ok: true };
}
