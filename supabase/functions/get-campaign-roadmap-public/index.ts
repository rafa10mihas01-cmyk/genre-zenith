// Public endpoint — Mapa de Entrega (roadmap) compartilhável por link.
// Funciona como um documento compartilhado: quem tem o link visualiza, sem
// login, sem OTP, sem cookie. É FISICAMENTE isolado do Portal do Cliente:
//   - Lookup pelo campo `campaigns.roadmap_token` (NÃO usa `public_plan_token`).
//   - Whitelist explícita de campos. Nada de SELECT *.
//   - Nunca devolve: client_id, client_email, valor_*, contratos, aprovações,
//     uploads, notes internas, deal_id, plan_*_by, ips, snapshots financeiros.
//   - Não emite/aceita JWT do portal. Não chama gateCampaignAccess.
// Revogar o link = trocar `roadmap_token` (não afeta o portal protegido).

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { checkRateLimit, clientIp, rateLimitResponse } from "../_shared/rate-limit.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Subset do simulation_snapshot que é seguro mostrar publicamente.
// REMOVIDO em relação ao portal privado: clientPriceTotal (valor pago),
// pricePerStreamSell e qualquer chave de preço/custo/margem.
function sanitizeSnapshotPublic(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const allowed = ["meta", "days", "effectiveDays", "curva", "splitOrganicPct", "music"];
  const out: Record<string, unknown> = {};
  for (const k of allowed) {
    if (r[k] !== undefined) out[k] = r[k];
  }
  // Dentro de `music`, só os campos públicos (posição/streams do top 200).
  if (out.music && typeof out.music === "object") {
    const m = out.music as Record<string, unknown>;
    out.music = {
      top200Position: m.top200Position ?? m.top200Pos ?? null,
      top200StreamsDay: m.top200StreamsDay ?? null,
      baselineStreamsDay: m.baselineStreamsDay ?? null,
    };
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const ip = clientIp(req);
  const rl = await checkRateLimit(`getCampaignRoadmapPublic:${ip}`, 60, 120);
  if (!rl.allowed) return rateLimitResponse(corsHeaders);

  let token = "";
  try {
    const body = await req.json();
    token = String(body?.roadmap_token ?? "").trim();
  } catch (_) { /* ignore */ }

  // Token gerado por encode(gen_random_bytes(18),'hex') = 36 chars [a-f0-9].
  if (!/^[a-f0-9]{36}$/.test(token)) {
    return jr({ error: "invalid_token" }, 400);
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false },
  });

  // WHITELIST EXPLÍCITA. Nada de "*". Cada campo aqui é uma decisão.
  // Excluídos: client_id, client_email, valor_cobrado, valor_recebido,
  // forma_recebimento, notes, plan_approved_*, client_approved_*,
  // client_rejected_*, client_adjustment_request, client_approved_ip,
  // deal_id, created_by, public_plan_token, roadmap_token (não ecoar),
  // token_expires_at, token_revoked_at, simulation_snapshot bruto.
  const { data: campRaw, error: cErr } = await supabase
    .from("campaigns")
    .select(
      "id, track_name, artist, cover_url, spotify_track_url, goal_plays, status, started_at, deadline, total_delivered, engagement_multiplier, simulation_snapshot",
    )
    .eq("roadmap_token", token)
    .maybeSingle();

  if (cErr) return jr({ error: cErr.message }, 500);
  if (!campRaw) return jr({ error: "not_found" }, 404);

  // Mesmo critério do portal: campanha encerrada => link expira.
  if (campRaw.status === "completed" || campRaw.status === "cancelled") {
    return jr({ error: "campaign_closed", message: "Campanha encerrada" }, 404);
  }

  const snapshot = sanitizeSnapshotPublic(campRaw.simulation_snapshot);

  // Plano de distribuição (eco). Só metadados públicos da playlist.
  // NÃO retorna: planned_streams * price, custo, curator pago, etc.
  const { data: allocs, error: aErr } = await supabase
    .from("campaign_eco_allocations")
    .select(
      "id, managed_playlist_id, planned_streams, start_day, status, dispatched_at, position, genre_source, genre_affinity_score, managed_playlists(name, cover_url, followers, spotify_url, genre_id, engagement_multiplier_override)",
    )
    .eq("campaign_id", campRaw.id)
    .order("planned_streams", { ascending: false });
  if (aErr) return jr({ error: aErr.message }, 500);

  // Snapshots de execução (eco) — só leitura agregada de plays por playlist.
  const { data: snaps } = await supabase
    .from("campaign_eco_snapshots")
    .select("id, managed_playlist_id, plays_24h, plays_7d, plays_28d, captured_at, source")
    .eq("campaign_id", campRaw.id)
    .order("captured_at", { ascending: false })
    .limit(500);

  // Coletado real de rádio/autoplay/mixes — mesma fonte que o painel interno
  // usa pra mostrar "coletado" na linha #0 do plano. Soma plays_7d mais recente
  // por playlist em organic_plays_snapshots. Quando ausente, o card cai no
  // valor estimado (radioGoal = meta × splitOrganicPct%).
  let organicTotalPlays = 0;
  try {
    // organic_plays_snapshots não tem campaign_id — só deal_id.
    // Pega TODOS os curator_deals dessa campanha (mesmo critério da página interna).
    const { data: dealsForCampaign } = await supabase
      .from("curator_deals")
      .select("id")
      .eq("campaign_id", campRaw.id);
    const dealIds = ((dealsForCampaign ?? []) as Array<{ id: string }>).map((d) => d.id);
    if (dealIds.length > 0) {
      const { data: organicRows } = await supabase
        .from("organic_plays_snapshots")
        .select("spotify_playlist_id, playlist_name, plays_7d, plays_28d, plays_24h, captured_at")
        .in("deal_id", dealIds)
        .order("captured_at", { ascending: false })
        .limit(2000);
      const latest = new Map<string, { plays: number; at: string }>();
      for (const r of (organicRows ?? []) as any[]) {
        const key = r.spotify_playlist_id ?? `name:${r.playlist_name ?? ""}`;
        const prev = latest.get(key);
        const at = String(r.captured_at ?? "");
        if (!prev || at > prev.at) {
          latest.set(key, { plays: Number(r.plays_7d ?? r.plays_28d ?? r.plays_24h ?? 0), at });
        }
      }
      for (const v of latest.values()) organicTotalPlays += v.plays;
    }
  } catch (_) { /* organic_summary é opcional */ }

  // Forecast — curva acumulada PLANEJADA (sem preço, sem nomes de playlist).
  let forecast: {
    curve: Array<{ day: number; cumulative: number }>;
    goalHitDay: number | null;
    totalDays: number;
    goalPlays: number;
    startedAt: string;
    plannedDailyAverage: number;
  } | null = null;
  try {
    const rs = campRaw.simulation_snapshot as { days?: number; curva?: Array<{ streamsDay?: number }> } | null;
    if (rs?.days && Array.isArray(rs.curva) && rs.curva.length > 0) {
      const curvaSnap = rs.curva;
      const days = curvaSnap.length;
      let running = 0;
      const curve: Array<{ day: number; cumulative: number }> = [];
      let goalHitDay: number | null = null;
      const goal = campRaw.goal_plays ?? 0;
      for (let i = 0; i < days; i++) {
        const sd = Number(curvaSnap[i]?.streamsDay ?? 0);
        running += Number.isFinite(sd) ? sd : 0;
        curve.push({ day: i + 1, cumulative: Math.round(running) });
        if (goalHitDay === null && goal > 0 && running >= goal) goalHitDay = i + 1;
      }
      forecast = {
        curve,
        goalHitDay,
        totalDays: days,
        goalPlays: goal,
        startedAt: campRaw.started_at,
        plannedDailyAverage: days > 0 ? Math.round(running / days) : 0,
      };
    }
  } catch (_) { /* opcional */ }

  // Campos públicos da campanha (subset já filtrado acima, sem snapshot bruto).
  const camp = {
    id: campRaw.id,
    track_name: campRaw.track_name,
    artist: campRaw.artist,
    cover_url: campRaw.cover_url,
    spotify_track_url: campRaw.spotify_track_url,
    goal_plays: campRaw.goal_plays,
    status: campRaw.status,
    started_at: campRaw.started_at,
    deadline: campRaw.deadline,
    total_delivered: campRaw.total_delivered,
    engagement_multiplier: campRaw.engagement_multiplier,
    simulation_snapshot: snapshot,
  };

  return jr({
    campaign: camp,
    allocations: allocs ?? [],
    snapshots: snaps ?? [],
    forecast,
    organic_summary: { total_plays: organicTotalPlays },
  });
});
