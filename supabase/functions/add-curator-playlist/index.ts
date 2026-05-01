// add-curator-playlist — chamada pela página pública do curador para
// adicionar uma playlist ao deal. Usa public_token para localizar o deal,
// busca o nome da playlist via fetch-spotify-meta e insere com
// is_baseline = false. Sem auth (rota pública). Service role p/ ignorar RLS.
import { corsHeaders } from "npm:@supabase/supabase-js/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const SPOTIFY_URL_RE = /spotify\.com\/(track|playlist|album)\/([A-Za-z0-9]+)/;

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const token = typeof body?.public_token === "string" ? body.public_token.trim() : "";
    const spotifyUrl = typeof body?.spotify_url === "string" ? body.spotify_url.trim() : "";

    if (!token) return jr({ ok: false, error: "public_token obrigatório" }, 400);
    if (!spotifyUrl) return jr({ ok: false, error: "spotify_url obrigatória" }, 400);

    const match = spotifyUrl.match(SPOTIFY_URL_RE);
    if (!match || match[1] !== "playlist") {
      return jr({ ok: false, error: "URL precisa ser de uma playlist do Spotify" }, 400);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false },
    });

    const { data: deal, error: dealErr } = await admin
      .from("curator_deals")
      .select("id")
      .eq("public_token", token)
      .maybeSingle();

    if (dealErr) return jr({ ok: false, error: dealErr.message }, 200);
    if (!deal) return jr({ ok: false, error: "not found" }, 404);

    // Busca metadados via edge function fetch-spotify-meta
    let playlistName = "Playlist";
    try {
      const metaRes = await fetch(`${SUPABASE_URL}/functions/v1/fetch-spotify-meta`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${ANON_KEY}`,
          apikey: ANON_KEY,
        },
        body: JSON.stringify({ url: spotifyUrl }),
      });
      const meta = await metaRes.json().catch(() => null);
      if (meta?.ok && typeof meta.title === "string" && meta.title.trim()) {
        playlistName = meta.title.trim();
      }
    } catch {
      // segue com nome default; não bloqueia inserção
    }

    const { data: playlist, error: insErr } = await admin
      .from("curator_playlists")
      .insert({
        deal_id: deal.id,
        spotify_url: spotifyUrl,
        playlist_name: playlistName,
        is_baseline: false,
      })
      .select("id, deal_id, spotify_url, playlist_name, followers, is_baseline, added_at")
      .single();

    if (insErr) return jr({ ok: false, error: insErr.message }, 200);

    return jr({ ok: true, playlist });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return jr({ ok: false, error: msg }, 200);
  }
});
