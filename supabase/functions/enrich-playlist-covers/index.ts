// enrich-playlist-covers — Hidrata capa/seguidores de playlists do Spotify
// que não estão em curator_playlists e salva em spotify_playlist_cache.
// Fase 17-C: leitura pública agora vem exclusivamente da VPS Observer.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  observerGetPlaylist,
  ObserverApiError,
  ObserverNotConfiguredError,
} from "../_shared/observer-playlist.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const ids: string[] = Array.isArray(body?.playlist_ids)
      ? body.playlist_ids.filter((x: unknown) => typeof x === "string" && x.length > 0).slice(0, 50)
      : [];

    if (ids.length === 0) {
      return new Response(JSON.stringify({ cached: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const sb = createClient(SUPABASE_URL, SERVICE_KEY);

    // Filtra IDs já cacheados (fresh < 30 dias)
    const { data: existing } = await sb
      .from("spotify_playlist_cache")
      .select("spotify_playlist_id, cached_at")
      .in("spotify_playlist_id", ids);
    const fresh = new Set(
      (existing ?? [])
        .filter((r: any) => {
          const age = Date.now() - new Date(r.cached_at).getTime();
          return age < 30 * 24 * 60 * 60 * 1000;
        })
        .map((r: any) => r.spotify_playlist_id),
    );
    const toFetch = ids.filter((id) => !fresh.has(id));

    if (toFetch.length === 0) {
      return new Response(JSON.stringify({ cached: [], reused: ids.length }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fase 17-C: VPS Observer.
    const rows: Array<{
      spotify_playlist_id: string;
      image_url: string | null;
      followers: number | null;
      owner_name: string | null;
      cached_at: string;
    }> = [];

    const CONCURRENCY = 2;
    let rateLimited = false;
    let retryAfterSec: number | null = null;

    for (let i = 0; i < toFetch.length; i += CONCURRENCY) {
      if (rateLimited) break;
      const chunk = toFetch.slice(i, i + CONCURRENCY);
      const results = await Promise.all(
        chunk.map(async (id): Promise<typeof rows[number] | null> => {
          try {
            const j = await observerGetPlaylist(id);
            return {
              spotify_playlist_id: id,
              image_url: j?.images?.[0]?.url ?? null,
              followers: j?.followers?.total ?? null,
              owner_name: j?.owner?.display_name ?? null,
              cached_at: new Date().toISOString(),
            };
          } catch (err) {
            if (err instanceof ObserverApiError) {
              if (err.status === 429) {
                rateLimited = true;
                if (err.retryAfter) retryAfterSec = err.retryAfter;
                console.warn(`observer ${id} -> 429, retry-after=${err.retryAfter}`);
                return null;
              }
              if (err.status === 404 || err.status === 403) {
                return {
                  spotify_playlist_id: id,
                  image_url: null,
                  followers: null,
                  owner_name: null,
                  cached_at: new Date().toISOString(),
                };
              }
              console.warn(`observer ${id} -> ${err.status}: ${err.body.slice(0, 200)}`);
              return null;
            }
            if (err instanceof ObserverNotConfiguredError) {
              console.error("observer not configured");
              return null;
            }
            console.error(`observer ${id} threw:`, err);
            return null;
          }
        }),
      );
      for (const r of results) if (r) rows.push(r);
      // Pequeno delay entre lotes
      if (i + CONCURRENCY < toFetch.length && !rateLimited) {
        await new Promise((res) => setTimeout(res, 150));
      }
    }

    if (rows.length > 0) {
      await sb.from("spotify_playlist_cache").upsert(rows, { onConflict: "spotify_playlist_id" });
    }

    return new Response(
      JSON.stringify({
        cached: rows,
        reused: ids.length - toFetch.length,
        rate_limited: rateLimited,
        retry_after_sec: retryAfterSec,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error).message ?? e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
