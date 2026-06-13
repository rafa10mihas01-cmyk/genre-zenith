// recheck-archived-followers — rotina leve semanal que verifica se playlists
// arquivadas (archived_at IS NOT NULL) ultrapassaram o limite mínimo de saves.
// Quando passa, marca reactivation_eligible_at = now() pra revisão MANUAL.
//
// Nunca reativa automaticamente. Nunca chama brain/snapshot. Só atualiza
// followers e o marker de elegibilidade.
//
// Custo Spotify: ~100 playlists/execução × 1 chamada × 1×/semana = ~14/dia.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { requireTeamAccess } from "../_shared/auth.ts";
import { getAppToken, SpotifyCircuitOpenError } from "../_shared/spotify-client.ts";
import { getPlaylistMeta } from "../_shared/spotify-playlist.ts";
import { reportCronHealth } from "../_shared/cron-health.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";

// Mesmo limiar usado nos importadores. Manter sincronizado.
const REACTIVATION_THRESHOLD = 100;

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const isCron = CRON_SECRET && req.headers.get("x-cron-secret") === CRON_SECRET;
  if (!isCron) {
    const guard = await requireTeamAccess(req);
    if (!guard.ok) return guard.resp;
  }

  const startedAt = Date.now();
  const body = await req.json().catch(() => ({}));
  const limit: number = Math.min(Math.max(Number(body?.limit) || 100, 1), 300);
  const source = isCron ? "cron:archived-recheck" : (body?.source ?? "manual");

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  let checked = 0;
  let updated = 0;
  let newlyEligible = 0;
  let failed = 0;
  const errors: string[] = [];

  try {
    // Seleciona arquivadas que ainda não foram marcadas como elegíveis.
    // Ordena por last_metrics_at NULLS FIRST pra cobrir as mais "estagnadas".
    const { data: pls, error } = await sb
      .from("managed_playlists")
      .select("id, spotify_playlist_id, name, followers, archived_followers")
      .not("archived_at", "is", null)
      .is("reactivation_eligible_at", null)
      .order("last_metrics_at", { ascending: true, nullsFirst: true })
      .limit(limit);
    if (error) throw new Error(error.message);

    if (!pls || pls.length === 0) {
      await reportCronHealth(sb, {
        job_name: "recheck-archived-followers",
        status: "ok",
        startedAt,
        metrics: { checked: 0, updated: 0, newly_eligible: 0 },
      });
      return jr({ ok: true, checked: 0, updated: 0, newly_eligible: 0 });
    }

    const token = await getAppToken();
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

    for (const p of pls) {
      try {
        const meta = await getPlaylistMeta(p.spotify_playlist_id, token, {
          fields: "followers(total)",
        });
        const followers = meta.followers ?? 0;
        checked++;

        const update: Record<string, unknown> = {
          followers,
          last_metrics_at: new Date().toISOString(),
        };
        if (followers >= REACTIVATION_THRESHOLD) {
          update.reactivation_eligible_at = new Date().toISOString();
          newlyEligible++;
        }

        const { error: upErr } = await sb
          .from("managed_playlists")
          .update(update)
          .eq("id", p.id);
        if (upErr) {
          failed++;
          errors.push(`${p.name ?? p.id}: ${upErr.message}`);
        } else {
          updated++;
        }
      } catch (e) {
        if (e instanceof SpotifyCircuitOpenError) throw e;
        failed++;
        errors.push(`${p.name ?? p.id}: ${(e as Error).message}`);
      }

      // throttle leve — 300ms entre playlists (~3 rpm)
      await sleep(300);
    }

    await reportCronHealth(sb, {
      job_name: "recheck-archived-followers",
      status: failed === 0 ? "ok" : (updated === 0 ? "error" : "partial"),
      startedAt,
      metrics: { checked, updated, newly_eligible: newlyEligible, failed },
    });

    return jr({
      ok: true,
      checked,
      updated,
      newly_eligible: newlyEligible,
      failed,
      errors: errors.slice(0, 5),
    });
  } catch (e) {
    await reportCronHealth(sb, {
      job_name: "recheck-archived-followers",
      status: "error",
      startedAt,
      message: (e as Error).message,
    });
    if (e instanceof SpotifyCircuitOpenError) {
      return jr({
        ok: false,
        error: "SPOTIFY_CIRCUIT_OPEN",
        code: "spotify_circuit_open",
        blocked_until: e.blockedUntil,
        retry_after: e.retryAfterSec,
      }, 503);
    }
    return jr({ ok: false, error: (e as Error).message }, 500);
  }
});
