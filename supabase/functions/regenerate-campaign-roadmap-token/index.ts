// Regenera o roadmap_token de uma campanha — invalida o link público antigo
// sem afetar o portal protegido (que usa public_plan_token, campo distinto).
// Auth: requer usuário logado (admin). Não aceita acesso anônimo.

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return jr({ error: "unauthorized" }, 401);
  }

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const token = authHeader.replace("Bearer ", "");
  const { data: claims, error: claimsErr } = await userClient.auth.getClaims(token);
  if (claimsErr || !claims?.claims?.sub) {
    return jr({ error: "unauthorized" }, 401);
  }

  let campaignId = "";
  try {
    const body = await req.json();
    campaignId = String(body?.campaign_id ?? "").trim();
  } catch (_) { /* ignore */ }

  if (!/^[0-9a-f-]{36}$/i.test(campaignId)) {
    return jr({ error: "invalid_campaign_id" }, 400);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false },
  });

  // Gera novo token (mesma entropia do default da coluna: 18 bytes hex = 36 chars).
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  const newToken = Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");

  const { data, error } = await admin
    .from("campaigns")
    .update({ roadmap_token: newToken })
    .eq("id", campaignId)
    .select("id, roadmap_token")
    .maybeSingle();

  if (error) return jr({ error: error.message }, 500);
  if (!data) return jr({ error: "not_found" }, 404);

  return jr({ ok: true, roadmap_token: data.roadmap_token });
});
