// snapshot-catalog-performance — Cron diário (03:00 UTC).
// Captura snapshot de performance de TODAS as músicas ativas do catálogo:
//   - track.popularity (Spotify /v1/tracks)
//   - artist.followers.total (Spotify /v1/artists)
// Não duplica snapshot do mesmo dia (UNIQUE catalog_track_id + snapshot_date).
//
// monthly_listeners e spotify_followers ficam null por enquanto — a API pública
// do Spotify não expõe esses números. Colunas existem prontas pra quando
// houver coleta via outra fonte (scrape autenticado, partner API etc.).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { getAppToken, spotifyFetch } from "../_shared/spotify-client.ts";
import { reportCronHealth } from "../_shared/cron-health.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FN = "snapshot-catalog-performance";

type Track = { id: string; spotify_track_id: string };

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const startedAt = Date.now();
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE);

  const metrics = { tracks: 0, snapshots_inserted: 0, snapshots_skipped: 0, errors: 0 };

  try {
    // 1. Buscar todas as músicas ativas do catálogo
    const { data: tracks, error: tracksErr } = await sb
      .from("catalog_tracks")
      .select("id, spotify_track_id")
      .eq("status", "active");
    if (tracksErr) throw tracksErr;

    const list = (tracks ?? []) as Track[];
    metrics.tracks = list.length;
    if (list.length === 0) {
      await reportCronHealth(sb, { job_name: FN, status: "ok", startedAt, metrics, message: "no active tracks" });
      return new Response(JSON.stringify({ ok: true, ...metrics }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. Skip tracks que já têm snapshot hoje
    const todayUTC = new Date().toISOString().slice(0, 10);
    const { data: existing } = await sb
      .from("catalog_track_snapshots")
      .select("catalog_track_id")
      .eq("snapshot_date", todayUTC);
    const already = new Set((existing ?? []).map((r: any) => r.catalog_track_id));
    const todo = list.filter((t) => !already.has(t.id));
    metrics.snapshots_skipped = list.length - todo.length;

    if (todo.length === 0) {
      await reportCronHealth(sb, { job_name: FN, status: "ok", startedAt, metrics, message: "all already snapshotted today" });
      return new Response(JSON.stringify({ ok: true, ...metrics }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 3. Buscar tracks no Spotify em lotes de 50 (endpoint /v1/tracks aceita até 50 IDs)
    const token = await getAppToken({ functionName: FN });
    const trackById = new Map<string, { popularity: number | null; artist_id: string | null }>();

    for (const batch of chunk(todo, 50)) {
      const ids = batch.map((t) => t.spotify_track_id).filter(Boolean).join(",");
      if (!ids) continue;
      try {
        const r = await spotifyFetch(`https://api.spotify.com/v1/tracks?ids=${ids}`, {
          headers: { Authorization: `Bearer ${token}` },
        }, { functionName: FN, operation: "tracks.bulk" });
        if (!r.ok) { metrics.errors++; continue; }
        const j = await r.json();
        for (const tk of (j?.tracks ?? [])) {
          if (!tk?.id) continue;
          trackById.set(tk.id, {
            popularity: typeof tk.popularity === "number" ? tk.popularity : null,
            artist_id: tk.artists?.[0]?.id ?? null,
          });
        }
      } catch (_e) {
        metrics.errors++;
      }
    }

    // 4. Buscar artists em lotes de 50 (/v1/artists aceita até 50)
    const artistIds = Array.from(new Set(
      Array.from(trackById.values()).map((v) => v.artist_id).filter(Boolean) as string[],
    ));
    const artistById = new Map<string, { followers: number | null }>();
    for (const batch of chunk(artistIds, 50)) {
      const ids = batch.join(",");
      if (!ids) continue;
      try {
        const r = await spotifyFetch(`https://api.spotify.com/v1/artists?ids=${ids}`, {
          headers: { Authorization: `Bearer ${token}` },
        }, { functionName: FN, operation: "artists.bulk" });
        if (!r.ok) { metrics.errors++; continue; }
        const j = await r.json();
        for (const a of (j?.artists ?? [])) {
          if (!a?.id) continue;
          artistById.set(a.id, { followers: a.followers?.total ?? null });
        }
      } catch (_e) {
        metrics.errors++;
      }
    }

    // 5. Inserir snapshots (UNIQUE garante idempotência)
    const rows = todo.map((t) => {
      const tk = trackById.get(t.spotify_track_id);
      const art = tk?.artist_id ? artistById.get(tk.artist_id) : null;
      return {
        catalog_track_id: t.id,
        spotify_popularity: tk?.popularity ?? null,
        monthly_listeners: null,
        artist_followers: art?.followers ?? null,
        spotify_followers: null,
        snapshot_date: todayUTC,
      };
    });

    const { data: inserted, error: insErr } = await sb
      .from("catalog_track_snapshots")
      .upsert(rows, { onConflict: "catalog_track_id,snapshot_date", ignoreDuplicates: true })
      .select("id");
    if (insErr) {
      metrics.errors++;
    } else {
      metrics.snapshots_inserted = inserted?.length ?? 0;
    }

    await reportCronHealth(sb, {
      job_name: FN,
      status: metrics.errors > 0 ? "partial" : "ok",
      startedAt,
      metrics,
    });
    return new Response(JSON.stringify({ ok: true, ...metrics }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    await reportCronHealth(sb, {
      job_name: FN, status: "error", startedAt, metrics, message: String((e as Error)?.message ?? e),
    });
    return new Response(JSON.stringify({ ok: false, error: String((e as Error)?.message ?? e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
