// Shared audit logic for campaign flow. Read-only.
// Step status:
//   ok       — check passed
//   failed   — something is genuinely wrong / will break the flow
//   pending  — depende de uma ação humana ainda não feita (não é bug)
//   skipped  — não se aplica neste modo de coleta
// Auditoria adapta-se ao collection_mode: 'bot' (Spotify) verifica fila do bot,
// 'spreadsheet' verifica recebimento de planilha do cliente.

export type AuditStep = {
  step: string;
  label: string;
  status: "ok" | "failed" | "pending" | "skipped";
  detail: string;
  data?: Record<string, unknown>;
};

export type AuditReport = {
  campaign_id: string;
  ok: boolean;
  collection_mode: string | null;
  steps: AuditStep[];
};

// deno-lint-ignore no-explicit-any
type Admin = any;

export async function auditCampaignFlow(
  admin: Admin,
  campaignId: string,
): Promise<AuditReport> {
  const steps: AuditStep[] = [];
  const push = (
    step: string,
    label: string,
    status: AuditStep["status"],
    detail: string,
    data?: Record<string, unknown>,
  ) => {
    steps.push({ step, label, status, detail, data });
  };

  // ── 0) Carrega a campanha
  const { data: campaign, error: campErr } = await admin
    .from("campaigns")
    .select(
      "id, track_name, artist, status, client_approved_at, plan_approved_at, " +
      "campaign_type, collection_mode, deal_id, curator_id, client_id, spotify_track_id, " +
      "goal_plays, total_delivered, valor_cobrado, simulation_snapshot, created_at, eco_dispatched_at",
    )
    .eq("id", campaignId)
    .maybeSingle();

  if (campErr || !campaign) {
    push("0_campaign", "Campanha encontrada", "failed", campErr?.message ?? "campaign_not_found");
    return { campaign_id: campaignId, ok: false, collection_mode: null, steps };
  }

  const mode: "bot" | "spreadsheet" =
    campaign.collection_mode === "spreadsheet" ? "spreadsheet" : "bot";
  const clientOk = !!campaign.client_approved_at;
  const planOk = !!campaign.plan_approved_at;
  const isLive = campaign.status === "active" || campaign.status === "paused";
  const isClosed = campaign.status === "completed" || campaign.status === "cancelled";

  // Estado da campanha é empurrado por último (resultado final do pipeline).
  const pushFinalState = () => {
    if (isClosed) {
      push("9_state", "Estado final da campanha", "ok",
        campaign.status === "completed"
          ? `Concluída — meta atingida (${campaign.total_delivered ?? 0}/${campaign.goal_plays ?? 0})`
          : "Cancelada");
    } else if (isLive) {
      push("9_state", "Estado final da campanha", "ok",
        `Campanha ${campaign.status} — "${campaign.track_name}" / ${campaign.artist ?? "—"}`);
    } else if (!clientOk) {
      push("9_state", "Estado final da campanha", "pending",
        "Rascunho — aguardando cliente aprovar o plano público.");
    } else if (!planOk) {
      push("9_state", "Estado final da campanha", "pending",
        "Rascunho — cliente aprovou, falta você aprovar o plano interno.");
    } else {
      push("9_state", "Estado final da campanha", "pending",
        "Rascunho — pronta pra iniciar distribuição.");
    }
  };

  // ── 2) Cliente aprovou via portal
  if (clientOk) {
    push("2_client_approved", "Cliente aprovou o plano público", "ok",
      `Aprovado em ${campaign.client_approved_at}`);
  } else {
    push("2_client_approved", "Cliente aprovou o plano público", "pending",
      "Aguardando — envie o link público ao cliente.");
  }

  // ── 3) Plano aprovado internamente
  if (planOk) {
    const snap = campaign.simulation_snapshot;
    const hasSnap = !!snap && typeof snap === "object";
    if (!hasSnap) {
      push("3_plan_approved", "Plano interno aprovado", "failed",
        "Aprovado mas simulation_snapshot vazio — repete a simulação.");
    } else {
      push("3_plan_approved", "Plano interno aprovado", "ok",
        `Aprovado em ${campaign.plan_approved_at}`);
    }
  } else {
    push("3_plan_approved", "Plano interno aprovado", "pending",
      clientOk
        ? "Aguardando — clique em 'Aprovar plano interno' na tela de execução."
        : "Bloqueado até o cliente aprovar o plano público.");
  }

  // ── 4) Deals vinculados (curador REAL, não placeholder interno)
  const { data: dealsRaw } = await admin
    .from("curator_deals")
    .select("id, curator_id, curator_name, state, started_at, campaign_id, source, baseline_captured_at")
    .eq("campaign_id", campaignId);

  const allDeals = dealsRaw ?? [];
  const realDeals = allDeals.filter(
    (d: any) => d.curator_id != null && d.source !== "campaign_internal",
  );
  const placeholderDeals = allDeals.filter(
    (d: any) => d.curator_id == null || d.source === "campaign_internal",
  );
  const deals = realDeals.length > 0 ? realDeals : allDeals;
  const dealIds = deals.map((d: any) => d.id);

  if (realDeals.length > 0) {
    push("4_deals_linked", "Deals do curador vinculados", "ok",
      `${realDeals.length} deal(s) com curador real vinculado(s)`,
      { deals: realDeals.map((d: any) => ({ id: d.id, curator: d.curator_name, state: d.state })) });
  } else if (placeholderDeals.length > 0 && planOk) {
    push("4_deals_linked", "Deals do curador vinculados", "pending",
      `${placeholderDeals.length} deal(s) placeholder interno (sem curador real). Falta vincular curador real à campanha.`);
  } else if (planOk) {
    push("4_deals_linked", "Deals do curador vinculados", "failed",
      "Plano aprovado mas nenhum deal vinculado à campanha.");
  } else {
    push("4_deals_linked", "Deals do curador vinculados", "pending",
      "O deal do curador é criado quando você aprovar o plano interno.");
  }

  // ─────────────────────────────────────────────────────────────
  // Daqui pra baixo a auditoria muda conforme o modo de coleta.
  // ─────────────────────────────────────────────────────────────

  if (mode === "spreadsheet") {
    // Uploads vinculam-se via deal_id. Considera TODOS os deals da campanha
    // (inclusive placeholder interno), porque a planilha pode estar no deal interno
    // antes do curador real ser vinculado.
    const allDealIds = allDeals.map((d: any) => d.id);
    let uploadsArr: any[] = [];
    if (allDealIds.length > 0) {
      const { data: uploads } = await admin
        .from("label_spreadsheet_uploads")
        .select("id, deal_id, rows_imported, status, created_at, is_baseline")
        .in("deal_id", allDealIds)
        .order("created_at", { ascending: false });
      uploadsArr = uploads ?? [];
    }

    const baseline = uploadsArr.find((u: any) => u.is_baseline);
    const followups = uploadsArr.filter((u: any) => !u.is_baseline);

    // ── 5) Baseline da planilha (1ª foto oficial)
    if (baseline) {
      push("5_spreadsheet_baseline", "Baseline da planilha recebida", "ok",
        `Recebida em ${baseline.created_at} · ${baseline.rows_imported ?? 0} linha(s) importada(s).`,
        { upload_id: baseline.id, deal_id: baseline.deal_id });
    } else if (uploadsArr.length > 0) {
      push("5_spreadsheet_baseline", "Baseline da planilha recebida", "failed",
        `${uploadsArr.length} upload(s) encontrado(s), mas nenhum marcado como baseline. Marque o primeiro upload como baseline.`);
    } else {
      push("5_spreadsheet_baseline", "Baseline da planilha recebida", "pending",
        allDealIds.length === 0
          ? "Aguardando criação do deal pra vincular a planilha do cliente."
          : "Cliente ainda não subiu a 1ª planilha (baseline) pelo portal.");
    }

    // ── 6) Acompanhamentos (uploads seguintes que viram snapshots periódicos)
    if (followups.length > 0) {
      const last = followups[0];
      push("6_spreadsheet_followups", "Acompanhamentos da planilha", "ok",
        `${followups.length} acompanhamento(s) · último em ${last.created_at} (${last.rows_imported ?? 0} linha(s)).`);
    } else {
      push("6_spreadsheet_followups", "Acompanhamentos da planilha", "pending",
        baseline
          ? "Baseline ok. Aguardando próximo upload da gravadora pra calcular Δ."
          : "Disponível após a baseline ser recebida.");
    }
  } else {
    // ── 5b) Baseline REAL = snapshots capturados pelo bot (is_baseline=true)
    if (dealIds.length === 0) {
      push("5_baseline", "Baseline de playlists definida", "pending",
        "Aguardando criação do deal pra registrar baseline.");
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
          .select("id, playlist_spotify_id")
          .in("upload_id", uploadIds);
        totalRows = rows?.length ?? 0;
        withPlaylistId = (rows ?? []).filter((r: any) => !!r.playlist_spotify_id).length;
      }

      const { data: portalPls } = await admin
        .from("v_curator_playlists_operational")
        .select("id, spotify_playlist_id, deal_id")
        .in("deal_id", dealIds);
      const portalCount = (portalPls ?? []).filter((p: any) => !!p.spotify_playlist_id).length;

      const { data: baselineSnaps } = await admin
        .from("curator_deal_snapshots")
        .select("id, deal_id, captured_at, playlist_id")
        .in("deal_id", dealIds)
        .eq("is_initial_capture", true);
      const baselineCount = baselineSnaps?.length ?? 0;
      const firstBaselineAt = (baselineSnaps ?? [])
        .map((s: any) => s.captured_at)
        .sort()[0];

      const awaitingDeals = deals.filter((d: any) => d.state === "awaiting_baseline");
      const anyBaselineCaptured = deals.some((d: any) => d.baseline_captured_at);

      if (baselineCount > 0 || anyBaselineCaptured) {
        push("5_baseline", "Baseline capturada pelo bot", "ok",
          `${baselineCount} snapshot(s) baseline · 1ª foto em ${firstBaselineAt ?? "—"}. Campanha ativada.`);
      } else if (awaitingDeals.length > 0) {
        push("5_baseline", "Baseline capturada pelo bot", "pending",
          `Deal em "awaiting_baseline" — robô na fila pra tirar a 1ª foto no Spotify for Artists. ` +
          `A campanha só ativa depois que a baseline chegar.`);
      } else if (totalRows === 0 && portalCount === 0) {
        push("5_baseline", "Baseline capturada pelo bot",
          planOk ? "failed" : "pending",
          `Sem planilha, sem playlists no portal e sem snapshots do bot nos ${dealIds.length} deal(s).`);
      } else {
        push("5_baseline", "Baseline capturada pelo bot", "pending",
          `${portalCount} playlist(s) declarada(s) + ${totalRows} linha(s) de planilha, ` +
          `mas o bot ainda NÃO capturou a foto baseline.`);
      }
    }

    // ── 6b) Bot ativo = auto_collect + execução real (batches do S4A)
    if (dealIds.length === 0) {
      push("6_collection", "Bot ativo coletando playlists",
        planOk ? "failed" : "pending",
        "Sem deals — bot não tem o que coletar.");
    } else {
      const { data: songs } = await admin
        .from("curator_deal_songs")
        .select("id, deal_id, auto_collect, auto_collect_status")
        .in("deal_id", dealIds);
      const collecting = (songs ?? []).filter((s: any) => s.auto_collect === true);
      const songIds = (songs ?? []).map((s: any) => s.id);

      let batchCount = 0;
      let lastBatchAt: string | null = null;
      if (songIds.length > 0) {
        const { data: batches } = await admin
          .from("bot_print_batches")
          .select("id, status, created_at")
          .in("song_id", songIds)
          .order("created_at", { ascending: false })
          .limit(5);
        batchCount = batches?.length ?? 0;
        lastBatchAt = batches?.[0]?.created_at ?? null;
      }

      if (collecting.length === 0) {
        push("6_collection", "Bot ativo coletando playlists",
          isLive ? "failed" : "pending",
          `${songs?.length ?? 0} song(s) registradas, nenhuma com auto_collect=true. ` +
          (isLive
            ? "Bot vai filtrar tudo e não coletar."
            : "Ativa quando aprovar o plano interno e iniciar a distribuição."));
      } else if (batchCount === 0) {
        push("6_collection", "Bot ativo coletando playlists", "pending",
          `${collecting.length} song(s) na fila com auto_collect=true, mas o bot AINDA NÃO executou nenhuma coleta (0 batches em bot_print_batches). Aguardando 1ª execução do robô.`);
      } else {
        push("6_collection", "Bot ativo coletando playlists", "ok",
          `${collecting.length} song(s) na fila · ${batchCount} batch(es) recentes · última coleta em ${lastBatchAt ?? "—"}.`);
      }
    }
  }

  // Estado final por último — é o resultado do pipeline acima.
  pushFinalState();

  // OK geral só se não houver falha real (pending/skipped não derrubam)
  const hasFailure = steps.some((s) => s.status === "failed");
  return {
    campaign_id: campaignId,
    ok: !hasFailure,
    collection_mode: mode,
    steps,
  };
}
