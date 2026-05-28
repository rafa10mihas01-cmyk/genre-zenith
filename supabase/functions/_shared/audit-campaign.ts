// Shared audit logic for campaign flow. Read-only.
// Returns 7 step results: ok | failed | skipped + detail.

export type AuditStep = {
  step: string;
  label: string;
  status: "ok" | "failed" | "skipped";
  detail: string;
  data?: Record<string, unknown>;
};

export type AuditReport = {
  campaign_id: string;
  ok: boolean;
  steps: AuditStep[];
};

// deno-lint-ignore no-explicit-any
type Admin = any;

export async function auditCampaignFlow(
  admin: Admin,
  campaignId: string,
): Promise<AuditReport> {
  const steps: AuditStep[] = [];
  const fail = (step: string, label: string, detail: string, data?: Record<string, unknown>) => {
    steps.push({ step, label, status: "failed", detail, data });
  };
  const ok = (step: string, label: string, detail: string, data?: Record<string, unknown>) => {
    steps.push({ step, label, status: "ok", detail, data });
  };
  const skip = (step: string, label: string, detail: string) => {
    steps.push({ step, label, status: "skipped", detail });
  };

  // ── 1) Campanha existe e ativa
  const { data: campaign, error: campErr } = await admin
    .from("campaigns")
    .select(
      "id, track_name, artist, status, client_approved_at, plan_approved_at, " +
      "campaign_type, deal_id, curator_id, client_id, spotify_track_id, " +
      "goal_plays, valor_cobrado, simulation_snapshot, created_at",
    )
    .eq("id", campaignId)
    .maybeSingle();

  if (campErr || !campaign) {
    fail("1_campaign", "Campanha existe e ativa", campErr?.message ?? "campaign_not_found");
    return { campaign_id: campaignId, ok: false, steps };
  }

  if (campaign.status !== "active") {
    fail("1_campaign", "Campanha existe e ativa", `status=${campaign.status} (esperado: active)`, { campaign });
  } else {
    ok("1_campaign", "Campanha existe e ativa", `"${campaign.track_name}" / ${campaign.artist}`, {
      campaign_type: campaign.campaign_type,
      client_id: campaign.client_id,
      curator_id: campaign.curator_id,
    });
  }

  // ── 2) Plano aprovado (plan_approved_at)
  if (!campaign.plan_approved_at) {
    fail("2_plan_approved", "Plano aprovado internamente", "plan_approved_at IS NULL — clique em 'Aprovar plano' na aba Plano");
  } else {
    const snap = campaign.simulation_snapshot;
    const hasSnap = !!snap && typeof snap === "object";
    if (!hasSnap) {
      fail("2_plan_approved", "Plano aprovado internamente", "Aprovado mas simulation_snapshot vazio");
    } else {
      ok("2_plan_approved", "Plano aprovado internamente", `Aprovado em ${campaign.plan_approved_at}`);
    }
  }

  // ── 3) Cliente aprovou via portal
  if (!campaign.client_approved_at) {
    fail("3_client_approved", "Cliente aprovou via portal", "client_approved_at IS NULL — cliente não aprovou o plano");
  } else {
    ok("3_client_approved", "Cliente aprovou via portal", `Aprovado em ${campaign.client_approved_at}`);
  }

  // ── 4) Baseline importada com playlist_spotify_id
  // Baseline é por deal. Carrega deals da campanha primeiro.
  const { data: deals } = await admin
    .from("curator_deals")
    .select("id, curator_id, curator_name, state, started_at, campaign_id")
    .eq("campaign_id", campaignId);

  const dealIds = (deals ?? []).map((d: any) => d.id);

  if (dealIds.length === 0) {
    skip("4_baseline", "Baseline importada com playlist_spotify_id", "Sem deals vinculados — etapa 5 também vai falhar");
  } else {
    const { data: uploads } = await admin
      .from("label_spreadsheet_uploads")
      .select("id, deal_id, rows_imported, status")
      .in("deal_id", dealIds);

    const uploadIds = (uploads ?? []).map((u: any) => u.id);
    let withPlaylistId = 0;
    let totalRows = 0;
    if (uploadIds.length > 0) {
      const { data: rows } = await admin
        .from("label_spreadsheet_rows")
        .select("id, playlist_spotify_id", { count: "exact", head: false })
        .in("upload_id", uploadIds);
      totalRows = rows?.length ?? 0;
      withPlaylistId = (rows ?? []).filter((r: any) => !!r.playlist_spotify_id).length;
    }

    if (totalRows === 0) {
      fail("4_baseline", "Baseline importada com playlist_spotify_id",
        `Nenhuma planilha importada nos ${dealIds.length} deal(s) da campanha`);
    } else if (withPlaylistId === 0) {
      fail("4_baseline", "Baseline importada com playlist_spotify_id",
        `${totalRows} linhas importadas mas nenhuma com playlist_spotify_id`);
    } else {
      ok("4_baseline", "Baseline importada com playlist_spotify_id",
        `${totalRows} linhas, ${withPlaylistId} com playlist_spotify_id`);
    }
  }

  // ── 5) Deals com campaign_id vinculado
  if (dealIds.length === 0) {
    fail("5_deals_linked", "Deals com campaign_id vinculado",
      "Nenhum deal com campaign_id apontando pra esta campanha");
  } else {
    ok("5_deals_linked", "Deals com campaign_id vinculado",
      `${dealIds.length} deal(s) vinculado(s)`,
      { deals: (deals ?? []).map((d: any) => ({ id: d.id, curator: d.curator_name, state: d.state })) });
  }

  // ── 6) Playlists vinculadas nos deals
  if (dealIds.length === 0) {
    skip("6_playlists_linked", "Playlists vinculadas nos deals", "Sem deals — não há onde anexar playlists");
  } else {
    const { data: cPlaylists } = await admin
      .from("curator_playlists")
      .select("id, deal_id, spotify_playlist_id")
      .in("deal_id", dealIds);
    const { data: baselinePls } = await admin
      .from("curator_deal_baseline_playlists")
      .select("id, deal_id, spotify_playlist_id")
      .in("deal_id", dealIds);

    const total = (cPlaylists?.length ?? 0) + (baselinePls?.length ?? 0);
    if (total === 0) {
      fail("6_playlists_linked", "Playlists vinculadas nos deals",
        `Nenhuma playlist anexada nos ${dealIds.length} deal(s). Bot não tem alvo.`);
    } else {
      const dealsWithPls = new Set([
        ...(cPlaylists ?? []).map((p: any) => p.deal_id),
        ...(baselinePls ?? []).map((p: any) => p.deal_id),
      ]);
      const missing = dealIds.filter((id: string) => !dealsWithPls.has(id));
      if (missing.length > 0) {
        fail("6_playlists_linked", "Playlists vinculadas nos deals",
          `${total} playlists no total, mas ${missing.length} deal(s) sem nenhuma playlist`, { deals_without_playlists: missing });
      } else {
        ok("6_playlists_linked", "Playlists vinculadas nos deals",
          `${total} playlists em ${dealsWithPls.size} deal(s)`);
      }
    }
  }

  // ── 7) Bot vê deals na fila (curator_deal_songs com auto_collect=true)
  if (dealIds.length === 0) {
    skip("7_bot_queue", "Bot vê deals na fila de coleta", "Sem deals — fila vazia");
  } else {
    const { data: songs } = await admin
      .from("curator_deal_songs")
      .select("id, deal_id, auto_collect, auto_collect_status")
      .in("deal_id", dealIds);
    const collecting = (songs ?? []).filter((s: any) => s.auto_collect === true);
    if (collecting.length === 0) {
      fail("7_bot_queue", "Bot vê deals na fila de coleta",
        `${songs?.length ?? 0} song(s) registradas mas nenhuma com auto_collect=true. ` +
        `Bot vai filtrar tudo e não coletar.`);
    } else {
      ok("7_bot_queue", "Bot vê deals na fila de coleta",
        `${collecting.length} song(s) na fila com auto_collect=true`);
    }
  }

  const allOk = steps.every((s) => s.status !== "failed");
  return { campaign_id: campaignId, ok: allOk, steps };
}
