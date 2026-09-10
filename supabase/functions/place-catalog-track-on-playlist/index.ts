// place-catalog-track-on-playlist — envio direcionado de uma faixa do catálogo
// para UMA playlist específica, com opção de segunda cópia proposital.
//
// POST { spotify_track_id: string, managed_playlist_id: uuid, allow_duplicate?: boolean }
// → { ok, placement_id, copy_index, duplicate, playlist_name }
//
// Toda a regra (elegibilidade da playlist, limite de 2 cópias, unicidade) vive na
// RPC engine_place_catalog_track_on_playlist. Aqui só há guard de acesso + resolução
// do catalog_track_id a partir do spotify_track_id.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TRACK_ID_RE = /^[A-Za-z0-9]{22}$/;

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jr({ ok: false, error: "method_not_allowed" }, 405);

  try {
    // 🔐 Exige sessão da equipe (admin/curador)
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) return jr({ ok: false, error: "unauthorized" }, 401);
    const authed = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData } = await authed.auth.getUser();
    if (!userData?.user) return jr({ ok: false, error: "unauthorized" }, 401);
    const { data: hasAccess } = await authed.rpc("has_team_access");
    if (!hasAccess) return jr({ ok: false, error: "forbidden" }, 403);

    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const trackId = typeof body?.spotify_track_id === "string" ? body.spotify_track_id.trim() : "";
    const playlistId = typeof body?.managed_playlist_id === "string" ? body.managed_playlist_id.trim() : "";
    const allowDuplicate = body?.allow_duplicate === true;

    if (!TRACK_ID_RE.test(trackId)) {
      return jr({ ok: false, error: "invalid_spotify_track_id" }, 400);
    }
    if (!UUID_RE.test(playlistId)) {
      return jr({ ok: false, error: "invalid_managed_playlist_id" }, 400);
    }

    const sb = createClient(SUPABASE_URL, SERVICE_KEY);

    const { data: track, error: trackErr } = await sb
      .from("catalog_tracks")
      .select("id")
      .eq("spotify_track_id", trackId)
      .maybeSingle();
    if (trackErr) return jr({ ok: false, error: "track_lookup_failed", message: trackErr.message }, 500);
    if (!track?.id) {
      return jr({
        ok: false,
        error: "track_not_in_catalog",
        message: "Cadastre a música no catálogo antes de enviá-la para uma playlist.",
      }, 400);
    }

    const { data: rpcData, error: rpcErr } = await sb.rpc("engine_place_catalog_track_on_playlist", {
      p_track_id: track.id,
      p_playlist_id: playlistId,
      p_allow_duplicate: allowDuplicate,
    });
    if (rpcErr) return jr({ ok: false, error: "rpc_failed", message: rpcErr.message }, 500);

    return jr(rpcData);
  } catch (e) {
    return jr({ ok: false, error: "internal_error", message: (e as Error)?.message ?? String(e) }, 500);
  }
});
