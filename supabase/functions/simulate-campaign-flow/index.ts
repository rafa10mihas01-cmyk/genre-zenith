// simulate-campaign-flow — cria uma campanha de teste, executa as 7 etapas
// inserindo dados mínimos válidos em cada uma, audita após cada etapa, e
// no final apaga TUDO em cascata. Zero efeito permanente.
//
// POST {} (sem body necessário) → { ok, campaign_id, label, steps[], cleanup_ok }
//
// IMPORTANTE: requer JWT (created_by usa auth.uid()). Roda com a identidade
// do usuário chamador.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { auditCampaignFlow, type AuditStep } from "../_shared/audit-campaign.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

type StepResult = { step: string; status: "ok" | "failed"; detail: string };

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
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const label = `[TEST] Simulação ${ts}`;

  const steps: StepResult[] = [];
  let campaignId: string | null = null;
  const created: {
    campaign_id?: string;
    client_id?: string;
    curator_ids: string[];
    deal_ids: string[];
    upload_ids: string[];
  } = { curator_ids: [], deal_ids: [], upload_ids: [] };

  const cleanup = async () => {
    try {
      // Order: rows → uploads → curator_playlists → curator_deal_songs → deals → eco_allocations → campaign → curators → client
      if (created.upload_ids.length > 0) {
        await admin.from("label_spreadsheet_rows").delete().in("upload_id", created.upload_ids);
        await admin.from("label_spreadsheet_uploads").delete().in("id", created.upload_ids);
      }
      if (created.deal_ids.length > 0) {
        await admin.from("curator_playlists").delete().in("deal_id", created.deal_ids);
        await admin.from("curator_deal_baseline_playlists").delete().in("deal_id", created.deal_ids);
        await admin.from("curator_deal_songs").delete().in("deal_id", created.deal_ids);
        await admin.from("curator_deals").delete().in("id", created.deal_ids);
      }
      if (created.campaign_id) {
        await admin.from("campaign_eco_allocations").delete().eq("campaign_id", created.campaign_id);
        await admin.from("campaigns").delete().eq("id", created.campaign_id);
      }
      if (created.curator_ids.length > 0) {
        await admin.from("curators").delete().in("id", created.curator_ids);
      }
      if (created.client_id) {
        await admin.from("clients").delete().eq("id", created.client_id);
      }
      return true;
    } catch (e) {
      console.error("[simulate] cleanup error", e);
      return false;
    }
  };

  const recordStep = (step: string, status: "ok" | "failed", detail: string) =>
    steps.push({ step, status, detail });

  try {
    // ─────────────────────────────────────────────
    // 1) Criar campanha com nome, música, cliente
    // ─────────────────────────────────────────────
    const { data: client, error: clientErr } = await admin
      .from("clients")
      .insert({ name: `[TEST] Cliente ${ts}`, user_id: userId })
      .select("id")
      .single();
    if (clientErr || !client) {
      recordStep("1_create_campaign", "failed", `client insert: ${clientErr?.message}`);
      await cleanup();
      return json({ ok: false, label, campaign_id: null, steps, cleanup_ok: true });
    }
    created.client_id = client.id;

    const { data: campIns, error: campInsErr } = await admin
      .from("campaigns")
      .insert({
        track_name: label,
        artist: "Test Artist",
        spotify_track_id: "TEST" + ts.slice(0, 18),
        spotify_track_url: "https://open.spotify.com/track/test",
        cover_url: null,
        goal_plays: 10000,
        deadline: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
        started_at: new Date().toISOString(),
        status: "active",
        campaign_type: "ecosystem",
        engagement_multiplier: 35,
        created_by: userId,
        client_id: client.id,
        notes: "[TEST] Simulação automática — apagar se sobrar",
      })
      .select("id, track_name, status")
      .single();

    if (campInsErr || !campIns) {
      recordStep("1_create_campaign", "failed", campInsErr?.message ?? "insert returned null");
      await cleanup();
      return json({ ok: false, label, campaign_id: null, steps, cleanup_ok: true });
    }
    campaignId = campIns.id;
    created.campaign_id = campaignId;
    recordStep("1_create_campaign", "ok", `id=${campaignId} status=${campIns.status}`);

    // ─────────────────────────────────────────────
    // 2) Rodar calculadora e gerar plano (mock snapshot + 2 allocs)
    // ─────────────────────────────────────────────
    const snapshot = {
      days: 30,
      meta: 10000,
      custoEco: 200,
      custoExt: 800,
      clientPriceTotal: 1500,
      pricePerStreamSell: 0.15,
      engagement_multiplier: 35,
      music: { top200Position: 0 },
    };
    const { error: snapErr } = await admin
      .from("campaigns")
      .update({ simulation_snapshot: snapshot, valor_cobrado: 1500 })
      .eq("id", campaignId);
    if (snapErr) {
      recordStep("2_plan_generated", "failed", `snapshot update: ${snapErr.message}`);
    } else {
      recordStep("2_plan_generated", "ok", "simulation_snapshot gravado");
    }

    // ─────────────────────────────────────────────
    // 3) Cliente aprovar via portal + aprovar plano
    // ─────────────────────────────────────────────
    const nowIso = new Date().toISOString();
    const { error: apprErr } = await admin
      .from("campaigns")
      .update({
        client_approved_at: nowIso,
        client_approved_by: userId,
        plan_approved_at: nowIso,
        plan_approved_by: userId,
      })
      .eq("id", campaignId);
    if (apprErr) {
      recordStep("3_approvals", "failed", apprErr.message);
    } else {
      recordStep("3_approvals", "ok", "client_approved_at + plan_approved_at gravados");
    }

    // ─────────────────────────────────────────────
    // 5) Criar deals de curador JÁ com campaign_id  (fazemos antes do 4 — baseline depende de deal)
    // ─────────────────────────────────────────────
    const curatorsToCreate = [
      { name: `[TEST] Plug Music ${ts}` },
      { name: `[TEST] Manolo ${ts}` },
    ];
    const createdDeals: { id: string; curator_id: string; curator_name: string }[] = [];

    for (const cur of curatorsToCreate) {
      const { data: curRow, error: curErr } = await admin
        .from("curators")
        .insert({ name: cur.name, user_id: userId, purchased_plays: 100000, total_cost: 1000 })
        .select("id, name")
        .single();
      if (curErr || !curRow) {
        recordStep("5_deals_linked", "failed", `curator insert: ${curErr?.message}`);
        await cleanup();
        return json({ ok: false, campaign_id: campaignId, label, steps, cleanup_ok: true });
      }
      created.curator_ids.push(curRow.id);

      const { data: dealRow, error: dealErr } = await admin
        .from("curator_deals")
        .insert({
          user_id: userId,
          curator_id: curRow.id,
          curator_name: curRow.name,
          campaign_id: campaignId,
          song_spotify_url: "https://open.spotify.com/track/test",
          song_name: label,
          song_artist: "Test Artist",
          target_plays: 5000,
          baseline_plays: 0,
          cost: 500,
          started_at: nowIso,
          ends_at: new Date(Date.now() + 30 * 86400000).toISOString(),
          ramp_up_days: 5,
          daily_goal: 200,
          state: "active",
          billing_model: "per_streams",
        })
        .select("id, curator_id, curator_name")
        .single();
      if (dealErr || !dealRow) {
        recordStep("5_deals_linked", "failed", `deal insert: ${dealErr?.message}`);
        await cleanup();
        return json({ ok: false, campaign_id: campaignId, label, steps, cleanup_ok: true });
      }
      created.deal_ids.push(dealRow.id);
      createdDeals.push({ id: dealRow.id, curator_id: dealRow.curator_id, curator_name: dealRow.curator_name });

      // Song shadow com auto_collect=true (etapa 7 depende disso)
      await admin.from("curator_deal_songs").insert({
        deal_id: dealRow.id,
        song_spotify_url: "https://open.spotify.com/track/test",
        spotify_track_id: "TEST" + ts.slice(0, 18),
        song_name: label,
        song_artist: "Test Artist",
        target_plays: 5000,
        daily_goal: 200,
        position: 0,
        auto_collect: true,
        next_auto_collect_at: nowIso,
      });
    }
    recordStep("5_deals_linked", "ok", `${createdDeals.length} deal(s) com campaign_id`);

    // ─────────────────────────────────────────────
    // 4) Importar baseline com playlist_spotify_id (vincula ao primeiro deal)
    // ─────────────────────────────────────────────
    const baselineDealId = createdDeals[0].id;
    const { data: upload, error: upErr } = await admin
      .from("label_spreadsheet_uploads")
      .insert({
        deal_id: baselineDealId,
        uploaded_via: "test",
        uploaded_by: userId,
        file_name: "test-baseline.xlsx",
        rows_imported: 3,
        total_streams: 1500,
        status: "imported",
        reference_date: new Date().toISOString().slice(0, 10),
        is_baseline: true,
      })
      .select("id")
      .single();
    if (upErr || !upload) {
      recordStep("4_baseline", "failed", upErr?.message ?? "upload insert null");
    } else {
      created.upload_ids.push(upload.id);
      const sampleRows = [
        { upload_id: upload.id, deal_id: baselineDealId, playlist_name: "Test PL 1", playlist_spotify_id: "TESTPL001", streams: 500, position: 1 },
        { upload_id: upload.id, deal_id: baselineDealId, playlist_name: "Test PL 2", playlist_spotify_id: "TESTPL002", streams: 700, position: 2 },
        { upload_id: upload.id, deal_id: baselineDealId, playlist_name: "Test PL 3", playlist_spotify_id: "TESTPL003", streams: 300, position: 3 },
      ];
      const { error: rowsErr } = await admin.from("label_spreadsheet_rows").insert(sampleRows);
      if (rowsErr) {
        recordStep("4_baseline", "failed", `rows: ${rowsErr.message}`);
      } else {
        recordStep("4_baseline", "ok", "3 linhas com playlist_spotify_id");
      }
    }

    // ─────────────────────────────────────────────
    // 6) Vincular playlists nos deals (curator_playlists)
    // ─────────────────────────────────────────────
    const plRows: any[] = [];
    for (const d of createdDeals) {
      plRows.push({
        deal_id: d.id,
        spotify_url: "https://open.spotify.com/playlist/TESTPL_" + d.id.slice(0, 6),
        spotify_playlist_id: "TESTPL_" + d.id.slice(0, 6),
        playlist_name: `[TEST] PL de ${d.curator_name}`,
        is_baseline: true,
        match_status: "baseline",
        attribution_method: "test_seed",
        attribution_reason: "simulate-campaign-flow",
      });
    }
    const { error: plErr } = await admin.from("curator_playlists").insert(plRows);
    if (plErr) {
      recordStep("6_playlists_linked", "failed", plErr.message);
    } else {
      recordStep("6_playlists_linked", "ok", `${plRows.length} playlist(s) anexadas`);
    }

    // ─────────────────────────────────────────────
    // 7) Validação final via audit-campaign-flow
    // ─────────────────────────────────────────────
    const auditReport = await auditCampaignFlow(admin, campaignId);
    auditReport.steps.forEach((s: AuditStep) => {
      recordStep(`audit_${s.step}`, s.status === "ok" ? "ok" : "failed", `${s.label}: ${s.detail}`);
    });

    const cleanupOk = await cleanup();
    const allOk = steps.every((s) => s.status === "ok");
    return json({
      ok: allOk,
      campaign_id: campaignId,
      label,
      steps,
      audit: auditReport,
      cleanup_ok: cleanupOk,
    });
  } catch (e) {
    const cleanupOk = await cleanup();
    return json({
      ok: false,
      campaign_id: campaignId,
      label,
      steps,
      error: (e as Error).message,
      cleanup_ok: cleanupOk,
    }, 500);
  }
});
