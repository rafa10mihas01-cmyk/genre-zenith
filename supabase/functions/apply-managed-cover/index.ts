// apply-managed-cover — envia uma nova capa para a playlist gerenciada (managed_playlists)
// direto no Spotify via PUT /playlists/{id}/images.
//
// Body: { playlist_id: string (managed_playlists.id), image_url: string (storage interno) }
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { requireTeamAccess } from "../_shared/auth.ts";
import { getUserAccessToken, getSpotifyToken, guardedSpotifyFetch, forceRefreshUserAccessToken } from "../_shared/spotify.ts";
import { getPlaylistMeta } from "../_shared/spotify-playlist.ts";
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

type EncodedCover = { bytes: Uint8Array; width: number; height: number; quality: number };

async function visualDistance(a: EncodedCover, b: EncodedCover): Promise<number> {
  const ai = await resize(await decodeJpeg(a.bytes), { width: 64, height: 64, method: "lanczos3" });
  const bi = await resize(await decodeJpeg(b.bytes), { width: 64, height: 64, method: "lanczos3" });
  let sum = 0;
  let count = 0;
  for (let i = 0; i < ai.data.length && i < bi.data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const d = ai.data[i + c] - bi.data[i + c];
      sum += d * d;
      count++;
    }
  }
  return Math.sqrt(sum / Math.max(1, count));
}

async function imageToCleanJpeg(buf: Uint8Array, contentType: string): Promise<EncodedCover> {
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
      if (bytes.byteLength <= MAX_BYTES) {
        return { bytes, width: size, height: size, quality };
      }
    }
  }
  throw new Error("não foi possível comprimir a capa abaixo de 256KB");
}

function isAllowedImageUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return false;
    if (u.hostname === new URL(SUPABASE_URL).hostname) return true;
    if (/(^|\.)scdn\.co$/i.test(u.hostname)) return true;
    if (/spotifycdn\.com$/i.test(u.hostname)) return true;
    return false;
  } catch { return false; }
}

// SEMPRE re-encoda como baseline JPEG quadrado e limpo (sem ICC/EXIF/progressivo).
// O Spotify aceita 202 e descarta silenciosamente JPEGs com perfis embutidos
// ou encoding progressivo — por isso o passthrough do CDN da Spotify falhava.
async function fetchAsCleanJpeg(url: string): Promise<EncodedCover> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`fetch image ${r.status}`);
  const buf = new Uint8Array(await r.arrayBuffer());
  const ct = r.headers.get("content-type") ?? "image/jpeg";
  return await imageToCleanJpeg(buf, ct);
}

async function fetchSpotifyCoverUrl(spotifyPlaylistId: string, token: string): Promise<string | null> {
  const r = await guardedSpotifyFetch(`https://api.spotify.com/v1/playlists/${spotifyPlaylistId}/images`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) return null;
  const images = await r.json().catch(() => null);
  return Array.isArray(images) ? (images[0]?.url ?? null) : null;
}

// Extrai só o hash final da imagem (ignora CDN shard e prefixo de tamanho).
function extractImageHash(url: string | null): string | null {
  if (!url) return null;
  const m = url.match(/\/image\/[a-f0-9]{16}([a-f0-9]+)/i);
  return m ? m[1].toLowerCase() : url.toLowerCase();
}

async function waitForSpotifyCover(spotifyPlaylistId: string, token: string, previousUrl: string | null): Promise<string | null> {
  const prevHash = extractImageHash(previousUrl);
  let latest: string | null = null;
  for (let i = 0; i < 8; i++) {
    if (i > 0) await new Promise((resolve) => setTimeout(resolve, 1200));
    latest = await fetchSpotifyCoverUrl(spotifyPlaylistId, token);
    const curHash = extractImageHash(latest);
    // O prefixo /image/ab67706c também aparece em capas customizadas de playlist.
    // Então a confirmação confiável aqui é mudança de hash, não o prefixo da URL.
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
      const meta = await getPlaylistMeta(pl.spotify_playlist_id, appToken, { fields: "owner(id)" });
      ownerId = meta.owner_id;
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

    let jpeg: EncodedCover;
    try { jpeg = await fetchAsCleanJpeg(imageUrl); }
    catch (e) { return jr({ ok: false, error: (e as Error).message }, 400); }
    const previousCoverUrl = await fetchSpotifyCoverUrl(pl.spotify_playlist_id, token);
    if (previousCoverUrl) {
      try {
        const currentJpeg = await fetchAsCleanJpeg(previousCoverUrl);
        const distance = await visualDistance(jpeg, currentJpeg);
        console.log(`[cover] visual-distance=${distance.toFixed(2)} selected=${imageUrl} current=${previousCoverUrl}`);
        if (distance < 2) {
          return jr({ ok: true, unchanged: true, confirmed: true, cover_url: previousCoverUrl, message: "Essa imagem já é a capa atual da playlist." });
        }
      } catch (e) {
        console.warn(`[cover] comparação visual falhou: ${(e as Error).message}`);
      }
    }

    const b64 = uint8ToBase64(jpeg.bytes);
    console.log(`[cover] PUT ${pl.spotify_playlist_id} owner=${ownerId ?? "?"} ${jpeg.width}x${jpeg.height} q=${jpeg.quality} ${jpeg.bytes.byteLength}b base64=${b64.length}c`);

    let resp = await guardedSpotifyFetch(`https://api.spotify.com/v1/playlists/${pl.spotify_playlist_id}/images`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "image/jpeg" },
      body: b64,
    });
    let respText = await resp.text().catch(() => "");
    console.log(`[cover] Spotify resposta status=${resp.status} body="${respText.slice(0, 200)}"`);

    // Retry uma vez se 401 — token revogado/invalidado antes do expires_at
    if (resp.status === 401 && ownerId) {
      try {
        console.log(`[cover] 401 recebido — forçando refresh do token de ${ownerId} e retry`);
        const refreshed = await forceRefreshUserAccessToken(ownerId);
        token = refreshed.token;
        resp = await guardedSpotifyFetch(`https://api.spotify.com/v1/playlists/${pl.spotify_playlist_id}/images`, {
          method: "PUT",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "image/jpeg" },
          body: b64,
        });
        respText = await resp.text().catch(() => "");
        console.log(`[cover] retry status=${resp.status} body="${respText.slice(0, 200)}"`);
      } catch (e) {
        return jr({
          ok: false,
          error: `Token Spotify da conta "${ownerId}" expirou/foi revogado. Reconecte a conta em Configurações → Spotify. (${(e as Error).message})`,
        }, 412);
      }
    }

    if (!resp.ok && resp.status !== 202) {
      if (resp.status === 401) {
        return jr({
          ok: false,
          error: `Token Spotify da conta "${ownerId ?? "?"}" foi revogado. Reconecte a conta em Configurações → Spotify.`,
        }, 412);
      }
      return jr({ ok: false, error: `Spotify ${resp.status}: ${respText.slice(0, 300)}` }, 502);
    }

    const spotifyCoverUrl = await waitForSpotifyCover(pl.spotify_playlist_id, token, previousCoverUrl);
    const prevHash = extractImageHash(previousCoverUrl);
    const curHash = extractImageHash(spotifyCoverUrl);
    const changed = !!curHash && curHash !== prevHash;
    console.log(`[cover] verifica prev=${prevHash ?? "null"} cur=${curHash ?? "null"} changed=${changed} url=${spotifyCoverUrl ?? "null"}`);

    if (!spotifyCoverUrl) {
      await supabase.from("collection_logs").insert({
        acao: "apply-managed-cover",
        status: "erro",
        mensagem: `${pl.spotify_playlist_id} Spotify aceitou (202) mas não retornou capa atual (owner=${ownerId ?? "?"})`,
      });
      return jr({
        ok: false,
        confirmed: false,
        cover_url: spotifyCoverUrl,
        error: "O Spotify aceitou o upload, mas não retornou a capa atualizada. Tente novamente em alguns segundos.",
      }, 200);
    }

    // Spotify aceitou (202), mas a capa publicada ainda tem o mesmo hash.
    // Nesse caso o upload foi aceito pela borda, mas não entrou na playlist.
    if (!changed) {
      await supabase.from("collection_logs").insert({
        acao: "apply-managed-cover",
        status: "erro",
        mensagem: `${pl.spotify_playlist_id} Spotify aceitou (202) mas a capa não mudou (owner=${ownerId ?? "?"})`,
      });
      return jr({
        ok: false,
        confirmed: false,
        cover_url: spotifyCoverUrl,
        error: "O Spotify aceitou o upload, mas a capa publicada ainda não mudou. Tente novamente em alguns segundos ou use outra imagem.",
      }, 200);
    }

    await supabase.from("managed_playlists").update({ cover_url: spotifyCoverUrl }).eq("id", pl.id);
    await supabase.from("playlists").update({ cover_url: spotifyCoverUrl }).eq("spotify_playlist_id", pl.spotify_playlist_id);
    await supabase.from("collection_logs").insert({
      acao: "apply-managed-cover",
      status: "sucesso",
      mensagem: `${pl.spotify_playlist_id} capa atualizada e confirmada`,
    });

    return jr({ ok: true, cover_url: spotifyCoverUrl, confirmed: changed });
  } catch (e) {
    return jr({ ok: false, error: (e as Error).message }, 500);
  }
});
