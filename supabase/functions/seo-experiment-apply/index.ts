// seo-experiment-apply — aplica um experimento proposto via Spotify API
// Body: { experiment_id: string }
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { requireTeamAccess } from "../_shared/auth.ts";
import { getUserToken } from "../_shared/spotify-client.ts";
import { setPlaylistDetails, SpotifyApiError } from "../_shared/spotify-playlist.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MEASURE_DAYS = 14;

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const guard = await requireTeamAccess(req);
  if (!guard.ok) return guard.resp;

  try {
    const body = await req.json().catch(() => ({}));
    const experimentId: string = body?.experiment_id;
    if (!experimentId) return jr({ ok: false, error: "experiment_id obrigatório" }, 400);

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    const { data: exp, error } = await supabase
      .from("playlist_seo_experiments")
      .select("id, playlist_id, field, version_after, status")
      .eq("id", experimentId)
      .maybeSingle();
    if (error || !exp) return jr({ ok: false, error: error?.message ?? "not found" }, 404);
    if (exp.status !== "proposed") return jr({ ok: false, error: `status inválido: ${exp.status}` }, 409);

    const { data: pl } = await supabase
      .from("managed_playlists")
      .select("id, spotify_playlist_id, account_id, followers, name, description")
      .eq("id", exp.playlist_id)
      .maybeSingle();
    if (!pl) return jr({ ok: false, error: "playlist não encontrada" }, 404);

    // Resolve a conta dona da playlist
    let spotifyUserId: string | undefined;
    if (pl.account_id) {
      const { data: acc } = await supabase
        .from("accounts")
        .select("spotify_user_id")
        .eq("id", pl.account_id)
        .maybeSingle();
      spotifyUserId = (acc as any)?.spotify_user_id ?? undefined;
    }

    const { token } = await getUserToken(spotifyUserId);

    const payload: Record<string, string> = {};
    if (exp.field === "name") payload.name = exp.version_after;
    else payload.description = exp.version_after;

    try {
      await setPlaylistDetails(pl.spotify_playlist_id, payload, token);
    } catch (e) {
      const status = e instanceof SpotifyApiError ? e.status : 0;
      const bodyText = e instanceof SpotifyApiError ? e.body : (e as Error).message;
      await supabase.from("playlist_seo_experiments").update({
        status: "rejected",
        reasoning: `[apply-fail] Spotify ${status}: ${bodyText.slice(0, 200)}`,
        updated_at: new Date().toISOString(),
      }).eq("id", exp.id);
      return jr({ ok: false, error: `Spotify ${status}: ${bodyText.slice(0, 200)}` }, 502);
    }

    const now = new Date();
    const dueAt = new Date(now.getTime() + MEASURE_DAYS * 86_400_000);

    // Marca experimento como ativo
    await supabase.from("playlist_seo_experiments").update({
      status: "active",
      applied_at: now.toISOString(),
      baseline_followers: pl.followers ?? 0,
      baseline_at: now.toISOString(),
      measure_due_at: dueAt.toISOString(),
      updated_at: now.toISOString(),
    }).eq("id", exp.id);

    // Atualiza o campo correspondente no managed_playlists pra ficar coerente
    const update: Record<string, unknown> = { updated_at: now.toISOString() };
    if (exp.field === "name") update.name = exp.version_after;
    else update.description = exp.version_after;
    await supabase.from("managed_playlists").update(update).eq("id", pl.id);

    return jr({ ok: true, applied_at: now.toISOString(), measure_due_at: dueAt.toISOString() });
  } catch (e) {
    return jr({ ok: false, error: (e as Error).message }, 500);
  }
});
