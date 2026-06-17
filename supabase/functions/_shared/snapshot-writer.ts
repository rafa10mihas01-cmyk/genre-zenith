// _shared/snapshot-writer.ts — Writer único para curator_deal_snapshots.
// NC-003 (Red Team 2026-06-17): elimina os 3 INSERTs paralelos espalhados
// em bot-ingest-snapshot, _shared/ingest-dom e extract-snapshot-from-print.
//
// Toda gravação em curator_deal_snapshots DEVE passar por aqui. O contrato
// do payload vive em um lugar só.
//
// Comportamento:
//   • upsert idempotente quando vier batch_id+playlist_id (preserva a regra
//     antiga do extract-snapshot-from-print).
//   • passa correlation_id pra trace.
//   • respeita o trigger BEFORE INSERT/UPDATE `reject_snapshot_regression`
//     (não tenta inserir plays decrescentes — apenas relata o erro).

// deno-lint-ignore no-explicit-any
type Sb = any;

export interface CuratorSnapshotPayload {
  deal_id: string;
  song_id: string;
  playlist_id: string;
  plays: number;
  plays_24h?: number | null;
  plays_7d?: number | null;
  plays_28d?: number | null;
  source: string;
  match_method?: string | null;
  is_initial_capture?: boolean;
  flagged?: boolean;
  flag_reason?: string | null;
  correlation_id?: string | null;
  print_url?: string | null;
  snapshot_run_id?: string | null;
  ai_raw?: unknown;
  batch_id?: string | null;
}

export interface SnapshotWriteResult {
  inserted: boolean;
  updated: boolean;
  skipped: boolean;
  error: string | null;
}

export async function writeCuratorDealSnapshot(
  sb: Sb,
  payload: CuratorSnapshotPayload,
): Promise<SnapshotWriteResult> {
  const base = {
    deal_id: payload.deal_id,
    song_id: payload.song_id,
    playlist_id: payload.playlist_id,
    plays: payload.plays,
    plays_24h: payload.plays_24h ?? null,
    plays_7d: payload.plays_7d ?? null,
    plays_28d: payload.plays_28d ?? null,
    source: payload.source,
    match_method: payload.match_method ?? null,
    is_initial_capture: payload.is_initial_capture ?? false,
    flagged: payload.flagged ?? false,
    flag_reason: payload.flag_reason ?? null,
    correlation_id: payload.correlation_id ?? null,
    print_url: payload.print_url ?? null,
    snapshot_run_id: payload.snapshot_run_id ?? payload.batch_id ?? null,
    ai_raw: payload.ai_raw ?? null,
    batch_id: payload.batch_id ?? null,
  } as Record<string, unknown>;

  // Dedup por (batch_id, playlist_id) — preserva regra do extract-snapshot-from-print.
  if (payload.batch_id) {
    const { data: existing } = await sb
      .from("curator_deal_snapshots")
      .select("id, plays")
      .eq("batch_id", payload.batch_id)
      .eq("playlist_id", payload.playlist_id)
      .maybeSingle();

    if (existing?.id) {
      if ((payload.plays ?? 0) > (existing.plays ?? 0)) {
        const { error } = await sb
          .from("curator_deal_snapshots")
          .update({
            plays: base.plays,
            plays_24h: base.plays_24h,
            plays_7d: base.plays_7d,
            plays_28d: base.plays_28d,
            match_method: base.match_method,
            ai_raw: base.ai_raw,
            snapshot_run_id: base.snapshot_run_id,
          })
          .eq("id", existing.id);
        return {
          inserted: false,
          updated: !error,
          skipped: false,
          error: error?.message ?? null,
        };
      }
      return { inserted: false, updated: false, skipped: true, error: null };
    }
  }

  const { error } = await sb.from("curator_deal_snapshots").insert(base);
  return {
    inserted: !error,
    updated: false,
    skipped: false,
    error: error?.message ?? null,
  };
}
