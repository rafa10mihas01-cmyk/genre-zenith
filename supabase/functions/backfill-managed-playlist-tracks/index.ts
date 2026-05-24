// backfill-managed-playlist-tracks — Roda em lote a sincronização de
// managed_playlist_tracks para playlists ativas que ainda não têm
// nenhuma faixa snapshotada. Idempotente.
//
// POST { limit?: number }   (padrão 60)
// Retorna: { processed, ok, failed, remaining, details: [...] }

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getSpotifyToken } from "../_shared/spotify.ts";
import { requireTeamAccess } from "../_shared/auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function syncOne(sb: any, token: string, pl: { id: string; spotify_playlist_id: string }) {
  const rows: any[] = [];
  let url: string | null =
    `https://api.spotify.com/v1/playlists/${pl.spotify_playlist_id}/items` +
    `?fields=items(added_at,track(id,name,duration_ms,artists(name),album(images))),next&limit=100`;
  let pos = 0;
  while (url) {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) {
      const txt = await r.text();
      throw new Error(`spotify ${r.status}: ${txt.slice(0, 120)}`);
    }
    const j = await r.json();
    for (const it of j.items ?? []) {
      const tr = it?.track;
      if (!tr?.id) { pos++; continue; }
      const imgs = tr.album?.images ?? [];
      const cover = imgs[imgs.length - 1]?.url ?? imgs[0]?.url ?? null;
      rows.push({
        playlist_id: pl.id,
        spotify_track_id: tr.id,
        track_name: tr.name ?? null,
        artist_name: (tr.artists ?? []).map((a: any) => a?.name).filter(Boolean).join(", ") || null,
        album_cover: cover,
        position: pos,
        added_at: it.added_at ?? null,
        duration_ms: tr.duration_ms ?? null,
      });
      pos++;
    }
    url = j.next ?? null;
  }

  // Replace-all
  await sb.from("managed_playlist_tracks").delete().eq("playlist_id", pl.id);
  if (rows.length > 0) {
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await sb.from("managed_playlist_tracks").insert(rows.slice(i, i + 500));
      if (error) throw new Error(`insert: ${error.message}`);
    }
  }
  await sb.from("managed_playlists")
    .update({ tracks_count: rows.length, last_metrics_at: new Date().toISOString() })
    .eq("id", pl.id);
  return rows.length;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const guard = await requireTeamAccess(req);
  if (!guard.ok) return guard.resp;

  let body: any = {};
  try { body = await req.json(); } catch { /* ignore */ }
  const limit = Math.max(1, Math.min(Number(body.limit ?? 60), 200));

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  // 1) Pega playlists ativas com spotify_playlist_id mas SEM linhas em managed_playlist_tracks.
  // PostgREST não tem COUNT-zero, então usamos RPC dinâmica via select com left join virtual:
  // listamos todos os IDs ativos e depois filtramos os que aparecem em mpt.
  const { data: all } = await sb
    .from("managed_playlists")
    .select("id, spotify_playlist_id")
    .is("archived_at", null)
    .not("spotify_playlist_id", "is", null);

  const allIds = (all ?? []).map((r: any) => r.id);
  if (allIds.length === 0) return jr({ ok: true, processed: 0, ok_count: 0, failed: 0, remaining: 0, details: [] });

  // Busca playlist_ids que JÁ têm tracks
  const present = new Set<string>();
  for (let i = 0; i < allIds.length; i += 500) {
    const slice = allIds.slice(i, i + 500);
    const { data } = await sb
      .from("managed_playlist_tracks")
      .select("playlist_id")
      .in("playlist_id", slice);
    for (const r of (data ?? []) as any[]) present.add(r.playlist_id);
  }

  const missing = (all ?? []).filter((r: any) => !present.has(r.id));
  const batch = missing.slice(0, limit);
  const remaining = Math.max(0, missing.length - batch.length);

  if (batch.length === 0) return jr({ ok: true, processed: 0, ok_count: 0, failed: 0, remaining, details: [] });

  const token = await getSpotifyToken();
  const details: any[] = [];
  let okCount = 0, failed = 0;

  for (const pl of batch) {
    try {
      const n = await syncOne(sb, token, pl as any);
      okCount++;
      details.push({ id: pl.id, ok: true, tracks: n });
    } catch (e) {
      failed++;
      details.push({ id: pl.id, ok: false, error: (e as Error).message.slice(0, 200) });
    }
  }

  return jr({
    ok: true,
    processed: batch.length,
    ok_count: okCount,
    failed,
    remaining,
    details,
  });
});
