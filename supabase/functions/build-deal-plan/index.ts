// build-deal-plan — gera/regenera o plano de entrega diário por playlist
// para um curator_deal. Usa buildEcoPlan (mesmo motor das campanhas).
// Idempotente: sempre recomputa a partir das curator_playlists atuais.
import { corsHeaders } from "npm:@supabase/supabase-js/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { buildEcoPlan, type Alloc, type EcoPlanRow } from "../_shared/computeEcoPlan.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DEFAULT_MULT = 35;

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function daysBetween(start: string, end: string | null): number {
  if (!end) return 30;
  const a = new Date(start).getTime();
  const b = new Date(end).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return 30;
  return Math.max(7, Math.round((b - a) / 86400000));
}

function scalePlanToTarget(plan: EcoPlanRow[], target: number): EcoPlanRow[] {
  const targetTotal = Math.max(0, Math.round(target));
  const rawTotal = plan.reduce((sum, row) => sum + row.daily.reduce((s, v) => s + Number(v || 0), 0), 0);
  if (targetTotal <= 0 || rawTotal <= 0 || rawTotal === targetTotal) return plan;

  const cells: Array<{ rowIndex: number; dayIndex: number; base: number; remainder: number }> = [];
  let baseTotal = 0;
  plan.forEach((row, rowIndex) => {
    row.daily.forEach((value, dayIndex) => {
      const scaled = (Number(value || 0) * targetTotal) / rawTotal;
      const base = Math.floor(scaled);
      baseTotal += base;
      cells.push({ rowIndex, dayIndex, base, remainder: scaled - base });
    });
  });

  cells.sort((a, b) => b.remainder - a.remainder);
  let remaining = targetTotal - baseTotal;
  for (let i = 0; i < cells.length && remaining > 0; i++, remaining--) cells[i].base += 1;

  const nextDaily = plan.map((row) => row.daily.map(() => 0));
  for (const cell of cells) nextDaily[cell.rowIndex][cell.dayIndex] = cell.base;

  return plan.map((row, index) => {
    const daily = nextDaily[index];
    return { ...row, daily, total_streams: daily.reduce((sum, value) => sum + value, 0) };
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const dealId = typeof body?.deal_id === "string" ? body.deal_id.trim() : "";
    if (!dealId) return jr({ ok: false, error: "deal_id obrigatório" }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    const { data: deal, error: dealErr } = await admin
      .from("curator_deals")
      .select("id, started_at, ends_at, target_plays, daily_goal, ramp_up_days")
      .eq("id", dealId)
      .maybeSingle();
    if (dealErr) return jr({ ok: false, error: dealErr.message }, 500);
    if (!deal) return jr({ ok: false, error: "deal não encontrado" }, 404);
    if (!deal.started_at) return jr({ ok: false, error: "deal sem started_at" }, 400);

    const days = daysBetween(deal.started_at, deal.ends_at);
    const dailyGoal = Number(deal.daily_goal ?? 0) || Math.max(1, Math.round(Number(deal.target_plays ?? 0) / days));
    const targetPlays = Number(deal.target_plays ?? 0) || dailyGoal * days;

    const { data: playlists, error: plErr } = await admin
      .from("curator_playlists")
      .select("id, playlist_name, followers, match_status, spotify_playlist_id, image_url, spotify_url")
      .eq("deal_id", dealId)
      .in("match_status", ["curator", "baseline"])
      .gt("followers", 0);
    if (plErr) return jr({ ok: false, error: plErr.message }, 500);

    if (!playlists || playlists.length === 0) {
      // Sem playlists: limpa plano antigo
      await admin.from("curator_deal_plan").delete().eq("deal_id", dealId);
      return jr({ ok: true, deal_id: dealId, playlists: 0, message: "sem playlists válidas" });
    }

    // Distribui target_plays proporcional aos followers (com piso de 1)
    const totalFollowers = playlists.reduce((s, p) => s + Number(p.followers ?? 0), 0);
    const allocs: Alloc[] = playlists.map((p) => {
      const f = Number(p.followers ?? 0);
      const share = totalFollowers > 0 ? f / totalFollowers : 1 / playlists.length;
      const planned = Math.max(1, Math.round(targetPlays * share));
      return {
        id: p.id,
        planned_streams: planned,
        start_day: 1,
        managed_playlists: {
          id: p.spotify_playlist_id ?? undefined,
          name: p.playlist_name,
          cover_url: p.image_url ?? null,
          followers: f,
          spotify_url: p.spotify_url ?? null,
        },
      };
    });

    // Curva sintética flat baseada no daily_goal
    const curva = Array.from({ length: days }, () => ({ streamsDay: Math.max(1, dailyGoal) }));
    const plan = scalePlanToTarget(buildEcoPlan({
      snapshot: { days, modo: "simultaneo", curva },
      startedAt: deal.started_at,
      engagementMultiplier: DEFAULT_MULT,
      allocs,
    }), targetPlays);

    // Limpa plano antigo e insere novo
    await admin.from("curator_deal_plan").delete().eq("deal_id", dealId);

    const rows = plan.map((row) => ({
      deal_id: dealId,
      curator_playlist_id: row.allocation_id,
      playlist_name: row.playlist_name,
      followers: row.followers,
      position: row.position,
      start_day: row.start_day,
      cap_dia: row.cap_dia,
      daily: row.daily,
      total_streams: row.total_streams,
      engagement_mult: DEFAULT_MULT,
    }));

    const { error: insErr } = await admin.from("curator_deal_plan").insert(rows);
    if (insErr) return jr({ ok: false, error: insErr.message }, 500);

    return jr({
      ok: true,
      deal_id: dealId,
      playlists: rows.length,
      total_planned: rows.reduce((s, r) => s + r.total_streams, 0),
      days,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return jr({ ok: false, error: msg }, 500);
  }
});
