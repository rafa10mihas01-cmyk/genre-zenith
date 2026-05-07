// approve-community-participation — admin/team aprova ou recusa uma participação.
// Atualiza status, soma pontos no membro e retorna o novo total.
// Membro NÃO consegue chamar (RLS + checagem de role).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userRes } = await userClient.auth.getUser();
    const user = userRes?.user;
    if (!user) {
      return new Response(JSON.stringify({ error: "not_authenticated" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(supabaseUrl, serviceKey);

    // Confere role admin/curador
    const { data: roles } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id);
    const allowed = (roles ?? []).some((r) => ["admin", "curador"].includes(r.role));
    if (!allowed) {
      return new Response(JSON.stringify({ error: "forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const { participation_id, action, points, note } = body ?? {};
    if (!participation_id || !["approve", "reject"].includes(action)) {
      return new Response(JSON.stringify({ error: "invalid_input" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: part, error: pErr } = await admin
      .from("community_participations")
      .select("id, member_id, status, points_offered")
      .eq("id", participation_id)
      .maybeSingle();
    if (pErr || !part) {
      return new Response(JSON.stringify({ error: "not_found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!["accepted", "submitted"].includes(part.status)) {
      return new Response(JSON.stringify({ error: "invalid_state" }), {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const awarded =
      action === "approve"
        ? Math.max(0, Number.isFinite(points) ? Number(points) : Number(part.points_offered) || 0)
        : 0;

    const { error: uErr } = await admin
      .from("community_participations")
      .update({
        status: action === "approve" ? "approved" : "rejected",
        points_awarded: awarded,
        review_note: note ?? null,
        reviewed_by: user.id,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", participation_id);
    if (uErr) throw uErr;

    if (awarded > 0) {
      const { data: m } = await admin
        .from("community_members")
        .select("points,tier")
        .eq("id", part.member_id)
        .maybeSingle();
      const newPoints = (m?.points ?? 0) + awarded;
      const newTier = newPoints >= 2001 ? "ouro" : newPoints >= 501 ? "prata" : "bronze";
      await admin
        .from("community_members")
        .update({ points: newPoints, tier: newTier })
        .eq("id", part.member_id);
    }

    return new Response(JSON.stringify({ ok: true, awarded }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
