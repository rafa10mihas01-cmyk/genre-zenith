// restore-campaign-allocations
// Reconstrói o plano de allocations de uma campanha que foi indevidamente
// esvaziada (ex.: cron expire-draft-campaigns rodou em rascunho com plano
// já fechado). Usa o simulation_snapshot CONGELADO como fonte de verdade —
// nada de RNG novo, nada de recálculo de preço.
//
// POST { campaign_ids: string[], primary_genre_id?: string, dry_run?: boolean }
// Header: Authorization: Bearer <jwt admin>
//
// Regras:
//  - Só roda se snapshot_locked_at IS NOT NULL.
//  - Só roda se NÃO houver allocations (não sobrescreve plano existente).
//  - Resolve gênero primário: input.primary_genre_id > snapshot.music.genre (lookup nome).
//  - Distribui posições via chartTier do snapshot (mesma engine do approve).
//  - planned_streams = followers × mult/30 × POSITION_PCT[pos-1] × effectiveDays,
//    clamped pelo streamsEco do snapshot (não estoura o plano original).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  POSITION_PCT,
  chartTierFromTopPosition,
  distributeEcoPositions,
} from "../_shared/computeEcoPlan.ts";
import { MIN_PLAYLIST_SAVES_FOR_CAMPAIGN } from "../_shared/eco-constants.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

type RestoreResult = {
  campaign_id: string;
  track_name?: string | null;
  ok: boolean;
  reason?: string;
  primary_genre_id?: string | null;
  primary_genre_name?: string | null;
  candidates?: number;
  inserted?: number;
  planned_total?: number;
  target_eco?: number;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ ok: false, error: "missing_auth" }, 401);

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userRes, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userRes?.user) return json({ ok: false, error: "invalid_jwt" }, 401);
  const userId = userRes.user.id;

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  // Só admin pode restaurar (operação sensível, mexe em plano congelado).
  const { data: isAdmin } = await admin.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (!isAdmin) return json({ ok: false, error: "forbidden_admin_only" }, 403);

  let body: { campaign_ids?: string[]; primary_genre_id?: string; dry_run?: boolean };
  try { body = await req.json(); } catch { return json({ ok: false, error: "invalid_json" }, 400); }

  const ids = Array.isArray(body?.campaign_ids) ? body.campaign_ids.filter((x): x is string => typeof x === "string") : [];
  if (ids.length === 0) return json({ ok: false, error: "missing_campaign_ids" }, 400);
  const dryRun = !!body?.dry_run;
  const overrideGenre = typeof body?.primary_genre_id === "string" ? body.primary_genre_id : null;

  const results: RestoreResult[] = [];

  for (const campaignId of ids) {
    const r: RestoreResult = { campaign_id: campaignId, ok: false };
    try {
      // 1) Campaign + snapshot
      const { data: camp, error: cErr } = await admin
        .from("campaigns")
        .select("id, track_name, snapshot_locked_at, simulation_snapshot, engagement_multiplier, started_at, status")
        .eq("id", campaignId)
        .maybeSingle();
      if (cErr) throw new Error(cErr.message);
      if (!camp) { r.reason = "not_found"; results.push(r); continue; }
      r.track_name = camp.track_name;

      if (!camp.snapshot_locked_at) { r.reason = "snapshot_not_locked"; results.push(r); continue; }
      const snap: any = camp.simulation_snapshot;
      if (!snap || typeof snap !== "object") { r.reason = "missing_snapshot"; results.push(r); continue; }

      // 2) Bloqueia se já existem allocations
      const { count: existCount, error: exErr } = await admin
        .from("campaign_eco_allocations")
        .select("id", { count: "exact", head: true })
        .eq("campaign_id", campaignId);
      if (exErr) throw new Error(exErr.message);
      if ((existCount ?? 0) > 0) {
        r.reason = `allocations_already_present (${existCount})`;
        results.push(r);
        continue;
      }

      // 3) Resolve gênero
      let primaryGenreId: string | null = overrideGenre;
      let primaryGenreName: string | null = null;
      if (!primaryGenreId) {
        const genreName = typeof snap?.music?.genre === "string" ? snap.music.genre.trim() : "";
        if (!genreName) { r.reason = "missing_genre_in_snapshot"; results.push(r); continue; }
        const { data: g } = await admin
          .from("genres")
          .select("id, nome")
          .ilike("nome", genreName)
          .maybeSingle();
        if (!g?.id) { r.reason = `genre_not_found:${genreName}`; results.push(r); continue; }
        primaryGenreId = g.id as string;
        primaryGenreName = (g as any).nome as string;
      } else {
        const { data: g } = await admin.from("genres").select("nome").eq("id", primaryGenreId).maybeSingle();
        primaryGenreName = (g as any)?.nome ?? null;
      }
      r.primary_genre_id = primaryGenreId;
      r.primary_genre_name = primaryGenreName;

      // 4) Parâmetros do snapshot (fonte de verdade — não recalcula)
      const days = Number(snap?.effectiveDays ?? snap?.days ?? 0);
      const streamsEco = Number(snap?.streamsEco ?? 0);
      const mult = Math.max(1, Math.round(Number(camp.engagement_multiplier ?? snap?.engagementMultiplier ?? 35)));
      const topPos = Number(snap?.music?.top200Position ?? 0) || null;
      const chartTier = chartTierFromTopPosition(topPos);
      if (!(days > 0) || !(streamsEco > 0)) {
        r.reason = "invalid_snapshot_params";
        results.push(r);
        continue;
      }

      // 5) Inventário disponível
      const { data: pls, error: plErr } = await admin
        .from("managed_playlists")
        .select("id, followers")
        .eq("genre_id", primaryGenreId)
        .is("archived_at", null)
        .gte("followers", MIN_PLAYLIST_SAVES_FOR_CAMPAIGN)
        .order("followers", { ascending: false });
      if (plErr) throw new Error(plErr.message);
      const candidates = (pls ?? []).map((p: any) => ({
        id: p.id as string,
        followers: Number(p.followers ?? 0),
      })).filter(p => p.followers > 0);
      r.candidates = candidates.length;
      if (candidates.length === 0) {
        r.reason = "no_inventory";
        results.push(r);
        continue;
      }

      // 6) Distribui posições + capacidade real → seleciona N playlists até cobrir streamsEco
      const positions = distributeEcoPositions(
        candidates.map(c => ({ id: c.id, planned_streams: 0, followers: c.followers, genreSource: "primary" as const })),
        days,
        mult,
        { chartTier },
      );

      const capRows = candidates.map(c => {
        const pos = positions.get(c.id) ?? 3;
        const pct = POSITION_PCT[pos - 1] ?? 0.003;
        const cap = Math.max(1, Math.round(c.followers * (mult / 30) * pct * days));
        return { id: c.id, followers: c.followers, position: pos, cap };
      }).sort((a, b) => b.cap - a.cap);

      const rows: any[] = [];
      let cumulative = 0;
      for (let i = 0; i < capRows.length; i++) {
        if (cumulative >= streamsEco) break;
        const row = capRows[i];
        const remaining = streamsEco - cumulative;
        const planned = Math.max(1, Math.min(row.cap, remaining));
        rows.push({
          campaign_id: campaignId,
          managed_playlist_id: row.id,
          planned_streams: planned,
          start_day: 1,
          status: "pending",
          position: row.position,
          genre_source: "primary",
        });
        cumulative += planned;
      }

      r.target_eco = streamsEco;
      r.planned_total = rows.reduce((s, x) => s + x.planned_streams, 0);

      if (dryRun) {
        r.ok = true;
        r.reason = "dry_run";
        r.inserted = 0;
        results.push(r);
        continue;
      }

      const { error: insErr, count } = await admin
        .from("campaign_eco_allocations")
        .insert(rows, { count: "exact" });
      if (insErr) throw new Error(insErr.message);

      // Realinha total_allocated da campaign pra refletir o plano restaurado.
      await admin
        .from("campaigns")
        .update({ total_allocated: r.planned_total })
        .eq("id", campaignId);

      r.ok = true;
      r.inserted = count ?? rows.length;
      results.push(r);
    } catch (e: any) {
      r.ok = false;
      r.reason = `error: ${e?.message ?? String(e)}`;
      results.push(r);
    }
  }

  return json({
    ok: true,
    dry_run: dryRun,
    total: results.length,
    restored: results.filter(r => r.ok && (r.inserted ?? 0) > 0).length,
    results,
  });
});
