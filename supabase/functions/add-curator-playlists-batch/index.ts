// add-curator-playlists-batch — recebe uma lista de URLs do Spotify e insere
// todas em curator_playlists vinculadas ao deal do public_token. Sem auth.
import { corsHeaders } from "npm:@supabase/supabase-js/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const SPOTIFY_URL_RE = /spotify\.com\/(?:intl-[a-z]{2}\/)?(track|playlist|album)\/([A-Za-z0-9]+)/i;

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function fetchPlaylistName(url: string): Promise<string> {
  try {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/fetch-spotify-meta`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ANON_KEY}`,
        apikey: ANON_KEY,
      },
      body: JSON.stringify({ url }),
    });
    const j = await r.json().catch(() => null);
    if (j?.ok && typeof j.title === "string" && j.title.trim()) return j.title.trim();
  } catch {
    /* ignore */
  }
  return "Playlist";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const token = typeof body?.public_token === "string" ? body.public_token.trim() : "";
    const urls = Array.isArray(body?.urls) ? body.urls : [];

    if (!token) return jr({ ok: false, error: "public_token obrigatório" }, 400);
    if (urls.length === 0) return jr({ ok: false, error: "urls vazio" }, 400);
    if (urls.length > 200) return jr({ ok: false, error: "máximo 200 URLs por lote" }, 400);

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

    // Carrega URLs já existentes para deduplicar
    const { data: existing } = await admin
      .from("curator_playlists")
      .select("spotify_url")
      .eq("deal_id", deal.id);
    const existingSet = new Set((existing ?? []).map((p: any) => p.spotify_url));

    const results = {
      added: 0,
      skipped_duplicate: 0,
      skipped_invalid: 0,
      errors: [] as string[],
    };

    // Processa em paralelo limitado (5 por vez) para não estourar o oEmbed
    const queue = urls.map((u: unknown) => (typeof u === "string" ? u.trim() : ""));
    const BATCH = 5;
    for (let i = 0; i < queue.length; i += BATCH) {
      const slice = queue.slice(i, i + BATCH);
      await Promise.all(
        slice.map(async (raw) => {
          if (!raw) return;
          const m = raw.match(SPOTIFY_URL_RE);
          if (!m || m[1] !== "playlist") {
            results.skipped_invalid++;
            return;
          }
          if (existingSet.has(raw)) {
            results.skipped_duplicate++;
            return;
          }
          existingSet.add(raw);
          const name = await fetchPlaylistName(raw);
          const { error: insErr } = await admin.from("curator_playlists").insert({
            deal_id: deal.id,
            spotify_url: raw,
            playlist_name: name,
            is_baseline: false,
          });
          if (insErr) {
            results.errors.push(`${raw}: ${insErr.message}`);
          } else {
            results.added++;
          }
        }),
      );
    }

    return jr({ ok: true, ...results });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return jr({ ok: false, error: msg }, 200);
  }
});
