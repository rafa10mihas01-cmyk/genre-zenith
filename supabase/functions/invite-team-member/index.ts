import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const { email, role } = await req.json();
    if (!email || !["admin", "curador"].includes(role)) {
      return new Response(JSON.stringify({ ok: false, error: "Email e papel válido são obrigatórios" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Valida quem chamou
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ ok: false, error: "Não autenticado" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: callerRoles } = await admin
      .from("user_roles").select("role").eq("user_id", user.id).eq("role", "admin");
    if (!callerRoles || callerRoles.length === 0) {
      return new Response(JSON.stringify({ ok: false, error: "Apenas admins podem convidar pessoas" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verifica se já existe — se sim, só atribui o papel
    const { data: existing } = await admin.auth.admin.listUsers({ perPage: 200 });
    const found = existing?.users?.find((u) => (u.email ?? "").toLowerCase() === email.toLowerCase());

    let targetUserId: string;
    let invited = false;

    if (found) {
      targetUserId = found.id;
    } else {
      // Tenta enviar convite por email
      const { data: invite, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email);
      if (inviteErr || !invite?.user) {
        return new Response(JSON.stringify({
          ok: false,
          error: `Não foi possível convidar por email: ${inviteErr?.message ?? "erro desconhecido"}. Peça à pessoa para criar conta em /login e atribua o papel depois.`,
        }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      targetUserId = invite.user.id;
      invited = true;
    }

    // Atribui o papel (idempotente via UNIQUE)
    const { error: roleErr } = await admin
      .from("user_roles")
      .insert({ user_id: targetUserId, role, created_by: user.id });

    if (roleErr && !roleErr.message.includes("duplicate")) {
      return new Response(JSON.stringify({ ok: false, error: roleErr.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true, invited, user_id: targetUserId }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
