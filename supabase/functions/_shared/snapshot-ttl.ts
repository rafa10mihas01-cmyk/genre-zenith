// Política única de TTL para tabelas de snapshot.
// `null` = nunca expira. `days` = número de dias após a coluna `ts_column`.
export type SnapshotTtlPolicy = {
  table: string;
  ts_column: string;
  days: number | null;
};

export const SNAPSHOT_TTL_POLICIES: SnapshotTtlPolicy[] = [
  { table: "playlist_metrics_snapshots",   ts_column: "collected_at", days: 180 },
  { table: "playlist_followers_snapshots", ts_column: "captured_at",  days: 180 },
  { table: "playlist_track_snapshots",     ts_column: "captured_at",  days: 60  },
  { table: "playlist_drift_snapshots",     ts_column: "captured_at",  days: 60  },
  { table: "curator_deal_snapshots",       ts_column: "captured_at",  days: 365 },
  { table: "campaign_eco_snapshots",       ts_column: "captured_at",  days: 365 },
  { table: "learning_snapshots",           ts_column: "snapshot_at",  days: null }, // nunca expira
];
