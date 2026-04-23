// upload-playlist-cover — envia a capa selecionada para o Spotify
// POST { template_id: string, image_url: string }
// → { ok: true }
import { corsHeaders } from "npm:@supabase/supabase-js/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getUserAccessToken } from "../_shared/spotify.ts";
// WASM puro — funciona no edge runtime do Deno (sem libs nativas)
import decodePng from "npm:@jsquash/png@3.1.0/decode.js";
import decodeJpeg from "npm:@jsquash/jpeg@1.5.0/decode.js";
import encodeJpeg from "npm:@jsquash/jpeg@1.5.0/encode.js";
import resize from "npm:@jsquash/resize@2.1.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MAX_BYTES = 256 * 1024; // limite Spotify

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

// Decodifica (PNG/JPEG), redimensiona e re-encoda em JPEG
// reduzindo qualidade/tamanho até caber em MAX_BYTES.
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
      if (bytes.byteLength <= MAX_BYTES) {
        console.log(`[cover] OK ${size}x${size} q=${quality} → ${(bytes.byteLength/1024).toFixed(1)}KB`);
        return bytes;
      }
    }
  }
  throw new Error("não foi possível comprimir a capa abaixo de 256KB");
}

async function fetchAsBase64Jpeg(url: string): Promise<string> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`fetch image ${r.status}`);
  const buf = new Uint8Array(await r.arrayBuffer());
  const ct = r.headers.get("content-type") ?? "image/png";
  if (/jpeg|jpg/i.test(ct) && buf.byteLength <= MAX_BYTES) {
    return uint8ToBase64(buf);
  }
  const jpeg = await imageToJpegUnderLimit(buf, ct);
  return uint8ToBase64(jpeg);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jr({ error: "POST only" }, 405);

  let body: { template_id?: string; image_url?: string };
  try { body = await req.json(); } catch { return jr({ error: "invalid json" }, 400); }
  if (!body.template_id || !body.image_url) return jr({ error: "template_id e image_url obrigatórios" }, 400);

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: tpl } = await supabase
    .from("playlist_templates").select("*").eq("id", body.template_id).maybeSingle();
  if (!tpl) return jr({ error: "template not found" }, 404);
  if (!tpl.spotify_playlist_id) return jr({ error: "template ainda não publicado no Spotify" }, 400);

  let token: string;
  try {
    const t = await getUserAccessToken(tpl.spotify_owner_id ?? undefined);
    token = t.token;
  } catch (e) {
    return jr({ error: (e as Error).message }, 400);
  }

  let b64: string;
  try {
    b64 = await fetchAsBase64Jpeg(body.image_url);
  } catch (e) {
    return jr({ error: (e as Error).message }, 400);
  }

  const resp = await fetch(`https://api.spotify.com/v1/playlists/${tpl.spotify_playlist_id}/images`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "image/jpeg",
    },
    body: b64,
  });

  if (!resp.ok && resp.status !== 202) {
    const t = await resp.text();
    return jr({ ok: false, error: `Spotify ${resp.status}: ${t.slice(0, 200)}` }, 200);
  }

  await supabase.from("playlist_templates").update({
    cover_image_url: body.image_url,
  }).eq("id", tpl.id);

  return jr({ ok: true });
});
