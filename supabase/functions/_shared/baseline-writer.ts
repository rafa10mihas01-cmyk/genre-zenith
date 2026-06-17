// Shared helper — Phase 1.A.1 (NexEngine baseline architecture).
//
// Regra oficial:
//   Não existe baseline sem Campaign.
//   Toda baseline é escrita exclusivamente em `campaign_playlist_collections`
//   via a RPC `ingest_campaign_collection_batch` (intent='baseline').
//   Leitura oficial: `get_campaign_baseline()`.
//
// Quando o writer detecta um deal sem `campaign_id`, ele NÃO grava baseline e
// emite um evento estruturado em `bot_events` para auditoria (não silencioso).

import { createClient } from "npm:@supabase/supabase-js@2";

type SupabaseClient = ReturnType<typeof createClient>;

export type BaselineSkipReason =
  | "deal_without_campaign"
  | "deal_not_found"
  | "no_baseline_rows";

export interface BaselineSkipPayload {
  writer: string;
  deal_id: string;
  song_id?: string | null;
  spotify_playlist_id?: string | null;
  reason: BaselineSkipReason;
  details?: Record<string, unknown>;
}

/**
 * Resolve a campanha oficial de um deal. Retorna null se o deal não existir
 * ou não estiver vinculado a uma campanha.
 */
export async function resolveDealCampaignId(
  supabase: SupabaseClient,
  deal_id: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("curator_deals")
    .select("campaign_id")
    .eq("id", deal_id)
    .maybeSingle();
  if (error) {
    console.warn("[baseline-writer] resolveDealCampaignId error:", error.message, { deal_id });
    return null;
  }
  return ((data as any)?.campaign_id as string | null) ?? null;
}

/**
 * Emite um evento de skip estruturado em `bot_events`. Nunca lança — falha
 * de logging não pode quebrar o fluxo do writer.
 */
export async function logBaselineSkip(
  supabase: SupabaseClient,
  payload: BaselineSkipPayload,
): Promise<void> {
  const { writer, deal_id, song_id, spotify_playlist_id, reason, details } = payload;
  try {
    await supabase.from("bot_events").insert({
      bot_name: writer,
      deal_id,
      song_id: song_id ?? null,
      step: "baseline_skipped",
      status: "skipped",
      message: `Baseline ignorada: ${reason}`,
      metadata: {
        reason,
        writer,
        spotify_playlist_id: spotify_playlist_id ?? null,
        skipped_at: new Date().toISOString(),
        ...(details ?? {}),
      },
    });
  } catch (e) {
    console.warn(
      "[baseline-writer] failed to log baseline skip:",
      (e as Error).message,
      { writer, deal_id, reason },
    );
  }
}

export interface BaselinePlaylistRow {
  spotify_playlist_id: string;
  playlist_name?: string | null;
  playlist_url?: string | null;
  plays_7d?: number | null;
  captured_at?: string | null;
}

/**
 * Grava baseline oficial em `campaign_playlist_collections` via RPC.
 * - Se o deal não tem campaign_id → emite skip log e retorna { skipped: true }.
 * - Se não há linhas → emite skip log (no_baseline_rows) e retorna { skipped: true }.
 * - Caso contrário, chama `ingest_campaign_collection_batch` com intent='baseline'.
 *
 * Importante: a RPC é idempotente (segunda chamada de baseline é rejeitada
 * silenciosamente pela camada SQL — comportamento por design).
 */
export async function writeBaselineOfficial(
  supabase: SupabaseClient,
  args: {
    writer: string;
    deal_id: string;
    song_id?: string | null;
    rows: BaselinePlaylistRow[];
    snapshot_run_id?: string | null;
    campaign_id_hint?: string | null;
  },
): Promise<
  | { ok: true; campaign_id: string; rows_sent: number; rpc_result: unknown }
  | { ok: false; skipped: true; reason: BaselineSkipReason }
> {
  const { writer, deal_id, song_id, rows, snapshot_run_id, campaign_id_hint } = args;

  const campaign_id =
    campaign_id_hint ?? (await resolveDealCampaignId(supabase, deal_id));

  if (!campaign_id) {
    await logBaselineSkip(supabase, {
      writer,
      deal_id,
      song_id,
      reason: "deal_without_campaign",
      details: { rows_dropped: rows.length },
    });
    return { ok: false, skipped: true, reason: "deal_without_campaign" };
  }

  if (!rows || rows.length === 0) {
    await logBaselineSkip(supabase, {
      writer,
      deal_id,
      song_id,
      reason: "no_baseline_rows",
      details: { campaign_id },
    });
    return { ok: false, skipped: true, reason: "no_baseline_rows" };
  }

  const capturedAt = new Date().toISOString();
  const rpcRows = rows
    .filter((r) => r.spotify_playlist_id && !String(r.spotify_playlist_id).startsWith("algo:"))
    .map((r) => ({
      playlist_id: r.spotify_playlist_id,
      playlist_url:
        r.playlist_url ?? `https://open.spotify.com/playlist/${r.spotify_playlist_id}`,
      playlist_name_at_capture: r.playlist_name ?? null,
      plays_7d: Math.max(0, Number(r.plays_7d ?? 0) || 0),
      captured_at: r.captured_at ?? capturedAt,
      source: "s4a_dom",
    }));

  if (rpcRows.length === 0) {
    await logBaselineSkip(supabase, {
      writer,
      deal_id,
      song_id,
      reason: "no_baseline_rows",
      details: { campaign_id, filtered_out: rows.length },
    });
    return { ok: false, skipped: true, reason: "no_baseline_rows" };
  }

  const { data: rpcResult, error: rpcErr } = await supabase.rpc(
    "ingest_campaign_collection_batch",
    {
      p_campaign_id: campaign_id,
      p_intent: "baseline",
      p_rows: rpcRows,
      p_snapshot_run_id: snapshot_run_id ?? null,
    },
  );
  if (rpcErr) {
    console.error(
      `[${writer}] ingest_campaign_collection_batch (baseline) failed:`,
      rpcErr.message,
      { deal_id, campaign_id, rows: rpcRows.length },
    );
    throw rpcErr;
  }
  console.log(
    `[${writer}] baseline ingested in campaign_playlist_collections:`,
    JSON.stringify({ deal_id, campaign_id, rows: rpcRows.length, rpc: rpcResult }),
  );
  return { ok: true, campaign_id, rows_sent: rpcRows.length, rpc_result: rpcResult };
}
