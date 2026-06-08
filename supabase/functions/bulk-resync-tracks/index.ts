// bulk-resync-tracks — one-off operacional. Recebe { ids: string[] } e invoca
// sync-managed-playlist-tracks (force=true) pra cada playlist, usando service role
// internamente. Retorna lista { id, ok, before, after, error }.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
// One-off: auth via SERVICE_ROLE bearer apenas (sem requireTeamAccess pra evitar
// dependência de JWT de usuário que expira em sessões longas).

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

  let body: any = {};
  try { body = await req.json(); } catch {}
  let ids: string[] = Array.isArray(body?.ids) ? body.ids.filter((x: any) => typeof x === "string") : [];

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  if (ids.length === 0) {
    const { data } = await sb
      .from("managed_playlists")
      .select("id")
      .is("archived_at", null)
      .not("spotify_playlist_id", "is", null)
      .or("tracks_count.eq.0,tracks_count.is.null,tracks_hash.eq.da39a3ee5e6b4b0d3255bfef95601890afd80709");
    ids = (data ?? []).map((r: any) => r.id);
  }

  const beforeMap = new Map<string, number>();
  {
    const { data } = await sb
      .from("managed_playlists")
      .select("id, tracks_count, name")
      .in("id", ids);
    for (const r of (data ?? []) as any[]) beforeMap.set(r.id, r.tracks_count ?? 0);
  }

  const CONC = 6;
  let i = 0;
  const results: any[] = [];
  async function worker() {
    while (i < ids.length) {
      const my = i++;
      const id = ids[my];
      try {
        // Hard-reset: estas playlists têm tracks_count=0 mas podem ter linhas órfãs
        // em managed_playlist_tracks (parser quebrado deixou estado misto).
        // Limpar antes evita colisão de UNIQUE(playlist_id, position) no upsert.
        await sb.from("managed_playlist_tracks").delete().eq("playlist_id", id);
        await sb.from("managed_playlists").update({ tracks_hash: null }).eq("id", id);
        const res = await fetch(`${SUPABASE_URL}/functions/v1/sync-managed-playlist-tracks`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${SERVICE_KEY}`,
            apikey: SERVICE_KEY,
          },
          body: JSON.stringify({ playlist_id: id, force: true }),
        });
        const j: any = await res.json().catch(() => ({}));
        results.push({ id, before: beforeMap.get(id) ?? 0, after: j?.total ?? null, ok: !!j?.ok, error: j?.ok ? null : (j?.error || `http_${res.status}`) });
      } catch (e: any) {
        results.push({ id, before: beforeMap.get(id) ?? 0, after: null, ok: false, error: String(e?.message || e) });
      }
    }
  }
  await Promise.all(Array.from({ length: CONC }, worker));

  const recovered = results.filter((r) => r.ok && (r.after ?? 0) > 0).length;
  const still_zero = results.filter((r) => r.ok && (r.after ?? 0) === 0).length;
  const failed = results.filter((r) => !r.ok).length;

  return jr({ ok: true, total: ids.length, recovered, still_zero, failed, results });
});
