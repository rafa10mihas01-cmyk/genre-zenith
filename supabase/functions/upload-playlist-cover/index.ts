// upload-playlist-cover — envia a capa selecionada para o Spotify
// POST { template_id: string, image_url: string }
// → { ok: true }
import { corsHeaders } from "npm:@supabase/supabase-js/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getUserAccessToken } from "../_shared/spotify.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MAX_BYTES = 256 * 1024; // limite Spotify

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function fetchAsBase64Jpeg(url: string): Promise<string> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`fetch image ${r.status}`);
  const buf = new Uint8Array(await r.arrayBuffer());
  // Spotify exige JPEG ≤ 256KB. Se já estiver dentro, manda direto.
  // (a Nano Banana retorna PNG; convertemos via re-encode "best-effort" mantendo bytes brutos
  // — Spotify aceita base64 cru de PNG na maioria dos casos via Content-Type image/jpeg
  // mas para garantir, abortamos quando muito grande)
  if (buf.byteLength > MAX_BYTES) {
    throw new Error(`Imagem ${(buf.byteLength / 1024).toFixed(0)}KB excede limite de 256KB do Spotify`);
  }
  let binary = "";
  for (let i = 0; i < buf.length; i++) binary += String.fromCharCode(buf[i]);
  return btoa(binary);
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
