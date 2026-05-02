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
    const slug = typeof body?.slug === "string" ? body.slug.trim() : "";

    if (!token && !slug) {
      return jr({ ok: false, error: "public_token ou slug obrigatório" }, 400);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false },
    });

    // Aceita slug (preferencial) ou token (compatibilidade com links antigos).
    // Se vier algo que parece um token hex (24 chars), trata como token mesmo
    // que tenha sido enviado no campo slug.
    const looksLikeToken = (v: string) => /^[a-f0-9]{20,}$/i.test(v);
    let query = admin
      .from("curator_deals")
      .select(
        "id, curator_name, song_spotify_url, song_name, song_artist, song_cover_url, target_plays, daily_goal, baseline_plays, cost, started_at, public_token, slug, created_at, spotify_owner_id, spotify_owner_url",
      );

    if (token) {
      query = query.eq("public_token", token);
    } else if (looksLikeToken(slug)) {
      query = query.eq("public_token", slug);
    } else {
      query = query.eq("slug", slug);
    }

    const { data: deal, error: dealErr } = await query.maybeSingle();

    if (dealErr) return jr({ ok: false, error: dealErr.message }, 200);
    if (!deal) return jr({ ok: false, error: "not found" }, 200);


    const [{ data: playlists, error: plErr }, { data: logs, error: logErr }] = await Promise.all([
      admin
        .from("curator_playlists")
        .select(
          "id, deal_id, spotify_url, playlist_name, followers, is_baseline, added_at, spotify_playlist_id, spotify_owner_id, spotify_owner_name, image_url, added_at_spotify, match_status, match_reason, streams_7d, streams_28d, streams_total, last_paste_at",
        )
        .eq("deal_id", deal.id)
        // Curador SÓ vê o que é dele: playlists do próprio (curator) ou já existentes
        // como baseline. Editorial / suspicious / organic ficam só pro admin.
        .in("match_status", ["curator", "baseline"])
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
