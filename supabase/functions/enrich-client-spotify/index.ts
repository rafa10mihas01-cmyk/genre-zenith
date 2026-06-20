// enrich-client-spotify — Recebe { client_id }, lê spotify_artist_url do cliente,
// extrai o artist ID da URL, chama /v1/artists/{id} via guardedSpotifyFetch e salva
// spotify_artist_id, monthly_listeners (followers) e image_url em clients.
//
// Gap 5: disparado pelo frontend após criar/atualizar cliente que tenha spotify_artist_url.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { ccFetch } from "../_shared/catalog-gateway.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Extrai o ID de uma URL tipo https://open.spotify.com/artist/{id}?si=...
function extractArtistId(url: string): string | null {
  if (!url) return null;
  const m = url.match(/artist\/([A-Za-z0-9]{22})/);
  return m ? m[1] : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  let body: any;
  try { body = await req.json(); } catch { return jr({ ok: false, error: "Invalid JSON" }, 400); }
  const clientId: string | undefined = body?.client_id;
  if (!clientId) return jr({ ok: false, error: "client_id obrigatório" }, 400);

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  const { data: client, error: cErr } = await supabase
    .from("clients")
    .select("id, spotify_artist_url, spotify_artist_id")
    .eq("id", clientId)
    .maybeSingle();
  if (cErr) return jr({ ok: false, error: cErr.message }, 500);
  if (!client) return jr({ ok: false, error: "cliente não encontrado" }, 404);

  const url = (client as any).spotify_artist_url as string | null;
  const artistId = extractArtistId(url ?? "");
  if (!artistId) {
    return jr({ ok: false, skipped: "sem_spotify_artist_url_valida" });
  }

  // Se já temos o mesmo id salvo, ainda assim refetchamos pra atualizar followers/imagem.
  // Token vem do Catalog Gateway (CC pool NexEngine 05/10).
  const r = await ccFetch(
    `https://api.spotify.com/v1/artists/${artistId}`,
    "enrich-client-spotify",
    artistId,
  );
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    return jr({ ok: false, error: `spotify ${r.status}: ${t.slice(0, 200)}` }, r.status === 404 ? 404 : 502);
  }
  const artist: any = await r.json();
  const followers = Number(artist?.followers?.total ?? 0);
  const image = Array.isArray(artist?.images) && artist.images.length > 0
    ? (artist.images[0]?.url as string | null)
    : null;

  const updates: Record<string, unknown> = {
    spotify_artist_id: artistId,
    monthly_listeners: Number.isFinite(followers) ? followers : null,
    image_url: image,
  };

  const { error: uErr } = await supabase.from("clients").update(updates).eq("id", clientId);
  if (uErr) return jr({ ok: false, error: uErr.message }, 500);

  return jr({
    ok: true,
    client_id: clientId,
    spotify_artist_id: artistId,
    monthly_listeners: updates.monthly_listeners,
    image_url: image,
    name: artist?.name ?? null,
  });
});
