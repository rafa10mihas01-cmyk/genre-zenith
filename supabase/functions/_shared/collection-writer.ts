// _shared/collection-writer.ts
//
// Fase 3.A.1 — Writer Único Oficial da arquitetura de Coleta.
//
// Regra oficial:
//   Nenhuma Edge Function pode escrever diretamente em
//   `campaign_playlist_collections`. Toda escrita deve passar por
//   `writeCollectionBatch()` (intent='periodic') ou `writeBaselineOfficial()`
//   (intent='baseline'), ambos implementados aqui.
//
// O writer é, internamente, um wrapper fino sobre a RPC oficial
// `ingest_campaign_collection_batch` — a fonte de verdade SQL permanece
// inalterada (regra "nome ≠ responsabilidade"; só consolidamos o ponto de
// entrada da aplicação).
//
// Histórico:
//   Antes: cada Edge Function (`bot-ingest-dom`, `extract-snapshot-from-print`,
//   `import-label-spreadsheet`) chamava a RPC diretamente, com formatações
//   ligeiramente diferentes e sem auditoria comum.
//   Agora: um único helper, contrato CollectionRow unificado, log padronizado
//   em `collection_logs`.

import { createClient } from "npm:@supabase/supabase-js@2";
import {
  writeBaselineOfficial as _writeBaselineOfficial,
  resolveDealCampaignId,
  logBaselineSkip,
  type BaselinePlaylistRow,
  type BaselineSkipPayload,
  type BaselineSkipReason,
} from "./baseline-writer.ts";

type SupabaseClient = ReturnType<typeof createClient>;

// Re-exports — `baseline-writer.ts` continua existindo (compat), mas o ponto
// de entrada oficial passa a ser `collection-writer.ts`.
export {
  resolveDealCampaignId,
  logBaselineSkip,
  type BaselinePlaylistRow,
  type BaselineSkipPayload,
  type BaselineSkipReason,
};
export const writeBaselineOfficial = _writeBaselineOfficial;

// Contrato único entregue por todos os parsers (DOM, OCR, Spreadsheet,
// Snapshot). Os parsers podem extrair campos extras, mas o writer só
// consome este subconjunto.
export interface CollectionRow {
  spotify_playlist_id: string;
  playlist_name?: string | null;
  playlist_url?: string | null;
  plays_7d?: number | null;
  captured_at?: string | null;
  source?: string | null;
}

export interface WriteCollectionArgs {
  writer: string;
  campaign_id: string;
  intent: "baseline" | "periodic";
  rows: CollectionRow[];
  snapshot_run_id?: string | null;
  upload_id?: string | null;
  default_source?: string;
}

export type WriteCollectionResult =
  | {
      ok: true;
      intent: "baseline" | "periodic";
      campaign_id: string;
      rows_sent: number;
      rpc_result: unknown;
    }
  | { ok: false; skipped: true; reason: "no_rows" };

/**
 * Escreve um lote de coleta em `campaign_playlist_collections` via a RPC
 * oficial `ingest_campaign_collection_batch`. Único ponto de escrita
 * permitido na aplicação.
 *
 * - intent='baseline' → primeira coleta (idempotente no SQL).
 * - intent='periodic' → coletas subsequentes (delta de plays).
 *
 * Quando `upload_id` é informado, vincula as collections recém-criadas
 * (últimos 5 min) ao upload pra rastreabilidade.
 */
export async function writeCollectionBatch(
  supabase: SupabaseClient,
  args: WriteCollectionArgs,
): Promise<WriteCollectionResult> {
  const {
    writer,
    campaign_id,
    intent,
    rows,
    snapshot_run_id,
    upload_id,
    default_source,
  } = args;

  const capturedAt = new Date().toISOString();
  const rpcRows = (rows ?? [])
    .filter(
      (r) =>
        typeof r.spotify_playlist_id === "string" &&
        r.spotify_playlist_id.length > 0 &&
        !r.spotify_playlist_id.startsWith("algo:"),
    )
    .map((r) => ({
      playlist_id: r.spotify_playlist_id,
      playlist_url:
        r.playlist_url ??
        `https://open.spotify.com/playlist/${r.spotify_playlist_id}`,
      playlist_name_at_capture: r.playlist_name ?? null,
      plays_7d: Math.max(0, Number(r.plays_7d ?? 0) || 0),
      captured_at: r.captured_at ?? capturedAt,
      source: r.source ?? default_source ?? "collection_writer",
    }));

  if (rpcRows.length === 0) {
    return { ok: false, skipped: true, reason: "no_rows" };
  }

  const { data: rpcResult, error: rpcErr } = await supabase.rpc(
    "ingest_campaign_collection_batch",
    {
      p_campaign_id: campaign_id,
      p_intent: intent,
      p_rows: rpcRows,
      p_snapshot_run_id: snapshot_run_id ?? null,
      p_upload_id: upload_id ?? null,
    },
  );
  if (rpcErr) {
    console.error(
      `[collection-writer/${writer}] ingest_campaign_collection_batch (${intent}) failed:`,
      rpcErr.message,
      { campaign_id, rows: rpcRows.length },
    );
    throw rpcErr;
  }

  if (upload_id) {
    try {
      await supabase
        .from("campaign_playlist_collections")
        .update({ upload_id })
        .eq("campaign_id", campaign_id)
        .is("upload_id", null)
        .gte(
          "captured_at",
          new Date(Date.now() - 5 * 60 * 1000).toISOString(),
        );
    } catch (e) {
      console.warn(
        `[collection-writer/${writer}] upload_id link failed:`,
        (e as Error).message,
      );
    }
  }

  console.log(
    `[collection-writer/${writer}] ${intent} ingested:`,
    JSON.stringify({ campaign_id, rows: rpcRows.length, rpc: rpcResult }),
  );

  return {
    ok: true,
    intent,
    campaign_id,
    rows_sent: rpcRows.length,
    rpc_result: rpcResult,
  };
}
