// apply-managed-cover — envia uma nova capa para a playlist gerenciada (managed_playlists)
// direto no Spotify via PUT /playlists/{id}/images.
//
// Body: { playlist_id: string (managed_playlists.id), image_url: string (storage interno) }
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { requireTeamAccess } from "../_shared/auth.ts";
import { getUserAccessToken, getSpotifyToken } from "../_shared/spotify.ts";
import decodePng from "npm:@jsquash/png@3.1.0/decode.js";
import decodeJpeg from "npm:@jsquash/jpeg@1.5.0/decode.js";
import encodeJpeg from "npm:@jsquash/jpeg@1.5.0/encode.js";
import resize from "npm:@jsquash/resize@2.1.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MAX_BYTES = 256 * 1024;

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function uint8ToBase64(buf: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < buf.length; i += chunk) {
    binary += String.fromCharCode(...buf.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function imageToJpegUnderLimit(buf: Uint8Array, contentType: string): Promise<Uint8Array> {
  const isPng = /png/i.test(contentType) || (buf[0] === 0x89 && buf[1] === 0x50);
  const imageData = isPng ? await decodePng(buf) : await decodeJpeg(buf);
  const sizes = [640, 512, 400, 320];
  const qualities = [85, 75, 65, 55, 45, 35];
  for (const size of sizes) {
    const resized = (imageData.width === size && imageData.height === size)
      ? imageData
      : await resize(imageData, { width: size, height: size, method: "lanczos3" });
    for (const quality of qualities) {
      const out = await encodeJpeg(resized, { quality });
      const bytes = new Uint8Array(out);
      if (bytes.byteLength <= MAX_BYTES) return bytes;
    }
  }
  throw new Error("não foi possível comprimir a capa abaixo de 256KB");
}

function isAllowedImageUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return false;
    if (u.hostname === new URL(SUPABASE_URL).hostname) return true;
    // CDN do Spotify (capas de playlists/artistas) — fonte segura e pública
    if (/(^|\.)scdn\.co$/i.test(u.hostname)) return true;
    if (/spotifycdn\.com$/i.test(u.hostname)) return true;
    return false;
  } catch { return false; }
}

async function fetchAsBase64Jpeg(url: string): Promise<string> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`fetch image ${r.status}`);
  const buf = new Uint8Array(await r.arrayBuffer());
  const ct = r.headers.get("content-type") ?? "image/png";
  if (/jpeg|jpg/i.test(ct) && buf.byteLength <= MAX_BYTES) return uint8ToBase64(buf);
  const jpeg = await imageToJpegUnderLimit(buf, ct);
  return uint8ToBase64(jpeg);
}

async function fetchSpotifyCoverUrl(spotifyPlaylistId: string, token: string): Promise<string | null> {
  const r = await fetch(`https://api.spotify.com/v1/playlists/${spotifyPlaylistId}/images`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) return null;
  const images = await r.json().catch(() => null);
  return Array.isArray(images) ? (images[0]?.url ?? null) : null;
}

// Extrai só o hash final da imagem (ignora CDN shard e prefixo de tamanho).
// Ex.: https://image-cdn-fa.spotifycdn.com/image/ab67706c0000bebbHASH
//   → HASH. Mosaicos auto-gerados começam com ab67706c, capas uploaded não.
function extractImageHash(url: string | null): string | null {
  if (!url) return null;
  const m = url.match(/\/image\/[a-f0-9]{16}([a-f0-9]+)/i);
  return m ? m[1].toLowerCase() : url.toLowerCase();
}

function isAutoMosaic(url: string | null): boolean {
  return !!url && /\/image\/ab67706c[0-9a-f]+/i.test(url);
}

async function waitForSpotifyCover(spotifyPlaylistId: string, token: string, previousUrl: string | null): Promise<string | null> {
  const prevHash = extractImageHash(previousUrl);
  let latest: string | null = null;
  for (let i = 0; i < 8; i++) {
    if (i > 0) await new Promise((resolve) => setTimeout(resolve, 1200));
    latest = await fetchSpotifyCoverUrl(spotifyPlaylistId, token);
    const curHash = extractImageHash(latest);
    if (latest && curHash && curHash !== prevHash) return latest;
  }
  return latest;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jr({ error: "POST only" }, 405);

  const guard = await requireTeamAccess(req);
  if (!guard.ok) return guard.resp;

  try {
    const body = await req.json().catch(() => ({}));
    const playlistId: string = body?.playlist_id;
    const imageUrl: string = body?.image_url;
    if (!playlistId || !imageUrl) return jr({ ok: false, error: "playlist_id e image_url obrigatórios" }, 400);
    if (!isAllowedImageUrl(imageUrl)) return jr({ ok: false, error: "image_url não permitida (apenas storage interno)" }, 400);

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: pl } = await supabase
      .from("managed_playlists")
      .select("id, spotify_playlist_id")
      .eq("id", playlistId)
      .maybeSingle();
    if (!pl?.spotify_playlist_id) return jr({ ok: false, error: "playlist sem spotify_playlist_id" }, 404);

    // descobre dono
    let ownerId: string | null = null;
    try {
      const appToken = await getSpotifyToken();
      const or = await fetch(
        `https://api.spotify.com/v1/playlists/${pl.spotify_playlist_id}?fields=owner(id)`,
        { headers: { Authorization: `Bearer ${appToken}` } },
      );
      if (or.ok) ownerId = (await or.json())?.owner?.id ?? null;
    } catch { /* */ }

    let token: string;
    try {
      const r = await getUserAccessToken(ownerId ?? undefined);
      token = r.token;
    } catch (e) {
      return jr({
        ok: false,
        error: ownerId
          ? `conta do dono "${ownerId}" não está conectada. Conecte em Configurações → Spotify.`
          : `nenhuma conta Spotify conectada: ${(e as Error).message}`,
      }, 412);
    }

    let b64: string;
    try { b64 = await fetchAsBase64Jpeg(imageUrl); }
    catch (e) { return jr({ ok: false, error: (e as Error).message }, 400); }

    const previousCoverUrl = await fetchSpotifyCoverUrl(pl.spotify_playlist_id, token);

    const resp = await fetch(`https://api.spotify.com/v1/playlists/${pl.spotify_playlist_id}/images`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "image/jpeg" },
      body: b64,
    });
    if (!resp.ok && resp.status !== 202) {
      const t = await resp.text();
      return jr({ ok: false, error: `Spotify ${resp.status}: ${t.slice(0, 300)}` }, 502);
    }

    const spotifyCoverUrl = await waitForSpotifyCover(pl.spotify_playlist_id, token, previousCoverUrl);
    const finalCoverUrl = spotifyCoverUrl ?? imageUrl;

    await supabase.from("managed_playlists").update({ cover_url: finalCoverUrl }).eq("id", pl.id);
    await supabase.from("playlists").update({ cover_url: finalCoverUrl }).eq("spotify_playlist_id", pl.spotify_playlist_id);
    await supabase.from("collection_logs").insert({
      acao: "apply-managed-cover",
      status: "sucesso",
      mensagem: `${pl.spotify_playlist_id} capa atualizada${spotifyCoverUrl ? " e confirmada" : " (aguardando CDN)"}`,
    });

    return jr({ ok: true, cover_url: finalCoverUrl, confirmed: Boolean(spotifyCoverUrl) });
  } catch (e) {
    return jr({ ok: false, error: (e as Error).message }, 500);
  }
});
