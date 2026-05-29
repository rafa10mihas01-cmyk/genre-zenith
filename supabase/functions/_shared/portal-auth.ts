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
  req: Request,
  // deno-lint-ignore no-explicit-any
  admin: any,
  campaignId: string,
): Promise<GateResult> {
  if (!campaignId) return { ok: false, status: 400, error: "missing_campaign" };

  const { count } = await admin
    .from("campaign_access_emails")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaignId);

  if ((count ?? 0) === 0) return { ok: true };

  const auth = req.headers.get("authorization") || req.headers.get("Authorization") || "";
  // Aceita tanto "Bearer <jwt>" quanto cabeçalho custom x-portal-jwt.
  let jwt = "";
  if (auth.toLowerCase().startsWith("bearer ")) jwt = auth.slice(7).trim();
  if (!jwt) jwt = (req.headers.get("x-portal-jwt") || "").trim();

  if (!jwt) return { ok: false, status: 401, error: "auth_required" };

  const payload = await verifyAccessJwt(jwt);
  if (!payload) return { ok: false, status: 401, error: "invalid_session" };
  if (payload.campaign_id !== campaignId) {
    return { ok: false, status: 403, error: "wrong_campaign" };
  }
  return { ok: true, email: payload.email };
}
