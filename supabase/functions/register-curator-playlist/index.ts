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
};

type ProcessedItem = {
  url: string;
  playlist_id: string | null;
  status: "ok" | "blocked" | "duplicate" | "track_already_present" | "invalid_url" | "not_found" | "error";
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

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

    if (urls.length === 0) return jr({ ok: false, error: "urls vazio" }, 400);
    if (urls.length > 200) return jr({ ok: false, error: "máximo 200 URLs por chamada" }, 400);
    if (!publicToken && !dealIdInput) {
      return jr({ ok: false, error: "public_token ou deal_id obrigatório" }, 400);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    // ------- Identificar deal e modo (público vs admin) -------
    let deal: DealRow | null = null;
    let authedUserId: string | null = null;

    if (publicToken) {
      const { data, error } = await admin
        .from("curator_deals")
        .select("id, user_id, spotify_owner_id, song_spotify_url, started_at")
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
        .select("id, user_id, spotify_owner_id, song_spotify_url, started_at")
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

    let trackIdToCheck = extractTrackId(deal.song_spotify_url ?? "");
    if (songIdInput) {
      const { data: songRow } = await admin
        .from("curator_deal_songs")
        .select("spotify_track_id, song_spotify_url")
        .eq("id", songIdInput)
        .eq("deal_id", deal.id)
        .maybeSingle();
      trackIdToCheck = songRow?.spotify_track_id || extractTrackId(songRow?.song_spotify_url ?? "") || trackIdToCheck;
    }

    // ------- Carregar contexto de classificação -------
    const { data: existing } = await admin
      .from("curator_playlists")
      .select("spotify_playlist_id, spotify_owner_id, playlist_name, match_status")
      .eq("deal_id", deal.id);

    const existingIds = new Set(
      (existing ?? [])
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

    // ------- Processar URLs em paralelo (5 por vez) -------
    const items: ProcessedItem[] = urls.map((u) => ({
      url: typeof u === "string" ? u.trim() : "",
      playlist_id: null,
      status: "ok",
    }));

    const BATCH = 5;
    for (let i = 0; i < items.length; i += BATCH) {
      const slice = items.slice(i, i + BATCH);
      await Promise.all(
        slice.map(async (item) => {
          if (!item.url) {
            item.status = "invalid_url";
            return;
          }
          const pid = extractPlaylistId(item.url);
          if (!pid) {
            item.status = "invalid_url";
            return;
          }
          item.playlist_id = pid;
          if (existingIds.has(pid)) {
            item.status = "duplicate";
            return;
          }
          try {
            const meta = await fetchPlaylistMeta(pid);
            if (!meta) {
              item.status = "not_found";
              return;
            }
            item.meta = meta;
            // Cadastro via portal do curador = declaração oficial → sempre 'curator'.
            // Cadastro via admin/JWT = passa pelo classificador normal.
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
            item.track_presence = await checkTrackInPlaylist(pid, trackIdToCheck);
            if (item.track_presence.found) {
              item.status = "track_already_present";
              return;
            }

          } catch (e) {
            item.status = "error";
            item.error = e instanceof Error ? e.message : String(e);
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
        song_id: songIdInput,
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
        return jr({ ok: false, error: insErr.message, items }, 200);
      }
      inserted = count ?? toInsert.length;
    }

    const summary = {
      total: items.length,
      inserted,
      blocked: items.filter((it) => it.status === "blocked").length,
      duplicate: items.filter((it) => it.status === "duplicate").length,
      track_already_present: items.filter((it) => it.status === "track_already_present").length,
      invalid: items.filter((it) => it.status === "invalid_url").length,
      not_found: items.filter((it) => it.status === "not_found").length,
      error: items.filter((it) => it.status === "error").length,
    };

    return jr({
      ok: true,
      summary,
      items,
      deal_owner_id: deal.spotify_owner_id,
      owner_captured: false,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return jr({ ok: false, error: msg }, 200);
  }
});
