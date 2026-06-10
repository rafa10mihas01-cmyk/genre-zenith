// expand-from-winners — Onda 3
// Usa os top owners com winners (winner_score >= 70) como sementes
// para descobrir mais playlists públicas deles via Spotify API.
//
// Toda playlist nova passa pelo MESMO gate textual da Onda 1 (scoreAndGate)
// e entra como needs_enrich=true. O cron de enrich (Onda 1) cuida do resto,
// e o cron de winner-score (Onda 2) recalcula.
//
// Acionamento:
//   - POST manual: { genre_id?, min_winner_score?, max_owners_per_genre?, max_playlists_per_owner? }
//   - Cron (header x-cron-secret)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { loadGateContext, scoreAndGate } from "../_shared/discovery-scoring.ts";
import { reportCronHealth } from "../_shared/cron-health.ts";
import { getSpotifyToken, guardedSpotifyFetch, setSpotifyCtx } from "../_shared/spotify.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const THROTTLE_MS = 300;

async function fetchUserPlaylists(token: string, ownerId: string, limit = 50): Promise<any[]> {
  // Spotify só expõe playlists públicas de usuários comuns.
  // Para owner_type='label' ou ownerId 'spotify', o endpoint pode falhar.
  const url = `https://api.spotify.com/v1/users/${encodeURIComponent(ownerId)}/playlists?limit=${limit}`;
  const ctx = { spotify_user_id: ownerId, owner_id: ownerId, function_name: "expand-from-winners" } as const;
  const r = await guardedSpotifyFetch(url, { headers: { Authorization: `Bearer ${token}` } }, ctx);
  if (r.status === 404 || r.status === 403) return [];
  if (r.status === 401) {
    const t2 = await getSpotifyToken(true);
    const r2 = await guardedSpotifyFetch(url, { headers: { Authorization: `Bearer ${t2}` } }, ctx);
    if (!r2.ok) return [];
    const j2 = await r2.json();
    return j2.items ?? [];
  }
  if (!r.ok) return [];
  const j = await r.json();
  return j.items ?? [];
}

interface ExpandStats {
  genre_id: string;
  slug: string;
  owners_processed: number;
  playlists_fetched: number;
  already_existed: number;
  rejected_by_gate: number;
  inserted: number;
  errors: number;
}

async function expandGenre(
  supabase: any,
  genreId: string,
  opts: { minWinner: number; maxOwners: number; maxPerOwner: number },
): Promise<ExpandStats> {
  const ctx = await loadGateContext(supabase, genreId);
  const stats: ExpandStats = {
    genre_id: genreId, slug: ctx.slug,
    owners_processed: 0, playlists_fetched: 0,
    already_existed: 0, rejected_by_gate: 0, inserted: 0, errors: 0,
  };

  // 1) Top owners — agrupados, com winner_score >= minWinner
  const { data: winners } = await supabase
    .from("search_results")
    .select("owner_id, owner_type, winner_score")
    .eq("genre_id", genreId)
    .gte("winner_score", opts.minWinner)
    .is("duplicate_of", null)
    .not("owner_id", "is", null)
    .neq("owner_id", "spotify")
    .order("winner_score", { ascending: false })
    .limit(500);

  const ownerMap = new Map<string, { owner_id: string; owner_type: string | null; count: number; max_ws: number }>();
  for (const w of winners ?? []) {
    const cur = ownerMap.get(w.owner_id);
    if (cur) { cur.count++; cur.max_ws = Math.max(cur.max_ws, Number(w.winner_score)); }
    else ownerMap.set(w.owner_id, { owner_id: w.owner_id, owner_type: w.owner_type, count: 1, max_ws: Number(w.winner_score) });
  }
  const owners = [...ownerMap.values()]
    .sort((a, b) => (b.count - a.count) || (b.max_ws - a.max_ws))
    .slice(0, opts.maxOwners);

  if (owners.length === 0) return stats;

  // Carrega editorial blocklist — perfis institucionais retornam 403.
  const { data: blocklistRows } = await supabase
    .from("spotify_editorial_blocklist")
    .select("spotify_user_id");
  const blocklist = new Set<string>((blocklistRows ?? []).map((r: any) => String(r.spotify_user_id).toLowerCase()));

  const token = await getSpotifyToken();

  // 2) IDs já existentes nesse gênero (para dedupe rápido)
  const { data: existing } = await supabase
    .from("search_results")
    .select("spotify_playlist_id")
    .eq("genre_id", genreId);
  const existingIds = new Set((existing ?? []).map((e: any) => e.spotify_playlist_id).filter(Boolean));

  let ownerIdx = 0;
  let skippedEditorial = 0;
  for (const owner of owners) {
    if (blocklist.has(String(owner.owner_id).toLowerCase())) {
      skippedEditorial++;
      console.log(`[expand] skip editorial_blocked owner=${owner.owner_id}`);
      continue;
    }
    if (ownerIdx++ > 0) await sleep(THROTTLE_MS);
    setSpotifyCtx({
      owner_id: owner.owner_id,
      spotify_user_id: owner.owner_id,
      function_name: "expand-from-winners",
    });
    stats.owners_processed++;
    let items: any[] = [];
    try {
      items = await fetchUserPlaylists(token, owner.owner_id, Math.min(50, opts.maxPerOwner));
    } catch (e) {
      stats.errors++;
      console.error(`[expand] owner ${owner.owner_id} fetch failed:`, (e as Error).message);
      continue;
    }
    items = items.slice(0, opts.maxPerOwner);

    for (const pl of items) {
      stats.playlists_fetched++;
      if (!pl?.id) continue;
      if (existingIds.has(pl.id)) { stats.already_existed++; continue; }

      const nome = pl.name ?? "";
      const desc = pl.description ?? null;
      const followers = pl.followers?.total ?? null; // /users/{id}/playlists não retorna followers; fica null e enrich resolve
      const totalTracks = pl.tracks?.total ?? null;
      const imageUrl = pl.images?.[0]?.url ?? null;
      const url = pl.external_urls?.spotify ?? null;
      const ownerId = pl.owner?.id ?? owner.owner_id;
      const ownerType = pl.owner?.type ?? owner.owner_type ?? "user";

      // GATE TEXTUAL UNIFICADO (mesma esteira da Onda 1)
      const gate = scoreAndGate(ctx, { nomePl: nome, descricao: desc, followers });
      if (gate.hardBlock) {
        stats.rejected_by_gate++;
        continue;
      }

      const now = new Date().toISOString();
      const { error } = await supabase.from("search_results").insert({
        genre_id: genreId,
        posicao: 0,
        nome_playlist: nome,
        descricao: desc,
        spotify_playlist_id: pl.id,
        spotify_url: url,
        imagem_url: imageUrl,
        total_musicas: totalTracks,
        seguidores: followers,
        owner_id: ownerId,
        owner_type: ownerType,
        score: gate.score,
        is_valid: false,            // só vira true após Phase 2 (enrich)
        needs_enrich: true,
        first_seen_at: now,
        last_seen_at: now,
        times_seen: 1,
        coletado_em: now,
        apify_run_id: `expand-wave3:${owner.owner_id}`,
      });
      if (error) {
        // Pode ser unique violation por race condition — só ignora
        if (!String(error.message).includes("duplicate")) {
          stats.errors++;
          console.error("[expand] insert failed:", error.message);
        }
      } else {
        stats.inserted++;
        existingIds.add(pl.id);
      }
    }
  }

  return stats;
}

// FASE APP-05: pausado por restrição do Spotify (endpoint /v1/users/{id}/playlists
// passou a exigir Extended Quota Mode). 99% das chamadas retornavam 403, sem
// benefício operacional. Código preservado pra reativação futura.
const PAUSED_BY_SPOTIFY_RESTRICTION = true;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
  const startedAt = Date.now();

  if (PAUSED_BY_SPOTIFY_RESTRICTION) {
    await reportCronHealth(supabase, {
      job_name: "expand-from-winners",
      status: "ok",
      startedAt,
      message: "paused_by_spotify_restriction",
      metrics: { paused: true, reason: "spotify_endpoint_restricted" },
    }).catch(() => {});
    return new Response(JSON.stringify({
      ok: true,
      paused: true,
      reason: "paused_by_spotify_restriction",
      detail: "Endpoint /v1/users/{id}/playlists requer Extended Quota Mode. Função pausada pela FASE APP-05.",
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  try {
    let body: any = {};
    if (req.method === "POST") {
      try { body = await req.json(); } catch { /* empty */ }
    }
    const minWinner = Number(body.min_winner_score ?? 70);
    const maxOwners = Math.min(Number(body.max_owners_per_genre ?? 20), 100);
    const maxPerOwner = Math.min(Number(body.max_playlists_per_owner ?? 25), 50);

    let genreIds: string[];
    if (body.genre_id) {
      genreIds = [body.genre_id];
    } else {
      const { data } = await supabase.from("genres").select("id").eq("ativo", true);
      genreIds = (data ?? []).map((g: any) => g.id);
    }

    const results: ExpandStats[] = [];
    let totalInserted = 0;
    let totalErrors = 0;
    for (const gid of genreIds) {
      try {
        const r = await expandGenre(supabase, gid, { minWinner, maxOwners, maxPerOwner });
        results.push(r);
        totalInserted += r.inserted;
        totalErrors += r.errors;
      } catch (e) {
        console.error(`[expand] genre ${gid} failed:`, (e as Error).message);
        results.push({
          genre_id: gid, slug: "?", owners_processed: 0, playlists_fetched: 0,
          already_existed: 0, rejected_by_gate: 0, inserted: 0, errors: 1,
        });
        totalErrors++;
      }
    }

    // Log em discovery_wave1_reports para auditoria centralizada
    try {
      await supabase.from("discovery_wave1_reports").insert({
        wave: "wave3-expand-from-winners",
        stats: { min_winner: minWinner, max_owners: maxOwners, max_per_owner: maxPerOwner, total_inserted: totalInserted, by_genre: results },
      });
    } catch (e) {
      console.warn("[expand] report log skipped:", (e as Error).message);
    }

    await reportCronHealth(supabase, {
      job_name: "expand-from-winners",
      status: totalErrors === 0 ? "ok" : (totalInserted === 0 ? "error" : "partial"),
      startedAt,
      metrics: { total_inserted: totalInserted, genres: genreIds.length, errors: totalErrors },
    });

    return new Response(JSON.stringify({ ok: true, total_inserted: totalInserted, by_genre: results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[expand] fatal", e);
    await reportCronHealth(supabase, {
      job_name: "expand-from-winners",
      status: "error",
      startedAt,
      message: String((e as Error).message),
    });
    return new Response(JSON.stringify({ ok: false, error: String((e as Error).message) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
