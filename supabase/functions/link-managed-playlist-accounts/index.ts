// Auto-link managed_playlists.account_id by matching the Spotify playlist
// owner.id against connected spotify_user_tokens.spotify_user_id.
import { createClient } from "npm:@supabase/supabase-js@2";
import { getAppToken } from "../_shared/spotify-client.ts";
import { getPlaylistMeta, SpotifyApiError } from "../_shared/spotify-playlist.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: tokens } = await supabase
      .from("spotify_user_tokens")
      .select("id, spotify_user_id");
    const ownerToAccount = new Map<string, string>();
    for (const t of tokens ?? []) {
      if (t.spotify_user_id) ownerToAccount.set(t.spotify_user_id, t.id);
    }

    if (ownerToAccount.size === 0) {
      return new Response(JSON.stringify({ ok: true, linked: 0, scanned: 0, reason: "no_tokens" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: pls } = await supabase
      .from("managed_playlists")
      .select("id, spotify_playlist_id, metadata")
      .is("account_id", null)
      .is("archived_at", null);

    const list = pls ?? [];
    if (list.length === 0) {
      return new Response(JSON.stringify({ ok: true, linked: 0, scanned: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const appToken = await getAppToken();
    let linked = 0;
    let scanned = 0;
    const errors: string[] = [];

    for (const p of list) {
      scanned++;
      try {
        // try cached owner first
        let ownerId: string | null =
          (p.metadata as any)?.owner_id || (p.metadata as any)?.owner?.id || null;

        if (!ownerId) {
          let meta;
          try {
            meta = await getPlaylistMeta(p.spotify_playlist_id, appToken, { fields: "owner(id,display_name)" });
          } catch (e) {
            if (e instanceof SpotifyApiError && e.status === 404) continue;
            throw e instanceof SpotifyApiError ? new Error(`spotify ${e.status}`) : e;
          }
          ownerId = meta.owner_id;
          // cache in metadata so next time we skip the API call
          const newMeta = { ...(p.metadata || {}), owner_id: ownerId, owner_name: meta.owner_display_name };
          await supabase.from("managed_playlists").update({ metadata: newMeta }).eq("id", p.id);
        }

        if (ownerId && ownerToAccount.has(ownerId)) {
          await supabase
            .from("managed_playlists")
            .update({ account_id: ownerToAccount.get(ownerId)! })
            .eq("id", p.id);
          linked++;
        }
      } catch (e) {
        errors.push(`${p.spotify_playlist_id}: ${(e as Error).message}`);
      }
    }

    return new Response(
      JSON.stringify({ ok: true, scanned, linked, errors: errors.slice(0, 10) }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
