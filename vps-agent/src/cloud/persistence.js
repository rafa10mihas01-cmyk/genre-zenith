// Persistência: snapshots, eventos, atualização de song.
import { sb } from "./supabaseClient.js";

export async function insertBotEvent(payload) {
  const { error } = await sb.from("bot_events").insert(payload);
  if (error) throw new Error(`bot_events insert: ${error.message}`);
}

export async function insertDealSnapshot(payload) {
  const { data, error } = await sb.from("curator_deal_snapshots")
    .insert(payload).select("id").single();
  if (error) throw new Error(`curator_deal_snapshots insert: ${error.message}`);
  return data?.id;
}

export async function bumpDealSong({ song_id, intervalMinutes }) {
  const next = new Date(Date.now() + intervalMinutes * 60_000).toISOString();
  const { error } = await sb.from("curator_deal_songs").update({
    last_auto_collect_at: new Date().toISOString(),
    next_auto_collect_at: next,
    auto_collect_status: "idle",
    auto_collect_error: null,
  }).eq("id", song_id);
  if (error) throw new Error(`curator_deal_songs update: ${error.message}`);
}

export async function markDealSongError({ song_id, error: err }) {
  await sb.from("curator_deal_songs").update({
    auto_collect_status: "error",
    auto_collect_error: String(err).slice(0, 500),
    last_auto_collect_at: new Date().toISOString(),
  }).eq("id", song_id);
}

export async function getDealSong(song_id) {
  const { data, error } = await sb.from("curator_deal_songs")
    .select("id, deal_id, song_name, song_artist, song_spotify_url, spotify_track_id, baseline_plays, auto_collect_interval_minutes")
    .eq("id", song_id).maybeSingle();
  if (error) throw new Error(`curator_deal_songs select: ${error.message}`);
  return data;
}

export async function getPrintBatch(batch_id) {
  const { data, error } = await sb.from("bot_print_batches")
    .select("*").eq("id", batch_id).maybeSingle();
  if (error) throw new Error(`bot_print_batches select: ${error.message}`);
  return data;
}

export async function updatePrintBatch(batch_id, patch) {
  const { error } = await sb.from("bot_print_batches")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", batch_id);
  if (error) throw new Error(`bot_print_batches update: ${error.message}`);
}
