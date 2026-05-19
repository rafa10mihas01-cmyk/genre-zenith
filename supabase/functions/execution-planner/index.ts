// execution-planner — Compara campaign_allocations com a fila e enfileira ADDs faltantes.
// Idempotente via dedupe_key. Roda via pg_cron (1/min).
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

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

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  // 1. Allocations elegíveis: status approved/active, com playlist e campanha não encerrada
  const { data: allocs, error: aErr } = await supabase
    .from("campaign_allocations")
    .select(`
      id, campaign_id, playlist_id, status, created_at,
      campaigns!inner ( id, status, spotify_track_id, started_at ),
      playlists!inner ( id, spotify_playlist_id, ownership )
    `)
    .in("status", ["approved", "active"])
    .in("campaigns.status", ["active", "running", "live"])
    .order("created_at", { ascending: true });

  if (aErr) return jr({ error: aErr.message }, 500);

  // 1b. Ramp-up de aquecimento: respeita a assinatura ECO (motor único).
  // Em vez de enfileirar todas as allocations de uma campanha de uma vez,
  // libera gradualmente ao longo de RAMP_DAYS (5 dias). Espalha o
  // aquecimento no tempo, reduz risco anti-spam e bate com a curva
  // mostrada pra cliente (operação gera a curva, não o contrário).
  const RAMP_DAYS = 5;
  const now = Date.now();
  const byCampaign = new Map<string, any[]>();
  for (const a of allocs ?? []) {
    const arr = byCampaign.get(a.campaign_id) ?? [];
    arr.push(a);
    byCampaign.set(a.campaign_id, arr);
  }

  const candidates: any[] = [];
  for (const [, list] of byCampaign) {
    const startedAt = (list[0] as any).campaigns?.started_at;
    const startMs = startedAt ? new Date(startedAt).getTime() : now;
    const daysSinceStart = Math.max(0, Math.floor((now - startMs) / 86_400_000));
    // Fração liberada cresce linearmente até atingir 1.0 em RAMP_DAYS.
    const releasedFrac = Math.min(1, (daysSinceStart + 1) / RAMP_DAYS);
    const total = list.length;
    const releasedCount = Math.max(1, Math.ceil(total * releasedFrac));
    // Ordenado por created_at asc já no query → libera as primeiras N.
    for (const a of list.slice(0, releasedCount)) {
      const trackId = (a as any).campaigns?.spotify_track_id;
      const plId = (a as any).playlists?.spotify_playlist_id;
      if (!trackId || !plId) continue;
      candidates.push({
        allocation_id: a.id,
        campaign_id: a.campaign_id,
        playlist_id: a.playlist_id,
        spotify_playlist_id: plId,
        spotify_track_id: trackId,
        dedupe_key: `add:${plId}:${trackId}`,
      });
    }
  }

  if (candidates.length === 0) return jr({ ok: true, enqueued: 0, considered: 0 });

  // 2. Filtrar os que já têm job aberto (pending/claimed/failed) ou já feito (done)
  const dedupeKeys = candidates.map((c) => c.dedupe_key);
  const { data: existing } = await supabase
    .from("playlist_execution_jobs")
    .select("dedupe_key, status")
    .in("dedupe_key", dedupeKeys);

  const skip = new Set(
    (existing ?? [])
      .filter((e: any) => ["pending", "claimed", "failed", "done"].includes(e.status))
      .map((e: any) => e.dedupe_key),
  );

  const toInsert = candidates
    .filter((c) => !skip.has(c.dedupe_key))
    .map((c) => ({
      job_type: "playlist.track.add",
      allocation_id: c.allocation_id,
      campaign_id: c.campaign_id,
      playlist_id: c.playlist_id,
      spotify_playlist_id: c.spotify_playlist_id,
      spotify_track_id: c.spotify_track_id,
      dedupe_key: c.dedupe_key,
      status: "pending",
    }));

  if (toInsert.length === 0) {
    return jr({ ok: true, enqueued: 0, considered: candidates.length });
  }

  const { error: insErr, count } = await supabase
    .from("playlist_execution_jobs")
    .insert(toInsert, { count: "exact" });

  if (insErr) return jr({ error: insErr.message }, 500);

  return jr({ ok: true, enqueued: count ?? toInsert.length, considered: candidates.length });
});
