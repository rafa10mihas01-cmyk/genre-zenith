// useSyncStatusBatch — deriva status de sync por playlist sem schema novo.
// Fontes (todas reutilizadas):
//   - playlist_operation_queue (AUTO_SYNC) → status atual + próxima execução
//   - spotify_call_log                    → origem do token (OAuth vs Client Credentials)
// O resto (última sync, tipo catálogo/operacional) já vem na própria managed_playlists.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type SyncStatus = "processing" | "pending" | "failed" | "done" | "idle";
export type TokenSource = "oauth" | "app" | null;

export type PlaylistSyncInfo = {
  status: SyncStatus;
  nextSyncAt: string | null;   // próximo scheduled_for de uma fila pendente
  lastQueueAt: string | null;  // created_at da última row na fila
  tokenSource: TokenSource;    // do último spotify_call_log dessa playlist
  lastCallAt: string | null;
};

const EMPTY: PlaylistSyncInfo = {
  status: "idle",
  nextSyncAt: null,
  lastQueueAt: null,
  tokenSource: null,
  lastCallAt: null,
};

export function useSyncStatusBatch(playlistIds: string[]) {
  const ids = [...new Set(playlistIds)].filter(Boolean).sort();
  const key = ids.join(",");

  return useQuery({
    queryKey: ["sync-status-batch", key],
    enabled: ids.length > 0,
    staleTime: 30_000,
    queryFn: async (): Promise<Record<string, PlaylistSyncInfo>> => {
      const map: Record<string, PlaylistSyncInfo> = {};
      for (const id of ids) map[id] = { ...EMPTY };

      // 1) Fila AUTO_SYNC — pega as últimas 500 rows pra esse conjunto e reduz pra mais recente por playlist
      const { data: queueRows } = await supabase
        .from("playlist_operation_queue")
        .select("playlist_id, status, scheduled_for, created_at")
        .in("playlist_id", ids)
        .eq("operation_type", "AUTO_SYNC")
        .order("created_at", { ascending: false })
        .limit(500);

      const seenQueue = new Set<string>();
      for (const r of queueRows ?? []) {
        if (seenQueue.has(r.playlist_id)) continue;
        seenQueue.add(r.playlist_id);
        const slot = map[r.playlist_id];
        if (!slot) continue;
        const s = r.status as string;
        slot.status =
          s === "processing" ? "processing" :
          s === "pending" ? "pending" :
          s === "failed" ? "failed" :
          s === "done" ? "done" : "idle";
        slot.lastQueueAt = r.created_at;
        slot.nextSyncAt = s === "pending" ? r.scheduled_for : null;
      }

      // 2) Token usado — última chamada Spotify por playlist nos últimos 7 dias
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const { data: callRows } = await supabase
        .from("spotify_call_log")
        .select("playlist_id, spotify_user_id, app_id, created_at")
        .in("playlist_id", ids)
        .gte("created_at", sevenDaysAgo)
        .order("created_at", { ascending: false })
        .limit(1000);

      const seenCall = new Set<string>();
      for (const r of callRows ?? []) {
        if (!r.playlist_id || seenCall.has(r.playlist_id)) continue;
        seenCall.add(r.playlist_id);
        const slot = map[r.playlist_id];
        if (!slot) continue;
        slot.tokenSource = r.spotify_user_id ? "oauth" : r.app_id ? "app" : null;
        slot.lastCallAt = r.created_at;
      }

      return map;
    },
  });
}
