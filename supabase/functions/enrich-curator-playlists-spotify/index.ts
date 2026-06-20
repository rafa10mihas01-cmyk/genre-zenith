// enrich-curator-playlists-spotify
// Busca metadados (capa, nome real, seguidores, owner) no Spotify para
// curator_playlists que ainda não têm image_url. Pode receber:
//   { deal_id }              -> enriquece tudo desse deal
//   { spotify_playlist_ids } -> enriquece IDs específicos (qualquer deal)
//   { campaign_id }          -> resolve o deal_id da campanha e enriquece
//
// Idempotente. Pode ser chamada inline pelo importer ou via curl pra backfill.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { ccFetch } from "../_shared/catalog-gateway.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const FIELDS = "name,followers.total,images,owner(display_name,id)";

async function fetchOne(spotifyId: string) {
  const url = `https://api.spotify.com/v1/playlists/${spotifyId}?fields=${encodeURIComponent(FIELDS)}`;
  const res = await ccFetch(url, "enrich-curator-playlists-spotify", spotifyId);
  if (res.status === 404 || res.status === 400) return { spotifyId, gone: true };
  if (!res.ok) return { spotifyId, error: `HTTP ${res.status}` };
  const j = await res.json();
  return {
    spotifyId,
    name: j?.name ?? null,
    followers: j?.followers?.total ?? null,
    cover: Array.isArray(j?.images) && j.images.length > 0 ? j.images[0]?.url ?? null : null,
    owner_id: j?.owner?.id ?? null,
    owner_name: j?.owner?.display_name ?? null,
  };
}

async function runWithConcurrency<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  async function worker() {
    while (true) {
      const idx = i++;
      if (idx >= items.length) return;
      try {
        out[idx] = await fn(items[idx]);
      } catch (e) {
        out[idx] = { error: (e as Error).message } as unknown as R;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const dealId: string | null = body?.deal_id ?? null;
    const campaignId: string | null = body?.campaign_id ?? null;
    const onlyIds: string[] | null = Array.isArray(body?.spotify_playlist_ids) ? body.spotify_playlist_ids : null;
    const force: boolean = !!body?.force;

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    // Resolve deal_ids se veio campaign_id (1:N safe — pode haver vários deals).
    let effectiveDealIds: string[] = dealId ? [dealId] : [];
    if (effectiveDealIds.length === 0 && campaignId) {
      const { data: dealRows } = await admin
        .from("curator_deals")
        .select("id")
        .eq("campaign_id", campaignId);
      effectiveDealIds = ((dealRows ?? []) as Array<{ id: string }>).map((d) => d.id);
    }

    // Carrega curator_playlists alvo
    // FASE APP-05: filtra playlists já marcadas como spotify_dead pra parar
    // de consultar IDs que o Spotify confirmou que não existem mais (404).
    let q = admin
      .from("curator_playlists")
      .select("id, spotify_playlist_id, image_url, followers, spotify_dead")
      .eq("spotify_dead", false);
    if (onlyIds && onlyIds.length > 0) {
      q = q.in("spotify_playlist_id", onlyIds);
    } else if (effectiveDealIds.length > 0) {
      q = q.in("deal_id", effectiveDealIds);
    } else {
      return jr({ ok: false, error: "Informe deal_id, campaign_id ou spotify_playlist_ids" }, 400);
    }
    const { data: cps, error: cpErr } = await q;
    if (cpErr) return jr({ ok: false, error: cpErr.message }, 500);

    const targets = (cps ?? []).filter((p: any) => {
      if (!p.spotify_playlist_id) return false;
      if (force) return true;
      return !p.image_url; // só os que faltam capa
    });

    if (targets.length === 0) {
      return jr({ ok: true, enriched: 0, total_candidates: cps?.length ?? 0, skipped: true });
    }

    // Token via Catalog Gateway (pool CC NexEngine 05/10).

    // Dedupe por spotify_playlist_id (várias campanhas podem ter o mesmo id)
    const uniqueIds = Array.from(new Set(targets.map((t: any) => t.spotify_playlist_id as string)));
    const results = await runWithConcurrency(uniqueIds, 6, (id) => fetchOne(id));
    const byId = new Map<string, any>();
    for (const r of results) byId.set((r as any).spotifyId, r);

    let updated = 0;
    let gone = 0;
    let failed = 0;
    const goneIds = new Set<string>();
    for (const cp of targets as any[]) {
      const r = byId.get(cp.spotify_playlist_id);
      if (!r) continue;
      if (r.gone) {
        gone++;
        goneIds.add(cp.spotify_playlist_id);
        continue;
      }
      if (r.error) { failed++; continue; }
      const patch: Record<string, unknown> = {};
      if (r.cover) patch.image_url = r.cover;
      if (r.name) patch.playlist_name = r.name;
      if (typeof r.followers === "number") patch.followers = r.followers;
      if (r.owner_name) patch.spotify_owner_name = r.owner_name;
      if (r.owner_id) patch.spotify_owner_id = r.owner_id;
      if (Object.keys(patch).length === 0) continue;
      const { error: upErr } = await admin.from("curator_playlists").update(patch).eq("id", cp.id);
      if (upErr) { failed++; continue; }
      updated++;
    }

    // FASE APP-05: marca playlists 404/400 como mortas pra não tentar de novo
    let marked_dead = 0;
    if (goneIds.size > 0) {
      const { error: deadErr, count } = await admin
        .from("curator_playlists")
        .update({
          spotify_dead: true,
          spotify_dead_at: new Date().toISOString(),
          spotify_dead_reason: "spotify_404_not_found",
        }, { count: "exact" })
        .in("spotify_playlist_id", Array.from(goneIds))
        .eq("spotify_dead", false);
      if (!deadErr) marked_dead = count ?? 0;
    }


    return jr({ ok: true, enriched: updated, gone, marked_dead, failed, total_candidates: targets.length });
  } catch (e) {
    return jr({ ok: false, error: (e as Error).message }, 500);
  }
});
