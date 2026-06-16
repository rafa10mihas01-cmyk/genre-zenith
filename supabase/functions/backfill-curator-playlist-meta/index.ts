// backfill-curator-playlist-meta
// Recupera metadados (nome, capa, owner, seguidores) de linhas de
// curator_playlists que ficaram com placeholder "Playlist Spotify XYZ"
// ou sem capa por causa de timeout/429 do Spotify no momento do import.
//
// Processa UMA playlist por vez, com pausa entre cada — antídoto do batch=5
// que estourava rate limit.
//
// Body:
//   { deal_id?: string, playlist_row_ids?: string[], limit?: number }
//   - deal_id: backfilla todas as placeholders desse deal
//   - playlist_row_ids: lista específica de linhas curator_playlists.id
//   - limit: máx por chamada (default 100)

import { corsHeaders } from "npm:@supabase/supabase-js/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { fetchPlaylistMeta } from "../_shared/curator-playlist.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const SPACING_MS = 220;
const ITEM_TIMEOUT_MS = 15_000;

function jr(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("spotify_timeout")), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const dealId = typeof body?.deal_id === "string" ? body.deal_id.trim() : "";
    const rowIds: string[] = Array.isArray(body?.playlist_row_ids)
      ? body.playlist_row_ids.filter((v: unknown): v is string => typeof v === "string")
      : [];
    const limit = Math.min(Math.max(Number(body?.limit ?? 100) || 100, 1), 500);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    // Quem precisa de backfill:
    //  - placeholder name "Playlist Spotify ..." OU image_url null OU followers=0+name vazio
    let query = admin
      .from("curator_playlists")
      .select("id, spotify_playlist_id, playlist_name, image_url")
      .limit(limit);

    if (rowIds.length > 0) {
      query = query.in("id", rowIds);
    } else if (dealId) {
      query = query
        .eq("deal_id", dealId)
        .or("playlist_name.ilike.Playlist Spotify %,image_url.is.null");
    } else {
      return jr({ ok: false, error: "deal_id ou playlist_row_ids obrigatório" }, 400);
    }

    const { data: rows, error } = await query;
    if (error) return jr({ ok: false, error: error.message }, 200);
    const candidates = (rows ?? []).filter(
      (r: any) =>
        typeof r.spotify_playlist_id === "string" &&
        r.spotify_playlist_id.length > 0 &&
        (
          !r.playlist_name ||
          /^Playlist Spotify [A-Za-z0-9]{22}$/.test(r.playlist_name) ||
          !r.image_url
        ),
    );

    let updated = 0;
    let failed = 0;
    const failures: Array<{ id: string; error: string }> = [];

    for (let i = 0; i < candidates.length; i++) {
      const row: any = candidates[i];
      try {
        const meta = await withTimeout(fetchPlaylistMeta(row.spotify_playlist_id), ITEM_TIMEOUT_MS);
        if (meta) {
          const patch: Record<string, unknown> = {};
          if (meta.name && !/^Playlist Spotify /.test(meta.name)) patch.playlist_name = meta.name;
          if (meta.image_url) patch.image_url = meta.image_url;
          if (meta.owner_id) patch.spotify_owner_id = meta.owner_id;
          if (meta.owner_name) patch.spotify_owner_name = meta.owner_name;
          if (typeof meta.followers === "number") patch.followers = meta.followers;
          if (Object.keys(patch).length > 0) {
            const { error: upErr } = await admin
              .from("curator_playlists")
              .update(patch)
              .eq("id", row.id);
            if (upErr) {
              failed++;
              failures.push({ id: row.id, error: upErr.message });
            } else {
              updated++;
            }
          }
        }
      } catch (e) {
        failed++;
        failures.push({ id: row.id, error: e instanceof Error ? e.message : String(e) });
        // backoff extra se foi 429/timeout
        await sleep(800);
      }
      if (i + 1 < candidates.length) await sleep(SPACING_MS);
    }

    return jr({
      ok: true,
      considered: candidates.length,
      updated,
      failed,
      failures: failures.slice(0, 20),
    });
  } catch (e) {
    return jr({ ok: false, error: e instanceof Error ? e.message : String(e) }, 200);
  }
});
