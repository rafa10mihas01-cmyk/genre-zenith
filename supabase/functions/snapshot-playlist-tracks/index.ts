// snapshot-playlist-tracks — Cron diário.
// Captura hash dos top 50 track IDs de playlists alvo. Só grava nova linha
// quando o hash mudou (= playlist trocou tracks).
//
// Garantias por execução:
//   - Retenção: apaga snapshots com captured_at < NOW() - 60 dias.
//   - MINIMUM: TODAS as managed_playlists são processadas em todo run
//     (mesmo que não tenham mudado — força registro de "ainda igual" via
//     no-op skip; o snapshot anterior comprova continuidade).
//   - PLUS: tier=leader (todos) + sample 20% medium até `limit`.
//   - Auto-archive: managed_playlists que retornam 404 (apagadas no Spotify)
//     viram archived_at = now() pra parar de poluir o status do cron.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { getSpotifyTokenWithApp, SpotifyAuthInvalidError, markAppAuthFailure } from "../_shared/spotify.ts";
import { listPlaylistTrackRefs, SpotifyApiError } from "../_shared/spotify-playlist.ts";
import { reportCronHealth } from "../_shared/cron-health.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RETENTION_DAYS = 60;

async function sha1(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const startedAt = Date.now();
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE);
  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const limit = Math.min(Number(body.limit ?? 60), 300);
    const tierMode: string | null = body.tier ?? null;
    const explicitIds: string[] = Array.isArray(body.playlist_ids) ? body.playlist_ids : [];

    // Retenção: 60 dias
    const cutoffISO = new Date(Date.now() - RETENTION_DAYS * 86400_000).toISOString();
    const { count: pruned } = await sb
      .from("playlist_track_snapshots")
      .delete({ count: "exact" })
      .lt("captured_at", cutoffISO);

    // 1. MINIMUM: todas as managed_playlists (com spotify_playlist_id) NÃO arquivadas
    const { data: managed } = await sb
      .from("managed_playlists")
      .select("spotify_playlist_id")
      .is("archived_at", null)
      .not("spotify_playlist_id", "is", null);
    const managedIds = new Set<string>((managed ?? []).map((m: any) => m.spotify_playlist_id));

    // 2. PLUS: leader + sample medium (por refresh_tier)
    const { data: targets } = await sb
      .from("search_results")
      .select("spotify_playlist_id, refresh_tier")
      .in("refresh_tier", ["leader", "medium"])
      .not("spotify_playlist_id", "is", null)
      .limit(limit * 3);

    // 3. EXTRA: top-N por followers de cada genre ativo
    const topByGenre: Array<{ id: string; source: string }> = [];
    if (tierMode === "leader" || explicitIds.length === 0) {
      const { data: genreRows } = await sb.from("genres").select("id");
      const N_PER_GENRE = tierMode === "leader" ? 10 : 5;
      for (const g of (genreRows ?? []) as any[]) {
        const { data: topRows } = await sb
          .from("search_results")
          .select("spotify_playlist_id")
          .eq("genre_id", g.id)
          .eq("is_valid", true)
          .is("duplicate_of", null)
          .not("spotify_playlist_id", "is", null)
          .not("seguidores", "is", null)
          .order("seguidores", { ascending: false })
          .limit(N_PER_GENRE);
        for (const r of (topRows ?? []) as any[]) {
          topByGenre.push({ id: r.spotify_playlist_id, source: "top-by-followers" });
        }
      }
    }

    const list: Array<{ id: string; source: string }> = [];
    const seen = new Set<string>();

    for (const id of explicitIds) {
      if (seen.has(id)) continue;
      seen.add(id);
      list.push({ id, source: "explicit" });
    }
    for (const id of managedIds) {
      if (seen.has(id)) continue;
      seen.add(id);
      list.push({ id, source: "managed" });
    }
    for (const t of topByGenre) {
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      list.push(t);
    }
    for (const r of (targets ?? []) as any[]) {
      if (seen.has(r.spotify_playlist_id)) continue;
      if (r.refresh_tier === "medium" && Math.random() > 0.2) continue;
      seen.add(r.spotify_playlist_id);
      list.push({ id: r.spotify_playlist_id, source: r.refresh_tier });
      if (list.length >= Math.max(limit, managedIds.size + topByGenre.length)) break;
    }

    // Token + appId iniciais (failover trocará durante o loop se necessário).
    let { token, appId: currentAppId, appName: currentAppName } = await getSpotifyTokenWithApp();
    const triedApps = new Set<string>();
    if (currentAppId) triedApps.add(currentAppId);

    let inserted = 0;
    let unchanged = 0;
    let failed = 0;
    let auto_archived = 0;
    const failed_ids: string[] = [];

    // Auth streak breaker — protege contra cascata 401 → 429 → blackout 12h.
    const AUTH_STREAK_THRESHOLD = 5;
    let consecutiveAuthFailures = 0;
    let authBreakerTriggered = false;
    const quarantinedDuringRun: Array<{ app_id: string; app_name: string; reason: string }> = [];
    let failoverUsed = false;

    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const THROTTLE_MS = 400; // ~150 req/min, abaixo do limite ~180 do Spotify
    let rateLimitedHits = 0;

    /** Tenta failover pro próximo app saudável. Retorna true se conseguiu, false se acabou o pool. */
    const tryFailover = async (reason: "AUTH_INVALID" | "AUTH_MISSING"): Promise<boolean> => {
      if (currentAppId) {
        await markAppAuthFailure(currentAppId, reason);
        quarantinedDuringRun.push({ app_id: currentAppId, app_name: currentAppName, reason });
      }
      try {
        const next = await getSpotifyTokenWithApp({ excludeAppIds: Array.from(triedApps) });
        token = next.token;
        currentAppId = next.appId;
        currentAppName = next.appName;
        if (next.appId) triedApps.add(next.appId);
        failoverUsed = true;
        console.warn(`[snapshot] failover → app=${currentAppName} (excluded=${Array.from(triedApps).join(",")})`);
        return true;
      } catch (e) {
        console.error(`[snapshot] failover esgotado: ${(e as Error).message}`);
        return false;
      }
    };

    for (let idx = 0; idx < list.length; idx++) {
      if (authBreakerTriggered) break;
      const t = list[idx];
      if (idx > 0) await sleep(THROTTLE_MS);

      // Helper: lista refs com 1 retry pra 429. 401 borbulha pro outer catch (failover).
      const fetchRefs = async (): Promise<string[]> => {
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const refs = await listPlaylistTrackRefs(t.id, token);
            return refs.map((r) => r.id).filter((x): x is string => !!x).slice(0, 50);
          } catch (e) {
            if (e instanceof SpotifyApiError && e.status === 429) {
              rateLimitedHits++;
              const waitSec = Math.min(e.retryAfter ?? 5, 60);
              console.warn(`[snapshot] 429 on ${t.id} — sleeping ${waitSec}s (attempt ${attempt + 1})`);
              await sleep(waitSec * 1000);
              if (attempt === 0) continue;
            }
            throw e;
          }
        }
        return [];
      };

      try {
        let ids: string[];
        try {
          ids = await fetchRefs();
          consecutiveAuthFailures = 0; // sucesso reseta streak local
        } catch (e) {
          // ── AUTH_INVALID: incrementa streak, tenta failover na 1ª, aborta no threshold.
          if (e instanceof SpotifyAuthInvalidError) {
            consecutiveAuthFailures++;
            console.warn(`[snapshot] 401 on ${t.id} app=${currentAppName} streak=${consecutiveAuthFailures}`);
            if (consecutiveAuthFailures === 1) {
              const ok = await tryFailover("AUTH_INVALID");
              if (!ok) {
                authBreakerTriggered = true;
                failed++;
                if (failed_ids.length < 10) failed_ids.push(`${t.id}:401-no-failover`);
                break;
              }
              // Retenta a mesma playlist com novo app (decrementa idx).
              idx--;
              continue;
            }
            if (consecutiveAuthFailures >= AUTH_STREAK_THRESHOLD) {
              authBreakerTriggered = true;
              failed++;
              if (failed_ids.length < 10) failed_ids.push(`${t.id}:401-streak`);
              console.error(`[snapshot] AUTH_BREAKER_OPEN após ${consecutiveAuthFailures} × 401 — abortando lote`);
              break;
            }
            failed++;
            if (failed_ids.length < 10) failed_ids.push(`${t.id}:401`);
            continue;
          }
          if (e instanceof SpotifyApiError) {
            // Auto-archive 404 em managed → para de poluir o status
            if (e.status === 404 && managedIds.has(t.id)) {
              await sb.from("managed_playlists")
                .update({ archived_at: new Date().toISOString() })
                .eq("spotify_playlist_id", t.id)
                .is("archived_at", null);
              auto_archived++;
              console.log(`[snapshot] auto-archived 404 playlist ${t.id}`);
              continue;
            }
            failed++;
            if (failed_ids.length < 10) failed_ids.push(`${t.id}:${e.status}`);
            continue;
          }
          throw e;
        }
        if (!ids.length) continue;
        const hash = await sha1(ids.join("|"));

        const { data: last } = await sb
          .from("playlist_track_snapshots")
          .select("tracks_hash")
          .eq("playlist_spotify_id", t.id)
          .order("captured_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (last?.tracks_hash === hash) { unchanged++; continue; }

        const { error } = await sb.from("playlist_track_snapshots").insert({
          playlist_spotify_id: t.id,
          tracks_hash: hash,
          track_ids: ids,
        });
        if (error) {
          failed++;
          if (failed_ids.length < 10) failed_ids.push(`${t.id}:insert`);
          continue;
        }
        inserted++;
      } catch (e) {
        failed++;
        if (failed_ids.length < 10) failed_ids.push(`${t.id}:${String(e).slice(0, 40)}`);
        console.error("snap failed", t.id, String(e));
      }
    }

    const payload = {
      ok: true,
      scanned: list.length,
      managed_covered: managedIds.size,
      inserted, unchanged, failed, auto_archived,
      pruned_old: pruned ?? 0,
      retention_days: RETENTION_DAYS,
      failed_ids: failed_ids.length ? failed_ids : undefined,
      auth_breaker: {
        triggered: authBreakerTriggered,
        failover_used: failoverUsed,
        quarantined: quarantinedDuringRun,
        final_app_id: currentAppId,
        final_app_name: currentAppName,
      },
    };

    await reportCronHealth(sb, {
      job_name: "snapshot-playlist-tracks",
      status: failed > 0 ? "partial" : "ok",
      startedAt,
      metrics: {
        snapshot_count_per_run: inserted,
        scanned: list.length,
        managed_covered: managedIds.size,
        unchanged,
        failed,
        auto_archived,
        rate_limited_hits: rateLimitedHits,
        pruned_old: pruned ?? 0,
        failed_ids,
      },
      message: `inserted=${inserted} unchanged=${unchanged} failed=${failed} archived=${auto_archived} 429s=${rateLimitedHits} pruned=${pruned ?? 0}` +
        (failed_ids.length ? ` · first_failures=[${failed_ids.slice(0, 3).join(",")}]` : ""),
    });

    return new Response(JSON.stringify(payload), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    await reportCronHealth(sb, {
      job_name: "snapshot-playlist-tracks",
      status: "error",
      startedAt,
      metrics: { snapshot_count_per_run: 0 },
      message: String(e).slice(0, 500),
    });
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
