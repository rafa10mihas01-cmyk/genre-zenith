// playlist-lock.ts — Lock operacional simples para managed_playlists + log de operação.
//
// Uso:
//   const lock = await acquirePlaylistLock(sb, playlistId, "AUTO_SYNC");
//   if (!lock.ok) return jr({ ok: false, error: "playlist_locked", locked_by: lock.locked_by }, 423);
//   try {
//     ... faz o trabalho ...
//     await finishPlaylistOperation(sb, lock, { status: "success", tracks_before, tracks_after });
//   } catch (e) {
//     await finishPlaylistOperation(sb, lock, { status: "failed", error: (e as Error).message });
//     throw e;
//   } finally {
//     await releasePlaylistLock(sb, lock);
//   }
//
// O lock expira automaticamente após 30s (TTL) caso a função trave.

const LOCK_TTL_SECONDS = 30;

export type LockedBy =
  | "MANUAL_EDITOR"
  | "AUTO_SYNC"
  | "DIAGNOSE_ENGINE"
  | "RECOVERY"
  | "MAINTENANCE";

export type LockHandle = {
  ok: true;
  playlist_id: string;
  locked_by: LockedBy;
  log_id: string | null;
  acquired_at: string;
};

export type LockFailure = {
  ok: false;
  reason: "playlist_locked";
  locked_by: string | null;
  locked_at: string | null;
};

export async function acquirePlaylistLock(
  sb: any,
  playlistId: string,
  lockedBy: LockedBy,
  tracksBefore?: number | null,
): Promise<LockHandle | LockFailure> {
  const now = new Date();
  const ttlCutoff = new Date(now.getTime() - LOCK_TTL_SECONDS * 1000).toISOString();

  // Tenta adquirir: só atualiza se locked_at for null OU mais velho que o TTL.
  const { data, error } = await sb
    .from("managed_playlists")
    .update({ locked_at: now.toISOString(), locked_by: lockedBy })
    .eq("id", playlistId)
    .or(`locked_at.is.null,locked_at.lt.${ttlCutoff}`)
    .select("id")
    .maybeSingle();

  if (error) {
    return { ok: false, reason: "playlist_locked", locked_by: null, locked_at: null };
  }

  if (!data) {
    // Não conseguiu — alguém já tem o lock e está dentro do TTL.
    const { data: cur } = await sb
      .from("managed_playlists")
      .select("locked_by, locked_at")
      .eq("id", playlistId)
      .maybeSingle();
    return {
      ok: false,
      reason: "playlist_locked",
      locked_by: cur?.locked_by ?? null,
      locked_at: cur?.locked_at ?? null,
    };
  }

  // Insere linha de log "running"
  let logId: string | null = null;
  try {
    const { data: log } = await sb
      .from("playlist_operation_log")
      .insert({
        playlist_id: playlistId,
        operation: lockedBy,
        started_at: now.toISOString(),
        tracks_before: tracksBefore ?? null,
        status: "running",
      })
      .select("id")
      .single();
    logId = log?.id ?? null;
  } catch { /* log é best-effort */ }

  return {
    ok: true,
    playlist_id: playlistId,
    locked_by: lockedBy,
    log_id: logId,
    acquired_at: now.toISOString(),
  };
}

export type FinishOpts = {
  status: "success" | "failed" | "aborted";
  tracks_before?: number | null;
  tracks_after?: number | null;
  tracks_changed?: number | null;
  conflict_detected?: boolean;
  retries?: number;
  divergence_count?: number;
  lock_timeout?: boolean;
  error?: string | null;
};

export async function finishPlaylistOperation(
  sb: any,
  lock: LockHandle,
  opts: FinishOpts,
): Promise<void> {
  if (!lock.log_id) return;
  try {
    await sb
      .from("playlist_operation_log")
      .update({
        finished_at: new Date().toISOString(),
        status: opts.status,
        tracks_before: opts.tracks_before ?? null,
        tracks_after: opts.tracks_after ?? null,
        tracks_changed: opts.tracks_changed ?? null,
        conflict_detected: !!opts.conflict_detected,
        retries: opts.retries ?? 0,
        divergence_count: opts.divergence_count ?? 0,
        lock_timeout: !!opts.lock_timeout,
        error: opts.error ?? null,
      })
      .eq("id", lock.log_id);
  } catch { /* best-effort */ }
}

export async function releasePlaylistLock(sb: any, lock: LockHandle): Promise<void> {
  try {
    await sb
      .from("managed_playlists")
      .update({ locked_at: null, locked_by: null })
      .eq("id", lock.playlist_id);
  } catch { /* best-effort */ }
}

export function lockedResponseBody(failure: LockFailure) {
  return {
    ok: false,
    error: "playlist_locked",
    message: `Playlist em uso por ${failure.locked_by ?? "outra operação"} desde ${failure.locked_at ?? "?"}. Tente novamente em alguns segundos.`,
    locked_by: failure.locked_by,
    locked_at: failure.locked_at,
  };
}
