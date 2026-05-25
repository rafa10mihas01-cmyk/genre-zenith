// replan-campaign-eco — Adiciona playlists novas do gênero primário ao plano
// de uma campanha já aprovada, sem mexer nas allocs existentes.
//
// POST { campaign_id: uuid, dry_run?: boolean }
// Header: Authorization: Bearer <jwt do dono da campanha>
//
// Comportamento:
//  - dry_run=true (preview): retorna quantas playlists entrariam e plays/dia
//    adicionais. NÃO grava nada.
//  - dry_run=false (default): insere as novas allocs com status='approved',
//    genre_source='primary', position calculada via distributeEcoPositions
//    APENAS sobre as novas (não rebalanceia as existentes).
//
// Regras:
//  - Só considera managed_playlists do MESMO genre_id primário da campanha
//    (gênero majoritário entre as allocs atuais), não-arquivadas, com followers > 0.
//  - Ignora playlists já presentes em campaign_eco_allocations desta campanha
//    (qualquer status — preserva dispatched/done/pending/approved).
//  - planned_streams = round(followers × mult/30 × POSITION_PCT[pos-1] × days)
//    — mesma fórmula do buildEcoPlan.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  distributeEcoPositions,
  POSITION_PCT,
} from "../_shared/computeEcoPlan.ts";
import { getGenreNeighbors } from "../_shared/genre-affinity.ts";

// Pequeno RNG determinístico (mesma família do computeEcoPlan) para
// distribuir uniformemente posições 5–10 nas playlists de gêneros vizinhos.
function seededRng(seed: string) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let a = h >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const NEIGHBOR_POS_MIN = 5;
const NEIGHBOR_POS_MAX = 10;
const NEIGHBOR_AFFINITY_THRESHOLD = 0.60;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return json({ ok: false, error: "missing_auth" }, 401);
  }

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userRes, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userRes?.user) return json({ ok: false, error: "invalid_jwt" }, 401);
  const userId = userRes.user.id;

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  let body: { campaign_id?: string; dry_run?: boolean };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }
  const campaignId = body?.campaign_id;
  const dryRun = !!body?.dry_run;
  if (!campaignId || typeof campaignId !== "string") {
    return json({ ok: false, error: "missing_campaign_id" }, 400);
  }

  // 1) Campanha + ownership
  const { data: campaign, error: campErr } = await admin
    .from("campaigns")
    .select("id, created_by, engagement_multiplier, simulation_snapshot")
    .eq("id", campaignId)
    .maybeSingle();
  if (campErr) return json({ ok: false, error: campErr.message }, 500);
  if (!campaign) return json({ ok: false, error: "campaign_not_found" }, 404);
  if (campaign.created_by !== userId) {
    const { data: isAdmin } = await admin.rpc("has_role", { _user_id: userId, _role: "admin" });
    if (!isAdmin) return json({ ok: false, error: "forbidden" }, 403);
  }

  const snap = (campaign as any).simulation_snapshot ?? null;
  const days = Number(snap?.effectiveDays ?? snap?.days ?? 0);
  const mult = Math.max(1, Math.round(Number((campaign as any).engagement_multiplier ?? snap?.engagement_multiplier ?? 30)));
  if (days <= 0) return json({ ok: false, error: "invalid_snapshot_days" }, 400);

  // 2) Allocs existentes — descobre gênero primário e playlists já usadas
  const { data: existing, error: exErr } = await admin
    .from("campaign_eco_allocations")
    .select("managed_playlist_id, status, managed_playlists(genre_id)")
    .eq("campaign_id", campaignId);
  if (exErr) return json({ ok: false, error: exErr.message }, 500);

  const existingRows = (existing ?? []) as any[];
  if (existingRows.length === 0) {
    return json({ ok: false, error: "no_existing_allocations" }, 400);
  }

  const genreCounts = new Map<string, number>();
  const usedIds = new Set<string>();
  for (const r of existingRows) {
    if (r.managed_playlist_id) usedIds.add(r.managed_playlist_id);
    const gid = r.managed_playlists?.genre_id;
    if (gid) genreCounts.set(gid, (genreCounts.get(gid) ?? 0) + 1);
  }
  const primaryGenreId = [...genreCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  if (!primaryGenreId) {
    return json({ ok: false, error: "no_primary_genre" }, 400);
  }

  // 3) Candidatas PRIMÁRIAS: managed_playlists do mesmo gênero, ativas, fora do plano
  const { data: candidatePls, error: cErr } = await admin
    .from("managed_playlists")
    .select("id, followers, genre_id")
    .eq("genre_id", primaryGenreId)
    .is("archived_at", null)
    .gt("followers", 0)
    .order("followers", { ascending: false });
  if (cErr) return json({ ok: false, error: cErr.message }, 500);

  const freshPrimary = (candidatePls ?? []).filter((p: any) => !usedIds.has(p.id));

  // 3b) Candidatas VIZINHAS: gêneros com afinidade >= 0.60 (excluindo o primário).
  //     Posições forçadas em [5,10] para não competir com slots premium do primário.
  const neighbors = await getGenreNeighbors(admin, primaryGenreId, NEIGHBOR_AFFINITY_THRESHOLD);
  const neighborGenreIds = neighbors
    .map(n => n.genre_id)
    .filter(gid => gid && gid !== primaryGenreId);

  let freshNeighbor: any[] = [];
  if (neighborGenreIds.length > 0) {
    const { data: neighborPls, error: nErr } = await admin
      .from("managed_playlists")
      .select("id, followers, genre_id")
      .in("genre_id", neighborGenreIds)
      .is("archived_at", null)
      .gt("followers", 0)
      .order("followers", { ascending: false });
    if (nErr) return json({ ok: false, error: nErr.message }, 500);
    freshNeighbor = (neighborPls ?? []).filter((p: any) => !usedIds.has(p.id));
  }

  if (freshPrimary.length === 0 && freshNeighbor.length === 0) {
    return json({
      ok: true,
      added: 0,
      plays_per_day_added: 0,
      message: "Nenhuma playlist nova (primário ou vizinhos) fora do plano.",
    });
  }

  // 4) Posições — primário usa distributeEcoPositions (respeita tier).
  //    Vizinhos são forçados em [5,10] via RNG determinístico por id.
  const prelimAllocs = freshPrimary.map((p: any) => ({
    id: p.id,
    planned_streams: Math.round(Number(p.followers ?? 0) * (mult / 30) * 0.05 * days),
    followers: Number(p.followers ?? 0),
  }));
  const primaryPositions = distributeEcoPositions(prelimAllocs, days, mult);

  const neighborPositions = new Map<string, number>();
  for (const p of freshNeighbor) {
    const rng = seededRng(`neighbor-pos:${p.id}`);
    const range = NEIGHBOR_POS_MAX - NEIGHBOR_POS_MIN + 1;
    neighborPositions.set(p.id, NEIGHBOR_POS_MIN + Math.floor(rng() * range));
  }

  // 5) Monta linhas + soma plays/dia adicionais
  let playsPerDayAdded = 0;
  let playsPerDayPrimary = 0;
  let playsPerDayNeighbor = 0;
  const rows: any[] = [];

  const buildRow = (p: any, pos: number, source: "primary" | "affinity") => {
    const positionPct = POSITION_PCT[pos - 1] ?? 0.003;
    const followers = Number(p.followers ?? 0);
    const capDia = Math.max(1, Math.round(followers * (mult / 30) * positionPct));
    const plannedStreams = Math.max(1, capDia * days);
    playsPerDayAdded += capDia;
    if (source === "primary") playsPerDayPrimary += capDia;
    else playsPerDayNeighbor += capDia;
    rows.push({
      campaign_id: campaignId,
      managed_playlist_id: p.id,
      planned_streams: plannedStreams,
      start_day: 1,
      status: "approved",
      position: pos,
      genre_source: source,
    });
  };

  for (const p of freshPrimary) {
    buildRow(p, primaryPositions.get(p.id) ?? 3, "primary");
  }
  for (const p of freshNeighbor) {
    buildRow(p, neighborPositions.get(p.id) ?? NEIGHBOR_POS_MIN, "affinity");
  }

  const summary = {
    added: rows.length,
    added_primary: freshPrimary.length,
    added_neighbor: freshNeighbor.length,
    plays_per_day_added: playsPerDayAdded,
    plays_per_day_primary: playsPerDayPrimary,
    plays_per_day_neighbor: playsPerDayNeighbor,
    neighbor_genres: neighborGenreIds,
  };

  if (dryRun) {
    return json({ ok: true, dry_run: true, ...summary });
  }

  // 6) Insert
  const { error: insErr, count } = await admin
    .from("campaign_eco_allocations")
    .insert(rows, { count: "exact" });
  if (insErr) return json({ ok: false, error: insErr.message }, 500);

  return json({ ok: true, ...summary, added: count ?? rows.length });
});
