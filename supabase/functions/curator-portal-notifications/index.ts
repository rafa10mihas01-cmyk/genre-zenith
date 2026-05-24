// curator-portal-notifications
// Lê/marca notificações da tabela `notifications` para o curador dono do deal
// identificado pelo public_token. Usado pelo CuratorNotificationsBell do portal público.
//
// Body:
//   { action: "list",      public_token: string, limit?: number }
//   { action: "mark_read", public_token: string, notification_id: string }
//
// Retorna { ok, notifications?, marked? } ou { ok:false, reason }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

type ListBody = { action: "list"; public_token: string; limit?: number };
type ReadBody = { action: "mark_read"; public_token: string; notification_id: string };
type Body = ListBody | ReadBody;

async function resolveCuratorUserId(publicToken: string): Promise<string | null> {
  const { data: deal } = await admin
    .from("curator_deals")
    .select("curator_id")
    .eq("public_token", publicToken)
    .maybeSingle();
  if (!deal?.curator_id) return null;
  const { data: curator } = await admin
    .from("curators")
    .select("user_id")
    .eq("id", deal.curator_id)
    .maybeSingle();
  return curator?.user_id ?? null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = (await req.json()) as Body;
    if (!body?.public_token || typeof body.public_token !== "string") {
      return json({ ok: false, reason: "public_token_required" }, 400);
    }

    const userId = await resolveCuratorUserId(body.public_token);
    if (!userId) {
      return json({ ok: true, notifications: [] });
    }

    if (body.action === "list") {
      const limit = Math.min(Math.max(body.limit ?? 20, 1), 50);
      const { data, error } = await admin
        .from("notifications")
        .select("id, type, title, message, action_url, read, created_at, metadata")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) return json({ ok: false, reason: error.message }, 500);
      return json({ ok: true, notifications: data ?? [] });
    }

    if (body.action === "mark_read") {
      if (!body.notification_id) return json({ ok: false, reason: "notification_id_required" }, 400);
      const { error } = await admin
        .from("notifications")
        .update({ read: true })
        .eq("id", body.notification_id)
        .eq("user_id", userId);
      if (error) return json({ ok: false, reason: error.message }, 500);
      return json({ ok: true, marked: true });
    }

    return json({ ok: false, reason: "unknown_action" }, 400);
  } catch (e) {
    return json({ ok: false, reason: (e as Error).message }, 500);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
