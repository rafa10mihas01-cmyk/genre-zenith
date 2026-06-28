// suggest-playlist-swap — sugere playlists para substituir uma alocação congelada.
// Retorna candidatas únicas (que cobrem a meta sozinhas) + combinações 2-3.
import { createClient } from "npm:@supabase/supabase-js@2";
import { requireTeamAccess } from "../_shared/auth.ts";
import { getGenreNeighbors } from "../_shared/genre-affinity.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

type Candidate = {
  managed_playlist_id: string;
  name: string;
  cover_url: string | null;
  followers: number;
  genre_id: string | null;
  free_capacity: number;
  affinity_score: number; // 1 = mesmo gênero, <1 = vizinho
  tier: "primary" | "neighbor";
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const guard = await requireTeamAccess(req);
  if (!guard.ok) return guard.resp;

  try {
    const { campaign_id, old_allocation_id } = await req.json();
    if (!campaign_id || !old_allocation_id) {
      return json({ error: "missing params" }, 400);
    }

    const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // 1) Alocação alvo
    const { data: oldAlloc, error: aErr } = await sb
      .from("campaign_eco_allocations")
      .select("id, campaign_id, managed_playlist_id, planned_streams, start_day, dispatched_at")
      .eq("id", old_allocation_id)
      .single();
    if (aErr || !oldAlloc) return json({ error: "allocation not found" }, 404);
    if (oldAlloc.campaign_id !== campaign_id) return json({ error: "campaign mismatch" }, 400);
    const target = Number(oldAlloc.planned_streams);

    // 1b) Janela da campanha (pra estimar capacidade compatível com o planner)
    const { data: camp } = await sb
      .from("campaigns")
      .select("started_at, deadline")
      .eq("id", campaign_id)
      .single();
    let planDays = 30;
    if (camp?.started_at && camp?.deadline) {
      const ms = new Date(camp.deadline as string).getTime() - new Date(camp.started_at as string).getTime();
      const d = Math.round(ms / 86400000);
      if (d > 0) planDays = d;
    }
    // Capacidade por playlist ~ followers * 4 streams a cada 30 dias (curva do planner em posições altas).
    const CAP_PER_FOLLOWER_PER_30D = 4;
    const capFactor = (planDays / 30) * CAP_PER_FOLLOWER_PER_30D;

    // 2) Gênero da playlist antiga
    const { data: oldPl } = await sb
      .from("managed_playlists")
      .select("genre_id")
      .eq("id", oldAlloc.managed_playlist_id)
      .single();
    const primaryGenre = oldPl?.genre_id as string | null;


    // 3) Pool de gêneros (primário + vizinhos)
    const genrePool: { genre_id: string; score: number; tier: "primary" | "neighbor" }[] = [];
    if (primaryGenre) {
      genrePool.push({ genre_id: primaryGenre, score: 1, tier: "primary" });
      const neighbors = await getGenreNeighbors(sb, primaryGenre, 0.6);
      for (const n of neighbors) {
        genrePool.push({ genre_id: n.genre_id, score: n.score, tier: "neighbor" });
      }
    }

    // 4) Playlists já alocadas a essa campanha (a evitar)
    const { data: existingAllocs } = await sb
      .from("campaign_eco_allocations")
      .select("managed_playlist_id")
      .eq("campaign_id", campaign_id);
    const excluded = new Set((existingAllocs ?? []).map(r => r.managed_playlist_id));

    // 5) Lista candidatas (mesmos gêneros do pool, não arquivadas, não na campanha)
    const genreIds = genrePool.map(g => g.genre_id);
    let candidatesQuery = sb
      .from("managed_playlists")
      .select("id, name, cover_url, followers, genre_id, archived_at")
      .eq("playlist_type", "CAMPAIGN")
      .limit(200);
    if (genreIds.length > 0) candidatesQuery = candidatesQuery.in("genre_id", genreIds);
    const { data: rawCandidates, error: cErr } = await candidatesQuery;
    if (cErr) return json({ error: cErr.message }, 500);

    const filtered = (rawCandidates ?? []).filter(p => !excluded.has(p.id));

    // 6) Capacidade livre por playlist: capacidade ~ followers * 0.4 (proxy),
    // menos a soma de planned_streams ativos em outras campanhas.
    const ids = filtered.map(p => p.id);
    const { data: otherAllocs } = ids.length
      ? await sb
          .from("campaign_eco_allocations")
          .select("managed_playlist_id, planned_streams, status")
          .in("managed_playlist_id", ids)
          .in("status", ["pending", "active", "dispatched"])
      : { data: [] as any[] };

    const usedByPl = new Map<string, number>();
    for (const r of otherAllocs ?? []) {
      usedByPl.set(
        r.managed_playlist_id,
        (usedByPl.get(r.managed_playlist_id) ?? 0) + Number(r.planned_streams ?? 0),
      );
    }

    const scoreByGenre = new Map(genrePool.map(g => [g.genre_id, g] as const));

    const candidates: Candidate[] = filtered
      .map(p => {
        const followers = Number(p.followers ?? 0);
        const nominalCap = Math.max(0, Math.round(followers * capFactor));
        const used = usedByPl.get(p.id) ?? 0;
        const free = Math.max(0, nominalCap - used);
        const g = p.genre_id ? scoreByGenre.get(p.genre_id) : undefined;
        return {
          managed_playlist_id: p.id,
          name: p.name,
          cover_url: p.cover_url,
          followers,
          genre_id: p.genre_id ?? null,
          free_capacity: free,
          affinity_score: g?.score ?? 0.5,
          tier: g?.tier ?? "neighbor",
        };
      })
      // só vale quem tem alguma capacidade real
      .filter(c => c.free_capacity > 0);


    // 7) Singles que cobrem a meta sozinhos — ordenados
    const singles = candidates
      .filter(c => c.free_capacity >= target)
      .sort((a, b) =>
        b.affinity_score - a.affinity_score ||
        b.free_capacity - a.free_capacity ||
        b.followers - a.followers,
      )
      .slice(0, 15);

    // 8) Combos 2-3 que cobrem (greedy a partir das mais afins / maiores capacidades)
    const combos: { items: Candidate[]; total_capacity: number; split: { managed_playlist_id: string; planned_streams: number }[] }[] = [];
    if (singles.length === 0) {
      // ordenamos por capacidade desc (mais provável de cobrir) com afinidade como tiebreaker
      const sortedByCap = [...candidates].sort((a, b) =>
        b.free_capacity - a.free_capacity || b.affinity_score - a.affinity_score,
      );
      const POOL_PAIR = Math.min(sortedByCap.length, 25);
      const POOL_TRIO = Math.min(sortedByCap.length, 20);
      // pares
      outerPair: for (let i = 0; i < POOL_PAIR; i++) {
        for (let j = i + 1; j < POOL_PAIR; j++) {
          const a = sortedByCap[i], b = sortedByCap[j];
          if (a.free_capacity + b.free_capacity >= target) {
            combos.push(buildCombo([a, b], target));
            if (combos.length >= 5) break outerPair;
          }
        }
      }
      // trios se ainda faltar
      if (combos.length < 3) {
        outerTrio: for (let i = 0; i < POOL_TRIO; i++) {
          for (let j = i + 1; j < POOL_TRIO; j++) {
            for (let k = j + 1; k < POOL_TRIO; k++) {
              const a = sortedByCap[i], b = sortedByCap[j], c = sortedByCap[k];
              if (a.free_capacity + b.free_capacity + c.free_capacity >= target) {
                combos.push(buildCombo([a, b, c], target));
                if (combos.length >= 5) break outerTrio;
              }
            }
          }
        }
      }
    }

    return json({
      target,
      old_playlist_id: oldAlloc.managed_playlist_id,
      plan_days: planDays,
      genre_pool: genrePool,
      pool_size: filtered.length,
      candidates_with_capacity: candidates.length,
      singles,
      combos,
    });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);

  }
});

function buildCombo(items: Candidate[], target: number) {
  const totalCap = items.reduce((s, x) => s + x.free_capacity, 0);
  // split proporcional à capacidade livre — soma = target exatamente
  let assigned = 0;
  const split = items.map((c, idx) => {
    let v: number;
    if (idx === items.length - 1) {
      v = Math.max(0, target - assigned);
    } else {
      v = Math.round((c.free_capacity / totalCap) * target);
      assigned += v;
    }
    return { managed_playlist_id: c.managed_playlist_id, planned_streams: v };
  });
  return { items, total_capacity: totalCap, split };
}

function json(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
