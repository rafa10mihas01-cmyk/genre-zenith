// get-curator-deal-public — retorna dados públicos de um deal de curador
// a partir do public_token (sem expor user_id). Usado pela página pública
// que o curador acessa para ver a meta e cadastrar playlists.
// Sem auth (rota pública). Service role para ignorar RLS.
import { corsHeaders } from "npm:@supabase/supabase-js/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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
    if (!token) return jr({ ok: false, error: "public_token obrigatório" }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false },
    });

    const { data: deal, error: dealErr } = await admin
      .from("curator_deals")
      .select(
        "id, curator_name, song_spotify_url, song_name, song_artist, song_cover_url, target_plays, baseline_plays, cost, started_at, public_token, created_at",
      )
      .eq("public_token", token)
      .maybeSingle();

    if (dealErr) return jr({ ok: false, error: dealErr.message }, 200);
    if (!deal) return jr({ ok: false, error: "not found" }, 404);

    const [{ data: playlists, error: plErr }, { data: logs, error: logErr }] = await Promise.all([
      admin
        .from("curator_playlists")
        .select("id, deal_id, spotify_url, playlist_name, followers, is_baseline, added_at")
        .eq("deal_id", deal.id)
        .order("added_at", { ascending: true }),
      admin
        .from("curator_deal_logs")
        .select("id, deal_id, total_plays, note, is_baseline, created_at, print_urls")
        .eq("deal_id", deal.id)
        .order("created_at", { ascending: true }),
    ]);

    if (plErr) return jr({ ok: false, error: plErr.message }, 200);
    if (logErr) return jr({ ok: false, error: logErr.message }, 200);

    return jr({ ok: true, deal, playlists: playlists ?? [], logs: logs ?? [] });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return jr({ ok: false, error: msg }, 200);
  }
});
