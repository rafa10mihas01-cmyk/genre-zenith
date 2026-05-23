// diagnose-managed-playlists-batch — roda diagnose-managed-playlist em lote.
// Seleciona playlists importadas que nunca foram diagnosticadas OU que estão
// há mais de 30 dias sem diagnóstico, e chama o diagnose uma por uma.
// Usado pelo cron `diagnose-managed-playlists-daily`.
import { corsHeaders } from "npm:@supabase/supabase-js/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { requireTeamAccess } from "../_shared/auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const guard = await requireTeamAccess(req);
  if (!guard.ok) return guard.resp;

  const body = await req.json().catch(() => ({}));
  const limit = Math.min(Math.max(Number(body?.limit ?? 25), 1), 100);
  const staleDays = Number(body?.stale_days ?? 30);

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  const cutoff = new Date(Date.now() - staleDays * 24 * 60 * 60 * 1000).toISOString();

  // Prioriza quem NUNCA foi diagnosticado (last_diagnosis_at IS NULL),
  // depois os mais antigos.
  const { data: rows, error } = await supabase
    .from("managed_playlists")
    .select("id, name, last_diagnosis_at")
    .is("archived_at", null)
    .or(`last_diagnosis_at.is.null,last_diagnosis_at.lt.${cutoff}`)
    .order("last_diagnosis_at", { ascending: true, nullsFirst: true })
    .limit(limit);

  if (error) return jr({ ok: false, error: error.message }, 500);
  if (!rows?.length) return jr({ ok: true, processed: 0, results: [] });

  const results: Array<{ id: string; ok: boolean; error?: string }> = [];
  for (const r of rows) {
    try {
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/diagnose-managed-playlist`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${SERVICE_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ playlist_id: r.id, skip_ai: true, source: "batch" }),
      });
      const json = await resp.json().catch(() => ({}));
      results.push({ id: r.id, ok: resp.ok && json?.ok !== false, error: resp.ok ? undefined : (json?.error ?? `http_${resp.status}`) });
    } catch (e) {
      results.push({ id: r.id, ok: false, error: (e as Error).message });
    }
  }

  const ok = results.filter((r) => r.ok).length;
  const failed = results.length - ok;

  // Recalcula o cérebro depois pra refletir o novo last_diagnosis_at
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/playlist-brain-calc`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ batch: true, limit: 500 }),
    });
  } catch (_) { /* ignore */ }

  return jr({ ok: true, processed: results.length, ok_count: ok, failed, results });
});
