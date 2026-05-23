// invite-team-member — convida usuário e atribui role.
// 🔐 Audit #12 — usa requireTeamAccess (padrão), paginação real em listUsers,
// check de código de erro 23505 (não string match).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireTeamAccess } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-api-version, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jr(p: unknown, status = 200): Response {
  return new Response(JSON.stringify(p), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function findUserByEmailPaginated(admin: any, email: string): Promise<{ id: string } | null> {
  const target = email.toLowerCase();
  const PAGE_SIZE = 200;
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: PAGE_SIZE });
    if (error) throw new Error(`listUsers page=${page}: ${error.message}`);
    const users = data?.users ?? [];
    const found = users.find((u: any) => (u.email ?? "").toLowerCase() === target);
    if (found) return found;
    if (users.length < PAGE_SIZE) return null; // última página
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // 🔐 Audit #12 — usa shared guard (admin/curador apenas — admin checado depois)
    const guard = await requireTeamAccess(req);
    if (!guard.ok) return guard.resp;

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const authHeader = req.headers.get("Authorization") ?? "";

    let payload: { email?: string; role?: string };
    try { payload = await req.json(); } catch { return jr({ ok: false, error: "invalid json" }, 400); }
    const email = String(payload.email ?? "").trim().toLowerCase();
    const role = String(payload.role ?? "").trim();

    // Validação simples (Audit #12)
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 255) {
      return jr({ ok: false, error: "email inválido" }, 400);
    }
    if (!["admin", "curador"].includes(role)) {
      return jr({ ok: false, error: "role inválido (admin|curador)" }, 400);
    }

    // Apenas admin pode convidar (curador não)
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) return jr({ ok: false, error: "não autenticado" }, 401);

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: callerRoles } = await admin
      .from("user_roles").select("role").eq("user_id", user.id).eq("role", "admin");
    if (!callerRoles || callerRoles.length === 0) {
      return jr({ ok: false, error: "Apenas admins podem convidar pessoas" }, 403);
    }

    // Busca paginada (Audit #12 — antes só pegava primeiros 200)
    let targetUser: { id: string } | null;
    try {
      targetUser = await findUserByEmailPaginated(admin, email);
    } catch (e) {
      return jr({ ok: false, error: (e as Error).message }, 500);
    }

    let targetUserId: string;
    let invited = false;

    if (targetUser) {
      targetUserId = targetUser.id;
    } else {
      const siteUrl = req.headers.get("origin") ?? "https://engine.nexcreatorx.com";
      const { data: invite, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
        redirectTo: `${siteUrl}/reset-password`,
      });
      if (inviteErr || !invite?.user) {
        return jr({
          ok: false,
          error: `Não foi possível convidar por email: ${inviteErr?.message ?? "erro desconhecido"}. Peça à pessoa para criar conta em /login e atribua o papel depois.`,
        }, 400);
      }
      targetUserId = invite.user.id;
      invited = true;
    }

    // Atribui o papel — Audit #12: checa code 23505 (unique_violation), não string match
    const { error: roleErr } = await admin
      .from("user_roles")
      .insert({ user_id: targetUserId, role, created_by: user.id });

    if (roleErr && (roleErr as any).code !== "23505") {
      return jr({ ok: false, error: roleErr.message }, 500);
    }

    return jr({ ok: true, invited, user_id: targetUserId });
  } catch (e) {
    return jr({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
