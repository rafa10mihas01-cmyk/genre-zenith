// get-curator-deal-public — retorna dados públicos de um deal de curador
// a partir do public_token (sem expor user_id). Usado pela página pública
// que o curador acessa para ver a meta e cadastrar playlists.
// Sem auth (rota pública). Service role para ignorar RLS.
//
// FASE 13.0 — Fonte canônica de leitura: campaign_playlist_collections (CPC)
// via fn_campaign_playlist_growth. curator_deal_snapshots permanece como
// fallback de compatibilidade para deals antigos pré-CPC.
import { corsHeaders as baseCorsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { assertDealOperable } from "../_shared/deal-access.ts";
import { checkRateLimit, clientIp, rateLimitResponse } from "../_shared/rate-limit.ts";
import { gateCuratorAccess } from "../_shared/portal-auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  ...baseCorsHeaders,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-retry-count, x-portal-jwt",
};

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function spotifyTrackId(input: unknown): string | null {
  const raw = String(input ?? "").trim();
  if (!raw) return null;
  const m = raw.match(/track\/([A-Za-z0-9]{16,})/);
  if (m?.[1]) return m[1];
  return /^[A-Za-z0-9]{16,}$/.test(raw) ? raw : null;
}

function normText(input: unknown): string {
  return String(input ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Rate limit: 120 req/min por IP.
  const ip = clientIp(req);
  const rl = await checkRateLimit(`get-curator-deal-public:${ip}`, 60, 120);
  if (!rl.allowed) return rateLimitResponse(corsHeaders);

  try {
    const body = await req.json().catch(() => ({}));
    const token = typeof body?.public_token === "string" ? body.public_token.trim() : "";
    const slug = typeof body?.slug === "string" ? body.slug.trim() : "";

    if (!token && !slug) {
      return jr({ ok: false, error: "public_token ou slug obrigatório" }, 400);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false },
    });

    // Aceita slug (preferencial) ou token (compatibilidade com links antigos).
    const looksLikeToken = (v: string) => /^[a-f0-9]{20,}$/i.test(v);
    let query = admin
      .from("curator_deals")
      .select(
        "id, curator_id, curator_name, song_spotify_url, song_name, song_artist, song_cover_url, target_plays, daily_goal, baseline_plays, cost, started_at, ends_at, public_token, slug, created_at, spotify_owner_id, spotify_owner_url, state, closed_at, closed_status, token_revoked_at, token_expires_at, campaign_id, source",
      );

    if (token) {
      query = query.eq("public_token", token);
    } else if (looksLikeToken(slug)) {
      query = query.eq("public_token", slug);
    } else {
      query = query.eq("slug", slug);
    }

    const { data: deal, error: dealErr } = await query.maybeSingle();

    if (dealErr) return jr({ ok: false, error: dealErr.message }, 200);
    if (!deal) return jr({ ok: false, error: "not found" }, 200);

    // Hardening 4.B.1.B: TTL + revogação. Só aplica quando a requisição
    // veio por token público (e não por slug amigável sem token).
    if (token) {
      if ((deal as { token_revoked_at?: string | null }).token_revoked_at) {
        return jr({ ok: false, error: "token_revoked" }, 410);
      }
      const _exp = (deal as { token_expires_at?: string | null }).token_expires_at;
      if (_exp && new Date(_exp).getTime() < Date.now()) {
        return jr({ ok: false, error: "token_expired" }, 410);
      }
    }

    // Hardening 4.B.1.A (Onda 1 — curador): exige OTP quando deal tem allowlist
    // OU o curador ligado tem e-mail. Sem allowlist mantém compat legada.
    const expectedGateToken = token || slug || deal.public_token || undefined;
    const gate = await gateCuratorAccess(
      req,
      admin,
      deal.id,
      deal.curator_id ?? null,
      expectedGateToken,
    );
    if (!gate.ok) {
      return jr({ ok: false, error: gate.error ?? "forbidden", required_otp: true }, gate.status ?? 401);
    }

    // Uploads/planilhas de campanha podem ser gravados no deal espelho da
    // campanha (ex.: Plug Music) enquanto este portal pertence ao curador real
    // (ex.: Manolo). Para o portal não ficar cego, lemos arquivos dos deals da
    // mesma campanha e da mesma música, sem criar dado novo.
    const uploadDealIds = new Set<string>([deal.id]);
    if ((deal as any).campaign_id) {
      try {
        const thisTrack = spotifyTrackId((deal as any).song_spotify_url);
        const thisName = normText((deal as any).song_name);
        const { data: siblingDeals } = await admin
          .from("curator_deals")
          .select("id, song_name, song_spotify_url")
          .eq("campaign_id", (deal as any).campaign_id);
        for (const sibling of (siblingDeals ?? []) as Array<{ id: string; song_name: string | null; song_spotify_url: string | null }>) {
          const siblingTrack = spotifyTrackId(sibling.song_spotify_url);
          const sameTrack = thisTrack && siblingTrack && thisTrack === siblingTrack;
          const sameName = thisName && normText(sibling.song_name) === thisName;
          if (sameTrack || sameName) uploadDealIds.add(sibling.id);
        }
      } catch (_e) { /* best-effort */ }
    }

    // Dados base + RPCs de progresso e histórico.
    const [
      { data: playlists, error: plErr },
      { data: songs, error: songsErr },
      { data: progressRpc, error: progressErr },
      { data: historyRpc, error: historyErr },
      { data: latestSnaps, error: snapsErr },
      { data: allSnaps, error: allSnapsErr },
      { data: proofs, error: proofsErr },
      { data: uploads, error: uploadsErr },
      { data: botBatches, error: botBatchesErr },
    ] = await Promise.all([
      admin
        // Separação operacional × observacional: hub público do curador só vê entregas reais.
        .from("v_curator_playlists_operational")
        .select(
          "id, deal_id, song_id, spotify_url, playlist_name, followers, is_initial_roster, added_at, spotify_playlist_id, spotify_owner_id, spotify_owner_name, image_url, added_at_spotify, match_status, match_reason, last_paste_at, streams_7d, streams_28d, streams_total",
        )
        .eq("deal_id", deal.id)
        .or("match_status.eq.curator,is_initial_roster.eq.true")
        // Fase 7.3 P2 — ordenação por entrega (streams_7d desc) substitui added_at.
        .order("streams_7d", { ascending: false, nullsFirst: false })
        .order("added_at", { ascending: true }),
      admin
        .from("curator_deal_songs")
        .select(
          "id, deal_id, song_spotify_url, spotify_track_id, song_name, song_artist, song_cover_url, daily_goal, target_plays, baseline_plays, position, started_at, ends_at, ramp_up_days, created_at",
        )
        .eq("deal_id", deal.id)
        .order("position", { ascending: true }),
      admin.rpc("get_curator_deal_progress", { p_deal_id: deal.id }),
      admin.rpc("get_curator_deal_snapshot_history", { p_deal_id: deal.id }),
      admin
        .from("curator_deal_snapshots")
        .select("playlist_id, captured_at, plays_24h, plays_7d, plays_28d, is_initial_capture")
        .eq("deal_id", deal.id)
        .eq("is_initial_capture", false)
        .order("captured_at", { ascending: false }),
      // Fase 7.3 P3 — todos os snapshots (incl. baseline) p/ delivery acumulado por playlist.
      admin
        .from("curator_deal_snapshots")
        .select("playlist_id, captured_at, plays, plays_7d, is_initial_capture, print_url, source, match_method")
        .eq("deal_id", deal.id)
        .order("captured_at", { ascending: true }),
      // Fase 7.3 P4 — galeria de prints (delivery_proofs).
      admin
        .from("delivery_proofs")
        .select("id, playlist_id, spotify_playlist_id, playlist_name, screenshot_url, position_in_playlist, plays_total, plays_7d, captured_at, bot_correlation_id, source")
        .eq("deal_id", deal.id)
        .order("captured_at", { ascending: false })
        .limit(500),
      // Fase 7.3 P5 — histórico de Excel (uploads).
      admin
        .from("label_spreadsheet_uploads")
        .select("id, file_name, file_path, content_hash, rows_imported, total_streams, reference_date, created_at, is_baseline, upload_mode, superseded_by, superseded_at, window_kind, window_days, quarantined_at, quarantine_reason, status, uploaded_via")
        .in("deal_id", Array.from(uploadDealIds))
        .order("reference_date", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false }),
    ]);


    // Erros críticos (sem playlists/songs a página não tem o que mostrar) ainda quebram.
    if (plErr) return jr({ ok: false, error: plErr.message }, 200);
    if (songsErr) return jr({ ok: false, error: songsErr.message }, 200);
    // Erros de progresso/histórico/snapshots são DEGRADAÇÃO GRACIOSA:
    // a página do curador continua abrindo (apenas sem números agregados de progresso).
    // Motivo: RPCs como get_curator_deal_progress podem estourar statement_timeout
    // quando a campanha tem muitas leituras em campaign_playlist_collections, e
    // bloquear o link inteiro por isso transforma uma lentidão em "link expirado".
    if (progressErr) console.error("[get-curator-deal-public] progress error (degraded):", progressErr.message);
    if (historyErr) console.error("[get-curator-deal-public] history error (degraded):", historyErr.message);
    if (snapsErr) console.error("[get-curator-deal-public] snaps error (degraded):", snapsErr.message);
    if (allSnapsErr) console.error("[get-curator-deal-public] allSnaps error (degraded):", allSnapsErr.message);
    if (proofsErr) console.error("[get-curator-deal-public] proofs error (degraded):", proofsErr.message);
    if (uploadsErr) console.error("[get-curator-deal-public] uploads error (degraded):", uploadsErr.message);

    // FASE 13.0 — perPlaylistDelivery por curator_playlists.id.
    // Inicial: derivado de curator_deal_snapshots (fallback de compatibilidade
    // para deals legados sem CPC). Sobrescrito abaixo com dados de
    // fn_campaign_playlist_growth (fonte canônica) quando disponível.
    const perPlaylistDelivery: Record<string, {
      baseline_plays: number | null;
      current_plays: number | null;
      delivery_accumulated: number;
      growth_pct: number | null;
      first_capture_at: string | null;
      last_capture_at: string | null;
      snapshot_count: number;
      last_print_url: string | null;
      source: "cpc" | "snapshots";
    }> = {};
    {
      const byPid = new Map<string, any[]>();
      for (const s of (allSnaps ?? []) as any[]) {
        if (!s.playlist_id) continue;
        const arr = byPid.get(s.playlist_id) ?? [];
        arr.push(s);
        byPid.set(s.playlist_id, arr);
      }
      for (const [pid, arr] of byPid) {
        arr.sort((a, b) => +new Date(a.captured_at) - +new Date(b.captured_at));
        const first = arr[0];
        const last = arr[arr.length - 1];
        const baseline = Number(first?.plays ?? 0);
        const current = Number(last?.plays ?? baseline);
        const delivery = Math.max(0, current - baseline);
        const growth = baseline > 0 ? (delivery / baseline) * 100 : null;
        const lastPrint = [...arr].reverse().find((x) => x.print_url)?.print_url ?? null;
        perPlaylistDelivery[pid] = {
          baseline_plays: baseline || null,
          current_plays: current || null,
          delivery_accumulated: delivery,
          growth_pct: growth,
          first_capture_at: first?.captured_at ?? null,
          last_capture_at: last?.captured_at ?? null,
          snapshot_count: arr.length,
          last_print_url: lastPrint,
          source: "snapshots",
        };
      }
    }

    // Fase 7.3 P4 — Galeria de prints unificada (delivery_proofs + snapshots).
    const playlistMetaByPid: Record<string, { name: string | null; image: string | null; spotify_url: string | null }> = {};
    for (const p of (playlists ?? []) as any[]) {
      playlistMetaByPid[p.id] = {
        name: p.playlist_name ?? null,
        image: p.image_url ?? null,
        spotify_url: p.spotify_url ?? null,
      };
    }
    const printsGallery: Array<{
      kind: "delivery_proof" | "snapshot";
      captured_at: string;
      playlist_id: string | null;
      playlist_name: string | null;
      playlist_image: string | null;
      screenshot_url: string;
      position: number | null;
      bot: string | null;
      source: string | null;
    }> = [];
    for (const p of (proofs ?? []) as any[]) {
      if (!p.screenshot_url) continue;
      const meta = p.playlist_id ? playlistMetaByPid[p.playlist_id] : null;
      printsGallery.push({
        kind: "delivery_proof",
        captured_at: p.captured_at,
        playlist_id: p.playlist_id ?? null,
        playlist_name: meta?.name ?? p.playlist_name ?? null,
        playlist_image: meta?.image ?? null,
        screenshot_url: p.screenshot_url,
        position: p.position_in_playlist ?? null,
        bot: p.bot_correlation_id ?? null,
        source: p.source ?? null,
      });
    }
    for (const s of (allSnaps ?? []) as any[]) {
      if (!s.print_url) continue;
      const meta = s.playlist_id ? playlistMetaByPid[s.playlist_id] : null;
      printsGallery.push({
        kind: "snapshot",
        captured_at: s.captured_at,
        playlist_id: s.playlist_id ?? null,
        playlist_name: meta?.name ?? null,
        playlist_image: meta?.image ?? null,
        screenshot_url: s.print_url,
        position: null,
        bot: s.match_method ?? null,
        source: s.source ?? null,
      });
    }
    printsGallery.sort((a, b) => +new Date(b.captured_at) - +new Date(a.captured_at));

    // Fase 7.3 P5 — Lista de uploads com signed URL (1h TTL).
    const uploadsWithUrls: Array<{
      id: string;
      file_name: string;
      reference_date: string | null;
      created_at: string;
      rows_imported: number | null;
      total_streams: number | null;
      is_baseline: boolean;
      upload_mode: string | null;
      window_kind: string | null;
      window_days: number | null;
      status: string | null;
      superseded: boolean;
      superseded_at: string | null;
      quarantined: boolean;
      download_url: string | null;
    }> = [];
    for (const u of (uploads ?? []) as any[]) {
      let url: string | null = null;
      try {
        if (u.file_path) {
          const { data: signed } = await admin.storage
            .from("label-spreadsheets")
            .createSignedUrl(u.file_path, 3600);
          url = signed?.signedUrl ?? null;
        }
      } catch (_e) { /* best-effort */ }
      uploadsWithUrls.push({
        id: u.id,
        file_name: u.file_name,
        reference_date: u.reference_date ?? null,
        created_at: u.created_at,
        rows_imported: u.rows_imported ?? null,
        total_streams: u.total_streams ?? null,
        is_baseline: !!u.is_baseline,
        upload_mode: u.upload_mode ?? null,
        window_kind: u.window_kind ?? null,
        window_days: u.window_days ?? null,
        status: u.status ?? null,
        superseded: !!u.superseded_by,
        superseded_at: u.superseded_at ?? null,
        quarantined: !!u.quarantined_at,
        download_url: url,
      });
    }



    // Último snapshot por playlist (já vem ordenado desc).
    const latestByPlaylist: Record<string, { plays_24h: number | null; plays_7d: number | null; plays_28d: number | null; captured_at: string }> = {};
    for (const s of (latestSnaps ?? []) as any[]) {
      if (!s.playlist_id) continue;
      if (!latestByPlaylist[s.playlist_id]) {
        latestByPlaylist[s.playlist_id] = {
          plays_24h: s.plays_24h ?? null,
          plays_7d: s.plays_7d ?? null,
          plays_28d: s.plays_28d ?? null,
          captured_at: s.captured_at,
        };
      }
    }

    // Fallback essencial para o portal do curador: o Growth Engine é a fonte
    // por spotify_playlist_id quando o snapshot do DEL não carrega janelas.
    // Deals legados podem não ter campaign_id; nesses casos resolvemos a
    // campanha pela música para não deixar a lista com "—".
    let growthCampaignId = ((deal as any).campaign_id as string | null) ?? null;
    if (!growthCampaignId) {
      try {
        const trackUrl = ((deal as any).song_spotify_url ?? "").trim();
        if (trackUrl) {
          const { data: campByTrack } = await admin
            .from("campaigns")
            .select("id")
            .eq("spotify_track_url", trackUrl)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          growthCampaignId = (campByTrack as any)?.id ?? null;
        }
        if (!growthCampaignId && (deal as any).song_name) {
          const { data: campByName } = await admin
            .from("campaigns")
            .select("id")
            .eq("track_name", (deal as any).song_name)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          growthCampaignId = (campByName as any)?.id ?? null;
        }
      } catch (_e) { /* best-effort */ }
    }

    const growthBySpotifyPlaylist: Record<string, { plays_7d: number | null; plays_28d: number | null }> = {};
    const curatorGrowthRows: Array<{
      playlist_id: string | null;
      current_name: string | null;
      baseline_plays: number | null;
      current_plays: number | null;
      delivery_accumulated: number | null;
      delta: number | null;
      baseline_at: string | null;
      last_captured_at: string | null;
    }> = [];
    if (growthCampaignId) {
      try {
        const attributedTo = (deal as any).curator_id ? `curator:${(deal as any).curator_id}` : null;
        if (attributedTo) {
          const { data: rpcRows } = await admin
            .rpc("fn_campaign_playlist_growth", { p_campaign_ids: [growthCampaignId] });
          const attributedRows = ((rpcRows ?? []) as any[]).filter(
            (r) => r.attributed_to === attributedTo,
          );
          curatorGrowthRows.push(...attributedRows);
        }

        const playlistIds = Array.from(
          new Set(
            ((playlists ?? []) as any[])
              .map((p) => (p.spotify_playlist_id ?? "").trim())
              .filter(Boolean),
          ),
        );
        if (playlistIds.length > 0) {
          const { data: rpcRows } = await admin
            .rpc("fn_campaign_playlist_growth", { p_campaign_ids: [growthCampaignId] });
          const wanted = new Set(playlistIds);
          const growthRows = ((rpcRows ?? []) as any[]).filter(
            (r) => r.playlist_id && wanted.has(String(r.playlist_id).trim()),
          );
          for (const r of growthRows as Array<{ playlist_id: string | null; current_plays: number | null; delivery_accumulated: number | null; delta: number | null }>) {
            const pid = (r.playlist_id ?? "").trim();
            if (!pid) continue;
            const plays7d = r.current_plays ?? r.delivery_accumulated ?? r.delta ?? null;
            const plays28d = r.delivery_accumulated ?? r.delta ?? r.current_plays ?? null;
            const prev = growthBySpotifyPlaylist[pid];
            growthBySpotifyPlaylist[pid] = {
              plays_7d: plays7d == null ? (prev?.plays_7d ?? null) : Math.max(Number(prev?.plays_7d ?? 0), Number(plays7d)),
              plays_28d: plays28d == null ? (prev?.plays_28d ?? null) : Math.max(Number(prev?.plays_28d ?? 0), Number(plays28d)),
            };
          }
        }

      } catch (_e) { /* best-effort */ }
    }

    // FASE 13.0 — CPC override em perPlaylistDelivery + has_baseline.
    // fn_campaign_playlist_growth (curatorGrowthRows) é a fonte canônica.
    // Mapeamos spotify_playlist_id → curator_playlists.id usando `playlists`.
    {
      const spotifyToCuratorPid = new Map<string, string>();
      for (const p of (playlists ?? []) as any[]) {
        const spid = String(p.spotify_playlist_id ?? "").trim();
        if (spid && p.id) spotifyToCuratorPid.set(spid, String(p.id));
      }
      for (const row of curatorGrowthRows) {
        const spid = String(row.playlist_id ?? "").trim();
        const pid = spid ? spotifyToCuratorPid.get(spid) : undefined;
        if (!pid) continue;
        const baseline = Number(row.baseline_plays ?? 0);
        const current = Number(row.current_plays ?? baseline);
        const delivery = Math.max(0, Number(row.delivery_accumulated ?? row.delta ?? 0));
        const growth = baseline > 0 ? (delivery / baseline) * 100 : null;
        perPlaylistDelivery[pid] = {
          baseline_plays: baseline || null,
          current_plays: current || null,
          delivery_accumulated: delivery,
          growth_pct: growth,
          first_capture_at: row.baseline_at ?? null,
          last_capture_at: row.last_captured_at ?? null,
          snapshot_count: 1,
          last_print_url: perPlaylistDelivery[pid]?.last_print_url ?? null,
          source: "cpc",
        };
      }
    }

    // FASE 13.0 — has_baseline server-side (ordem oficial):
    //   1) qualquer playlist do curador tem baseline_at na CPC
    //   2) há delivery_accumulated > 0 (correções retroativas)
    //   3) fallback: existem snapshots
    const hasBaselineFromCpc = curatorGrowthRows.some((r) => !!r.baseline_at);
    const hasDeliveryFromCpc = curatorGrowthRows.some(
      (r) => Number(r.delivery_accumulated ?? r.delta ?? 0) > 0,
    );
    const hasSnapshotFallback = ((allSnaps ?? []) as any[]).length > 0;
    const has_baseline = hasBaselineFromCpc || hasDeliveryFromCpc || hasSnapshotFallback;


    const progressWithGrowth = (() => {
      if (curatorGrowthRows.length === 0) return progressRpc ?? null;

      const delivered = curatorGrowthRows.reduce(
        (sum, row) => sum + Math.max(0, Number(row.delta ?? row.delivery_accumulated ?? 0)),
        0,
      );
      const currentProgress = (progressRpc ?? {}) as Record<string, any>;
      const currentDelivered = Number(currentProgress.delivered_curator ?? 0);
      if (delivered <= currentDelivered) return progressRpc ?? null;

      const target = Number(currentProgress.target_plays ?? (deal as any).target_plays ?? 0);
      const dailyGoal = Number(currentProgress.daily_goal ?? (deal as any).daily_goal ?? 0);
      const baselineTotal = curatorGrowthRows.reduce((sum, row) => sum + Math.max(0, Number(row.baseline_plays ?? 0)), 0);
      const latestTotal = curatorGrowthRows.reduce((sum, row) => sum + Math.max(0, Number(row.current_plays ?? 0)), 0);
      const captures = curatorGrowthRows
        .flatMap((row) => [row.baseline_at, row.last_captured_at])
        .filter((v): v is string => !!v)
        .sort((a, b) => +new Date(a) - +new Date(b));
      const startedAt = (deal as any).started_at ?? (deal as any).created_at ?? captures[0] ?? null;
      const daysElapsed = startedAt
        ? Math.max(1, Math.floor((Date.now() - +new Date(startedAt)) / 86400000))
        : Number(currentProgress.days_elapsed ?? 0);

      return {
        ...currentProgress,
        deal_id: (deal as any).id,
        target_plays: target,
        daily_goal: dailyGoal,
        baseline_total: baselineTotal,
        latest_total: latestTotal,
        delivered_curator: delivered,
        delivered_total: delivered,
        first_capture_at: captures[0] ?? currentProgress.first_capture_at ?? null,
        last_capture_at: captures[captures.length - 1] ?? currentProgress.last_capture_at ?? null,
        days_elapsed: daysElapsed,
        daily_avg: daysElapsed > 0 ? Math.round(delivered / daysElapsed) : Number(currentProgress.daily_avg ?? 0),
        progress_pct: target > 0 ? Math.min(100, Math.round((delivered / target) * 1000) / 10) : 0,
        eta_days: dailyGoal > 0 && delivered < target ? Math.ceil((target - delivered) / dailyGoal) : null,
        per_playlist: curatorGrowthRows.map((row) => ({
          playlist_id: row.playlist_id ?? "",
          playlist_name: row.current_name ?? null,
          is_initial_roster: false,
          baseline_plays: row.baseline_plays ?? null,
          latest_plays: row.current_plays ?? null,
          delivered: Math.max(0, Number(row.delta ?? row.delivery_accumulated ?? 0)),
          last_captured_at: row.last_captured_at ?? null,
          snapshot_count: 1,
          attribution_method: "campaign_growth",
        })).filter((row) => row.playlist_id),
      };
    })();

    // Gate informativo: leitura segue permitida (curador vê o histórico),
    // mas o frontend usa esse flag pra desabilitar mutações.
    const operable = assertDealOperable(deal as any);
    const access = operable.ok
      ? { writable: true }
      : { writable: false, code: operable.code, reason: operable.error };

    // Campaign shadow context: quando o deal é shadow de uma campanha,
    // o portal precisa saber se a baseline já foi capturada antes de aceitar
    // cadastros de playlist (sistema de identidade por playlist_id).
    let campaign_context: {
      is_campaign_shadow: boolean;
      campaign_id: string | null;
      baseline_status: string | null;
      baseline_captured_at: string | null;
      baseline_reference_date: string | null;
      baseline_playlist_count: number;
    } = {
      is_campaign_shadow: false,
      campaign_id: null,
      baseline_status: null,
      baseline_captured_at: null,
      baseline_reference_date: null,
      baseline_playlist_count: 0,
    };
    if ((deal as any).source === "campaign_internal" && (deal as any).campaign_id) {
      const campaignId = (deal as any).campaign_id as string;
      const { data: camp } = await admin
        .from("campaigns")
        .select("baseline_status, baseline_captured_at, baseline_reference_date")
        .eq("id", campaignId)
        .maybeSingle();
      const { count: baselineCount } = await admin
        .from("campaign_playlist_collections")
        .select("playlist_id", { count: "exact", head: true })
        .eq("campaign_id", campaignId)
        .eq("is_baseline", true);
      campaign_context = {
        is_campaign_shadow: true,
        campaign_id: campaignId,
        baseline_status: (camp as any)?.baseline_status ?? null,
        baseline_captured_at: (camp as any)?.baseline_captured_at ?? null,
        baseline_reference_date: (camp as any)?.baseline_reference_date ?? null,
        baseline_playlist_count: baselineCount ?? 0,
      };
    }

    // ====== Submissões do curador na camada de campanha (CCP) ======
    // Resumo + lista de conflitos de baseline para esta dupla deal/campanha.
    // Nunca quebra a resposta — se a tabela/colunas não existirem, devolve vazio.
    let curator_submissions: {
      total: number;
      valid: number;
      baseline_conflict: number;
      pending_substitution: number;
      resolved: number;
    } = { total: 0, valid: 0, baseline_conflict: 0, pending_substitution: 0, resolved: 0 };
    let baseline_conflicts: Array<{
      playlist_id: string;
      playlist_url: string;
      playlist_name: string | null;
      registered_at: string | null;
      baseline_conflict_at: string | null;
      baseline_captured_at: string | null;
      baseline_reference_date: string | null;
      baseline_plays_7d: number | null;
      reason: string;
      resolved: boolean;
    }> = [];

    if (growthCampaignId) {
      const campaignId = (deal as any).campaign_id as string;
      try {
        const { data: ccpRows } = await admin
          .from("curator_campaign_playlists")
          .select(
            "playlist_id, playlist_url, status, registered_at, matched_at, baseline_conflict_at",
          )
          .eq("deal_id", (deal as any).id);

        const rows = (ccpRows ?? []) as Array<any>;
        const total = rows.length;
        const valid = rows.filter((r) => r.status === "matched").length;
        const conflictRows = rows.filter((r) => r.status === "baseline_conflict");
        const conflictCount = conflictRows.length;

        // Enriquecer conflitos com dados da baseline (nome + plays_7d + captura)
        const conflictIds = conflictRows.map((r) => r.playlist_id);
        const baselineByPid: Record<string, any> = {};
        if (conflictIds.length > 0) {
          const { data: baseRows } = await admin
            .from("campaign_playlist_collections")
            .select("playlist_id, playlist_name_at_capture, plays_7d, captured_at, is_baseline")
            .eq("campaign_id", campaignId)
            .eq("is_baseline", true)
            .in("playlist_id", conflictIds);
          for (const b of (baseRows ?? []) as any[]) {
            baselineByPid[b.playlist_id] = b;
          }
        }

        // FASE 10.3 — usamos a data oficial da baseline da campanha (DATE imutável)
        // ao invés do timestamp técnico de cada coleta. campaign_context já carrega
        // baseline_reference_date.
        const campRefDate = campaign_context.baseline_reference_date;

        // "Resolvido" = curador registrou outra playlist (não-conflito) DEPOIS
        // do conflito, na mesma campanha/deal.
        const validSorted = rows
          .filter((r) => r.status === "matched" && r.registered_at)
          .map((r) => new Date(r.registered_at).getTime());

        baseline_conflicts = conflictRows.map((r) => {
          const base = baselineByPid[r.playlist_id] ?? null;
          const conflictAt = r.baseline_conflict_at
            ? new Date(r.baseline_conflict_at).getTime()
            : (r.registered_at ? new Date(r.registered_at).getTime() : 0);
          const resolved = validSorted.some((t) => t > conflictAt);
          return {
            playlist_id: r.playlist_id,
            playlist_url: r.playlist_url,
            playlist_name: base?.playlist_name_at_capture ?? null,
            registered_at: r.registered_at ?? null,
            baseline_conflict_at: r.baseline_conflict_at ?? null,
            baseline_captured_at: base?.captured_at ?? null,
            baseline_reference_date: campRefDate ?? null,
            baseline_plays_7d: typeof base?.plays_7d === "number" ? base.plays_7d : null,
            reason:
              "A música já estava nesta playlist antes do início da campanha. Conta como cenário pré-existente, não como entrega nova do curador.",
            resolved,
          };
        });

        const resolvedCount = baseline_conflicts.filter((c) => c.resolved).length;
        curator_submissions = {
          total,
          valid,
          baseline_conflict: conflictCount,
          pending_substitution: conflictCount - resolvedCount,
          resolved: resolvedCount,
        };
      } catch (_e) {
        // best-effort; mantém defaults
      }
    }


    // Histórico prévio: para cada playlist do curador, buscar baseline_plays
    // da view de crescimento da campanha. baseline_plays > 0 = música já tinha
    // atividade naquela playlist antes da campanha (não bloqueia, só sinaliza).
    const baselinePlaysByPid: Record<string, number> = {};
    if ((deal as any).campaign_id) {
      try {
        const playlistIds = Array.from(
          new Set(
            ((playlists ?? []) as any[])
              .map((p) => (p.spotify_playlist_id ?? "").trim())
              .filter(Boolean),
          ),
        );
        if (playlistIds.length > 0) {
          const { data: rpcRows } = await admin
            .rpc("fn_campaign_playlist_growth", { p_campaign_ids: [growthCampaignId] });
          const wanted = new Set(playlistIds);
          for (const r of (rpcRows ?? []) as Array<{ playlist_id: string | null; baseline_plays: number | null }>) {
            const pid = (r.playlist_id ?? "").trim();
            if (!pid || !wanted.has(pid)) continue;
            baselinePlaysByPid[pid] = Math.max(0, Number(r.baseline_plays ?? 0));
          }
        }

      } catch (_e) { /* best-effort */ }
    }

    // Fase 7.3 P7 — Timeline operacional do deal (só eventos de negócio).
    const timeline: Array<{ at: string; kind: string; label: string; detail?: string | null }> = [];
    if (deal.created_at) timeline.push({ at: deal.created_at, kind: "deal_created", label: "Deal criado" });
    const allSnapsArr = (allSnaps ?? []) as any[];
    const baselineSnap = allSnapsArr.find((s) => s.is_initial_capture);
    if (baselineSnap?.captured_at) timeline.push({ at: baselineSnap.captured_at, kind: "baseline", label: "Baseline capturada" });
    const firstCollect = allSnapsArr.find((s) => !s.is_initial_capture);
    if (firstCollect?.captured_at) timeline.push({ at: firstCollect.captured_at, kind: "first_collect", label: "Primeira coleta" });
    const firstPrint = [...printsGallery].reverse()[0];
    if (firstPrint) timeline.push({ at: firstPrint.captured_at, kind: "first_print", label: "Primeiro print", detail: firstPrint.playlist_name });
    const uploadsAsc = [...uploadsWithUrls].reverse();
    const firstUpload = uploadsAsc[0];
    if (firstUpload) timeline.push({ at: firstUpload.created_at, kind: "first_upload", label: "Primeiro Excel", detail: firstUpload.file_name });
    for (const u of uploadsAsc.slice(1)) {
      timeline.push({ at: u.created_at, kind: "upload", label: u.is_baseline ? "Excel baseline" : "Novo upload", detail: u.file_name });
    }
    const lastSnap = allSnapsArr[allSnapsArr.length - 1];
    if (lastSnap?.captured_at) timeline.push({ at: lastSnap.captured_at, kind: "last_collect", label: "Última coleta" });
    timeline.sort((a, b) => +new Date(a.at) - +new Date(b.at));

    // Fase 7.3 P3 — payload enriquecido por playlist + ordenação por delivery DESC.
    const enrichedPlaylists = (playlists ?? []).map((p: any) => {
      const d = perPlaylistDelivery[p.id] ?? null;
      const fallbackPlays7d = latestByPlaylist[p.id]?.plays_7d ?? growthBySpotifyPlaylist[(p.spotify_playlist_id ?? "").trim()]?.plays_7d ?? p.streams_7d ?? null;
      return {
        ...p,
        plays_24h: latestByPlaylist[p.id]?.plays_24h ?? null,
        plays_7d: fallbackPlays7d,
        plays_28d: latestByPlaylist[p.id]?.plays_28d ?? growthBySpotifyPlaylist[(p.spotify_playlist_id ?? "").trim()]?.plays_28d ?? p.streams_28d ?? null,
        last_window_capture_at: latestByPlaylist[p.id]?.captured_at ?? null,
        baseline_plays_prior: baselinePlaysByPid[(p.spotify_playlist_id ?? "").trim()] ?? 0,
        // delivery_per_playlist embarcado
        delivery_accumulated: d?.delivery_accumulated ?? 0,
        baseline_plays_pl: d?.baseline_plays ?? null,
        current_plays_pl: d?.current_plays ?? null,
        growth_pct: d?.growth_pct ?? null,
        first_capture_at: d?.first_capture_at ?? null,
        last_capture_at: d?.last_capture_at ?? p.last_paste_at ?? null,
        snapshot_count: d?.snapshot_count ?? 0,
        last_print_url: d?.last_print_url ?? null,
        days_active: d?.first_capture_at
          ? Math.max(0, Math.floor((Date.now() - +new Date(d.first_capture_at)) / 86400000))
          : null,
      };
    });
    // Fase 7.3 P2 — ranking: delivery desc → streams_7d desc → streams_28d desc → followers desc → added_at asc.
    enrichedPlaylists.sort((a: any, b: any) => {
      const dd = Number(b.delivery_accumulated ?? 0) - Number(a.delivery_accumulated ?? 0);
      if (dd !== 0) return dd;
      const s7 = Number(b.plays_7d ?? 0) - Number(a.plays_7d ?? 0);
      if (s7 !== 0) return s7;
      const s28 = Number(b.plays_28d ?? 0) - Number(a.plays_28d ?? 0);
      if (s28 !== 0) return s28;
      const f = Number(b.followers ?? 0) - Number(a.followers ?? 0);
      if (f !== 0) return f;
      return +new Date(a.added_at ?? 0) - +new Date(b.added_at ?? 0);
    });

    return jr({
      ok: true,
      deal,
      access,
      campaign_context,
      playlists: enrichedPlaylists,
      songs: songs ?? [],
      progress: progressWithGrowth,
      has_baseline,
      // Deduplicação é global no RPC get_curator_deal_snapshot_history,
      // então qualquer DEL/tela recebe a mesma timeline limpa.
      snapshot_history: historyRpc ?? [],
      curator_submissions,
      baseline_conflicts,
      // Fase 7.3 — novos blocos: galeria de prints, histórico de Excel e timeline.
      prints: printsGallery,
      uploads: uploadsWithUrls,
      timeline,
    });

  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return jr({ ok: false, error: msg }, 200);
  }
});
