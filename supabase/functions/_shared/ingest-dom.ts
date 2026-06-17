// Shared DOM ingest logic — used by bot-ingest-dom AND piggyback on bot-heartbeat.
// Single source of truth for processing playsMap snapshots from the VPS bot.
import { createClient } from "npm:@supabase/supabase-js@2";
import { assertDealOperable } from "./deal-access.ts";
import { classifyPlaylistKind } from "./algorithmic-classifier.ts";

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
  deduped_in_batch?: number;
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

async function ensureObservedPlaylist(
  supabase: ReturnType<typeof createClient>,
  item: DomItem,
  playlist: DomItem["playlists"][number],
  spotifyPlaylistId: string | null,
  isBaseline: boolean,
): Promise<string | null> {
  const playlistName = playlist.playlist_name?.trim() || null;
  if (!spotifyPlaylistId || !playlistName) return null;
  const { data: existing } = await supabase
    .from("curator_playlists")
    .select("id")
    .eq("deal_id", item.deal_id)
    .eq("song_id", item.song_id)
    .eq("spotify_playlist_id", spotifyPlaylistId)
    .maybeSingle();
  if ((existing as any)?.id) return (existing as any).id;

  const kind = classifyPlaylistKind(playlistName, (playlist as any).made_by ?? null, spotifyPlaylistId);
  const matchStatus = kind === "editorial" ? "editorial" : "organic";
  const { data: inserted } = await supabase
    .from("curator_playlists")
    .insert({
      deal_id: item.deal_id,
      song_id: item.song_id,
      spotify_url: playlist.spotify_url ?? `https://open.spotify.com/playlist/${spotifyPlaylistId}`,
      spotify_playlist_id: spotifyPlaylistId,
      playlist_name: playlistName,
      followers: (playlist as any).followers ?? null,
      spotify_owner_name: (playlist as any).made_by ?? null,
      is_baseline: isBaseline,
      match_status: matchStatus,
      attribution_method: "s4a_observed",
      attribution_reason: "Detectada automaticamente na aba Playlists do Spotify for Artists",
      streams_7d: toInt((playlist as any).plays_7d ?? 0),
      streams_28d: toInt((playlist as any).plays_28d ?? 0),
      streams_total: toInt((playlist as any).plays_28d ?? (playlist as any).plays_7d ?? (playlist as any).plays_24h ?? 0),
      last_paste_at: new Date().toISOString(),
    })
    .select("id")
    .maybeSingle();
  return ((inserted as any)?.id as string | undefined) ?? null;
}

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
    .select("id, state, closed_at, token_revoked_at, token_expires_at, campaign_id, source")
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

  // Se este deal é um shadow de campanha, vamos também alimentar campaign_eco_snapshots
  const campaignId: string | null = (dealRow as any)?.campaign_id ?? null;
  const isCampaignShadow = (dealRow as any)?.source === "campaign_internal" && !!campaignId;

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
      const intervalMin = (songRow as any)?.auto_collect_interval_minutes ?? 2880;
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

  // Dedupe dentro do lote: o bot pode mandar a mesma playlist várias vezes
  // (scrolls/re-renders). Mantém a entrada com mais dados preenchidos.
  const score = (x: any) =>
    (x.plays_24h != null ? 1 : 0) +
    (x.plays_7d  != null ? 1 : 0) +
    (x.plays_28d != null ? 1 : 0) +
    (x.followers != null ? 1 : 0);
  const dedupMap = new Map<string, any>();
  for (const p of playlists) {
    const key = extractId(p.spotify_url) ?? `name:${(p.playlist_name ?? "").trim().toLowerCase()}`;
    if (!key) continue;
    const prev = dedupMap.get(key);
    if (!prev || score(p) > score(prev)) dedupMap.set(key, p);
  }
  const dedupedPlaylists = Array.from(dedupMap.values());
  const dedupedOut = playlists.length - dedupedPlaylists.length;

  let inserted = 0;
  let skipped = 0;
  let totalPlays = 0;

  for (const p of dedupedPlaylists) {
    const sUrl = p.spotify_url ?? "";
    const sName = p.playlist_name ?? null;
    const sId = extractId(sUrl);

    const plays24h = p.plays_24h != null ? toInt(p.plays_24h) : null;
    const plays7d  = p.plays_7d  != null ? toInt(p.plays_7d)  : null;
    const plays28d = p.plays_28d != null ? toInt(p.plays_28d) : null;
    // Janela oficial agora é 7d. Fallback: 7d → 28d → 24h (compat) → 0.
    const plays = plays7d ?? plays28d ?? plays24h ?? 0;
    totalPlays += plays;

    let playlistId: string | null = null;
    let matchMethod: string | null = null;
    {
      const { data: matchData } = await supabase.rpc("match_curator_playlist", {
        p_deal_id: deal_id,
        p_spotify_playlist_id: sId,
        p_playlist_name: sName,
        p_song_id: song_id,
      });
      const row = Array.isArray(matchData) ? matchData[0] : null;
      if ((row as any)?.playlist_id) {
        playlistId = (row as any).playlist_id as string;
        matchMethod = ((row as any).match_method as string) ?? null;
      }
    }

    if (!playlistId) {
      if (isCampaignShadow) {
        playlistId = await ensureObservedPlaylist(supabase, item, p, sId, isBaseline);
        matchMethod = playlistId ? "s4a_observed" : matchMethod;
      }
      if (!playlistId) {
        const madeBy = (p as any).made_by ?? null;
        const kind = classifyPlaylistKind(sName, madeBy, sId);
      if (kind && sId) {
        await supabase.from("organic_plays_snapshots").insert({
          deal_id,
          song_id,
          spotify_track_id: null,
          spotify_playlist_id: sId,
          playlist_name: sName,
          kind,
          plays_24h: plays24h,
          plays_7d: plays7d,
          plays_28d: plays28d,
          source: p.source ?? "spotify_for_artists_dom",
          correlation_id: item.correlation_id ?? null,
        });
        continue;
      }

      const ref = sId ?? sName ?? "unknown";
      await supabase.from("collection_logs").insert({
        acao: "no_match",
        status: "alerta",
        mensagem: `[WARN] no_match: playlist ${ref} not registered in deal ${deal_id}`,
      });
      await supabase.rpc("create_notification", {
        p_type: "playlist_nao_identificada",
        p_title: "Playlist não identificada no deal",
        p_message: `Playlist não cadastrada no deal — verificar manualmente: ${ref}`,
        p_action_url: `/playlist-deals/${deal_id}`,
        p_metadata: { deal_id, song_id, spotify_playlist_id: sId, playlist_name: sName },
      });
      skipped++;
      continue;
      }
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
      is_initial_capture: isBaseline,
      correlation_id: item.correlation_id ?? null,
    });
    if (insErr) skipped++; else inserted++;

    // Espelha em campaign_eco_snapshots quando: shadow de campanha + playlist é própria (managed)
    if (isCampaignShadow && sId) {
      const { data: mp } = await supabase
        .from("managed_playlists")
        .select("id")
        .eq("spotify_playlist_id", sId)
        .maybeSingle();
      if ((mp as any)?.id) {
        const { error: ecoErr } = await supabase.from("campaign_eco_snapshots").insert({
          campaign_id: campaignId,
          managed_playlist_id: (mp as any).id,
          spotify_playlist_id: sId,
          plays_24h: plays24h,
          plays_7d: plays7d,
          plays_28d: plays28d,
          source: p.source ?? "spotify_for_artists_dom",
          correlation_id: item.correlation_id ?? null,
        });
        if (ecoErr) {
          console.warn("[ingest-dom] eco_snapshots insert failed:", ecoErr.message, { campaignId, sId });
        }
      }
    }
  }

  // Fase 1.A.1 — baseline oficial vai exclusivamente para
  // `campaign_playlist_collections` via writer compartilhado.
  // Sem campaign_id → skip estruturado em bot_events. Nada em legado.
  if (isBaseline) {
    const { writeBaselineOfficial } = await import("./baseline-writer.ts");
    const { data: allPls } = await supabase
      .from("curator_playlists")
      .select("spotify_playlist_id, playlist_name, song_id, spotify_url, streams_7d")
      .eq("deal_id", deal_id)
      .eq("song_id", song_id)
      .not("spotify_playlist_id", "is", null);
    const rows = (allPls ?? []).map((p: any) => ({
      spotify_playlist_id: p.spotify_playlist_id,
      playlist_name: p.playlist_name ?? null,
      playlist_url: p.spotify_url ?? null,
      plays_7d: Number(p.streams_7d ?? 0) || 0,
    }));
    await writeBaselineOfficial(supabase, {
      writer: "ingest-dom",
      deal_id,
      song_id,
      rows,
      campaign_id_hint: campaignId,
    });
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
  const intervalMin = (songRow as any)?.auto_collect_interval_minutes ?? 2880;
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

  return { song_id, ok: true, inserted, skipped, deduped_in_batch: dedupedOut };
}
