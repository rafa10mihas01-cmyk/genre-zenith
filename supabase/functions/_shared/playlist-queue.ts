// playlist-queue.ts — Helper para enfileirar operações em playlist_operation_queue.
//
// Uso:
//   await enqueuePlaylistJob(sb, {
//     playlist_id,
//     operation_type: "AUTO_SYNC",
//     priority: 3,           // 1=alta, 2=média, 3=baixa
//     payload: { ... },      // opcional
//     scheduled_for: null,   // opcional, default now()
//   });
//
// Dedupe: se já existe job 'pending' com mesmo (playlist_id, operation_type),
// o enqueue é skippado e retorna { skipped: true, reason: "duplicate_pending" }.

export type QueueOperation =
  | "AUTO_SYNC"
  | "MANUAL_EDITOR"
  | "DIAGNOSE_ENGINE"
  | "MAINTENANCE"
  | "BACKFILL"
  | "BRAIN_CALC";

export type EnqueueInput = {
  playlist_id: string;
  operation_type: QueueOperation;
  priority?: 1 | 2 | 3;
  payload?: Record<string, unknown>;
  scheduled_for?: string | Date | null;
  max_attempts?: number;
};

export type EnqueueResult =
  | { ok: true; id: string; skipped?: false }
  | { ok: true; skipped: true; reason: "duplicate_pending"; existing_id: string }
  | { ok: false; error: string };

export const PRIORITY_BY_OPERATION: Record<QueueOperation, 1 | 2 | 3> = {
  MANUAL_EDITOR: 1,
  DIAGNOSE_ENGINE: 1,
  BRAIN_CALC: 2,
  MAINTENANCE: 3,
  AUTO_SYNC: 3,
  BACKFILL: 3,
};

export async function enqueuePlaylistJob(sb: any, input: EnqueueInput): Promise<EnqueueResult> {
  if (!input.playlist_id) return { ok: false, error: "playlist_id obrigatório" };
  if (!input.operation_type) return { ok: false, error: "operation_type obrigatório" };

  // Dedupe: já existe pending pra essa playlist + operation?
  const { data: existing, error: dupErr } = await sb
    .from("playlist_operation_queue")
    .select("id")
    .eq("playlist_id", input.playlist_id)
    .eq("operation_type", input.operation_type)
    .eq("status", "pending")
    .limit(1)
    .maybeSingle();
  if (dupErr) return { ok: false, error: `dedupe check: ${dupErr.message}` };
  if (existing?.id) {
    return { ok: true, skipped: true, reason: "duplicate_pending", existing_id: existing.id };
  }

  const priority = input.priority ?? PRIORITY_BY_OPERATION[input.operation_type] ?? 3;
  const scheduled =
    input.scheduled_for == null
      ? new Date().toISOString()
      : (typeof input.scheduled_for === "string"
          ? input.scheduled_for
          : input.scheduled_for.toISOString());

  const { data, error } = await sb
    .from("playlist_operation_queue")
    .insert({
      playlist_id: input.playlist_id,
      operation_type: input.operation_type,
      priority,
      payload: input.payload ?? {},
      scheduled_for: scheduled,
      max_attempts: input.max_attempts ?? 3,
    })
    .select("id")
    .single();

  if (error) return { ok: false, error: error.message };
  return { ok: true, id: data.id };
}

/**
 * Backoff exponencial: 2min, 8min, 32min, ...
 * attempt = 1 → 2min; attempt = 2 → 8min; attempt = 3 → 32min
 */
export function backoffSecondsForAttempt(attempt: number): number {
  const minutes = Math.pow(4, Math.max(0, attempt - 1)) * 2;
  return minutes * 60;
}
