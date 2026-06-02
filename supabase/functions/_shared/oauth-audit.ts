// Helper de auditoria persistente do fluxo OAuth Spotify.
// Grava em public.spotify_oauth_audit usando service_role.
// Sempre fire-and-forget: nunca propaga erro pro fluxo principal.

export type OAuthAuditEvent =
  | "invite_created"
  | "invite_opened"
  | "login_started"
  | "callback_received"
  | "token_exchanged"
  | "account_connected"
  | "failure";

export type OAuthAuditFlow = "invite" | "admin" | "public";

export interface OAuthAuditFields {
  event: OAuthAuditEvent;
  flow?: OAuthAuditFlow | null;
  status?: "ok" | "error";
  error_code?: string | null;
  error_message?: string | null;
  state?: string | null;
  invite_token?: string | null;
  app_id?: string | null;
  spotify_user_id?: string | null;
  email?: string | null;
  display_name?: string | null;
  actor_user_id?: string | null;
  ip?: string | null;
  user_agent?: string | null;
  meta?: Record<string, unknown>;
}

export function extractRequestMeta(req: Request): { ip: string | null; user_agent: string | null } {
  const ip =
    req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    null;
  const user_agent = req.headers.get("user-agent") || null;
  return { ip, user_agent };
}

// Fire-and-forget. `sb` é um client service_role.
export async function logAudit(sb: any, fields: OAuthAuditFields): Promise<void> {
  try {
    const row = {
      event: fields.event,
      flow: fields.flow ?? null,
      status: fields.status ?? "ok",
      error_code: fields.error_code ?? null,
      error_message: fields.error_message ? String(fields.error_message).slice(0, 1000) : null,
      state: fields.state ?? null,
      invite_token: fields.invite_token ?? null,
      app_id: fields.app_id ?? null,
      spotify_user_id: fields.spotify_user_id ?? null,
      email: fields.email ?? null,
      display_name: fields.display_name ?? null,
      actor_user_id: fields.actor_user_id ?? null,
      ip: fields.ip ?? null,
      user_agent: fields.user_agent ? String(fields.user_agent).slice(0, 500) : null,
      meta: fields.meta ?? {},
    };
    await sb.from("spotify_oauth_audit").insert(row);
  } catch (e) {
    // Nunca falhar o fluxo principal por causa da auditoria
    console.error("[oauth-audit] insert failed:", (e as Error).message);
  }
}
