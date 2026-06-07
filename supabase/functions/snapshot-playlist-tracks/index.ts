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
import { getSpotifyTokenWithApp, getUserAccessToken, SpotifyAuthInvalidError, markAppAuthFailure } from "../_shared/spotify.ts";
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
      .select("spotify_playlist_id, owner_spotify_user_id")
      .is("archived_at", null)
      .not("spotify_playlist_id", "is", null);
    const managedIds = new Set<string>((managed ?? []).map((m: any) => m.spotify_playlist_id));
    // Mapa spotify_playlist_id → owner_spotify_user_id (pra escolher user token).
    const managedOwnerBySpId = new Map<string, string | null>();
    for (const m of (managed ?? []) as any[]) managedOwnerBySpId.set(m.spotify_playlist_id, m.owner_spotify_user_id ?? null);

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

    // Token de app (client_credentials) — usado APENAS para playlists não-managed
    // (descoberta via search_results / top-by-genre). Para managed playlists usamos
    // owner user token. Init é LAZY: se todas as playlists do lote forem managed,
    // não precisamos buscar app token (e portanto não falhamos se nenhum app
    // estiver com client_credentials válidos).
    let appToken: string | null = null;
    let currentAppId: string | null = null;
    let currentAppName: string = "";
    const triedApps = new Set<string>();
    const ensureAppToken = async (): Promise<boolean> => {
      if (appToken) return true;
      try {
        const r = await getSpotifyTokenWithApp({ excludeAppIds: Array.from(triedApps) });
        appToken = r.token;
        currentAppId = r.appId;
        currentAppName = r.appName;
        if (r.appId) triedApps.add(r.appId);
        return true;
      } catch (e) {
        console.warn(`[snapshot] sem app token disponível: ${(e as Error).message}`);
        return false;
      }
    };
    // Cache owner-token por spotify_user_id pra evitar refresh em cada playlist.
    const ownerTokenCache = new Map<string, string>();
    const ownersWithoutToken = new Set<string>();
    let owner_token_used = 0;
    let owner_token_failed = 0;

    let inserted = 0;
    let unchanged = 0;
    let failed = 0;
    let auto_archived = 0;
    const failed_ids: string[] = [];

    // Auth streak breaker — protege contra cascata 401 → 429 → blackout 12h.
    const AUTH_STREAK_THRESHOLD = 5;
    let consecutiveAuthFailures = 0;
    let authBreakerTriggered = false;
    // Quando 401 ocorre, fazemos failover e re-tentamos a MESMA playlist com outro app.
    // Se o novo app TAMBÉM retorna 401 nessa mesma playlist, o problema é da playlist
    // (privada/restrita pelo dono), não do token — tratamos como 404 (auto-archive em managed).
    let lastFailoverPlaylistId: string | null = null;
    const quarantinedDuringRun: Array<{ app_id: string; app_name: string; reason: string }> = [];
    let failoverUsed = false;

    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const THROTTLE_MS = 400; // ~150 req/min, abaixo do limite ~180 do Spotify
    let rateLimitedHits = 0;

    /** Tenta failover pro próximo app saudável (só afeta APP TOKEN — playlists não-managed). */
    const tryFailover = async (reason: "AUTH_INVALID" | "AUTH_MISSING"): Promise<boolean> => {
      if (currentAppId) {
        await markAppAuthFailure(currentAppId, reason);
        quarantinedDuringRun.push({ app_id: currentAppId, app_name: currentAppName, reason });
      }
      try {
        const next = await getSpotifyTokenWithApp({ excludeAppIds: Array.from(triedApps) });
        appToken = next.token;
        currentAppId = next.appId;
        currentAppName = next.appName;
        if (next.appId) triedApps.add(next.appId);
        failoverUsed = true;
        console.warn(`[snapshot] app-token failover → app=${currentAppName} (excluded=${Array.from(triedApps).join(",")})`);
        return true;
      } catch (e) {
        console.error(`[snapshot] failover esgotado: ${(e as Error).message}`);
        return false;
      }
    };

    /** Classifica erro de getUserAccessToken como permanente (owner nunca terá token
     *  até reconectar OAuth) ou transitório (rede, 5xx, etc.).
     *  Permanente:
     *   - "Nenhuma conta Spotify conectada" → não há row em spotify_user_tokens
     *   - "Spotify refresh 400 ... invalid_grant" → refresh_token revogado
     *   - "Spotify refresh 401" → credenciais explicitamente rejeitadas
     */
    const isPermanentOwnerTokenFailure = (err: unknown): boolean => {
      const msg = String((err as Error)?.message ?? err);
      if (msg.includes("Nenhuma conta Spotify conectada")) return true;
      if (/Spotify refresh 4\d\d/.test(msg) && /invalid_grant|invalid_client|revoked|unauthorized/i.test(msg)) return true;
      if (/Spotify refresh 401/.test(msg)) return true;
      return false;
    };

    /** Resolve token apropriado pra UMA playlist:
     *  - managed + owner com OAuth válido → user token
     *  - managed + owner permanentemente sem token → app token (fallback degradado)
     *  - managed + owner com falha transitória → null (skip nesta run, NÃO arquivar)
     *  - não-managed → app token
     */
    const resolveTokenFor = async (spId: string): Promise<{ token: string | null; isOwnerToken: boolean; ownerId: string | null; transientOwnerFailure?: boolean }> => {
      const ownerId = managedOwnerBySpId.get(spId) ?? null;
      if (ownerId && !ownersWithoutToken.has(ownerId)) {
        const cached = ownerTokenCache.get(ownerId);
        if (cached) return { token: cached, isOwnerToken: true, ownerId };
        // tentativa 1 + 1 retry curto pra falhas transitórias
        let lastErr: unknown = null;
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const { token: ut } = await getUserAccessToken(ownerId);
            ownerTokenCache.set(ownerId, ut);
            owner_token_used++;
            return { token: ut, isOwnerToken: true, ownerId };
          } catch (e) {
            lastErr = e;
            if (isPermanentOwnerTokenFailure(e)) break;
            if (attempt === 0) await sleep(500);
          }
        }
        owner_token_failed++;
        if (isPermanentOwnerTokenFailure(lastErr)) {
          ownersWithoutToken.add(ownerId);
          console.warn(`[snapshot] owner ${ownerId} PERMANENTE sem token (${String((lastErr as Error).message).slice(0, 120)}); fallback app token`);
        } else {
          // Transitório: NÃO marca owner como sem token. NÃO faz fallback pra app token
          // (pra evitar 401 cascade → archive falso positivo). Skip playlist nesta run.
          console.warn(`[snapshot] owner ${ownerId} falha transitória (${String((lastErr as Error).message).slice(0, 120)}); skip playlist ${spId} nesta run`);
          return { token: null, isOwnerToken: true, ownerId, transientOwnerFailure: true };
        }
      }
      await ensureAppToken();
      return { token: appToken, isOwnerToken: false, ownerId };
    };


    for (let idx = 0; idx < list.length; idx++) {
      if (authBreakerTriggered) break;
      const t = list[idx];
      if (idx > 0) await sleep(THROTTLE_MS);

      // Resolve token apropriado pra ESTA playlist (owner token se for managed+OAuth).
      const { token: callToken, isOwnerToken } = await resolveTokenFor(t.id);
      if (!callToken) {
        failed++;
        if (failed_ids.length < 10) failed_ids.push(`${t.id}:no-token`);
        continue;
      }

      // Helper: lista refs com 1 retry pra 429. 401 borbulha pro outer catch.
      const fetchRefs = async (): Promise<string[]> => {
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const refs = await listPlaylistTrackRefs(t.id, callToken);
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
          lastFailoverPlaylistId = null;
        } catch (e) {
          // ── AUTH_INVALID
          if (e instanceof SpotifyAuthInvalidError) {
            // Quando usamos OWNER TOKEN, 401 = problema do token do owner (re-auth necessário)
            // OU restrição da própria playlist. Não acionamos failover de app (não ajudaria)
            // nem alimentamos o streak global do app token.
            if (isOwnerToken) {
              console.warn(`[snapshot] 401 com owner token em ${t.id} — owner precisa reconectar`);
              failed++;
              if (failed_ids.length < 10) failed_ids.push(`${t.id}:401-owner`);
              continue;
            }

            // Se acabamos de fazer failover por causa DESTA mesma playlist e ela
            // 401 de novo com outro app, o problema é da playlist (privada/restrita),
            // não do token. Tratamos como 404: auto-archive em managed, sem alimentar streak.
            if (lastFailoverPlaylistId === t.id) {
              // DESATIVADO 2026-06-07: auto-archive por 401-persistent gerou
              // falsos positivos em massa (16 managed playlists arquivadas
              // indevidamente). 401 em /tracks ≠ playlist morta. Apenas
              // contabiliza como falha e segue — só 404 explícito arquiva.
              lastFailoverPlaylistId = null;
              consecutiveAuthFailures = 0;
              failed++;
              if (failed_ids.length < 10) failed_ids.push(`${t.id}:401-persistent`);
              continue;
            }

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
              lastFailoverPlaylistId = t.id;
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
      owner_token: {
        used: owner_token_used,
        failed: owner_token_failed,
        owners_without_token: Array.from(ownersWithoutToken),
      },
    };

    // Status:
    //  - error   → nada foi processado E houve falhas (esteira travada)
    //  - error   → auth breaker disparou (cascata 401)
    //  - partial → houve falhas mas algum snapshot foi gravado/unchanged
    //  - ok      → sem falhas
    const processedSomething = inserted > 0 || unchanged > 0;
    const healthStatus: "ok" | "partial" | "error" =
      authBreakerTriggered || (failed > 0 && !processedSomething && list.length > 0)
        ? "error"
        : failed > 0
          ? "partial"
          : "ok";

    await reportCronHealth(sb, {
      job_name: "snapshot-playlist-tracks",
      status: healthStatus,
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
