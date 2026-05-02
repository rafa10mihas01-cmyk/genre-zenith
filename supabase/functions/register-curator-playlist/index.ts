// register-curator-playlist
// Cadastra 1 ou várias playlists em um deal, com enrichment via Spotify API
// e classificação automática (curator / baseline / editorial / suspicious / organic).
//
// Aceita 2 modos de autenticação:
//   - public_token: usado pelo portal do curador (sem login). Bloqueia cadastro
//     de playlist cujo owner não bata com o spotify_owner_id do deal (anti-fraude).
//     Se o deal ainda não tem spotify_owner_id, captura do 1º cadastro.
//   - JWT (admin/curador autenticado): identifica o deal por deal_id no body,
//     valida que pertence ao usuário, e salva sem bloqueio (admin pode cadastrar
//     playlists de qualquer dono — apenas marca como suspicious quando aplicável).
//
// Body:
//   { public_token?: string, deal_id?: string, urls: string[], preview?: boolean }
//
// Quando preview=true, retorna a classificação proposta sem salvar nada.

import { corsHeaders } from "npm:@supabase/supabase-js/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  classifyPlaylist,
  extractPlaylistId,
  fetchPlaylistMeta,
  type ClassifyResult,
  type SpotifyPlaylistMeta,
} from "../_shared/curator-playlist.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

function jr(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type DealRow = {
  id: string;
  user_id: string;
  spotify_owner_id: string | null;
  started_at: string;
};

type ProcessedItem = {
  url: string;
  playlist_id: string | null;
  status: "ok" | "blocked" | "duplicate" | "invalid_url" | "not_found" | "error";
  match_status?: ClassifyResult["match_status"];
  match_reason?: string;
  meta?: SpotifyPlaylistMeta;
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
    let isPublicMode = false;
    let authedUserId: string | null = null;

    if (publicToken) {
      isPublicMode = true;
      const { data, error } = await admin
        .from("curator_deals")
        .select("id, user_id, spotify_owner_id, started_at")
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
        .select("id, user_id, spotify_owner_id, started_at")
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

            // Bloqueio anti-fraude no portal público:
            // se o deal já tem owner cadastrado e não bate, e não é editorial → bloqueia.
            if (
              isPublicMode &&
              deal!.spotify_owner_id &&
              cls.match_status !== "curator" &&
              cls.match_status !== "baseline"
            ) {
              item.status = "blocked";
              item.error = "playlist não pertence ao seu perfil Spotify cadastrado";
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

    // ------- Captura de spotify_owner_id no 1º cadastro do portal -------
    let updatedDealOwnerId = deal.spotify_owner_id;
    if (isPublicMode && !deal.spotify_owner_id) {
      // Pega o primeiro item válido com owner não-editorial → vira o owner do deal
      const firstValid = items.find(
        (it) =>
          it.status === "ok" &&
          it.meta &&
          it.meta.owner_id &&
          it.meta.owner_id.toLowerCase() !== "spotify",
      );
      if (firstValid?.meta) {
        updatedDealOwnerId = firstValid.meta.owner_id;
        await admin
          .from("curator_deals")
          .update({
            spotify_owner_id: updatedDealOwnerId,
            spotify_owner_url: `https://open.spotify.com/user/${updatedDealOwnerId}`,
          })
          .eq("id", deal.id);

        // Reclassifica todos os itens com o owner novo
        for (const it of items) {
          if (it.status === "ok" && it.meta) {
            const cls = classifyPlaylist({
              playlist: it.meta,
              dealOwnerId: updatedDealOwnerId,
              dealStartedAt: deal.started_at,
              addedAtSpotify: null,
              knownCuratorOwnerIds: [updatedDealOwnerId],
              curatorPlaylistNames,
            });
            it.match_status = cls.match_status;
            it.match_reason = cls.match_reason;
            // Após captura, o portal não pode mais cadastrar de outro dono
            if (
              cls.match_status !== "curator" &&
              cls.match_status !== "baseline" &&
              cls.match_status !== "editorial"
            ) {
              it.status = "blocked";
              it.error = "playlist não pertence ao seu perfil Spotify cadastrado";
            }
          }
        }
      }
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
      invalid: items.filter((it) => it.status === "invalid_url").length,
      not_found: items.filter((it) => it.status === "not_found").length,
      error: items.filter((it) => it.status === "error").length,
    };

    return jr({
      ok: true,
      summary,
      items,
      deal_owner_id: updatedDealOwnerId,
      owner_captured: isPublicMode && !deal.spotify_owner_id && updatedDealOwnerId !== null,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return jr({ ok: false, error: msg }, 200);
  }
});
