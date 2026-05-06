// get-client-campaign-public — payload PÚBLICO e SANITIZADO para o CLIENTE
// final da campanha (não para o curador). Acessado via /campanha/:client_token.
//
// Garantias de privacidade — o payload NUNCA inclui:
//   curator_name, curator_id, owner_id/spotify_owner_id, public_token,
//   match_status/match_reason, scores, custos, CPP, ledger, IDs internos
//   de tracking (deal_id, song_id, playlist_id internos), notas, tokens.
//
// Reusa a fonte de verdade do progresso (RPC get_curator_deal_progress
// + get_curator_deal_snapshot_history), mas reescreve o objeto antes de
// devolver ao frontend.
import { corsHeaders } from "npm:@supabase/supabase-js/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type AnyRec = Record<string, unknown>;

function pickPlaylistStatus(p: AnyRec, growth: number): "Nova" | "Crescendo" | "Destaque" | "Estável" {
  const addedAt = p.added_at_spotify || p.added_at;
  const ageDays = addedAt
    ? (Date.now() - new Date(String(addedAt)).getTime()) / (1000 * 60 * 60 * 24)
    : 999;
  if (ageDays <= 7) return "Nova";
  if (growth >= 5000) return "Destaque";
  if (growth >= 500) return "Crescendo";
  return "Estável";
}

function campaignStatus(args: {
  pct: number;
  closedAt: string | null;
  recent7Growth: number;
}): "Em andamento" | "Acelerando" | "Meta batida" | "Finalizada" {
  if (args.closedAt) return "Finalizada";
  if (args.pct >= 100) return "Meta batida";
  if (args.recent7Growth > 0 && args.pct >= 30) return "Acelerando";
  return "Em andamento";
}

function pace(args: { pct: number; daysElapsed: number; targetDays: number }):
  | "abaixo do esperado"
  | "normal"
  | "acelerando" {
  if (args.targetDays <= 0) return "normal";
  const expected = (args.daysElapsed / args.targetDays) * 100;
  if (args.pct >= expected + 10) return "acelerando";
  if (args.pct < expected - 10) return "abaixo do esperado";
  return "normal";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const token = typeof body?.client_token === "string" ? body.client_token.trim() : "";
    if (!token || token.length < 6) {
      return jr({ ok: false, error: "client_token obrigatório" }, 400);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false },
    });

    const { data: deal, error: dealErr } = await admin
      .from("curator_deals")
      .select(
        "id, song_name, song_artist, song_cover_url, target_plays, daily_goal, baseline_plays, started_at, ends_at, created_at, closed_at, state",
      )
      .eq("client_token", token)
      .maybeSingle();

    if (dealErr) return jr({ ok: false, error: dealErr.message }, 200);
    if (!deal) return jr({ ok: false, error: "not_found" }, 404);

    const [{ data: playlists }, { data: progress }, { data: history }] = await Promise.all([
      admin
        .from("curator_playlists")
        .select(
          "id, playlist_name, image_url, added_at, added_at_spotify, is_baseline",
        )
        .eq("deal_id", deal.id)
        .eq("match_status", "curator")
        .eq("is_baseline", false)
        .order("added_at", { ascending: true }),
      admin.rpc("get_curator_deal_progress", { p_deal_id: deal.id }),
      admin.rpc("get_curator_deal_snapshot_history", { p_deal_id: deal.id }),
    ]);

    const prog = (progress ?? {}) as AnyRec;
    const perPlaylist = ((prog.per_playlist as AnyRec[]) ?? []) as AnyRec[];
    const target = Number(prog.target_plays ?? deal.target_plays ?? 0);
    const delivered = Number(prog.delivered_curator ?? 0);
    const pct = Math.max(0, Math.min(100, Number(prog.progress_pct ?? 0)));

    // crescimento últimos 7 dias a partir do snapshot_history
    const histArr = (history ?? []) as AnyRec[];
    const now = Date.now();
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
    const recent = histArr.filter((h) =>
      new Date(String(h.captured_at)).getTime() >= sevenDaysAgo
    );
    let last7Growth = 0;
    if (recent.length >= 2) {
      const first = Number(recent[0].total_plays ?? 0);
      const last = Number(recent[recent.length - 1].total_plays ?? 0);
      last7Growth = Math.max(0, last - first);
    } else if (histArr.length >= 2) {
      const last = Number(histArr[histArr.length - 1].total_plays ?? 0);
      const prev = Number(histArr[histArr.length - 2].total_plays ?? 0);
      last7Growth = Math.max(0, last - prev);
    }
    const last7Pct = delivered - last7Growth > 0
      ? Math.round((last7Growth / Math.max(1, delivered - last7Growth)) * 100)
      : 0;

    // série diária sanitizada (apenas data + delivered acumulado)
    const baseline = Number(prog.baseline_total ?? deal.baseline_plays ?? 0);
    const series = histArr.map((h) => ({
      date: String(h.captured_at),
      delivered: Math.max(0, Number(h.total_plays ?? 0) - baseline),
    }));

    // mapa playlist_id -> delivered
    const deliveredByPlaylist = new Map<string, number>();
    for (const p of perPlaylist) {
      deliveredByPlaylist.set(String(p.playlist_id), Number(p.delivered ?? 0));
    }

    // playlists sanitizadas — sem owner, sem score, sem match
    const safePlaylists = ((playlists ?? []) as AnyRec[]).map((p) => {
      const grown = deliveredByPlaylist.get(String(p.id)) ?? 0;
      return {
        name: String(p.playlist_name ?? "Playlist"),
        image_url: (p.image_url as string) ?? null,
        delivered: grown,
        status: pickPlaylistStatus(p, grown),
      };
    });

    const startedAt = (deal.started_at as string) ?? (deal.created_at as string);
    const endsAt = deal.ends_at as string | null;
    const daysElapsed = Number(prog.days_elapsed ?? 0);
    const targetDays = endsAt && startedAt
      ? Math.max(
        1,
        Math.round(
          (new Date(endsAt).getTime() - new Date(startedAt).getTime()) /
            (1000 * 60 * 60 * 24),
        ),
      )
      : 30;

    const status = campaignStatus({
      pct,
      closedAt: deal.closed_at as string | null,
      recent7Growth: last7Growth,
    });

    const safeDeal = {
      campaign_name: `${deal.song_name}${deal.song_artist ? " — " + deal.song_artist : ""}`,
      song_name: deal.song_name,
      song_artist: deal.song_artist,
      song_cover_url: deal.song_cover_url,
      started_at: startedAt,
      ends_at: endsAt,
      last_update: prog.last_capture_at ?? null,
      status,
    };

    return jr({
      ok: true,
      deal: safeDeal,
      progress: {
        delivered,
        target,
        pct,
        last7_growth: last7Growth,
        last7_pct: last7Pct,
        days_elapsed: daysElapsed,
        target_days: targetDays,
        pace: pace({ pct, daysElapsed, targetDays }),
      },
      series,
      playlists: safePlaylists,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return jr({ ok: false, error: msg }, 200);
  }
});
