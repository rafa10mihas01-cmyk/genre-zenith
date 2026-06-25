// import-account-playlists — importa em massa todas as playlists da conta
// Spotify conectada (token OAuth) para a tabela managed_playlists.
// - Lê /v1/me/playlists com paginação
// - Filtra só as que pertencem ao próprio usuário (owner.id === me.id)
// - Upsert por spotify_playlist_id (idempotente)
// - Atualiza accounts.current_playlists
import { corsHeaders } from "npm:@supabase/supabase-js/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { requireTeamAccess } from "../_shared/auth.ts";
import { getUserToken, spotifyFetch } from "../_shared/spotify-client.ts";
import { getPlaylistMeta } from "../_shared/spotify-playlist.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Mesma regra do import-managed-playlist: novas com saves < limite nascem arquivadas.
// Exceções: metadata.strategic, metadata.auto_archive_exempt, locked_at.
const AUTO_ARCHIVE_MIN_FOLLOWERS = 100;

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type SpotifyPlaylistItem = {
  id: string;
  name: string;
  description: string | null;
  images: { url: string }[] | null;
  tracks: { total: number } | null;
  owner: { id: string; display_name?: string };
  external_urls?: { spotify?: string };
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const guard = await requireTeamAccess(req);
  if (!guard.ok) return guard.resp;

  try {
    const body = await req.json().catch(() => ({}));
    const dryRun: boolean = body?.dry_run === true;
    // Throttle: cap de playlists por execução (default 50) + delays entre calls.
    // Sem isso, conectar 1 conta com 100+ playlists gera 200+ chamadas em rajada
    // ao Spotify e dispara o rate limit de 86400s.
    const MAX_PLAYLISTS_PER_RUN: number = Math.max(1, Math.min(Number(body?.max_playlists ?? 50), 200));
    const SPOTIFY_CALL_DELAY_MS = 500; // entre chamadas individuais
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

    // Contadores pra relatório pós-sync.
    // IMPORTANTE: só contam chamadas SÍNCRONAS (listagem + followers).
    // Pipeline pós-import roda em EdgeRuntime.waitUntil e suas calls NÃO entram aqui.
    let spotifyCalls = 0;
    let rate429Count = 0;
    const { SpotifyCircuitOpenError } = await import("../_shared/spotify.ts");

    // 1) token OAuth da conta padrão (Baile Hits Oficial hoje)
    const { token, row } = await getUserToken(body?.spotify_user_id ?? undefined);
    const ownerId = row.spotify_user_id;

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    // 2) descobre account_id correspondente em `accounts`
    const { data: acc } = await supabase
      .from("accounts")
      .select("id")
      .eq("spotify_user_id", ownerId)
      .maybeSingle();
    const accountId: string | null = acc?.id ?? null;

    // 3) paginação /v1/me/playlists — limit=50 por página + 500ms entre páginas.
    // OAUTH OBRIGATÓRIO (Fase 17-C): /me/playlists lista playlists DO PRÓPRIO
    // usuário autenticado (inclusive privadas). Não há equivalente público no
    // Observer — esta é leitura autenticada legítima do proprietário.
    const collected: SpotifyPlaylistItem[] = [];
    let url: string | null = "https://api.spotify.com/v1/me/playlists?limit=50";
    let safety = 0;
    let pageIdx = 0;
    while (url && safety < 20) {
      safety++;
      if (pageIdx++ > 0) await sleep(SPOTIFY_CALL_DELAY_MS);
      spotifyCalls++;
      let r: Response;
      try {
        r = await spotifyFetch(url, { headers: { Authorization: `Bearer ${token}` } });
      } catch (e) {
        if (e instanceof SpotifyCircuitOpenError) rate429Count++;
        throw e;
      }
      if (!r.ok) {
        if (r.status === 429) rate429Count++;
        const t = await r.text();
        return jr({ ok: false, error: `Spotify ${r.status}: ${t.slice(0, 200)}` }, 500);
      }
      const j: { items: SpotifyPlaylistItem[]; next: string | null } = await r.json();
      for (const it of j.items ?? []) collected.push(it);
      url = j.next ?? null;
    }

    // 4) filtra só as que são DO próprio usuário
    const ownedAll = collected.filter((p) => p.owner?.id === ownerId);
    const others = collected.length - ownedAll.length;

    // Cliente Supabase precisa estar disponível antes do dryRun pra computar already_existed.
    // (supabase client já criado acima)

    // 4.1) Pré-computa quantas das ownedAll JÁ existem em managed_playlists.
    // Essa métrica é o que o operador precisa pra entender "já tem N importadas
    // de antes, faltam M". Não depende do cap.
    const ownedAllIds = ownedAll.map((p) => p.id);
    const { data: existingAllRows } = ownedAllIds.length > 0
      ? await supabase
        .from("managed_playlists")
        .select("spotify_playlist_id")
        .in("spotify_playlist_id", ownedAllIds)
      : { data: [] as { spotify_playlist_id: string }[] };
    const existingAllIds = new Set(
      (existingAllRows ?? []).map((r: { spotify_playlist_id: string }) => r.spotify_playlist_id),
    );
    const alreadyExistedAll = existingAllIds.size;

    // 4.2) CRÍTICO: aplica o cap SOMENTE sobre o que ainda NÃO foi importado.
    // Antes: slice(0, 50) pegava os mesmos 50 primeiros toda execução → travava
    // em 50/N porque eram todos duplicatas ignoradas.
    const ownedNotYet = ownedAll.filter((p) => !existingAllIds.has(p.id));
    const owned = ownedNotYet.slice(0, MAX_PLAYLISTS_PER_RUN);
    const deferred = ownedNotYet.length - owned.length;
    const willImportNow = owned.length;
    const pendingAfterRun = Math.max(0, ownedNotYet.length - willImportNow);

    if (dryRun) {
      return jr({
        ok: true,
        dry_run: true,
        spotify_user_id: ownerId,
        account_id: accountId,
        total_fetched: collected.length,
        owned_count: ownedAll.length,
        already_existed: alreadyExistedAll,
        will_import_now: willImportNow,
        deferred_count: deferred,
        pending_after_run: pendingAfterRun,
        others_count: others,
        sample: owned.slice(0, 5).map((p) => ({ id: p.id, name: p.name, tracks: p.tracks?.total })),
      });
    }

    // 5) enriquecimento followers: concorrência baixa (3) + delay de 500ms entre lotes.
    // Antes: CONCURRENCY=8 sem delay → 100 playlists = 100 calls em ~1s → causa 429 24h.
    // /v1/me/playlists não retorna followers — só /v1/playlists/{id} retorna.
    // HARDENING: se a 1ª chamada falhar/retornar null, fazemos 1 retry após 1.5s.
    // Se ainda assim vier null, marcamos a playlist como `followers_unknown_at_import`
    // no metadata — assim o auto-archive NÃO decide silenciosamente "deixa ativo".
    const followersMap = new Map<string, number | null>();
    const followersUnknown = new Set<string>(); // p.id que ficou sem resposta após retry
    const CONCURRENCY = 3;
    const fetchFollowersOnce = async (id: string): Promise<number | null> => {
      const meta = await getPlaylistMeta(id, token, { fields: "followers(total)" });
      return typeof meta.followers === "number" ? meta.followers : null;
    };
    for (let i = 0; i < owned.length; i += CONCURRENCY) {
      if (i > 0) await sleep(SPOTIFY_CALL_DELAY_MS);
      const batch = owned.slice(i, i + CONCURRENCY);
      await Promise.all(batch.map(async (p) => {
        spotifyCalls++;
        let val: number | null = null;
        try {
          val = await fetchFollowersOnce(p.id);
        } catch (e) {
          if (e instanceof SpotifyCircuitOpenError) { rate429Count++; throw e; }
          if (e instanceof Error && /429/.test(e.message)) rate429Count++;
          val = null;
        }
        if (val === null) {
          // 1 retry isolado após 1.5s — cobre intermitência sem inflar chamadas.
          await sleep(1500);
          spotifyCalls++;
          try {
            val = await fetchFollowersOnce(p.id);
          } catch (e) {
            if (e instanceof SpotifyCircuitOpenError) { rate429Count++; throw e; }
            if (e instanceof Error && /429/.test(e.message)) rate429Count++;
            val = null;
          }
        }
        followersMap.set(p.id, val);
        if (val === null) followersUnknown.add(p.id);
      }));
    }

    // 6) upsert em managed_playlists já com followers preenchidos
    // Cada managed playlist precisa de uma linha canônica em `playlists`.
    // Sem isso, o playlist-brain-calc em lote não enxerga a playlist e o
    // cockpit fica sem cérebro/roadmap mesmo com a playlist importada.
    const nowIso = new Date().toISOString();
    let imported = 0;
    let skipped = 0;
    const importedIds: string[] = []; // managed_playlists.id (UUID) das playlists upsertadas com sucesso
    const activeImportedIds: string[] = []; // subset que NÃO nasceu arquivada — usado pra disparar pipeline
    const snapshotInserts: Array<{ playlist_spotify_id: string; followers: number | null; total_tracks: number | null }> = [];
    const { data: existingManaged } = owned.length > 0
      ? await supabase
        .from("managed_playlists")
        .select("spotify_playlist_id, genre_id, canonical_playlist_id, archived_at, metadata, locked_at")
        .in("spotify_playlist_id", owned.map((p) => p.id))
      : { data: [] as any[] };
    const existingBySpotifyId = new Map(
      (existingManaged ?? []).map((row: any) => [row.spotify_playlist_id, row]),
    );

    for (const p of owned) {
      const followers = followersMap.get(p.id) ?? null;
      const existing = existingBySpotifyId.get(p.id) as any | undefined;
      let canonicalId = existing?.canonical_playlist_id ?? null;
      const { data: canonical, error: canonicalError } = await supabase
        .from("playlists")
        .upsert({
          spotify_playlist_id: p.id,
          name: p.name ?? `Playlist ${p.id}`,
          ownership: "own",
          account_id: accountId,
          source: "managed",
          followers,
          cover_url: p.images && p.images.length > 0 ? p.images[0].url : null,
          genre_id: existing?.genre_id ?? null,
          monitored: true,
          last_seen_at: nowIso,
        }, { onConflict: "spotify_playlist_id" })
        .select("id")
        .single();
      if (canonicalError) {
        skipped++;
        console.error("canonical upsert error", p.id, canonicalError.message);
        continue;
      }
      canonicalId = canonical.id;

      // Decide se aplica auto-arquivamento (só pra registros NOVOS).
      const isNew = !existing;
      const existingMeta = (existing?.metadata ?? {}) as Record<string, unknown>;
      const isExempt =
        existingMeta.strategic === true ||
        existingMeta.auto_archive_exempt === true ||
        !!existing?.locked_at;
      const followersNum = typeof followers === "number" ? followers : null;
      const shouldAutoArchive =
        isNew && followersNum !== null && followersNum < AUTO_ARCHIVE_MIN_FOLLOWERS && !isExempt;

      const payload: Record<string, unknown> = {
        spotify_playlist_id: p.id,
        spotify_url: p.external_urls?.spotify ?? `https://open.spotify.com/playlist/${p.id}`,
        name: p.name ?? `Playlist ${p.id}`,
        description: p.description ?? null,
        cover_url: p.images && p.images.length > 0 ? p.images[0].url : null,
        tracks_count: p.tracks?.total ?? 0,
        followers,
        last_metrics_at: nowIso,
        account_id: accountId,
        canonical_playlist_id: canonicalId,
        imported_by: guard.via === "user" ? guard.userId : null,
        owner_spotify_user_id: ownerId,
        metadata: {
          source: "import-account-playlists",
          owner_display_name: p.owner?.display_name ?? null,
          ...(followersUnknown.has(p.id) ? { followers_unknown_at_import: true } : {}),
        },
      };
      if (shouldAutoArchive) {
        payload.archived_at = nowIso;
        payload.archived_reason = "auto_onboarding_low_followers";
        payload.archived_followers = followersNum;
      }

      const { data: upserted, error } = await supabase
        .from("managed_playlists")
        .upsert(payload, { onConflict: "spotify_playlist_id" })
        .select("id, lifecycle_stage, archived_at")
        .maybeSingle();
      if (error) {
        skipped++;
        console.error("upsert error", p.id, error.message);
      } else {
        imported++;
        if (upserted?.id) {
          importedIds.push(upserted.id);
          if (!upserted?.archived_at) activeImportedIds.push(upserted.id);
        }
        snapshotInserts.push({
          playlist_spotify_id: p.id,
          followers,
          total_tracks: p.tracks?.total ?? null,
        });
        // Dispara onboarding-check só pra playlists em onboarding QUE NÃO nasceram arquivadas.
        // Playlist auto-arquivada não consome ciclos de onboarding até ser reativada manualmente.
        if (upserted?.id && upserted?.lifecycle_stage === "onboarding" && !upserted?.archived_at) {
          fetch(`${SUPABASE_URL}/functions/v1/playlist-onboarding-check`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${SERVICE_KEY}`,
            },
            body: JSON.stringify({ playlist_id: upserted.id }),
          }).catch((e) => console.warn("onboarding-check dispatch", upserted.id, (e as Error).message));
        }
      }
    }

    // 7) snapshot temporal de followers (mesma tabela usada pelo refresh-search-results)
    if (snapshotInserts.length) {
      const { error: sErr } = await supabase
        .from("playlist_followers_snapshots")
        .insert(snapshotInserts);
      if (sErr) console.warn("snapshot insert:", sErr.message);
    }

    // 8) se a playlist já existe em search_results, atualiza followers/cover/tracks lá também
    const ids = owned.map((p) => p.id);
    if (ids.length) {
      for (const p of owned) {
        const followers = followersMap.get(p.id);
        await supabase.from("search_results").update({
          seguidores: followers ?? null,
          nome_playlist: p.name ?? null,
          imagem_url: p.images?.[0]?.url ?? null,
          total_musicas: p.tracks?.total ?? null,
          last_refreshed_at: nowIso,
          followers_verified_at: nowIso,
        }).eq("spotify_playlist_id", p.id);
      }
    }

    // 9) atualiza contagem na conta
    if (accountId) {
      await supabase
        .from("accounts")
        .update({ current_playlists: owned.length, updated_at: nowIso })
        .eq("id", accountId);
    }

    // 10) Pipeline automático pós-import (fire-and-forget, não bloqueia resposta).
    //     Fase 5.3: substitui a cadeia classify/snapshot/brain por UMA chamada ao
    //     analysis-orchestrator (trigger=import). O orquestrador cria o snapshot
    //     único e roda sync→dna→diagnose→brain→score com lock/idempotência.
    //     Só pra playlists que NÃO nasceram arquivadas.
    if (activeImportedIds.length > 0) {
      const ORCH_CONCURRENCY = 4;
      const ORCH_BATCH_DELAY_MS = 300;
      const ORCH_TIMEOUT_MS = 20_000;

      const triggerOrchestrator = async (playlistId: string) => {
        const ctrl = new AbortController();
        const tid = setTimeout(() => ctrl.abort(), ORCH_TIMEOUT_MS);
        try {
          const r = await fetch(`${SUPABASE_URL}/functions/v1/analysis-orchestrator`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${SERVICE_KEY}`,
            },
            body: JSON.stringify({
              playlist_id: playlistId,
              trigger: "import",
              idempotency_key: `import:${playlistId}:${nowIso.slice(0, 10)}`,
            }),
            signal: ctrl.signal,
          });
          if (!r.ok) {
            console.warn(`orchestrator import ${playlistId} → ${r.status}`);
          }
        } catch (e) {
          console.warn(`orchestrator import ${playlistId} error:`, (e as Error).message);
        } finally {
          clearTimeout(tid);
        }
      };

      const runPipeline = async () => {
        for (let i = 0; i < activeImportedIds.length; i += ORCH_CONCURRENCY) {
          if (i > 0) await sleep(ORCH_BATCH_DELAY_MS);
          const batch = activeImportedIds.slice(i, i + ORCH_CONCURRENCY);
          await Promise.all(batch.map(triggerOrchestrator));
        }
        console.log(`pipeline done: ${activeImportedIds.length} active playlists enqueued via analysis-orchestrator (${importedIds.length - activeImportedIds.length} auto-archived skipped)`);
      };

      const runtime = (globalThis as any).EdgeRuntime;
      if (runtime?.waitUntil) {
        runtime.waitUntil(runPipeline());
      } else {
        runPipeline().catch((e) => console.warn("pipeline fatal:", (e as Error).message));
      }
    }

    // Estado final do circuit breaker do app vinculado a esse token.
    const appIdForBreaker = (row as any)?.app_id ?? null;
    let circuitBreaker: any = { status: "closed", blocked_until: null, retry_after_sec: 0, app_id: appIdForBreaker };
    if (appIdForBreaker) {
      const { data: cb } = await supabase
        .from("spotify_circuit_breaker")
        .select("status, blocked_until, retry_after_sec, last_429_at")
        .eq("app_id", appIdForBreaker)
        .maybeSingle();
      if (cb) circuitBreaker = { ...cb, app_id: appIdForBreaker };
    }

    const autoArchived = importedIds.length - activeImportedIds.length;

    // Pendentes reais APÓS este run: ownedAll que continuam sem linha em managed_playlists.
    // Quem foi processado agora entra em existingAllIds via upsert; releitura mais simples
    // é subtrair: ownedAll - (já existiam antes + novos importados nesta execução).
    const newImportedThisRun = importedIds.length; // upsertados (inclui re-upserts de existentes, mas é o melhor proxy)
    const totalCoveredAfter = Math.min(
      ownedAll.length,
      alreadyExistedAll + Math.max(0, newImportedThisRun - 0 /* upsert pode ter tocado em existentes; usamos willImportNow */)
    );
    const pendingAfter = Math.max(0, ownedAll.length - alreadyExistedAll - willImportNow);
    const fullySynced = pendingAfter === 0;

    // Persiste o status da última sync na tabela `accounts` pra exibição no card.
    if (accountId) {
      await supabase.from("accounts").update({
        last_sync_at: new Date().toISOString(),
        last_sync_found: ownedAll.length,
        last_sync_imported: imported,
        last_sync_pending: pendingAfter,
        last_sync_already_existed: alreadyExistedAll,
        last_sync_auto_archived: autoArchived,
      }).eq("id", accountId);
    }

    return jr({
      ok: true,
      spotify_user_id: ownerId,
      account_id: accountId,
      total_fetched: collected.length,
      owned_count: ownedAll.length,
      processed_now: owned.length,
      deferred_count: deferred,
      others_count: others,
      imported,
      skipped,
      pipeline_dispatched: activeImportedIds.length,
      auto_archived: autoArchived,
      throttle: { max_per_run: MAX_PLAYLISTS_PER_RUN, call_delay_ms: SPOTIFY_CALL_DELAY_MS },
      report: {
        found: ownedAll.length,
        already_existed: alreadyExistedAll,
        imported,
        active: activeImportedIds.length,
        auto_archived: autoArchived,
        deferred,
        pending_after: pendingAfter,
        fully_synced: fullySynced,
        spotify_calls_sync: spotifyCalls,
        rate_429_count: rate429Count,
        circuit_breaker: circuitBreaker,
        note: "spotify_calls_sync conta apenas chamadas síncronas (listagem + followers). Pipeline pós-import (snapshot/classify/brain) roda em background.",
      },
    });
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    if (msg.startsWith("SPOTIFY_CIRCUIT_OPEN")) {
      const blockedMatch = msg.match(/blocked_until=([^\s]+)/);
      const retryMatch = msg.match(/retry_after=(\d+)s/);
      return jr({
        ok: false,
        error: "SPOTIFY_CIRCUIT_OPEN",
        circuit_open: true,
        blocked_until: blockedMatch?.[1] ?? null,
        retry_after_sec: retryMatch ? Number(retryMatch[1]) : 0,
        message: msg,
      }, 200);
    }
    return jr({ ok: false, error: msg }, 500);
  }
});
