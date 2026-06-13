// apply-playlist-identity — atualiza nome e/ou descrição da playlist
// gerenciada direto no Spotify via PUT /playlists/{id}.
//
// Body: { playlist_id: string (managed_playlists.id), name?: string, description?: string }
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { requireTeamAccess } from "../_shared/auth.ts";
import { getUserToken, getAppToken } from "../_shared/spotify-client.ts";
import { getPlaylistMeta, setPlaylistDetails, SpotifyApiError } from "../_shared/spotify-playlist.ts";

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
  const guard = await requireTeamAccess(req);
  if (!guard.ok) return guard.resp;

  try {
    const body = await req.json().catch(() => ({}));
    const playlistId: string = body?.playlist_id;
    const name: string | undefined = typeof body?.name === "string" ? body.name : undefined;
    const description: string | undefined = typeof body?.description === "string" ? body.description : undefined;
    if (!playlistId) return jr({ ok: false, error: "playlist_id obrigatório" }, 400);
    if (!name && !description) return jr({ ok: false, error: "envie name e/ou description" }, 400);

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: pl } = await supabase
      .from("managed_playlists")
      .select("id, spotify_playlist_id")
      .eq("id", playlistId)
      .maybeSingle();
    if (!pl?.spotify_playlist_id) return jr({ ok: false, error: "playlist sem spotify_playlist_id" }, 404);

    // descobre dono pra escolher o token certo
    let ownerId: string | null = null;
    try {
      const appToken = await getAppToken();
      const meta = await getPlaylistMeta(pl.spotify_playlist_id, appToken, { fields: "owner(id)" });
      ownerId = meta.owner_id;
    } catch { /* */ }

    let token: string;
    try {
      const r = await getUserToken(ownerId ?? undefined);
      token = r.token;
    } catch (e) {
      return jr({
        ok: false,
        error: ownerId
          ? `conta do dono "${ownerId}" não está conectada. Conecte em Configurações → Spotify.`
          : `nenhuma conta Spotify conectada: ${(e as Error).message}`,
      }, 412);
    }

    const payload: Record<string, string> = {};
    if (name) payload.name = name;
    if (description) payload.description = description;

    try {
      await setPlaylistDetails(pl.spotify_playlist_id, payload, token);
    } catch (e) {
      if (e instanceof SpotifyApiError) {
        return jr({ ok: false, error: `Spotify ${e.status}: ${e.body.slice(0, 300)}` }, 502);
      }
      throw e;
    }

    // atualiza cache local também
    const upd: Record<string, string> = {};
    if (name) upd.name = name;
    if (description) upd.description = description;
    await supabase.from("managed_playlists").update(upd).eq("id", pl.id);

    await supabase.from("collection_logs").insert({
      acao: "apply-playlist-identity",
      status: "sucesso",
      mensagem: `${pl.spotify_playlist_id}: ${Object.keys(payload).join(", ")}`,
    });

    return jr({ ok: true, updated: Object.keys(payload) });
  } catch (e) {
    return jr({ ok: false, error: (e as Error).message }, 500);
  }
});
