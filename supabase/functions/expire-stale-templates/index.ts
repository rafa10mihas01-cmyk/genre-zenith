// expire-stale-templates — arquiva templates ⚠️ medium não usados há mais de N horas (default 72h).
// Mantém o pool de criação enxuto, evita acúmulo de ruído.
//
// POST { hours?: number }  // default 72
import { corsHeaders } from "npm:@supabase/supabase-js/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { requireTeamAccess } from "../_shared/auth.ts";

import { deprecationGate } from "../_shared/_deprecation.ts";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  const __dep = await deprecationGate(req, "expire-stale-templates");
  if (__dep) return __dep;
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jr({ error: "POST only" }, 405);

  const guard = await requireTeamAccess(req);
  if (!guard.ok) return guard.resp;

  let body: { hours?: number } = {};
  try { body = await req.json(); } catch { /* ok */ }

  const hours = typeof body.hours === "number" && body.hours > 0 ? Math.floor(body.hours) : 72;

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  const { data, error } = await supabase.rpc("expire_stale_medium_templates", { p_hours: hours });
  if (error) {
    console.error("[expire-stale-templates]", error);
    return jr({ ok: false, error: error.message }, 500);
  }

  const row = Array.isArray(data) ? data[0] : data;
  const expiredCount = row?.expired_count ?? 0;

  await supabase.from("collection_logs").insert({
    acao: "expire-stale-templates",
    status: "sucesso",
    mensagem: `${expiredCount} templates medium expiraram (>${hours}h sem uso)`,
  }).then(() => {}, (e) => console.error("[expire-stale-templates] log/op failed:", e?.message ?? e));

  return jr({ ok: true, expired: expiredCount, hours });
});
