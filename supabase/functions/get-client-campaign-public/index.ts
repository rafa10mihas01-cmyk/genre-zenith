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
import { gateCampaignAccess } from "../_shared/portal-auth.ts";

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
    const clientToken = typeof body?.client_token === "string" ? body.client_token.trim() : "";
    const publicPlanToken = typeof body?.public_plan_token === "string" ? body.public_plan_token.trim() : "";
    if ((!clientToken || clientToken.length < 6) && (!publicPlanToken || publicPlanToken.length < 16)) {
      return jr({ ok: false, error: "client_token obrigatório" }, 400);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false },
    });

    let dealId: string | null = null;
    let selectedSongId: string | null = null;
    let dealRow: AnyRec | null = null;
    let linkedCamp: AnyRec | null = null;
    let songRow: AnyRec | null = null;

    if (publicPlanToken) {
      const { data: campaignByToken } = await admin
        .from("campaigns")
        .select("id, deal_id, client_approved_at")
        .eq("public_plan_token", publicPlanToken)
        .maybeSingle();
      if (!campaignByToken?.deal_id) return jr({ ok: false, error: "not_found" }, 404);

      const gate = await gateCampaignAccess(req, admin, campaignByToken.id);
      if (!gate.ok) return jr({ ok: false, error: gate.error }, gate.status ?? 401);

      linkedCamp = campaignByToken as AnyRec;
      dealId = String(campaignByToken.deal_id);

      const { data: firstSong } = await admin
        .from("curator_deal_songs")
        .select(
          "id, deal_id, song_name, song_artist, song_cover_url, target_plays, daily_goal, baseline_plays, started_at, ends_at, smartlink_url, client_id, client_token, slug",
        )
        .eq("deal_id", dealId)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      songRow = (firstSong as AnyRec | null) ?? null;
      if (songRow) selectedSongId = String(songRow.id);
    } else {
      // 1) Tenta resolver como token/slug POR MÚSICA primeiro.
      // Aceita tanto client_token (hex) quanto slug amigável.
      const looksLikeToken = /^[a-f0-9]{20,}$/i.test(clientToken);
      let songQuery = admin
        .from("curator_deal_songs")
        .select(
          "id, deal_id, song_name, song_artist, song_cover_url, target_plays, daily_goal, baseline_plays, started_at, ends_at, smartlink_url, client_id, client_token, slug",
        );
      songQuery = looksLikeToken
        ? songQuery.eq("client_token", clientToken)
        : songQuery.eq("slug", clientToken);
      const { data: songByClientToken } = await songQuery.maybeSingle();
      songRow = (songByClientToken as AnyRec | null) ?? null;

      // Fallback: se não achou por slug, tenta como token mesmo assim
      if (!songRow && !looksLikeToken) {
        const { data: byToken } = await admin
          .from("curator_deal_songs")
          .select(
            "id, deal_id, song_name, song_artist, song_cover_url, target_plays, daily_goal, baseline_plays, started_at, ends_at, smartlink_url, client_id, client_token, slug",
          )
          .eq("client_token", clientToken)
          .maybeSingle();
        songRow = (byToken as AnyRec | null) ?? null;
      }

      if (songRow) {
        selectedSongId = String(songRow.id);
        dealId = String(songRow.deal_id);
      } else {
        // 2) Fallback legado: token do deal inteiro
        const { data: legacyDeal } = await admin
          .from("curator_deals")
          .select("id")
          .eq("client_token", clientToken)
          .maybeSingle();
        if (!legacyDeal) return jr({ ok: false, error: "not_found" }, 404);
        dealId = String(legacyDeal.id);
      }
    }

    const { data: deal, error: dealErr } = await admin
      .from("curator_deals")
      .select(
        "id, campaign_id, song_name, song_artist, song_cover_url, target_plays, daily_goal, baseline_plays, started_at, ends_at, created_at, closed_at, state, spotify_owner_id",
      )
      .eq("id", dealId!)
      .maybeSingle();

    if (dealErr) return jr({ ok: false, error: dealErr.message }, 200);
    if (!deal) return jr({ ok: false, error: "not_found" }, 404);
    dealRow = deal as AnyRec;

    // Gate por PIN — busca a campanha desse deal e exige JWT se necessário.
    if (!linkedCamp) {
      const { data: linkedCampByDeal } = await admin
        .from("campaigns")
        .select("id, client_approved_at")
        .eq("deal_id", dealId!)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      linkedCamp = (linkedCampByDeal as AnyRec | null) ?? null;
    }
    if (linkedCamp?.id && !publicPlanToken) {
      const gate = await gateCampaignAccess(req, admin, linkedCamp.id);
      if (!gate.ok) return jr({ ok: false, error: gate.error }, gate.status ?? 401);
    }
    const campaignApproved = Boolean(linkedCamp?.client_approved_at);


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
          client_token: clientToken || publicPlanToken,
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
    let delivered = Number(prog.delivered_curator ?? 0);
    let pct = Math.max(0, Math.min(100, Number(prog.progress_pct ?? 0)));

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
      // Separação operacional × observacional: hub público do cliente lê só curadoria entregue.
      .from("v_curator_playlists_operational")
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

    // 5) Playlists do curador — FONTE OFICIAL: vw_campaign_playlist_growth
    // (mesma usada pelo cockpit interno). O caminho antigo
    // (v_curator_playlists_operational + match_status='curator') ficava VAZIO
    // em campanhas onde a coleta veio 100% por importação/snapshot, porque
    // essas playlists não recebem match_status='curator' na view operacional —
    // a atribuição correta vive em vw_campaign_playlist_growth.attributed_to.
    const campaignIdsForDeals = new Set<string>();
    if (dealRow.campaign_id) campaignIdsForDeals.add(String(dealRow.campaign_id));
    {
      const { data: campsForDeals } = await admin
        .from("campaigns")
        .select("id, deal_id")
        .eq("deal_id", dealId!);
      for (const c of (campsForDeals ?? []) as AnyRec[]) {
        if (c.id) campaignIdsForDeals.add(String(c.id));
      }
    }

    type CuratorGrowthRow = {
      playlist_id: string;
      delivery_accumulated: number;
      last_import_delta: number | null;
      current_plays: number | null;
      current_name: string | null;
      baseline_name: string | null;
      baseline_at: string | null;
      first_seen_at: string | null;
      playlist_url: string | null;
    };
    const curatorGrowth: CuratorGrowthRow[] = [];
    if (campaignIdsForDeals.size > 0) {
      const { data: growthRows } = await admin
        .from("vw_campaign_playlist_growth")
        .select(
          "playlist_id, delivery_accumulated, last_import_delta, current_plays, current_name, baseline_name, baseline_at, first_seen_at, playlist_url, attributed_to",
        )
        .in("campaign_id", Array.from(campaignIdsForDeals))
        .like("attributed_to", "curator:%");
      const byPid = new Map<string, CuratorGrowthRow>();
      for (const g of (growthRows ?? []) as AnyRec[]) {
        const k = String(g.playlist_id ?? "");
        if (!k) continue;
        const prev = byPid.get(k);
        const inc: CuratorGrowthRow = {
          playlist_id: k,
          delivery_accumulated: Number(g.delivery_accumulated ?? 0),
          last_import_delta: g.last_import_delta == null ? null : Number(g.last_import_delta),
          current_plays: g.current_plays == null ? null : Number(g.current_plays),
          current_name: (g.current_name as string | null) ?? null,
          baseline_name: (g.baseline_name as string | null) ?? null,
          baseline_at: (g.baseline_at as string | null) ?? null,
          first_seen_at: (g.first_seen_at as string | null) ?? null,
          playlist_url: (g.playlist_url as string | null) ?? null,
        };
        if (!prev) {
          byPid.set(k, inc);
        } else {
          // mesmo playlist_id em campanhas diferentes do mesmo deal — soma.
          prev.delivery_accumulated += inc.delivery_accumulated;
          if (inc.last_import_delta != null) {
            prev.last_import_delta = (prev.last_import_delta ?? 0) + inc.last_import_delta;
          }
          if (inc.current_plays != null) {
            prev.current_plays = Math.max(prev.current_plays ?? 0, inc.current_plays);
          }
        }
      }
      curatorGrowth.push(...byPid.values());
    }

    // Enriquecimento de metadados (nome/cover) via curator_playlist_library.
    const spIds = curatorGrowth.map((c) => c.playlist_id);
    const libByPid = new Map<string, AnyRec>();
    if (spIds.length > 0) {
      const { data: libRows } = await admin
        .from("curator_playlist_library")
        .select("spotify_playlist_id, playlist_name, image_url")
        .in("spotify_playlist_id", spIds);
      for (const r of (libRows ?? []) as AnyRec[]) {
        libByPid.set(String(r.spotify_playlist_id), r);
      }
    }

    const safePlaylists: AnyRec[] = curatorGrowth.map((c) => {
      const lib = libByPid.get(c.playlist_id) ?? {};
      const ageDays = c.first_seen_at
        ? (Date.now() - new Date(c.first_seen_at).getTime()) / (1000 * 60 * 60 * 24)
        : 999;
      let status: "Nova" | "Crescendo" | "Destaque" | "Estável";
      if (ageDays <= 7) status = "Nova";
      else if (c.delivery_accumulated >= 5000) status = "Destaque";
      else if (c.delivery_accumulated >= 500) status = "Crescendo";
      else status = "Estável";
      return {
        name: String(
          (lib.playlist_name as string | undefined) ??
            c.current_name ??
            c.baseline_name ??
            "Playlist",
        ),
        image_url: (lib.image_url as string | null) ?? null,
        delivered: c.delivery_accumulated,
        last_import_delta: c.last_import_delta,
        plays_24h: null,
        plays_7d: c.current_plays,
        plays_28d: null,
        status,
        source: "curator" as const,
        spotify_playlist_id: c.playlist_id,
      };
    });


    // 5b) Playlists INTERNAS (NexEngine) — vindas de campaign_eco_allocations
    // ligadas à campanha deste deal. Sem isso, o cliente não enxergava as
    // playlists próprias onde a música foi inserida internamente.
    try {
      const { data: campRow } = await admin
        .from("campaigns")
        .select("id")
        .eq("deal_id", dealId!)
        .maybeSingle();
      const campaignId = (dealRow.campaign_id as string | undefined) ?? (campRow?.id as string | undefined);
      if (campaignId) {
        const { data: ecoAllocs } = await admin
          .from("campaign_eco_allocations")
          .select("managed_playlist_id, planned_streams, status, managed_playlists(name, cover_url, followers, spotify_playlist_id)")
          .eq("campaign_id", campaignId);
        const ecoSpotifyIds = (ecoAllocs ?? [])
          .map((a: AnyRec) => String(((a.managed_playlists as AnyRec) ?? {}).spotify_playlist_id ?? ""))
          .filter(Boolean);
        // P2.3 — Ecossistema também deve vir do Growth Engine oficial.
        // `campaign_eco_snapshots` é legado e está vazio para Carnívoro; por isso
        // o portal mostrava ENGINE zerado mesmo com entrega em vw_campaign_playlist_growth.
        const ecoGrowthBySpotifyId = new Map<string, { delivered: number; last_import_delta: number | null; current_plays: number | null }>();
        if (ecoSpotifyIds.length > 0) {
          const { data: ecoGrowth } = await admin
            .from("vw_campaign_playlist_growth")
            .select("playlist_id, delivery_accumulated, last_import_delta, current_plays, attributed_to")
            .eq("campaign_id", campaignId)
            .in("playlist_id", ecoSpotifyIds)
            .eq("attributed_to", "ecosystem");
          for (const g of (ecoGrowth ?? []) as AnyRec[]) {
            const k = String(g.playlist_id ?? "");
            if (!k) continue;
            ecoGrowthBySpotifyId.set(k, {
              delivered: Number(g.delivery_accumulated ?? 0),
              last_import_delta: g.last_import_delta == null ? null : Number(g.last_import_delta),
              current_plays: g.current_plays == null ? null : Number(g.current_plays),
            });
          }
        }
        for (const a of (ecoAllocs ?? []) as AnyRec[]) {
          const mp = (a.managed_playlists as AnyRec) ?? {};
          const spotifyId = String(mp.spotify_playlist_id ?? "");
          const growth = spotifyId ? ecoGrowthBySpotifyId.get(spotifyId) : undefined;
          const grown = growth?.delivered ?? 0;
          safePlaylists.push({
            name: String(mp.name ?? "Playlist Engine"),
            image_url: (mp.cover_url as string) ?? null,
            delivered: grown,
            last_import_delta: growth?.last_import_delta ?? null,
            plays_24h: null,
            plays_7d: growth?.current_plays ?? null,
            plays_28d: null,
            status: grown > 0 ? "Crescendo" : "Nova",
            source: "engine" as const,
            planned: Number(a.planned_streams ?? 0),
            spotify_playlist_id: spotifyId || null,
          });
        }

      }
    } catch (_) { /* não bloqueia o portal se isso falhar */ }

    // Recalcula delivered/pct a partir do Growth Engine (curador + ecossistema).
    // get_curator_deal_progress.delivered_curator ainda retorna 0 em campanhas
    // novas onde a coleta veio só por importação, causando KPI zerado no portal.
    const deliveredFromPlaylists = safePlaylists.reduce(
      (s, p) => s + Number((p as AnyRec).delivered ?? 0),
      0,
    );
    if (deliveredFromPlaylists > delivered) {
      delivered = deliveredFromPlaylists;
      pct = target > 0
        ? Math.max(0, Math.min(100, Math.round((delivered / target) * 100)))
        : 0;
    }


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

    // 7) Status do upload de planilha (só importa se NÃO tem Spotify conectado)
    const hasSpotify = Boolean(dealRow.spotify_owner_id);
    let recentUploads: AnyRec[] = [];
    let lastSpreadsheetUploadAt: string | null = null;
    if (!hasSpotify) {
      const { data: uploads } = await admin
        .from("label_spreadsheet_uploads")
        .select("id, created_at, rows_imported, total_streams, status, file_name")
        .eq("deal_id", dealId!)
        .order("created_at", { ascending: false })
        .limit(5);
      recentUploads = (uploads ?? []) as AnyRec[];
      lastSpreadsheetUploadAt = recentUploads[0]?.created_at ?? null;
    }

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
      spreadsheet_source: !hasSpotify,
      campaign_approved: campaignApproved,
      last_spreadsheet_upload_at: lastSpreadsheetUploadAt,
      recent_uploads: recentUploads,
    });

  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return jr({ ok: false, error: msg }, 200);
  }
});
