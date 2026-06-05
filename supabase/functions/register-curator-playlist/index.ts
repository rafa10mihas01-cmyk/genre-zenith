// register-curator-playlist
// Cadastra 1 ou várias playlists em um deal, com enrichment via Spotify API
// e classificação automática (curator / baseline / editorial / suspicious / organic).
//
// Aceita 2 modos de autenticação:
//   - public_token: usado pelo portal do curador (sem login). Permite cadastrar
//     qualquer playlist válida, bloqueando apenas duplicadas já existentes no deal.
//   - JWT (admin/curador autenticado): identifica o deal por deal_id no body,
//     valida que pertence ao usuário, e salva a playlist válida.
//
// Body:
//   { public_token?: string, deal_id?: string, urls: string[], preview?: boolean }
//
// Quando preview=true, retorna a classificação proposta sem salvar nada.

import { corsHeaders } from "npm:@supabase/supabase-js/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  checkTrackInPlaylist,
  classifyPlaylist,
  extractPlaylistId,
  extractTrackId,
  fetchPlaylistMeta,
  type ClassifyResult,
  type SpotifyPlaylistMeta,
} from "../_shared/curator-playlist.ts";
import { assertDealOperable } from "../_shared/deal-access.ts";
import { recordMetric } from "../_shared/ops-metrics.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

// ===== Lock e rate limit em memória (por instância da edge function) =====
const LOCK_TTL_MS = 60_000;
const RL_WINDOW_MS = 60_000;
const RL_MAX = 5; // 5 importações por public_token por minuto

const importLocks = new Map<string, number>(); // key = deal_id|song_id  → expiresAt
const rateBuckets = new Map<string, number[]>(); // key = public_token   → timestamps

function tryAcquireLock(key: string): boolean {
  const now = Date.now();
  const exp = importLocks.get(key);
  if (exp && exp > now) return false;
  importLocks.set(key, now + LOCK_TTL_MS);
  return true;
}
function releaseLock(key: string) {
  importLocks.delete(key);
}

function checkRateLimit(token: string): { ok: boolean; retryAfterSec?: number } {
  const now = Date.now();
  const arr = (rateBuckets.get(token) ?? []).filter((t) => now - t < RL_WINDOW_MS);
  if (arr.length >= RL_MAX) {
    const oldest = arr[0];
    const retryAfterSec = Math.max(1, Math.ceil((RL_WINDOW_MS - (now - oldest)) / 1000));
    rateBuckets.set(token, arr);
    return { ok: false, retryAfterSec };
  }
  arr.push(now);
  rateBuckets.set(token, arr);
  return { ok: true };
}

// Timeout por URL: corta se Spotify travar
function withTimeout<T>(p: Promise<T>, ms: number, label = "timeout"): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(label)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

function jr(payload: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", ...extraHeaders },
  });
}

type DealRow = {
  id: string;
  user_id: string;
  spotify_owner_id: string | null;
  song_spotify_url: string | null;
  started_at: string;
  state: string | null;
  closed_at: string | null;
  token_revoked_at: string | null;
  token_expires_at: string | null;
  campaign_id: string | null;
  curator_id: string | null;
  source: string | null;
};

type ProcessedItem = {
  url: string;
  playlist_id: string | null;
  status: "ok" | "blocked" | "duplicate" | "duplicate_in_payload" | "baseline_blocked" | "campaign_baseline_blocked" | "baseline_conflict" | "awaiting_baseline" | "track_already_present" | "track_not_present" | "invalid_url" | "not_found" | "error" | "timeout";
  match_status?: ClassifyResult["match_status"];
  match_reason?: string;
  meta?: SpotifyPlaylistMeta;
  track_presence?: {
    found: boolean;
    position: number | null;
    track_name: string | null;
    artist_name: string | null;
  };
  error?: string;
};

function fallbackPlaylistMeta(playlistId: string): SpotifyPlaylistMeta {
  return {
    id: playlistId,
    name: `Playlist Spotify ${playlistId}`,
    owner_id: "",
    owner_name: "",
    followers: 0,
    image_url: null,
    total_tracks: 0,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const t0 = Date.now();
  try {
    const body = await req.json().catch(() => ({}));
    const publicToken = typeof body?.public_token === "string" ? body.public_token.trim() : "";
    const dealIdInput = typeof body?.deal_id === "string" ? body.deal_id.trim() : "";
    const songIdInput = typeof body?.song_id === "string" && body.song_id.trim().length > 0
      ? body.song_id.trim()
      : null;
    const positionRaw = body?.position;
    let positionInput: number | null = null;
    if (positionRaw !== null && positionRaw !== undefined && positionRaw !== "") {
      const n = Number(positionRaw);
      if (Number.isFinite(n) && Number.isInteger(n) && n >= 1) {
        positionInput = n;
      }
    }
    const urls: string[] = Array.isArray(body?.urls) ? body.urls : [];
    const preview = body?.preview === true;
    // Modo "música já está dentro": curador confirma que já adicionou a faixa
    // na playlist. Inverte a checagem: bloqueia se NÃO encontrar.
    const requireTrackPresent = body?.require_track_present === true;

    if (urls.length === 0) return jr({ ok: false, error: "urls vazio" }, 400);
    if (urls.length > 200) return jr({ ok: false, error: "máximo 200 URLs por chamada" }, 400);
    if (!publicToken && !dealIdInput) {
      return jr({ ok: false, error: "public_token ou deal_id obrigatório" }, 400);
    }

    // Rate limit: só rota pública e só importações reais (não preview)
    if (publicToken && !preview) {
      const rl = checkRateLimit(publicToken);
      if (!rl.ok) {
        return jr(
          { ok: false, error: `Muitas importações em sequência. Aguarde ${rl.retryAfterSec}s e tente de novo.` },
          429,
          { "Retry-After": String(rl.retryAfterSec ?? 30) },
        );
      }
    }

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    // ------- Identificar deal e modo (público vs admin) -------
    let deal: DealRow | null = null;
    let authedUserId: string | null = null;

    if (publicToken) {
      const { data, error } = await admin
        .from("curator_deals")
        .select("id, user_id, spotify_owner_id, song_spotify_url, started_at, state, closed_at, token_revoked_at, token_expires_at, campaign_id, curator_id, source")
        .eq("public_token", publicToken)
        .maybeSingle();
      if (error) return jr({ ok: false, error: error.message }, 200);
      if (!data) return jr({ ok: false, error: "deal não encontrado" }, 404);
      deal = data as DealRow;
    } else {
      // Modo admin: precisa de JWT válido
      const authHeader = req.headers.get("Authorization");
      if (!authHeader?.startsWith("Bearer ")) {
        return jr({ ok: false, error: "Unauthorized" }, 401);
      }
      const userClient = createClient(SUPABASE_URL, ANON_KEY, {
        global: { headers: { Authorization: authHeader } },
      });
      const token = authHeader.replace("Bearer ", "");
      const { data: claimsData, error: claimsErr } = await userClient.auth.getClaims(token);
      if (claimsErr || !claimsData?.claims?.sub) {
        return jr({ ok: false, error: "Unauthorized" }, 401);
      }
      authedUserId = claimsData.claims.sub as string;

      const { data, error } = await admin
        .from("curator_deals")
        .select("id, user_id, spotify_owner_id, song_spotify_url, started_at, state, closed_at, token_revoked_at, token_expires_at, campaign_id, curator_id, source")
        .eq("id", dealIdInput)
        .maybeSingle();
      if (error) return jr({ ok: false, error: error.message }, 200);
      if (!data) return jr({ ok: false, error: "deal não encontrado" }, 404);
      if (data.user_id !== authedUserId) {
        return jr({ ok: false, error: "Forbidden" }, 403);
      }
      deal = data as DealRow;
    }

    if (!deal) return jr({ ok: false, error: "deal não encontrado" }, 404);

    // ====== Gate de ciclo de vida (Fase 5B) ======
    const gate = assertDealOperable(deal);
    if (!gate.ok) {
      return jr({ ok: false, error: gate.error, code: gate.code }, gate.status);
    }

    let effectiveSongId = songIdInput;
    let trackIdToCheck = extractTrackId(deal.song_spotify_url ?? "");
    if (songIdInput) {
      const { data: songRow } = await admin
        .from("curator_deal_songs")
        .select("id, spotify_track_id, song_spotify_url")
        .eq("id", songIdInput)
        .eq("deal_id", deal.id)
        .maybeSingle();
      if (!songRow) {
        return jr({ ok: false, error: "Música não encontrada neste deal." }, 400);
      }
      trackIdToCheck = songRow?.spotify_track_id || extractTrackId(songRow?.song_spotify_url ?? "") || trackIdToCheck;
    } else {
      const { data: dealSongs, error: songsErr } = await admin
        .from("curator_deal_songs")
        .select("id, spotify_track_id, song_spotify_url, position, created_at")
        .eq("deal_id", deal.id)
        .order("position", { ascending: true })
        .order("created_at", { ascending: true })
        .limit(2);
      if (songsErr) return jr({ ok: false, error: songsErr.message }, 200);
      if ((dealSongs ?? []).length === 1) {
        const onlySong = dealSongs![0];
        effectiveSongId = onlySong.id;
        trackIdToCheck = onlySong.spotify_track_id || extractTrackId(onlySong.song_spotify_url ?? "") || trackIdToCheck;
      }
    }

    // ------- Lock de importação (clique duplo / abas duplicadas) -------
    // Não trava preview (read-only).
    const lockKey = `${deal.id}|${effectiveSongId ?? "no-song"}`;
    if (!preview) {
      if (!tryAcquireLock(lockKey)) {
        return jr(
          { ok: false, error: "Já existe uma importação em andamento para este deal. Aguarde alguns segundos." },
          423,
        );
      }
    }

    try {
      // ------- Carregar contexto de classificação -------
      const { data: existing } = await admin
        .from("curator_playlists")
        .select("spotify_playlist_id, spotify_owner_id, playlist_name, match_status, song_id, is_baseline")
        .eq("deal_id", deal.id);

      // Duplicata é por (deal_id, song_id, playlist_id):
      // a mesma playlist pode ser registrada para múltiplas músicas do mesmo deal,
      // só não pode repetir dentro da MESMA música.
      const existingIds = new Set(
        (existing ?? [])
          .filter((r: any) => (r.song_id ?? null) === (effectiveSongId ?? null))
          .map((r: any) => r.spotify_playlist_id)
          .filter((v: unknown): v is string => typeof v === "string" && v.length > 0),
      );
      // Playlists que JÁ foram capturadas como baseline real para esse deal+música.
      // Fonte de verdade: flag is_baseline=true (setada quando a playlist já listava
      // a música ANTES do deal começar). Se o curador tentar registrar uma delas
      // como sua, é bloqueio rígido — não conta como entrega dele.
      const baselineIds = new Set(
        (existing ?? [])
          .filter((r: any) =>
            (r.song_id ?? null) === (effectiveSongId ?? null) &&
            r.is_baseline === true
          )
          .map((r: any) => r.spotify_playlist_id)
          .filter((v: unknown): v is string => typeof v === "string" && v.length > 0),
      );
      const knownCuratorOwnerIds = Array.from(
        new Set(
          (existing ?? [])
            .filter((r: any) => r.match_status === "curator")
            .map((r: any) => r.spotify_owner_id)
            .filter((v: unknown): v is string => typeof v === "string" && v.length > 0),
        ),
      );
      const curatorPlaylistNames = (existing ?? [])
        .filter((r: any) => r.match_status === "curator")
        .map((r: any) => r.playlist_name)
        .filter((v: unknown): v is string => typeof v === "string" && v.length > 0);

      // ====== Contexto de campanha ======
      // REGRA DE NEGÓCIO OFICIAL (baseline conflict):
      // A baseline da campanha é mecanismo de EXCLUSÃO. Se a playlist já continha
      // a música antes do início da campanha, ela NÃO pode ser contabilizada como
      // entrega nova do curador, independente do deal.source.
      //
      // Gates aplicados sempre que o deal estiver vinculado a uma campanha:
      // (1) baseline ainda não capturada (apenas para shadow internos) → awaiting_baseline
      // (2) playlist_id presente na baseline da campanha → baseline_conflict
      const hasCampaign = !!deal!.campaign_id;
      const isCampaignShadow =
        deal!.source === "campaign_internal" && hasCampaign;
      let campaignBaselineStatus: string | null = null;
      const campaignBaselineIds = new Set<string>();
      if (hasCampaign) {
        const { data: camp } = await admin
          .from("campaigns")
          .select("baseline_status")
          .eq("id", deal!.campaign_id!)
          .maybeSingle();
        campaignBaselineStatus = (camp as any)?.baseline_status ?? null;

        const { data: baseRows } = await admin
          .from("campaign_playlist_collections")
          .select("playlist_id")
          .eq("campaign_id", deal!.campaign_id!)
          .eq("is_baseline", true);
        for (const r of (baseRows ?? []) as any[]) {
          if (typeof r.playlist_id === "string" && r.playlist_id.length > 0) {
            campaignBaselineIds.add(r.playlist_id);
          }
        }
      }

      // ------- Items + dedup intra-payload -------
      const items: ProcessedItem[] = urls.map((u) => ({
        url: typeof u === "string" ? u.trim() : "",
        playlist_id: null,
        status: "ok",
      }));

      // Pre-classifica invalid_url e marca duplicatas dentro do payload (1ª ocorrência processa, demais viram duplicate_in_payload)
      const seenInPayload = new Set<string>();
      for (const item of items) {
        if (!item.url) {
          item.status = "invalid_url";
          continue;
        }
        const pid = extractPlaylistId(item.url);
        if (!pid) {
          item.status = "invalid_url";
          continue;
        }
        item.playlist_id = pid;
        if (seenInPayload.has(pid)) {
          item.status = "duplicate_in_payload";
          continue;
        }
        seenInPayload.add(pid);
        // Gate de campanha: aguardando baseline (apenas shadows internos) → bloqueia TODOS os cadastros.
        if (isCampaignShadow && campaignBaselineStatus === "pending") {
          item.status = "awaiting_baseline";
          continue;
        }
        // Gate de campanha (TODOS os deals com campaign_id): playlist já presente
        // na baseline da campanha → conflito de baseline.
        if (hasCampaign && campaignBaselineIds.has(pid)) {
          item.status = "baseline_conflict";
          continue;
        }
        if (baselineIds.has(pid)) {
          // Bloqueio forte: estava na baseline do curador, então não é entrega dele.
          item.status = "baseline_blocked";
          continue;
        }
        if (existingIds.has(pid)) {
          item.status = "duplicate";
        }
      }


      const ITEM_TIMEOUT_MS = 15_000;
      const BATCH = 5;
      // Só processa items que ainda estão em "ok" (não foram marcados como invalid/duplicate)
      const processable = items.filter((it) => it.status === "ok" && it.playlist_id);

      for (let i = 0; i < processable.length; i += BATCH) {
        const slice = processable.slice(i, i + BATCH);
        await Promise.all(
          slice.map(async (item) => {
            const pid = item.playlist_id!;
            try {
              let meta: SpotifyPlaylistMeta | null = null;
              try {
                meta = await withTimeout(fetchPlaylistMeta(pid), ITEM_TIMEOUT_MS, "spotify_timeout");
              } catch (e) {
                if (publicToken && !requireTrackPresent) {
                  const msg = e instanceof Error ? e.message : String(e);
                  meta = fallbackPlaylistMeta(pid);
                  item.error = `Metadados do Spotify indisponíveis no cadastro: ${msg}`;
                } else {
                  throw e;
                }
              }
              if (!meta) {
                item.status = "not_found";
                return;
              }
              item.meta = meta;
              if (publicToken) {
                item.match_status = "curator";
                item.match_reason = "declarada pelo curador via portal";
              } else {
                const cls = classifyPlaylist({
                  playlist: meta,
                  dealOwnerId: deal!.spotify_owner_id,
                  dealStartedAt: deal!.started_at,
                  addedAtSpotify: null,
                  knownCuratorOwnerIds,
                  curatorPlaylistNames,
                });
                item.match_status = cls.match_status;
                item.match_reason = cls.match_reason;
              }
              try {
                item.track_presence = await withTimeout(
                  checkTrackInPlaylist(pid, trackIdToCheck),
                  ITEM_TIMEOUT_MS,
                  "spotify_timeout",
                );
              } catch (e) {
                if (requireTrackPresent) throw e;
                const msg = e instanceof Error ? e.message : String(e);
                item.error = item.error ?? `Não foi possível verificar presença da faixa no Spotify: ${msg}`;
              }
              if (requireTrackPresent) {
                // Botão "+" na música: curador disse "já adicionei" → exige presença real.
                if (!item.track_presence.found) {
                  item.status = "track_not_present";
                  return;
                }
              }
              // Fluxo de colar link: NÃO bloqueia se a música já estiver na playlist.
              // O bloqueio real é via baseline (feito na pré-classificação acima).
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e);
              item.status = msg === "spotify_timeout" ? "timeout" : "error";
              item.error = msg;
            }
          }),
        );
      }

      // Modo preview: não salva, só devolve o que aconteceria
      if (preview) {
        return jr({ ok: true, preview: true, items, deal_owner_id: deal.spotify_owner_id });
      }

      // ------- Inserir os ok no banco -------
      const toInsert = items
        .filter((it) => it.status === "ok" && it.meta && it.match_status)
        .map((it) => ({
          deal_id: deal!.id,
          song_id: effectiveSongId,
          spotify_url: `https://open.spotify.com/playlist/${it.playlist_id}`,
          spotify_playlist_id: it.playlist_id!,
          playlist_name: it.meta!.name,
          spotify_owner_id: it.meta!.owner_id,
          spotify_owner_name: it.meta!.owner_name,
          followers: it.meta!.followers,
          image_url: it.meta!.image_url,
          match_status: it.match_status!,
          match_reason: it.match_reason ?? null,
          is_baseline: it.match_status === "baseline",
          last_paste_at: new Date().toISOString(),
          position_in_paste: positionInput,
        }));

      let inserted = 0;
      if (toInsert.length > 0) {
        const { error: insErr, count } = await admin
          .from("curator_playlists")
          .insert(toInsert, { count: "exact" });
        if (insErr) {
          const raw = insErr.message ?? "";
          const friendly = /duplicate key|unique constraint/i.test(raw)
            ? "Essa playlist já está vinculada a essa música."
            : /violates row-level security/i.test(raw)
            ? "Você não tem permissão para registrar essa playlist."
            : raw || "Não foi possível salvar a playlist.";
          return jr({ ok: false, error: friendly, items }, 200);
        }
        inserted = count ?? toInsert.length;
        await admin
          .from("curator_deal_songs")
          .update({
            auto_collect_status: "idle",
            auto_collect_error: null,
            next_auto_collect_at: new Date().toISOString(),
          })
          .eq("deal_id", deal.id)
          .eq("auto_collect", true);

        // Mirror em curator_campaign_playlists (Fase 3): identidade canônica
        // por playlist_id na camada de campanha. Best-effort: a trigger DB
        // bloqueia anti-baseline mas já pré-filtramos acima.
        if (isCampaignShadow) {
          const ccpRows = items
            .filter((it) => it.status === "ok" && it.playlist_id)
            .map((it) => ({
              campaign_id: deal!.campaign_id!,
              curator_id: deal!.curator_id!,
              deal_id: deal!.id,
              playlist_id: it.playlist_id!,
              playlist_url: `https://open.spotify.com/playlist/${it.playlist_id}`,
              status: "pending_match" as const,
            }));
          if (ccpRows.length > 0 && deal!.curator_id) {
            const { error: ccpErr } = await admin
              .from("curator_campaign_playlists")
              .upsert(ccpRows, {
                onConflict: "campaign_id,playlist_id",
                ignoreDuplicates: true,
              });
            if (ccpErr) {
              console.warn(
                "[register-curator-playlist] curator_campaign_playlists upsert failed:",
                ccpErr.message,
              );
            }
          }
        }
      }

      const summary = {
        total: items.length,
        inserted,
        blocked: items.filter((it) => it.status === "blocked").length,
        duplicate: items.filter((it) => it.status === "duplicate").length,
        duplicate_in_payload: items.filter((it) => it.status === "duplicate_in_payload").length,
        baseline_blocked: items.filter((it) => it.status === "baseline_blocked").length,
        campaign_baseline_blocked: items.filter((it) => it.status === "campaign_baseline_blocked").length,
        baseline_conflict: items.filter((it) => it.status === "baseline_conflict").length,
        awaiting_baseline: items.filter((it) => it.status === "awaiting_baseline").length,
        track_already_present: items.filter((it) => it.status === "track_already_present").length,
        track_not_present: items.filter((it) => it.status === "track_not_present").length,
        invalid: items.filter((it) => it.status === "invalid_url").length,
        not_found: items.filter((it) => it.status === "not_found").length,
        timeout: items.filter((it) => it.status === "timeout").length,
        error: items.filter((it) => it.status === "error").length,
      };

      recordMetric(admin, {
        scope: "edge_function",
        operation: "register-curator-playlist",
        status: "success",
        duration_ms: Date.now() - t0,
        deal_id: deal.id,
        song_id: effectiveSongId,
        metadata: { ...summary, mode: publicToken ? "public" : "admin", preview },
      });

      // Fire-and-forget: regenera plano de entrega
      if (!preview) {
        fetch(`${SUPABASE_URL}/functions/v1/build-deal-plan`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${SERVICE_KEY}`,
          },
          body: JSON.stringify({ deal_id: deal.id }),
        }).catch((err) => console.error("[register-curator-playlist] build-deal-plan trigger falhou", err));
      }

      return jr({
        ok: true,
        summary,
        items,
        deal_owner_id: deal.spotify_owner_id,
        owner_captured: false,
      });
    } finally {
      if (!preview) releaseLock(lockKey);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    try {
      const adminErr = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
      recordMetric(adminErr, {
        scope: "edge_function",
        operation: "register-curator-playlist",
        status: "error",
        duration_ms: Date.now() - t0,
        metadata: { error: msg.slice(0, 240) },
      });
    } catch (_) { /* ignore */ }
    return jr({ ok: false, error: msg }, 200);
  }
});
