// sync-managed-playlists — sync completo das managed_playlists ATIVAS:
//   1. busca followers + tracks_count via Spotify Web API
//   2. atualiza managed_playlists
//   3. dispara playlist-brain-calc pra recalcular score
//   4. registra cada execução em sync_log
// Body: { playlist_id?: string, source?: string }
import { corsHeaders } from "npm:@supabase/supabase-js/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { requireTeamAccess } from "../_shared/auth.ts";
import { getAppToken, SpotifyCircuitOpenError, withSpotifyCtx } from "../_shared/spotify-client.ts";
import { reportCronHealth } from "../_shared/cron-health.ts";
import { getPlaylistMeta } from "../_shared/spotify-playlist.ts";
import { enqueuePlaylistJob } from "../_shared/playlist-queue.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function fetchMeta(id: string, token: string) {
  try {
    const meta = await getPlaylistMeta(id, token, { fields: "followers(total),tracks(total),name,images,description" });
    return {
      followers: meta.followers ?? 0,
      tracks_count: meta.tracks_total ?? 0,
      name: meta.name || null,
      cover_url: meta.cover_url,
      description: meta.description,
    };
  } catch {
    return null;
  }
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
  const playlistId: string | undefined = body?.playlist_id;
  const rawTier: string | undefined = body?.tier;
  const tier: "hot" | "warm" | "cold" | "__all__" | null =
    rawTier === "hot" || rawTier === "warm" || rawTier === "cold" || rawTier === "__all__"
      ? rawTier
      : null;
  const limit: number = Math.min(Math.max(Number(body?.limit) || 300, 1), 500);
  const source: string = isCron ? `cron${tier ? `:${tier}` : ""}` : (body?.source ?? "manual");
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  let synced = 0, failed = 0, recalculated = 0;
  const errors: string[] = [];

  try {
    // Resolve IDs por tier via RPC SQL (subqueries com EXISTS/NOT EXISTS).
    // Quando não há tier (ou playlist_id), comportamento legado: todas as ativas.
    let targetIds: string[] | null = null;
    if (playlistId) {
      targetIds = [playlistId];
    } else if (tier && tier !== "__all__") {
      const cutoff30d = new Date(Date.now() - 30 * 86400_000).toISOString();
      const cutoff14d = new Date(Date.now() - 14 * 86400_000).toISOString();
      const cutoff180d = new Date(Date.now() - 180 * 86400_000).toISOString();

      if (tier === "hot") {
        const { data, error } = await supabase.rpc("sync_tier_hot_ids", {
          p_limit: limit, p_cutoff: cutoff30d,
        });
        if (error) throw new Error(`hot tier: ${error.message}`);
        targetIds = (data ?? []).map((r: { id: string }) => r.id);
      } else if (tier === "warm") {
        const { data, error } = await supabase.rpc("sync_tier_warm_ids", {
          p_limit: limit, p_cutoff_imported: cutoff180d, p_cutoff_metrics: cutoff14d, p_cutoff_alloc: cutoff30d,
        });
        if (error) throw new Error(`warm tier: ${error.message}`);
        targetIds = (data ?? []).map((r: { id: string }) => r.id);
      } else {
        const { data, error } = await supabase.rpc("sync_tier_cold_ids", {
          p_limit: limit, p_cutoff_imported: cutoff180d, p_cutoff_metrics: cutoff14d, p_cutoff_alloc: cutoff30d,
        });
        if (error) throw new Error(`cold tier: ${error.message}`);
        targetIds = (data ?? []).map((r: { id: string }) => r.id);
      }
    }

    let q = supabase.from("managed_playlists")
      .select("id, spotify_playlist_id, canonical_playlist_id, name, cover_url, owner_spotify_user_id")
      .is("archived_at", null);
    if (targetIds) {
      if (targetIds.length === 0) {
        // tier vazio: nada a processar
        await supabase.from("sync_log").insert({
          source, tier, synced: 0, failed: 0, recalculated: 0, errors: null,
          duration_ms: Date.now() - startedAt,
        });
        if (isCron) {
          await reportCronHealth(supabase, {
            job_name: `sync-managed-playlists${tier ? `-${tier}` : ""}`,
            status: "ok", startedAt, metrics: { synced: 0, failed: 0, recalculated: 0, tier },
          });
        }
        return jr({ ok: true, tier, synced: 0, failed: 0, recalculated: 0 });
      }
      q = q.in("id", targetIds);
    } else {
      q = q.order("last_metrics_at", { ascending: true, nullsFirst: true }).limit(limit);
    }
    const { data: pls, error } = await q;
    if (error) throw new Error(error.message);

    if (pls && pls.length > 0) {
      const token = await getAppToken();
      const CONCURRENCY = 1;
      const BATCH_DELAY_MS = 5000;
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

      const processOne = async (p: typeof pls[number]) => {
        const ownerId = (p as any).owner_spotify_user_id ?? null;
        return withSpotifyCtx(
          {
            playlist_id: p.id,
            owner_id: ownerId,
            spotify_user_id: ownerId,
            function_name: "sync-managed-playlists",
          },
          async () => {
            try {
              const meta = await fetchMeta(p.spotify_playlist_id, token);
              if (!meta) { failed++; return; }
              const update: Record<string, unknown> = {
                followers: meta.followers,
                tracks_count: meta.tracks_count,
                last_metrics_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              };
              if (meta.name && meta.name !== p.name) update.name = meta.name;
              if (meta.cover_url && meta.cover_url !== p.cover_url) update.cover_url = meta.cover_url;
              let canonicalId = p.canonical_playlist_id;
              if (!canonicalId) {
                const { data: canonical, error: canonicalError } = await supabase
                  .from("playlists")
                  .upsert({
                    spotify_playlist_id: p.spotify_playlist_id,
                    name: meta.name ?? p.name,
                    ownership: "own",
                    source: "managed",
                    followers: meta.followers,
                    cover_url: meta.cover_url ?? p.cover_url,
                    monitored: true,
                    last_seen_at: new Date().toISOString(),
                  }, { onConflict: "spotify_playlist_id" })
                  .select("id")
                  .single();
                if (canonicalError) throw new Error(canonicalError.message);
                canonicalId = canonical.id;
                update.canonical_playlist_id = canonicalId;
              } else {
                await supabase.from("playlists").update({
                  name: meta.name ?? p.name,
                  followers: meta.followers,
                  cover_url: meta.cover_url ?? p.cover_url,
                  ownership: "own",
                  source: "managed",
                  monitored: true,
                  last_seen_at: new Date().toISOString(),
                }).eq("id", canonicalId);
              }

              await supabase.from("managed_playlists").update(update).eq("id", p.id);
              synced++;

              if (canonicalId) {
                // fire-and-forget pra não bloquear o sync
                fetch(`${SUPABASE_URL}/functions/v1/playlist-brain-calc`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
                  body: JSON.stringify({ playlist_id: canonicalId }),
                }).then((r) => { if (r.ok) recalculated++; }).catch(() => {});
              }

              // Enfileira AUTO_SYNC da playlist (dedupe ativo: skippa se já pending).
              await enqueuePlaylistJob(supabase, {
                playlist_id: p.id,
                operation_type: "AUTO_SYNC",
              }).catch(() => { /* best-effort */ });
            } catch (e) {
              if (e instanceof SpotifyCircuitOpenError) throw e;
              failed++;
              errors.push(`${p.name}: ${(e as Error).message}`);
            }
          },
        );
      };

      // processa em lotes de 10 com 2s de pausa entre lotes (rate-limit Spotify)
      for (let i = 0; i < pls.length; i += CONCURRENCY) {
        const chunk = pls.slice(i, i + CONCURRENCY);
        await Promise.all(chunk.map(processOne));
        if (i + CONCURRENCY < pls.length) await sleep(BATCH_DELAY_MS);
      }
    }


    await supabase.from("sync_log").insert({
      source, tier, synced, failed, recalculated,
      errors: errors.length ? errors.slice(0, 20) : null,
      duration_ms: Date.now() - startedAt,
    });

    if (isCron) {
      await reportCronHealth(supabase, {
        job_name: `sync-managed-playlists${tier ? `-${tier}` : ""}`,
        status: failed === 0 ? "ok" : (synced === 0 ? "error" : "partial"),
        startedAt,
        metrics: { synced, failed, recalculated, tier },
      });
    }

    return jr({ ok: true, tier, synced, failed, recalculated, errors: errors.slice(0, 5) });
  } catch (e) {
    await supabase.from("sync_log").insert({
      source, tier, synced, failed, recalculated,
      errors: [(e as Error).message],
      duration_ms: Date.now() - startedAt,
    });
    if (isCron) {
      await reportCronHealth(supabase, {
        job_name: `sync-managed-playlists${tier ? `-${tier}` : ""}`,
        status: "error",
        startedAt,
        message: (e as Error).message,
      });
    }
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
