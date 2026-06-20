// backfill-playlist-tracks-count
// Backfill do campo `tracks_count` em managed_playlists.
// Busca detalhe via Spotify (GET /v1/playlists/{id}?fields=tracks(total)) em lotes
// e atualiza tracks_count + last_metrics_at. Idempotente.
//
// POST body: { limit?: number (default 50), only_zero?: boolean (default true), dry_run?: boolean }
import { corsHeaders } from "npm:@supabase/supabase-js/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
// Fase 17-B.6: leitura pública → Catalog Gateway (CC).
// Classificação: CC-ONLY. Endpoint público de playlist (fields=tracks(total))
// não requer OAuth do owner.
import { ccFetch } from "../_shared/catalog-gateway.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const limit: number = Math.min(Math.max(Number(body?.limit ?? 50), 1), 500);
    const onlyZero: boolean = body?.only_zero !== false; // default true
    const dryRun: boolean = body?.dry_run === true;

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    let query = supabase
      .from("managed_playlists")
      .select("id, spotify_playlist_id, tracks_count")
      .is("archived_at", null)
      .order("imported_at", { ascending: true, nullsFirst: true })
      .limit(limit);
    if (onlyZero) {
      query = query.or("tracks_count.is.null,tracks_count.eq.0");
    }
    const { data: rows, error } = await query;
    if (error) return jr({ ok: false, error: error.message }, 500);
    if (!rows || rows.length === 0) {
      return jr({ ok: true, processed: 0, updated: 0, failed: 0, remaining: 0, details: [] });
    }

    if (dryRun) {
      return jr({
        ok: true,
        dry_run: true,
        would_process: rows.length,
        sample: rows.slice(0, 5).map((r) => ({ id: r.id, spotify_playlist_id: r.spotify_playlist_id, tracks_count: r.tracks_count })),
      });
    }

    const nowIso = new Date().toISOString();
    const CONCURRENCY = 3;
    const BATCH_DELAY_MS = 500;
    const details: Array<{ id: string; spotify_playlist_id: string; before: number | null; after: number | null; ok: boolean; error?: string }> = [];
    let updated = 0;
    let failed = 0;

    for (let i = 0; i < rows.length; i += CONCURRENCY) {
      const batch = rows.slice(i, i + CONCURRENCY);
      await Promise.all(batch.map(async (row) => {
        try {
          const r = await ccFetch(
            `https://api.spotify.com/v1/playlists/${row.spotify_playlist_id}?fields=tracks(total)`,
            "backfill-playlist-tracks-count",
            row.spotify_playlist_id,
          );
          if (!r.ok) {
            const t = await r.text();
            failed++;
            details.push({ id: row.id, spotify_playlist_id: row.spotify_playlist_id, before: row.tracks_count ?? null, after: null, ok: false, error: `${r.status}: ${t.slice(0, 120)}` });
            return;
          }
          const j: { tracks?: { total?: number } } = await r.json();
          const total = j.tracks?.total ?? 0;
          const { error: uErr } = await supabase
            .from("managed_playlists")
            .update({ tracks_count: total, last_metrics_at: nowIso })
            .eq("id", row.id);
          if (uErr) {
            failed++;
            details.push({ id: row.id, spotify_playlist_id: row.spotify_playlist_id, before: row.tracks_count ?? null, after: null, ok: false, error: uErr.message });
          } else {
            updated++;
            details.push({ id: row.id, spotify_playlist_id: row.spotify_playlist_id, before: row.tracks_count ?? null, after: total, ok: true });
          }
        } catch (e) {
          failed++;
          details.push({ id: row.id, spotify_playlist_id: row.spotify_playlist_id, before: row.tracks_count ?? null, after: null, ok: false, error: (e as Error).message });
        }
      }));
      // Delay entre lotes pra respeitar rate limit do Spotify (evita 429 em série).
      if (i + CONCURRENCY < rows.length) {
        await new Promise((res) => setTimeout(res, BATCH_DELAY_MS));
      }
    }

    // remaining: quantos ainda batem o filtro original
    let remaining = 0;
    if (onlyZero) {
      const { count } = await supabase
        .from("managed_playlists")
        .select("id", { count: "exact", head: true })
        .is("archived_at", null)
        .or("tracks_count.is.null,tracks_count.eq.0");
      remaining = count ?? 0;
    }

    return jr({
      ok: true,
      processed: rows.length,
      updated,
      failed,
      remaining,
      details,
    });
  } catch (e) {
    return jr({ ok: false, error: (e as Error).message }, 500);
  }
});
