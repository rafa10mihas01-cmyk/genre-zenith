// preview-distribute-catalog-track — Etapa 2 do fluxo. Dry-run.
// Recebe spotify_track_id + genre_id e retorna o que aconteceria se distribuísse.
// Não persiste nada. Chama a RPC preview_distribute_catalog_track.
// (touch: força redeploy 2026-06-23)
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const TRACK_ID_RE = /^[A-Za-z0-9]{22}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jr({ ok: false, error: "method_not_allowed" }, 405);

  try {
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const trackId = typeof body?.spotify_track_id === "string" ? body.spotify_track_id.trim() : "";
    const genreId = typeof body?.genre_id === "string" ? body.genre_id.trim() : "";

    if (!TRACK_ID_RE.test(trackId)) return jr({ ok: false, error: "invalid_spotify_track_id" }, 400);
    if (!UUID_RE.test(genreId)) return jr({ ok: false, error: "invalid_genre_id" }, 400);

    const sb = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data, error } = await sb.rpc("preview_distribute_catalog_track", {
      p_spotify_track_id: trackId,
      p_genre_id: genreId,
    });
    if (error) return jr({ ok: false, error: "rpc_failed", message: error.message }, 500);
    return jr(data);
  } catch (e) {
    return jr({ ok: false, error: "internal_error", message: (e as Error)?.message ?? String(e) }, 500);
  }
});
