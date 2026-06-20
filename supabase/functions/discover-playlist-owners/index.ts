// discover-playlist-owners — descobre qual conta Spotify é dona de cada
// managed_playlist (via API pública) e popula `owner_spotify_user_id`.
// Idempotente. Roda sob demanda pelo painel.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getAppToken, spotifyFetch } from "../_shared/spotify-client.ts";
import { requireTeamAccess } from "../_shared/auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const guard = await requireTeamAccess(req);
  if (!guard.ok) return guard.resp;

  let force = false;
  try { const b = await req.json(); force = !!b?.force; } catch {/* GET ok */}

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  // 1) Carrega contas conhecidas (spotify_user_id -> conta)
  const { data: tokens, error: tokErr } = await sb
    .from("spotify_user_tokens")
    .select("spotify_user_id, display_name, email");
  if (tokErr) return jr({ ok: false, error: tokErr.message }, 500);
  const knownIds = new Set((tokens ?? []).map((t) => t.spotify_user_id));

  // 2) Playlists a inspecionar
  let q = sb
    .from("managed_playlists")
    .select("id, spotify_playlist_id, name, owner_spotify_user_id")
    .is("archived_at", null);
  if (!force) q = q.is("owner_spotify_user_id", null);
  const { data: pls, error: plErr } = await q;
  if (plErr) return jr({ ok: false, error: plErr.message }, 500);

  const results: any[] = [];
  let matched = 0, unknown = 0, failed = 0;

  for (const p of pls ?? []) {
    try {
      let ownerId: string | null = null;
      let ownerDisplay: string | null = null;
      try {
        const r = await ccFetch(
          `https://api.spotify.com/v1/playlists/${p.spotify_playlist_id}?fields=owner(id,display_name)`,
          "discover-playlist-owners",
          p.spotify_playlist_id,
        );
        if (!r.ok) {
          failed++;
          results.push({ playlist: p.name, error: `spotify ${r.status}` });
          continue;
        }
        const j: any = await r.json();
        ownerId = j?.owner?.id ?? null;
        ownerDisplay = j?.owner?.display_name ?? null;
      } catch (e) {
        failed++;
        results.push({ playlist: p.name, error: (e as Error).message });
        continue;
      }
      if (!ownerId) { failed++; results.push({ playlist: p.name, error: "no owner" }); continue; }

      const isKnown = knownIds.has(ownerId);
      if (isKnown) matched++; else unknown++;

      await sb.from("managed_playlists")
        .update({ owner_spotify_user_id: ownerId })
        .eq("id", p.id);

      results.push({
        playlist: p.name,
        owner_spotify_user_id: ownerId,
        owner_display: ownerDisplay,
        known_account: isKnown,
      });
    } catch (e) {
      failed++;
      results.push({ playlist: p.name, error: (e as Error).message });
    }
    // pequeno respiro pra não estourar rate-limit
    await new Promise((res) => setTimeout(res, 80));
  }

  return jr({
    ok: true,
    inspected: pls?.length ?? 0,
    matched_known_account: matched,
    owner_unknown_account: unknown,
    failed,
    results,
  });
});
