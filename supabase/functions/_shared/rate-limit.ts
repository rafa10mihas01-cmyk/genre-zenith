// Shared distributed rate limit + AI quota helpers.
// Uses the public.bump_rate_limit RPC and public.ai_quota_user table.
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

let _admin: ReturnType<typeof createClient> | null = null;
function admin() {
  if (!_admin) {
    _admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false },
    });
  }
  return _admin;
}

export function clientIp(req: Request): string {
  const h = req.headers;
  return (
    h.get("cf-connecting-ip") ||
    h.get("x-real-ip") ||
    (h.get("x-forwarded-for") || "").split(",")[0].trim() ||
    "unknown"
  );
}

export interface RateLimitResult {
  allowed: boolean;
  count: number;
  limit: number;
}

/**
 * Distributed rate limit. Fails-open if RPC fails (don't block users on infra hiccups).
 * @param key Unique key (e.g. `getDealPublic:${ip}`).
 * @param windowSeconds Rolling window in seconds.
 * @param limit Max calls per window.
 */
export async function checkRateLimit(
  key: string,
  windowSeconds = 60,
  limit = 60,
): Promise<RateLimitResult> {
  try {
    const { data, error } = await admin().rpc("bump_rate_limit", {
      p_key: key,
      p_window_seconds: windowSeconds,
      p_limit: limit,
    });
    if (error || !data) return { allowed: true, count: 0, limit };
    const d = data as { allowed: boolean; count: number; limit: number };
    return { allowed: !!d.allowed, count: d.count ?? 0, limit: d.limit ?? limit };
  } catch {
    return { allowed: true, count: 0, limit };
  }
}

export function rateLimitResponse(corsHeaders: Record<string, string>) {
  return new Response(
    JSON.stringify({ ok: false, error: "rate_limited", code: "RATE_LIMITED" }),
    {
      status: 429,
      headers: { ...corsHeaders, "Content-Type": "application/json", "Retry-After": "60" },
    },
  );
}

// ---------- AI quota ----------

export interface AiQuotaResult {
  allowed: boolean;
  used: number;
  cap: number;
  blocked: boolean;
}

/** Check if user can spend AI tokens this month. Fails-open on infra error. */
export async function checkAiQuota(userId: string): Promise<AiQuotaResult> {
  try {
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    const ms = monthStart.toISOString().slice(0, 10);
    const { data } = await admin()
      .from("ai_quota_user")
      .select("tokens_used, cap_tokens, blocked")
      .eq("user_id", userId)
      .eq("month_start", ms)
      .maybeSingle();
    const used = Number((data as any)?.tokens_used ?? 0);
    const cap = Number((data as any)?.cap_tokens ?? 5_000_000);
    const blocked = Boolean((data as any)?.blocked ?? false);
    return { allowed: !blocked && used < cap, used, cap, blocked };
  } catch {
    return { allowed: true, used: 0, cap: 5_000_000, blocked: false };
  }
}

/** Increment AI tokens used (called after a successful AI call). */
export async function bumpAiQuota(userId: string, tokens: number): Promise<void> {
  if (!userId || !tokens || tokens <= 0) return;
  try {
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    const ms = monthStart.toISOString().slice(0, 10);
    await admin().rpc("bump_ai_quota", {
      p_user_id: userId,
      p_month_start: ms,
      p_tokens: tokens,
    });
  } catch {
    /* fail-silent */
  }
}

/** Log a single AI call into ai_usage_log for cost attribution. */
export interface AiUsageLog {
  userId?: string | null;
  functionName: string;
  provider?: string; // 'lovable' | 'claude' | ...
  model?: string | null;
  tokensIn?: number | null;
  tokensOut?: number | null;
  tokensTotal?: number | null;
  durationMs?: number | null;
  status?: "ok" | "error";
  error?: string | null;
  metadata?: Record<string, unknown>;
}

export async function logAiUsage(entry: AiUsageLog): Promise<void> {
  try {
    await admin().rpc("log_ai_usage", {
      p_user_id: entry.userId ?? null,
      p_function_name: entry.functionName,
      p_provider: entry.provider ?? "lovable",
      p_model: entry.model ?? null,
      p_tokens_in: entry.tokensIn ?? null,
      p_tokens_out: entry.tokensOut ?? null,
      p_tokens_total: entry.tokensTotal ?? null,
      p_duration_ms: entry.durationMs ?? null,
      p_status: entry.status ?? "ok",
      p_error: entry.error ?? null,
      p_metadata: entry.metadata ?? {},
    });
  } catch {
    /* fail-silent */
  }
}

export function aiQuotaResponse(corsHeaders: Record<string, string>) {
  return new Response(
    JSON.stringify({
      ok: false,
      error: "ai_quota_exceeded",
      code: "AI_QUOTA_EXCEEDED",
    }),
    {
      status: 429,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
}
