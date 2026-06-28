// diagnose-managed-playlists-batch — roda diagnose-managed-playlist em lote.
// Seleciona playlists importadas que nunca foram diagnosticadas OU que estão
// há mais de 30 dias sem diagnóstico, e chama o diagnose uma por uma.
// Usado pelo cron `diagnose-managed-playlists-daily`.
import { corsHeaders } from "npm:@supabase/supabase-js/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { requireTeamAccess } from "../_shared/auth.ts";
import { reportCronHealth } from "../_shared/cron-health.ts";
import { enqueuePlaylistJob } from "../_shared/playlist-queue.ts";
import { getEditorialTier, shouldUseEditorialAI } from "../_shared/editorial-flag.ts";

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

  const startedAt = Date.now();
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    const body = await req.json().catch(() => ({}));
    const limit = Math.min(Math.max(Number(body?.limit ?? 25), 1), 100);
    const staleDays = Number(body?.stale_days ?? 30);
    const genreId = typeof body?.genre_id === "string" ? body.genre_id : null;

    const cutoff = new Date(Date.now() - staleDays * 24 * 60 * 60 * 1000).toISOString();

    let query = supabase
      .from("managed_playlists")
      .select("id, name, genre_id, last_diagnosis_at, followers")
      .neq("playlist_type", "ARCHIVED")
      .eq("diagnose_blocked", false)
      .or(`last_diagnosis_at.is.null,last_diagnosis_at.lt.${cutoff}`)
      .order("last_diagnosis_at", { ascending: true, nullsFirst: true })
      .limit(Math.max(1000, limit * 25));
    if (genreId) query = query.eq("genre_id", genreId);

    const { data: candidates, error } = await query;

    if (error) throw new Error(error.message);
    if (!candidates?.length) {
      await reportCronHealth(supabase, {
        job_name: "diagnose-managed-playlists-batch",
        status: "ok",
        startedAt,
        metrics: { processed: 0, ok_count: 0, failed: 0 },
      });
      return jr({ ok: true, processed: 0, results: [] });
    }

    const rows: typeof candidates = [];
    const remaining = [...candidates];
    while (rows.length < limit && remaining.length > 0) {
      const seen = new Set<string>();
      for (let i = 0; i < remaining.length && rows.length < limit;) {
        const key = String((remaining[i] as any).genre_id ?? "sem-genero");
        if (!seen.has(key) || seen.size === 0) {
          rows.push(remaining.splice(i, 1)[0]);
          seen.add(key);
        } else {
          i++;
        }
      }
      if (seen.size <= 1) break;
    }

    // Em vez de chamar diagnose-managed-playlist diretamente em loop sequencial,
    // enfileira jobs DIAGNOSE_ENGINE (priority 1). O playlist-queue-processor
    // executa em paralelo controlado (um por playlist), com retry/backoff.
    const editorialTier = await getEditorialTier(supabase);
    const results: Array<{ id: string; ok: boolean; skipped?: boolean; error?: string; ai?: boolean }> = [];
    for (const r of rows) {
      const useAi = shouldUseEditorialAI((r as any).followers, editorialTier);
      const enq = await enqueuePlaylistJob(supabase, {
        playlist_id: r.id,
        operation_type: "DIAGNOSE_ENGINE",
        payload: { skip_ai: !useAi, source: "batch" },
      });
      if (enq.ok && (enq as any).skipped) {
        results.push({ id: r.id, ok: true, skipped: true, ai: useAi });
      } else if (enq.ok) {
        results.push({ id: r.id, ok: true, ai: useAi });
      } else {
        results.push({ id: r.id, ok: false, error: enq.error, ai: useAi });
      }
    }

    const ok = results.filter((r) => r.ok).length;
    const failed = results.length - ok;
    const skipped = results.filter((r) => r.skipped).length;

    await reportCronHealth(supabase, {
      job_name: "diagnose-managed-playlists-batch",
      status: failed > 0 ? "partial" : "ok",
      startedAt,
      metrics: { enqueued: ok - skipped, skipped_dupe: skipped, failed },
    });

    return jr({ ok: true, enqueued: ok - skipped, skipped_dupe: skipped, failed, results });
  } catch (e) {
    await reportCronHealth(supabase, {
      job_name: "diagnose-managed-playlists-batch",
      status: "error",
      startedAt,
      message: (e as Error).message,
    });
    return jr({ ok: false, error: (e as Error).message }, 500);
  }
});
