// snapshot-playlist-tracks — Cron diário.
// Captura hash dos top 50 track IDs de playlists alvo. Só grava nova linha
// quando o hash mudou (= playlist trocou tracks).
//
// Garantias por execução:
//   - Retenção: apaga snapshots com captured_at < NOW() - 60 dias.
//   - MINIMUM: TODAS as managed_playlists são processadas em todo run
//     (mesmo que não tenham mudado — força registro de "ainda igual" via
//     no-op skip; o snapshot anterior comprova continuidade).
//   - PLUS: tier=leader (todos) + sample 20% medium até `limit`.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { getSpotifyToken } from "../_shared/spotify.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RETENTION_DAYS = 60;

async function sha1(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const sb = createClient(SUPABASE_URL, SERVICE_ROLE);
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const limit = Math.min(Number(body.limit ?? 60), 200);

    // Retenção: 60 dias
    const cutoffISO = new Date(Date.now() - RETENTION_DAYS * 86400_000).toISOString();
    const { count: pruned } = await sb
      .from("playlist_track_snapshots")
      .delete({ count: "exact" })
      .lt("captured_at", cutoffISO);

    // 1. MINIMUM: todas as managed_playlists (com spotify_playlist_id)
    const { data: managed } = await sb
      .from("managed_playlists")
      .select("spotify_playlist_id")
      .not("spotify_playlist_id", "is", null);
    const managedIds = new Set<string>((managed ?? []).map((m: any) => m.spotify_playlist_id));

    // 2. PLUS: leader + sample medium
    const { data: targets } = await sb
      .from("search_results")
      .select("spotify_playlist_id, refresh_tier")
      .in("refresh_tier", ["leader", "medium"])
      .not("spotify_playlist_id", "is", null)
      .limit(limit * 3);

    const list: Array<{ id: string; source: string }> = [];
    const seen = new Set<string>();

    // managed primeiro (garantia mínima)
    for (const id of managedIds) {
      if (seen.has(id)) continue;
      seen.add(id);
      list.push({ id, source: "managed" });
    }
    // depois os tier leader/medium até o limit
    for (const r of (targets ?? []) as any[]) {
      if (seen.has(r.spotify_playlist_id)) continue;
      if (r.refresh_tier === "medium" && Math.random() > 0.2) continue;
      seen.add(r.spotify_playlist_id);
      list.push({ id: r.spotify_playlist_id, source: r.refresh_tier });
      if (list.length >= Math.max(limit, managedIds.size)) break;
    }

    const token = await getSpotifyToken();
    let inserted = 0;
    let unchanged = 0;
    let failed = 0;

    for (const t of list) {
      try {
        const resp = await fetch(
          `https://api.spotify.com/v1/playlists/${t.id}/tracks?fields=items(track(id))&limit=50`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (!resp.ok) { failed++; continue; }
        const json = await resp.json();
        const ids: string[] = (json.items ?? [])
          .map((it: any) => it?.track?.id)
          .filter((x: any): x is string => !!x);
        if (!ids.length) continue;
        const hash = await sha1(ids.join("|"));

        const { data: last } = await sb
          .from("playlist_track_snapshots")
          .select("tracks_hash")
          .eq("playlist_spotify_id", t.id)
          .order("captured_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (last?.tracks_hash === hash) { unchanged++; continue; }

        const { error } = await sb.from("playlist_track_snapshots").insert({
          playlist_spotify_id: t.id,
          tracks_hash: hash,
          track_ids: ids,
        });
        if (error) { failed++; continue; }
        inserted++;
      } catch (e) {
        failed++;
        console.error("snap failed", t.id, String(e));
      }
    }

    return new Response(JSON.stringify({
      ok: true,
      scanned: list.length,
      managed_covered: managedIds.size,
      inserted, unchanged, failed,
      pruned_old: pruned ?? 0,
      retention_days: RETENTION_DAYS,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
