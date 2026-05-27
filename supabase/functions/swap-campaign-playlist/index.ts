// swap-campaign-playlist — substitui uma alocação congelada por 1-3 novas, preservando o total.
import { createClient } from "npm:@supabase/supabase-js@2";
import { requireTeamAccess } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

type NewItem = { managed_playlist_id: string; planned_streams: number };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const guard = await requireTeamAccess(req);
  if (!guard.ok) return guard.resp;

  try {
    const { campaign_id, old_allocation_id, new_allocations, reason } = (await req.json()) as {
      campaign_id: string;
      old_allocation_id: string;
      new_allocations: NewItem[];
      reason?: string;
    };

    if (!campaign_id || !old_allocation_id || !Array.isArray(new_allocations) || new_allocations.length === 0) {
      return json({ error: "missing params" }, 400);
    }
    if (new_allocations.length > 3) return json({ error: "max 3 new playlists" }, 400);

    const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // 1) carrega alocação antiga
    const { data: oldAlloc, error: aErr } = await sb
      .from("campaign_eco_allocations")
      .select("id, campaign_id, managed_playlist_id, planned_streams, start_day, dispatched_at, cost_per_stream_op, market_per_stream, price_per_stream_sell, position")
      .eq("id", old_allocation_id)
      .single();
    if (aErr || !oldAlloc) return json({ error: "allocation not found" }, 404);
    if (oldAlloc.campaign_id !== campaign_id) return json({ error: "campaign mismatch" }, 400);
    if (oldAlloc.dispatched_at) return json({ error: "playlist já foi ao ar — não pode substituir" }, 409);

    const target = Number(oldAlloc.planned_streams);
    const sumNew = new_allocations.reduce((s, x) => s + Number(x.planned_streams || 0), 0);

    // tolerância ±1% ou ±1 stream
    const tol = Math.max(1, Math.round(target * 0.01));
    if (Math.abs(sumNew - target) > tol) {
      return json({ error: `sum mismatch: target=${target}, got=${sumNew}` }, 400);
    }

    // 2) valida que novas playlists existem e não estão já na campanha
    const newIds = new_allocations.map(x => x.managed_playlist_id);
    if (new Set(newIds).size !== newIds.length) return json({ error: "duplicate playlists" }, 400);

    const { data: existing } = await sb
      .from("campaign_eco_allocations")
      .select("managed_playlist_id")
      .eq("campaign_id", campaign_id)
      .in("managed_playlist_id", newIds);
    if (existing && existing.length > 0) {
      return json({ error: "uma das playlists já está na campanha" }, 409);
    }

    const { data: newPls, error: pErr } = await sb
      .from("managed_playlists")
      .select("id, genre_id")
      .in("id", newIds);
    if (pErr) return json({ error: pErr.message }, 500);
    if (!newPls || newPls.length !== newIds.length) {
      return json({ error: "playlist not found" }, 404);
    }
    const genreById = new Map(newPls.map(p => [p.id, p.genre_id]));

    // 3) gênero da campanha (do snapshot ou da playlist antiga)
    const { data: camp } = await sb
      .from("campaigns")
      .select("simulation_snapshot")
      .eq("id", campaign_id)
      .single();
    const snapshotGenres: string[] = (camp?.simulation_snapshot as any)?.genres ?? [];
    const { data: oldPl } = await sb
      .from("managed_playlists")
      .select("genre_id")
      .eq("id", oldAlloc.managed_playlist_id)
      .single();
    const primaryGenre: string | null = (oldPl?.genre_id as string | null) ?? snapshotGenres[0] ?? null;

    // 4) executa: delete antiga + insert novas (sem transação real, mas reversível via log)
    const { error: delErr } = await sb
      .from("campaign_eco_allocations")
      .delete()
      .eq("id", old_allocation_id);
    if (delErr) return json({ error: `delete failed: ${delErr.message}` }, 500);

    const rows = new_allocations.map(n => {
      const g = genreById.get(n.managed_playlist_id) ?? null;
      const isPrimary = primaryGenre && g === primaryGenre;
      return {
        campaign_id,
        managed_playlist_id: n.managed_playlist_id,
        planned_streams: n.planned_streams,
        start_day: oldAlloc.start_day,
        status: "pending",
        cost_per_stream_op: oldAlloc.cost_per_stream_op,
        market_per_stream: oldAlloc.market_per_stream,
        price_per_stream_sell: oldAlloc.price_per_stream_sell,
        genre_source: isPrimary ? "primary" : "affinity",
      };
    });

    const { error: insErr } = await sb.from("campaign_eco_allocations").insert(rows);
    if (insErr) {
      // tenta restaurar
      await sb.from("campaign_eco_allocations").insert([{
        id: oldAlloc.id,
        campaign_id: oldAlloc.campaign_id,
        managed_playlist_id: oldAlloc.managed_playlist_id,
        planned_streams: oldAlloc.planned_streams,
        start_day: oldAlloc.start_day,
        status: "pending",
        cost_per_stream_op: oldAlloc.cost_per_stream_op,
        market_per_stream: oldAlloc.market_per_stream,
        price_per_stream_sell: oldAlloc.price_per_stream_sell,
        position: oldAlloc.position,
      }]);
      return json({ error: `insert failed: ${insErr.message}` }, 500);
    }

    // 5) registra histórico
    await sb.from("campaign_plan_history").insert([{
      campaign_id,
      action: "swap",
      old_playlist_id: oldAlloc.managed_playlist_id,
      new_playlist_ids: newIds,
      reason: reason ?? null,
      meta: {
        target,
        new_allocations: rows.map(r => ({
          managed_playlist_id: r.managed_playlist_id,
          planned_streams: r.planned_streams,
        })),
      },
      acted_by: guard.via === "user" ? guard.userId : null,
    }]);

    return json({ ok: true, replaced: newIds.length, target });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});

function json(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
