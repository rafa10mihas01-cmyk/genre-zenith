// Shared DOM ingest logic — used by bot-ingest-dom AND piggyback on bot-heartbeat.
// Single source of truth for processing playsMap snapshots from the VPS bot.
import { createClient } from "npm:@supabase/supabase-js@2";
import { assertDealOperable } from "./deal-access.ts";

export type DomItem = {
  deal_id: string;
  song_id: string;
  playlists: Array<{
    playlist_name?: string | null;
    spotify_url?: string | null;
    plays_24h?: number | string | null;
    plays_7d?: number | string | null;
    plays_28d?: number | string | null;
    followers?: number | null;
    source?: string | null;
  }>;
  note?: string | null;
  correlation_id?: string | null;
};

export type DomItemResult = {
  song_id: string;
  ok: boolean;
  inserted?: number;
  skipped?: number;
  deduped?: boolean;
  error?: string;
};

const extractId = (url: string | null | undefined) => {
  if (!url) return null;
  const m = url.match(/playlist[/:]([a-zA-Z0-9]{16,})/);
  return m ? m[1] : null;
};

const toInt = (v: unknown) => {
  const n = parseInt(String(v ?? "")) || 0;
  return n > 0 ? n : 0;
};

export async function processDomItem(
  supabase: ReturnType<typeof createClient>,
  item: DomItem,
): Promise<DomItemResult> {
  const { deal_id, song_id, playlists, note } = item;

  if (!deal_id || !song_id) {
    return { song_id: song_id ?? "", ok: false, error: "deal_id and song_id required" };
  }
  if (!Array.isArray(playlists) || playlists.length === 0) {
    return { song_id, ok: false, error: "playlists array required" };
  }

  // Gate de ciclo de vida do deal
  const { data: dealRow } = await supabase
    .from("curator_deals")
    .select("id, state, closed_at, token_revoked_at, token_expires_at")
    .eq("id", deal_id)
    .maybeSingle();
  const gate = assertDealOperable(dealRow as any);
  if (!gate.ok) {
    await supabase
      .from("curator_deal_songs")
      .update({
        auto_collect_status: "idle",
        auto_collect_error: gate.error,
        next_auto_collect_at: new Date(Date.now() + 60 * 60_000).toISOString(),
        queued_at: null,
      })
      .eq("id", song_id);
    return { song_id, ok: false, error: gate.error };
  }

  // Dedupe: se já existe log dessa song nos últimos 90s, ignora
  {
    const since = new Date(Date.now() - 90_000).toISOString();
    const { data: recent } = await supabase
      .from("curator_deal_logs")
      .select("id")
      .eq("song_id", song_id)
      .gte("created_at", since)
      .limit(1);
    if (recent && recent.length > 0) {
      const { data: songRow } = await supabase
        .from("curator_deal_songs")
        .select("auto_collect_interval_minutes")
        .eq("id", song_id)
        .single();
      const intervalMin = (songRow as any)?.auto_collect_interval_minutes ?? 1440;
      const nextAt = new Date(Date.now() + intervalMin * 60_000).toISOString();
      await supabase
        .from("curator_deal_songs")
        .update({
          auto_collect_status: "idle",
          auto_collect_error: null,
          last_auto_collect_at: new Date().toISOString(),
          next_auto_collect_at: nextAt,
          queued_at: null,
        })
        .eq("id", song_id);
      return { song_id, ok: true, deduped: true, inserted: 0, skipped: 0 };
    }
  }

  // Detecta baseline (primeira coleta)
  const { count: existingLogs } = await supabase
    .from("curator_deal_logs")
    .select("id", { count: "exact", head: true })
    .eq("song_id", song_id);
  const isBaseline = (existingLogs ?? 0) === 0;

  let inserted = 0;
  let skipped = 0;
  let totalPlays = 0;

  for (const p of playlists) {
    const sUrl = p.spotify_url ?? "";
    const sName = p.playlist_name ?? null;
    const sId = extractId(sUrl);

    const plays24h = p.plays_24h != null ? toInt(p.plays_24h) : null;
    const plays7d  = p.plays_7d  != null ? toInt(p.plays_7d)  : null;
    const plays28d = p.plays_28d != null ? toInt(p.plays_28d) : null;
    const plays = plays24h ?? plays7d ?? plays28d ?? 0;
    totalPlays += plays;

    let playlistId: string | null = null;
    let matchMethod: string | null = null;
    {
      const { data: matchData } = await supabase.rpc("match_curator_playlist", {
        p_deal_id: deal_id,
        p_spotify_playlist_id: sId,
        p_playlist_name: sName,
      });
      const row = Array.isArray(matchData) ? matchData[0] : null;
      if ((row as any)?.playlist_id) {
        playlistId = (row as any).playlist_id as string;
        matchMethod = ((row as any).match_method as string) ?? null;
      }
    }

    if (!playlistId) {
      const { data: created, error: cErr } = await supabase
        .from("curator_playlists")
        .insert({
          deal_id,
          song_id,
          spotify_url: sUrl,
          spotify_playlist_id: sId,
          playlist_name: sName ?? "Sem nome",
          followers: p.followers ?? null,
        })
        .select("id")
        .single();
      if (cErr) { skipped++; continue; }
      playlistId = (created as any).id;
      matchMethod = "created";
    }

    const { error: insErr } = await supabase.from("curator_deal_snapshots").insert({
      deal_id,
      song_id,
      playlist_id: playlistId,
      plays,
      plays_24h: plays24h,
      plays_7d:  plays7d,
      plays_28d: plays28d,
      source: p.source ?? "spotify_for_artists_dom",
      match_method: matchMethod ?? (sId ? "spotify_id" : "name"),
      is_baseline: isBaseline,
      correlation_id: item.correlation_id ?? null,
    });
    if (insErr) skipped++; else inserted++;
  }

  await supabase.from("curator_deal_logs").insert({
    deal_id,
    song_id,
    total_plays: Math.max(0, totalPlays),
    note: note ?? (isBaseline ? `[bot dom] baseline inicial` : `[bot dom] coleta diária`),
    print_urls: [],
    is_baseline: isBaseline,
  });

  const { data: songRow } = await supabase
    .from("curator_deal_songs")
    .select("auto_collect_interval_minutes")
    .eq("id", song_id)
    .single();
  const intervalMin = (songRow as any)?.auto_collect_interval_minutes ?? 1440;
  const nextAt = new Date(Date.now() + intervalMin * 60_000).toISOString();

  await supabase
    .from("curator_deal_songs")
    .update({
      auto_collect_status: "idle",
      auto_collect_error: null,
      last_auto_collect_at: new Date().toISOString(),
      next_auto_collect_at: nextAt,
      queued_at: null,
    })
    .eq("id", song_id);

  return { song_id, ok: true, inserted, skipped };
}
