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
        .select("id, client_approved_at, token_expires_at, token_revoked_at")
        .eq("public_plan_token", publicPlanToken)
        .maybeSingle();
      if (!campaignByToken?.id) return jr({ ok: false, error: "not_found" }, 404);

      // Hardening 4.B.1.B: TTL + revogação.
      if ((campaignByToken as AnyRec).token_revoked_at) {
        return jr({ ok: false, error: "token_revoked" }, 410);
      }
      const _exp = (campaignByToken as AnyRec).token_expires_at;
      if (_exp && new Date(_exp).getTime() < Date.now()) {
        return jr({ ok: false, error: "token_expired" }, 410);
      }

      const gate = await gateCampaignAccess(req, admin, campaignByToken.id);
      if (!gate.ok) return jr({ ok: false, error: gate.error }, gate.status ?? 401);

      linkedCamp = campaignByToken as AnyRec;

      // (2026-06-19) Resolve qualquer curator_deal da campanha — não mais
      // campaigns.deal_id (1:N safe).
      const { data: anyDeal } = await admin
        .from("curator_deals")
        .select("id, created_at")
        .eq("campaign_id", campaignByToken.id)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (!anyDeal?.id) return jr({ ok: false, error: "not_found" }, 404);
      dealId = String(anyDeal.id);

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
        "id, campaign_id, song_spotify_url, song_name, song_artist, song_cover_url, target_plays, daily_goal, baseline_plays, started_at, ends_at, created_at, closed_at, state, spotify_owner_id",
      )
      .eq("id", dealId!)
      .maybeSingle();

    if (dealErr) return jr({ ok: false, error: dealErr.message }, 200);
    if (!deal) return jr({ ok: false, error: "not_found" }, 404);
    dealRow = deal as AnyRec;

    // Gate por PIN — resolve a campanha via curator_deals.campaign_id (1:N safe).
    if (!linkedCamp) {
      const { data: dealCamp } = await admin
        .from("curator_deals")
        .select("campaign_id, campaigns:campaign_id(id, client_approved_at)")
        .eq("id", dealId!)
        .maybeSingle();
      const campObj = (dealCamp as AnyRec | null)?.campaigns ?? null;
      linkedCamp = (campObj as AnyRec | null) ?? null;
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

    // 4) FASE 13.0 — Histórico via campaign_playlist_collections (CPC).
    // Fonte canônica é fn_campaign_playlist_growth para totais; para série
    // temporal usamos CPC raw (plays_7d por captured_at), filtrando pelas
    // playlists do curador via curator_campaign_playlists (CCP).
    const histCampaignId = dealRow.campaign_id as string | null;
    const histCuratorId = dealRow.curator_id as string | null;
    let snapshotsRaw: AnyRec[] = [];
    let cpcPlaylistIds = new Set<string>();
    if (histCampaignId && histCuratorId) {
      const { data: ccpRows } = await admin
        .from("curator_campaign_playlists")
        .select("playlist_id")
        .eq("campaign_id", histCampaignId)
        .eq("curator_id", histCuratorId)
        .eq("excluded_from_kpis", false);
      for (const r of (ccpRows ?? []) as AnyRec[]) {
        const pid = String(r.playlist_id ?? "").trim();
        if (pid) cpcPlaylistIds.add(pid);
      }
      if (cpcPlaylistIds.size > 0) {
        const { data: cpcRows } = await admin
          .from("campaign_playlist_collections")
          .select("playlist_id, plays_7d, captured_at, is_baseline, excluded")
          .eq("campaign_id", histCampaignId)
          .in("playlist_id", Array.from(cpcPlaylistIds))
          .eq("excluded", false)
          .order("captured_at", { ascending: true });
        snapshotsRaw = (cpcRows ?? []) as AnyRec[];
      }
    }

    // Agrupa por minuto (apenas CPC do curador deste deal — já filtrado acima).
    const buckets = new Map<string, { captured_at: string; total_plays: number }>();
    for (const s of snapshotsRaw) {
      const captured = new Date(String(s.captured_at));
      const bucketKey = `${captured.getFullYear()}-${captured.getMonth()}-${captured.getDate()}-${captured.getHours()}-${captured.getMinutes()}`;
      const cur = buckets.get(bucketKey);
      const plays = Number(s.plays_7d ?? 0);
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

    // crescimento últimos 7 dias (delta de plays_7d agregado entre snapshots da janela)
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

    // série diária — usa plays_7d agregado por captura como sinal de momentum.
    // Baseline = primeiro snapshot agregado (consistente com a lógica da view).
    const baselineSeries = histArr.length > 0 ? histArr[0].total_plays : 0;
    const series = histArr.map((h) => ({
      date: h.captured_at,
      delivered: Math.max(0, h.total_plays - baselineSeries),
    }));


    // 5) Playlists do curador — FONTE OFICIAL DE EXIBIÇÃO: curator_campaign_playlists
    // (lista CONTRATADA pelo curador). Crescimento/entrega vem de
    // fn_campaign_playlist_growth via LEFT JOIN — playlists sem match na view
    // ficam visíveis com status "Aguardando coleta" e delivered=0.
    // Importante: NÃO ocultamos playlists só porque ainda não tem coleta.
    const campaignIdsForDeals = new Set<string>();
    if (dealRow.campaign_id) campaignIdsForDeals.add(String(dealRow.campaign_id));
    // (2026-06-19) Resolve campanha via curator_deals.campaign_id (1:N safe) —
    // antes lia campaigns.deal_id e perdia o vínculo pra curadores secundários.
    {
      const { data: dealCampRows } = await admin
        .from("curator_deals")
        .select("campaign_id")
        .eq("id", dealId!);
      for (const d of (dealCampRows ?? []) as AnyRec[]) {
        if (d.campaign_id) campaignIdsForDeals.add(String(d.campaign_id));
      }
    }
    if (campaignIdsForDeals.size === 0) {
      const trackUrl = String(dealRow.song_spotify_url ?? "").trim();
      if (trackUrl) {
        const { data: linkedByUrl } = await admin
          .from("campaigns")
          .select("id")
          .eq("spotify_track_url", trackUrl)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (linkedByUrl?.id) campaignIdsForDeals.add(String(linkedByUrl.id));
      }
      if (campaignIdsForDeals.size === 0 && dealRow.song_name) {
        const { data: linkedByName } = await admin
          .from("campaigns")
          .select("id")
          .eq("track_name", String(dealRow.song_name))
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (linkedByName?.id) campaignIdsForDeals.add(String(linkedByName.id));
      }
    }

    type ContractedPlaylist = {
      playlist_id: string;
      playlist_url: string | null;
      first_seen_at: string | null;
      registered_at: string | null;
      discovered_by_bot?: boolean;
    };
    const contracted: ContractedPlaylist[] = [];
    if (campaignIdsForDeals.size > 0) {
      const { data: ccpRows } = await admin
        .from("curator_campaign_playlists")
        .select("playlist_id, playlist_url, registered_at, matched_at")
        .in("campaign_id", Array.from(campaignIdsForDeals))
        .eq("excluded_from_kpis", false);
      const seen = new Set<string>();
      for (const r of (ccpRows ?? []) as AnyRec[]) {
        const k = String(r.playlist_id ?? "");
        if (!k || seen.has(k)) continue;
        seen.add(k);
        contracted.push({
          playlist_id: k,
          playlist_url: (r.playlist_url as string | null) ?? null,
          first_seen_at: (r.matched_at as string | null) ?? (r.registered_at as string | null) ?? null,
          registered_at: (r.registered_at as string | null) ?? null,
        });
      }
    }
    if (contracted.length === 0) {
      const { data: dealPlaylists } = await admin
        .from("v_curator_playlists_operational")
        .select("spotify_playlist_id, spotify_url, added_at, last_paste_at, match_status, is_initial_roster")
        .eq("deal_id", dealId!)
        .eq("match_status", "curator")
        .eq("is_initial_roster", false)
        .not("spotify_playlist_id", "is", null);
      const seen = new Set<string>();
      for (const r of (dealPlaylists ?? []) as AnyRec[]) {
        const k = String(r.spotify_playlist_id ?? "");
        if (!k || seen.has(k)) continue;
        seen.add(k);
        contracted.push({
          playlist_id: k,
          playlist_url: (r.spotify_url as string | null) ?? null,
          first_seen_at: (r.last_paste_at as string | null) ?? (r.added_at as string | null) ?? null,
          registered_at: (r.added_at as string | null) ?? null,
        });
      }
    }

    // OVERRIDE: o `registered_at` em curator_campaign_playlists foi populado por
    // backfill em lote (ex.: tudo 05/06) e não reflete o momento real em que o
    // curador colou o link no portal. A fonte de verdade é
    // `curator_playlists.added_at` (ou `last_paste_at`), que é gravado no
    // exato instante do paste/import. Sobrescrevemos pra exibir a data certa.
    if (contracted.length > 0 && campaignIdsForDeals.size > 0) {
      const { data: dealIdsRows } = await admin
        .from("curator_deals")
        .select("id")
        .in("campaign_id", Array.from(campaignIdsForDeals));
      const dealIds = Array.from(new Set((dealIdsRows ?? []).map((r: AnyRec) => String(r.id)).filter(Boolean)));
      if (dealIds.length > 0) {
        const playlistIds = Array.from(new Set(contracted.map(c => c.playlist_id)));
        const { data: cpRows } = await admin
          .from("curator_playlists")
          .select("spotify_playlist_id, added_at, last_paste_at")
          .in("deal_id", dealIds)
          .in("spotify_playlist_id", playlistIds);
        // Pega a data mais antiga (= primeiro paste real) por playlist.
        const earliest = new Map<string, string>();
        for (const r of (cpRows ?? []) as AnyRec[]) {
          const k = String(r.spotify_playlist_id ?? "");
          if (!k) continue;
          const candidate = (r.last_paste_at as string | null) ?? (r.added_at as string | null);
          if (!candidate) continue;
          const prev = earliest.get(k);
          if (!prev || new Date(candidate).getTime() < new Date(prev).getTime()) {
            earliest.set(k, candidate);
          }
        }
        for (const c of contracted) {
          const real = earliest.get(c.playlist_id);
          if (real) c.registered_at = real;
        }
      }
    }


    // Baseline: playlists onde a música JÁ ESTAVA antes do deal começar.
    // Fase 1.A.1 — leitura oficial via RPC `public.get_campaign_baseline()`.
    // Frontend/edge funcs NÃO conhecem mais a tabela física da baseline.
    const baselinePlaylistIds = new Set<string>();
    {
      const campaignIds = Array.from(campaignIdsForDeals);
      for (const cid of campaignIds) {
        const { data: baselineRows, error: baselineErr } = await admin.rpc(
          "get_campaign_baseline",
          { p_campaign_id: cid, p_spotify_playlist_id: null },
        );
        if (baselineErr) {
          console.warn("[get-client-campaign-public] get_campaign_baseline error", baselineErr.message, { cid });
          continue;
        }
        for (const r of (baselineRows ?? []) as AnyRec[]) {
          if (selectedSongId && activeSong && r.song_id && String(r.song_id) !== String(selectedSongId)) continue;
          const k = String(r.spotify_playlist_id ?? "");
          if (k) baselinePlaylistIds.add(k);
        }
      }
    }

    type CuratorGrowthRow = {
      delivery_accumulated: number;
      last_import_delta: number | null;
      current_plays: number | null;
      current_name: string | null;
      baseline_name: string | null;
      first_seen_at: string | null;
      attributed_to: string | null;
    };
    const growthByPid = new Map<string, CuratorGrowthRow>();
    if (campaignIdsForDeals.size > 0) {
      const { data: growthRows } = await admin
        .rpc("fn_campaign_playlist_growth", { p_campaign_ids: Array.from(campaignIdsForDeals) });

      for (const g of (growthRows ?? []) as AnyRec[]) {
        const k = String(g.playlist_id ?? "");
        if (!k) continue;
        const prev = growthByPid.get(k);
        const inc: CuratorGrowthRow = {
          delivery_accumulated: Number(g.delivery_accumulated ?? 0),
          last_import_delta: g.last_import_delta == null ? null : Number(g.last_import_delta),
          current_plays: g.current_plays == null ? null : Number(g.current_plays),
          current_name: (g.current_name as string | null) ?? null,
          baseline_name: (g.baseline_name as string | null) ?? null,
          first_seen_at: (g.first_seen_at as string | null) ?? null,
          attributed_to: (g.attributed_to as string | null) ?? null,
        };
        if (!prev) {
          growthByPid.set(k, inc);
        } else {
          prev.delivery_accumulated += inc.delivery_accumulated;
          if (inc.last_import_delta != null) {
            prev.last_import_delta = (prev.last_import_delta ?? 0) + inc.last_import_delta;
          }
          if (inc.current_plays != null) {
            prev.current_plays = Math.max(prev.current_plays ?? 0, inc.current_plays);
          }
          // Preserva classificação de curador caso outra linha agregada
          // já tenha vindo como `organic`/`ecosystem` por acaso de ordem.
          if (
            inc.attributed_to &&
            inc.attributed_to.startsWith("curator:") &&
            !(prev.attributed_to ?? "").startsWith("curator:")
          ) {
            prev.attributed_to = inc.attributed_to;
          }
        }
    }

    // MERGE — REGRA DE NEGÓCIO OFICIAL:
    // Uma playlist só pode aparecer como "do curador" no portal quando
    // existe vínculo explícito (campaign_id, curator_id, playlist_id) em
    // curator_campaign_playlists. A view fn_campaign_playlist_growth já
    // materializa essa regra no campo `attributed_to`:
    //   - 'curator:<id>' → existe linha em CCP (JOIN por campaign_id+playlist_id)
    //   - 'organic'      → editorial / orgânica de terceiros / sem vínculo
    //   - 'ecosystem'    → playlist do nosso ecossistema (managed_playlists)
    // Só promovemos para `discovered_by_bot` quando a view classifica como
    // curador — editoriais e ecossistema NUNCA entram como playlist do
    // curador. Na prática, attributed_to='curator:<id>' implica CCP já
    // capturada acima; este merge cobre apenas a janela rara entre as
    // duas queries em que uma linha CCP nova foi inserida no meio.
      const ccpIds = new Set(contracted.map((c) => c.playlist_id));
      for (const [pid, g] of growthByPid.entries()) {
        if (ccpIds.has(pid)) continue;
        if (!g.attributed_to || !g.attributed_to.startsWith("curator:")) continue;
        contracted.push({
          playlist_id: pid,
          playlist_url: null,
          first_seen_at: g.first_seen_at,
          registered_at: g.first_seen_at,
          discovered_by_bot: true,
        });
      }
    }
    }

    // Enriquecimento de metadados (nome/cover) via curator_playlist_library —
    // cobre TODAS as contratadas, inclusive as sem coleta ainda.
    const spIds = contracted.map((c) => c.playlist_id);
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

    const safePlaylists: AnyRec[] = contracted.map((c) => {
      const lib = libByPid.get(c.playlist_id) ?? {};
      const g = growthByPid.get(c.playlist_id);
      const delivered = g?.delivery_accumulated ?? 0;
      const firstSeen = g?.first_seen_at ?? c.first_seen_at;
      const ageDays = firstSeen
        ? (Date.now() - new Date(firstSeen).getTime()) / (1000 * 60 * 60 * 24)
        : 999;
      let status: "Nova" | "Crescendo" | "Destaque" | "Estável" | "Aguardando coleta";
      if (!g) status = "Aguardando coleta";
      else if (ageDays <= 7) status = "Nova";
      else if (delivered >= 5000) status = "Destaque";
      else if (delivered >= 500) status = "Crescendo";
      else status = "Estável";
      return {
        name: String(
          (lib.playlist_name as string | undefined) ??
            g?.current_name ??
            g?.baseline_name ??
            "Playlist",
        ),
        image_url: (lib.image_url as string | null) ?? null,
        delivered,
        last_import_delta: g?.last_import_delta ?? null,
        plays_24h: null,
        plays_7d: g?.current_plays ?? null,
        plays_28d: delivered || g?.current_plays || null,
        status,
        source: "curator" as const,
        spotify_playlist_id: c.playlist_id,
        registered_at: c.registered_at,
        is_pre_campaign: baselinePlaylistIds.has(c.playlist_id),
        discovered_by_bot: Boolean(c.discovered_by_bot),
      };
    });


    // 5b) Playlists INTERNAS (NexEngine) — vindas de campaign_eco_allocations
    // ligadas à campanha deste deal. Sem isso, o cliente não enxergava as
    // playlists próprias onde a música foi inserida internamente.
    try {
      // (2026-06-19) Resolve campanha via curator_deals.campaign_id (1:N safe).
      let campaignId = (dealRow.campaign_id as string | undefined) ?? undefined;
      if (!campaignId) {
        const { data: dealCamp } = await admin
          .from("curator_deals")
          .select("campaign_id")
          .eq("id", dealId!)
          .maybeSingle();
        campaignId = (dealCamp as AnyRec | null)?.campaign_id ?? undefined;
      }
      if (campaignId) {
        const { data: ecoAllocs } = await admin
          .from("campaign_eco_allocations")
          .select("managed_playlist_id, planned_streams, status, dispatched_at, created_at, managed_playlists(name, cover_url, followers, spotify_playlist_id)")
          .eq("campaign_id", campaignId);
        const ecoSpotifyIds = (ecoAllocs ?? [])
          .map((a: AnyRec) => String(((a.managed_playlists as AnyRec) ?? {}).spotify_playlist_id ?? ""))
          .filter(Boolean);
        // P2.3 — Ecossistema também deve vir do Growth Engine oficial.
        // `campaign_eco_snapshots` é legado e está vazio para Carnívoro; por isso
        // o portal mostrava ENGINE zerado mesmo com entrega em fn_campaign_playlist_growth.
        const ecoGrowthBySpotifyId = new Map<string, { delivered: number; last_import_delta: number | null; current_plays: number | null }>();
        if (ecoSpotifyIds.length > 0) {
          const { data: rpcRows } = await admin
            .rpc("fn_campaign_playlist_growth", { p_campaign_ids: [campaignId] });
          const wanted = new Set(ecoSpotifyIds);
          const ecoGrowth = ((rpcRows ?? []) as AnyRec[]).filter(
            (g) => g.attributed_to === "ecosystem" && g.playlist_id && wanted.has(String(g.playlist_id)),
          );
          for (const g of ecoGrowth) {
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
          // Data real em que a música foi colocada na playlist do ecossistema:
          // preferimos `dispatched_at` (instante do envio); se ainda não saiu,
          // cai pra `created_at` da alocação (= quando entrou no plano).
          const ecoRegisteredAt = (a.dispatched_at as string | null) ?? (a.created_at as string | null) ?? null;
          safePlaylists.push({
            name: String(mp.name ?? "Playlist Engine"),
            image_url: (mp.cover_url as string) ?? null,
            delivered: grown,
            last_import_delta: growth?.last_import_delta ?? null,
            plays_24h: null,
            plays_7d: growth?.current_plays ?? null,
            plays_28d: grown || growth?.current_plays || null,
            status: grown > 0 ? "Crescendo" : "Nova",
            source: "engine" as const,
            planned: Number(a.planned_streams ?? 0),
            spotify_playlist_id: spotifyId || null,
            registered_at: ecoRegisteredAt,
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
      is_initial_capture: Boolean(entry.is_initial_capture),
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

    // ----- [AUDIT_PORTAL] log temporário -----
    try {
      const auth = req.headers.get("authorization") || req.headers.get("Authorization") || "";
      let jwtRaw = "";
      if (auth.toLowerCase().startsWith("bearer ")) jwtRaw = auth.slice(7).trim();
      if (!jwtRaw) jwtRaw = (req.headers.get("x-portal-jwt") || "").trim();
      let auditEmail: string | null = null;
      let auditJwtCampaign: string | null = null;
      if (jwtRaw) {
        try {
          const { verifyAccessJwt } = await import("../_shared/campaign-access-jwt.ts");
          const p = await verifyAccessJwt(jwtRaw);
          if (p) { auditEmail = p.email ?? null; auditJwtCampaign = p.campaign_id ?? null; }
        } catch (_) { /* noop */ }
      }
      console.log("[AUDIT_PORTAL] get-client-campaign-public OK", JSON.stringify({
        deal_id: dealId,
        campaign_id: (linkedCamp?.id as string | undefined) ?? (dealRow?.campaign_id as string | undefined) ?? null,
        campaign_token: publicPlanToken || null,
        client_token: clientToken || null,
        email: auditEmail,
        is_admin: auditEmail ? (auditEmail.endsWith("@nexengine") || auditEmail.includes("admin")) : false,
        jwt_campaign_id: auditJwtCampaign,
        playlists_count: safePlaylists.length,
        playlists_curator: safePlaylists.filter((p: AnyRec) => p.source === "curator").length,
        playlists_engine: safePlaylists.filter((p: AnyRec) => p.source === "engine").length,
        proofs_count: 0,
        organic_count: 0,
        snapshot_count: safeSnapshotHistory.length,
        delivered,
        target,
        pct,
      }));
    } catch (_) { /* noop */ }

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
