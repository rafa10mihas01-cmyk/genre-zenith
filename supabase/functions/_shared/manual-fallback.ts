// Classifica erros do Spotify e enfileira em manual_distribution_queue
// quando a execução automática não pode prosseguir. NUNCA marca o job como
// `failed` nesses casos — devolve `manual` para o caller atualizar o job.

import { SpotifyApiError } from "./spotify-playlist.ts";

export type ManualReason =
  | "spotify_401"
  | "spotify_403"
  | "spotify_429"
  | "no_account_connected"
  | "owner_without_token"
  | "playlist_collaborative";

export function classifyManualReason(e: unknown): ManualReason | null {
  if (e instanceof SpotifyApiError) {
    if (e.status === 401) return "spotify_401";
    if (e.status === 403) {
      const body = (e.message || "").toLowerCase();
      if (body.includes("collaborative")) return "playlist_collaborative";
      return "spotify_403";
    }
    if (e.status === 429) return "spotify_429";
    return null;
  }
  const msg = ((e as Error)?.message ?? String(e)).toLowerCase();
  if (msg.includes("nenhuma conta spotify conectada")) return "no_account_connected";
  if (msg.includes("sem token para spotify_user_id")) return "owner_without_token";
  if (msg.includes("owner_spotify_user_id não encontrado")) return "owner_without_token";
  if (msg.includes("collaborative")) return "playlist_collaborative";
  return null;
}

export async function enqueueManual(
  supabase: any,
  params: {
    job: any;
    reason: ManualReason;
    fallback: boolean; // true quando veio de falha automática (AUTO_FAILED_FALLBACK_MANUAL)
    playlistName?: string | null;
    position?: number | null;
  },
) {
  const { job, reason, fallback, playlistName, position } = params;
  const status = fallback ? "AUTO_FAILED_FALLBACK_MANUAL" : "MANUAL_PENDING";

  // Evita duplicar para o mesmo job em estado aberto
  const { data: existing } = await supabase
    .from("manual_distribution_queue")
    .select("id")
    .eq("job_id", job.id)
    .in("status", ["MANUAL_PENDING", "AUTO_FAILED_FALLBACK_MANUAL"])
    .maybeSingle();
  if (existing?.id) return existing.id as string;

  const { data: inserted, error } = await supabase
    .from("manual_distribution_queue")
    .insert({
      job_id: job.id,
      campaign_id: job.campaign_id ?? null,
      playlist_id: job.playlist_id ?? null,
      spotify_playlist_id: job.spotify_playlist_id ?? null,
      playlist_name: playlistName ?? null,
      spotify_track_id: job.spotify_track_id ?? null,
      job_type: job.job_type ?? null,
      position: position ?? null,
      motivo: reason,
      status,
    })
    .select("id")
    .maybeSingle();
  if (error) {
    console.log(JSON.stringify({ evt: "manual_queue.insert_error", error: error.message, job_id: job.id }));
    return null;
  }
  return inserted?.id ?? null;
}
