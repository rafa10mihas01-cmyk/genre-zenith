// get-client-campaign-public — payload PÚBLICO e SANITIZADO para o CLIENTE
// Acessado via /campanha/:client_token. O token pode ser:
//   1) curator_deal_songs.client_token  → token POR MÚSICA (novo padrão)
//   2) curator_deals.client_token        → token do deal inteiro (legado)
//
// Quando token é por música, retornamos:
//   - dados da música selecionada
//   - lista de "siblings" (outras músicas do MESMO deal pertencentes ao
//     MESMO cliente) com seus próprios client_tokens para o seletor
//   - smartlink_url da música (Linkfire/ToneDen) se cadastrado
//
// Privacidade — nunca expõe: curator_name, owner_id, public_token,
// match_status/score, custos, CPP, ledger, IDs internos sensíveis.
import { corsHeaders } from "npm:@supabase/supabase-js/cors";
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

  // Rate limit: 120 req/min por IP.
  const ip = clientIp(req);
  const rl = await checkRateLimit(`get-client-campaign-public:${ip}`, 60, 120);
  if (!rl.allowed) return rateLimitResponse(corsHeaders);

  try {
    const body = await req.json().catch(() => ({}));
    const token = typeof body?.client_token === "string" ? body.client_token.trim() : "";
    if (!token || token.length < 6) {
      return jr({ ok: false, error: "client_token obrigatório" }, 400);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false },
    });

    // 1) Tenta resolver como token/slug POR MÚSICA primeiro.
    // Aceita tanto client_token (hex) quanto slug amigável.
    const looksLikeToken = /^[a-f0-9]{20,}$/i.test(token);
    let songQuery = admin
      .from("curator_deal_songs")
      .select(
        "id, deal_id, song_name, song_artist, song_cover_url, target_plays, daily_goal, baseline_plays, started_at, ends_at, smartlink_url, client_id, client_token, slug",
      );
    songQuery = looksLikeToken
      ? songQuery.eq("client_token", token)
      : songQuery.eq("slug", token);
    let { data: songRow } = await songQuery.maybeSingle();

    // Fallback: se não achou por slug, tenta como token mesmo assim
    if (!songRow && !looksLikeToken) {
      const { data: byToken } = await admin
        .from("curator_deal_songs")
        .select(
          "id, deal_id, song_name, song_artist, song_cover_url, target_plays, daily_goal, baseline_plays, started_at, ends_at, smartlink_url, client_id, client_token, slug",
        )
        .eq("client_token", token)
        .maybeSingle();
      songRow = byToken;
    }

    let dealId: string | null = null;
    let selectedSongId: string | null = null;
    let dealRow: AnyRec | null = null;

    if (songRow) {
      selectedSongId = String(songRow.id);
      dealId = String(songRow.deal_id);
    } else {
      // 2) Fallback legado: token do deal inteiro
      const { data: legacyDeal } = await admin
        .from("curator_deals")
        .select("id")
        .eq("client_token", token)
        .maybeSingle();
      if (!legacyDeal) return jr({ ok: false, error: "not_found" }, 404);
      dealId = String(legacyDeal.id);
    }

    const { data: deal, error: dealErr } = await admin
      .from("curator_deals")
      .select(
        "id, song_name, song_artist, song_cover_url, target_plays, daily_goal, baseline_plays, started_at, ends_at, created_at, closed_at, state",
      )
      .eq("id", dealId!)
      .maybeSingle();

    if (dealErr) return jr({ ok: false, error: dealErr.message }, 200);
    if (!deal) return jr({ ok: false, error: "not_found" }, 404);
    dealRow = deal as AnyRec;

    // Lista de músicas exibidas no seletor:
    //   - se token é por música com client_id → todas as músicas do deal
    //     que pertencem ao MESMO cliente
    //   - se token é por música sem client_id → apenas a própria música
    //   - se token legado do deal → todas as músicas do deal
    let siblingsQuery = admin
      .from("curator_deal_songs")
      .select(
        "id, song_name, song_artist, song_cover_url, smartlink_url, client_id, client_token, slug, position, target_plays, daily_goal, baseline_plays, started_at, ends_at",
      )
      .eq("deal_id", dealId!)
      .order("position", { ascending: true });

    if (songRow) {
      if (songRow.client_id) {
        siblingsQuery = siblingsQuery.eq("client_id", songRow.client_id);
      } else {
        siblingsQuery = siblingsQuery.eq("id", songRow.id);
      }
    }

    const { data: siblingsRaw } = await siblingsQuery;
    const siblings = (siblingsRaw ?? []) as AnyRec[];

    // Se não tem nenhuma música cadastrada (deal antigo sem songs),
    // simulamos uma "música única" a partir do próprio deal.
    const songsList = siblings.length > 0
      ? siblings.map((s) => ({
        id: String(s.id),
        // Prefere slug bonito; cai pro client_token quando indisponível.
        client_token: String(s.slug ?? s.client_token ?? ""),
        song_name: String(s.song_name ?? ""),
        song_artist: (s.song_artist as string | null) ?? null,
        song_cover_url: (s.song_cover_url as string | null) ?? null,
        smartlink_url: (s.smartlink_url as string | null) ?? null,
      }))
      : [
        {
          id: "deal",
          client_token: token,
          song_name: String(dealRow.song_name ?? ""),
          song_artist: (dealRow.song_artist as string | null) ?? null,
          song_cover_url: (dealRow.song_cover_url as string | null) ?? null,
          smartlink_url: null,
        },
      ];

    if (!selectedSongId && siblings.length > 0) {
      selectedSongId = String(siblings[0].id);
    }

    const activeSong = siblings.find((s) => String(s.id) === selectedSongId) ?? null;

    // 3) Progress da música (ou do deal inteiro se legado)
    const { data: progress } = await admin.rpc("get_curator_deal_progress", {
      p_deal_id: dealId!,
      ...(selectedSongId && activeSong ? { p_song_id: selectedSongId } : {}),
    });

    const prog = (progress ?? {}) as AnyRec;
    const target = Number(
      activeSong?.target_plays ?? prog.target_plays ?? dealRow.target_plays ?? 0,
    );
    const delivered = Number(prog.delivered_curator ?? 0);
    const pct = Math.max(0, Math.min(100, Number(prog.progress_pct ?? 0)));

    // 4) Histórico — filtra por song_id se aplicável
    let histQuery = admin
      .from("curator_deal_snapshots")
      .select("captured_at, plays, is_baseline, playlist_id")
      .eq("deal_id", dealId!)
      .order("captured_at", { ascending: true });
    if (selectedSongId && activeSong) {
      histQuery = histQuery.eq("song_id", selectedSongId);
    }
    const { data: snapshotsRaw } = await histQuery;

    // Agrupa snapshots por minuto (curator playlists only)
    const { data: curatorPlaylistRows } = await admin
      .from("curator_playlists")
      .select("id")
      .eq("deal_id", dealId!)
      .eq("match_status", "curator");
    const curatorPlIds = new Set(
      ((curatorPlaylistRows ?? []) as AnyRec[]).map((r) => String(r.id)),
    );

    const buckets = new Map<string, { captured_at: string; total_plays: number }>();
    for (const s of (snapshotsRaw ?? []) as AnyRec[]) {
      if (!curatorPlIds.has(String(s.playlist_id))) continue;
      const captured = new Date(String(s.captured_at));
      const bucketKey = `${captured.getFullYear()}-${captured.getMonth()}-${captured.getDate()}-${captured.getHours()}-${captured.getMinutes()}`;
      const cur = buckets.get(bucketKey);
      const plays = Number(s.plays ?? 0);
      if (cur) {
        cur.total_plays += plays;
      } else {
        buckets.set(bucketKey, {
          captured_at: captured.toISOString(),
          total_plays: plays,
        });
      }
    }
    const histArr = Array.from(buckets.values()).sort(
      (a, b) => new Date(a.captured_at).getTime() - new Date(b.captured_at).getTime(),
    );

    // crescimento últimos 7 dias
    const now = Date.now();
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
    const recent = histArr.filter((h) => new Date(h.captured_at).getTime() >= sevenDaysAgo);
    let last7Growth = 0;
    if (recent.length >= 2) {
      const first = recent[0].total_plays;
      const last = recent[recent.length - 1].total_plays;
      last7Growth = Math.max(0, last - first);
    } else if (histArr.length >= 2) {
      const last = histArr[histArr.length - 1].total_plays;
      const prev = histArr[histArr.length - 2].total_plays;
      last7Growth = Math.max(0, last - prev);
    }
    const last7Pct = delivered - last7Growth > 0
      ? Math.round((last7Growth / Math.max(1, delivered - last7Growth)) * 100)
      : 0;

    // série diária sanitizada
    const baseline = Number(
      activeSong?.baseline_plays ?? prog.baseline_total ?? dealRow.baseline_plays ?? 0,
    );
    const series = histArr.map((h) => ({
      date: h.captured_at,
      delivered: Math.max(0, h.total_plays - baseline),
    }));

    // 5) Playlists — filtra por song_id quando aplicável
    let playlistsQuery = admin
      .from("curator_playlists")
      .select("id, playlist_name, image_url, added_at, added_at_spotify, is_baseline, song_id")
      .eq("deal_id", dealId!)
      .eq("match_status", "curator")
      .eq("is_baseline", false)
      .order("added_at", { ascending: true });
    const { data: playlistsRaw } = await playlistsQuery;
    const playlistsFiltered = ((playlistsRaw ?? []) as AnyRec[]).filter((p) => {
      if (!selectedSongId || !activeSong) return true;
      const sid = p.song_id as string | null;
      return !sid || sid === selectedSongId;
    });

    const perPlaylist = ((prog.per_playlist as AnyRec[]) ?? []) as AnyRec[];
    const deliveredByPlaylist = new Map<string, number>();
    for (const p of perPlaylist) {
      deliveredByPlaylist.set(String(p.playlist_id), Number(p.delivered ?? 0));
    }

    const safePlaylists = playlistsFiltered.map((p) => {
      const grown = deliveredByPlaylist.get(String(p.id)) ?? 0;
      return {
        name: String(p.playlist_name ?? "Playlist"),
        image_url: (p.image_url as string) ?? null,
        delivered: grown,
        status: pickPlaylistStatus(p, grown),
      };
    });

    const startedAt = (activeSong?.started_at as string | null)
      ?? (dealRow.started_at as string)
      ?? (dealRow.created_at as string);
    const endsAt = (activeSong?.ends_at as string | null) ?? (dealRow.ends_at as string | null);
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
      closedAt: dealRow.closed_at as string | null,
      recent7Growth: last7Growth,
    });

    const songName = String(activeSong?.song_name ?? dealRow.song_name ?? "");
    const songArtist = (activeSong?.song_artist as string | null)
      ?? (dealRow.song_artist as string | null);
    const songCover = (activeSong?.song_cover_url as string | null)
      ?? (dealRow.song_cover_url as string | null);

    const safeDeal = {
      campaign_name: `${songName}${songArtist ? " — " + songArtist : ""}`,
      song_name: songName,
      song_artist: songArtist,
      song_cover_url: songCover,
      smartlink_url: (activeSong?.smartlink_url as string | null) ?? null,
      started_at: startedAt,
      ends_at: endsAt,
      last_update: prog.last_capture_at ?? null,
      status,
    };

    // 6) Histórico de prints (sanitizado — sem spotify_url, dono, followers, note)
    const { data: snapHistRaw } = await admin.rpc("get_curator_deal_snapshot_history", {
      p_deal_id: dealId!,
    });
    const snapHist = Array.isArray(snapHistRaw) ? snapHistRaw : [];
    const safeSnapshotHistory = (snapHist as AnyRec[]).map((entry) => ({
      captured_at: entry.captured_at,
      is_baseline: Boolean(entry.is_baseline),
      playlists_count: Number(entry.playlists_count ?? 0),
      total_plays: Number(entry.total_plays ?? 0),
      print_url: (entry.print_url as string | null) ?? null,
      print_urls: Array.isArray(entry.print_urls) ? entry.print_urls : [],
      playlists: Array.isArray(entry.playlists)
        ? (entry.playlists as AnyRec[]).map((pl) => ({
          playlist_id: String(pl.playlist_id ?? ""),
          playlist_name: (pl.playlist_name as string | null) ?? "Playlist",
          image_url: (pl.image_url as string | null) ?? null,
          plays: Number(pl.plays ?? 0),
        }))
        : [],
    }));

    return jr({
      ok: true,
      deal: safeDeal,
      selected_song_id: selectedSongId,
      songs: songsList,
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
      snapshot_history: safeSnapshotHistory,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return jr({ ok: false, error: msg }, 200);
  }
});
