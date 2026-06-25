// Wave 2 — Playlist Ecosystem Score
// POST {} ou {mode:"full"} → recalcula tudo
// POST {mode:"single", spotify_playlist_id:"..."} → recalcula uma playlist
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { reportCronHealth } from "../_shared/cron-health.ts";
import { logSnapshotBypass } from "../_shared/_snapshot-phase6.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ---------- Thresholds ----------
const TH = {
  MIN_DAYS_CONFIDENT: 4,
  AQUECIDA_GROWTH: 25,        // crescimento 28d > 25%
  AQUECIDA_SUBINDO_PCT: 30,   // ≥30% das faixas subindo
  ESFRIANDO_GROWTH: -10,
  ESFRIANDO_CAINDO_PCT: 30,
  SATURADA_PCT: 50,
  SUBUTILIZADA_TRACK_MAX: 1,  // só temos 0–1 faixa lá
};

type Snap = {
  song_id: string; playlist_id: string;
  plays: number; plays_7d: number; plays_28d: number;
  captured_at: string;
};

function pct(curr: number, prev: number): number | null {
  if (!prev || prev <= 0) return null;
  return ((curr - prev) / prev) * 100;
}

function classifyPlaylist(opts: {
  confidence: number;
  growth_28d: number | null;
  pct_subindo: number;
  pct_caindo: number;
  pct_saturada: number;
  track_count: number;
}): string {
  const { confidence, growth_28d, pct_subindo, pct_caindo, pct_saturada, track_count } = opts;
  if (confidence < 0.3) return "sem_dados";
  if (track_count <= TH.SUBUTILIZADA_TRACK_MAX) return "subutilizada";
  if (pct_saturada >= TH.SATURADA_PCT) return "saturada";
  if ((growth_28d ?? 0) <= TH.ESFRIANDO_GROWTH && pct_caindo >= TH.ESFRIANDO_CAINDO_PCT) return "esfriando";
  if ((growth_28d ?? 0) >= TH.AQUECIDA_GROWTH || pct_subindo >= TH.AQUECIDA_SUBINDO_PCT) return "aquecida";
  return "estavel";
}

async function processPlaylist(
  supabase: ReturnType<typeof createClient>,
  spotifyPlaylistId: string,
  kind: "curator" | "managed",
): Promise<{ ok: boolean; error?: string }> {
  // 1) Linhas de curator_playlists desta playlist (uma por faixa)
  // Em managed_playlists não há join track↔playlist ainda → fica como subutilizada/sem dados.
  let songRows: any[] = [];
  let meta: { name: string | null; curator: string | null; image: string | null; followers: number } =
    { name: null, curator: null, image: null, followers: 0 };

  if (kind === "curator") {
    const { data } = await supabase
      .from("v_curator_playlists_operational")
      .select("id, song_id, playlist_name, spotify_owner_name, image_url, followers")
      .eq("spotify_playlist_id", spotifyPlaylistId);
    songRows = data ?? [];
    if (songRows.length > 0) {
      meta = {
        name: songRows[0].playlist_name,
        curator: songRows[0].spotify_owner_name,
        image: songRows[0].image_url,
        followers: Number(songRows[0].followers ?? 0),
      };
    }
  } else {
    const { data } = await supabase
      .from("managed_playlists")
      .select("name, image_url, followers")
      .eq("spotify_playlist_id", spotifyPlaylistId)
      .maybeSingle();
    if (data) meta = { name: data.name, curator: "managed", image: data.image_url, followers: Number((data as any).followers ?? 0) };
  }

  const songIds = songRows.map((r) => r.song_id).filter(Boolean);
  const track_count = songIds.length;

  // 2) Snapshots para esta playlist (paginados, últimos 35d)
  const allSnaps: Snap[] = [];
  let lastSnapshotAt: string | null = null;
  let snapshotsUsed = 0;
  if (songIds.length > 0) {
    const since = new Date(Date.now() - 35 * 86400_000).toISOString();
    const PAGE = 1000;
    for (let from = 0; from < 30000; from += PAGE) {
      const { data: rows, error } = await supabase
        .from("curator_deal_snapshots")
        .select("song_id, playlist_id, plays, plays_7d, plays_28d, captured_at")
        .in("song_id", songIds)
        .gte("captured_at", since)
        .order("captured_at", { ascending: false })
        .range(from, from + PAGE - 1);
      if (error) break;
      const arr = (rows ?? []) as any[];
      if (arr.length === 0) break;
      if (!lastSnapshotAt) lastSnapshotAt = arr[0]?.captured_at ?? null;
      // Filtra só os snapshots desta playlist (playlist_id → curator_playlists.id)
      const playlistRowIds = new Set(songRows.map((r) => r.id));
      for (const r of arr) {
        if (!playlistRowIds.has(r.playlist_id)) continue;
        allSnaps.push({
          song_id: r.song_id,
          playlist_id: r.playlist_id,
          plays: Number(r.plays ?? 0),
          plays_7d: Number(r.plays_7d ?? 0),
          plays_28d: Number(r.plays_28d ?? 0),
          captured_at: r.captured_at,
        });
      }
      snapshotsUsed += arr.length;
      if (arr.length < PAGE) break;
    }
  }

  // Latest por song_id (cumulativo atual de cada faixa nesta playlist)
  const latestPerSong = new Map<string, Snap>();
  for (const s of allSnaps) {
    const ex = latestPerSong.get(s.song_id);
    if (!ex || s.captured_at > ex.captured_at) latestPerSong.set(s.song_id, s);
  }
  let total_streams = 0, streams_7d = 0, streams_28d = 0;
  for (const s of latestPerSong.values()) {
    total_streams += s.plays;
    streams_7d += s.plays_7d;
    streams_28d += s.plays_28d;
  }

  // 3) Daily agg → growth 28d
  const dayLatest = new Map<string, Map<string, Snap>>(); // day → song_id → latest
  const distinctDays = new Set<string>();
  for (const s of allSnaps) {
    const d = s.captured_at.slice(0, 10);
    distinctDays.add(d);
    let m = dayLatest.get(d);
    if (!m) { m = new Map(); dayLatest.set(d, m); }
    const ex = m.get(s.song_id);
    if (!ex || s.captured_at > ex.captured_at) m.set(s.song_id, s);
  }
  const daily = [...dayLatest.entries()]
    .map(([d, m]) => ({ day: d, total: [...m.values()].reduce((a, b) => a + b.plays, 0) }))
    .sort((a, b) => (a.day < b.day ? 1 : -1));
  const latestDay = daily[0];
  const findDayAround = (n: number) => {
    const cutoff = Date.now() - n * 86400_000;
    return daily.find((d) => new Date(d.day).getTime() <= cutoff);
  };
  const ref28 = findDayAround(28);
  const growth_28d_pct = latestDay && ref28 && ref28.total > 0 ? pct(latestDay.total, ref28.total) : null;

  // 4) Composição via track_ecosystem_score (já calculado pela Wave 1)
  let pct_subindo = 0, pct_caindo = 0, pct_saturada = 0, pct_estavel = 0, avg_track_momentum = 0;
  if (songIds.length > 0) {
    // Buscar spotify_track_ids dessas songs
    const { data: songMeta } = await supabase
      .from("curator_deal_songs")
      .select("id, spotify_track_id")
      .in("id", songIds);
    const trackIds = Array.from(new Set((songMeta ?? [])
      .map((s: any) => s.spotify_track_id).filter(Boolean)));
    if (trackIds.length > 0) {
      const { data: scores } = await supabase
        .from("track_ecosystem_score")
        .select("momentum_class")
        .in("spotify_track_id", trackIds);
      const buckets: Record<string, number> = {
        subindo: 0, forte: 0, estavel: 0, caindo: 0, saturada: 0, fraca: 0, sem_dados: 0,
      };
      for (const s of (scores ?? []) as any[]) {
        buckets[s.momentum_class] = (buckets[s.momentum_class] ?? 0) + 1;
      }
      const n = scores?.length ?? 0;
      if (n > 0) {
        pct_subindo = ((buckets.subindo + buckets.forte) / n) * 100;
        pct_caindo = (buckets.caindo / n) * 100;
        pct_saturada = (buckets.saturada / n) * 100;
        pct_estavel = (buckets.estavel / n) * 100;
        // Momentum numérico: subindo=2, forte=2, estavel=1, saturada=0, caindo=-1, fraca=-1
        const score = (buckets.subindo + buckets.forte) * 2 + buckets.estavel * 1
          + buckets.caindo * -1 + buckets.fraca * -1;
        avg_track_momentum = score / n;
      }
    }
  }

  const confidence = Math.min(1, distinctDays.size / TH.MIN_DAYS_CONFIDENT);
  // Eficiência simplificada: streams_28d por faixa, normalizado a um teto de 5000
  const efficiency_score = track_count > 0
    ? Math.max(0, Math.min(1, (streams_28d / track_count) / 5000))
    : 0;

  const health_class = classifyPlaylist({
    confidence, growth_28d: growth_28d_pct,
    pct_subindo, pct_caindo, pct_saturada, track_count,
  });

  const { error } = await supabase
    .from("playlist_ecosystem_score")
    .upsert({
      playlist_kind: kind,
      spotify_playlist_id: spotifyPlaylistId,
      playlist_name: meta.name,
      curator_name: meta.curator,
      image_url: meta.image,
      followers: meta.followers,
      track_count,
      total_streams,
      streams_7d,
      streams_28d,
      growth_28d_pct,
      avg_track_momentum,
      pct_subindo, pct_caindo, pct_saturada, pct_estavel,
      health_class,
      efficiency_score,
      confidence,
      snapshots_used: snapshotsUsed,
      last_snapshot_at: lastSnapshotAt,
      calculated_at: new Date().toISOString(),
    }, { onConflict: "playlist_kind,spotify_playlist_id" });

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  logSnapshotBypass(req, "calculate-playlist-ecosystem-score");
  const startedAt = Date.now();
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  const mode = body?.mode ?? "full";
  try {

    if (mode === "single") {
      const spid = body?.spotify_playlist_id;
      const kind = (body?.playlist_kind ?? "curator") as "curator" | "managed";
      if (!spid) {
        return new Response(JSON.stringify({ error: "spotify_playlist_id required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const result = await processPlaylist(supabase, spid, kind);
      return new Response(JSON.stringify({ mode, spid, kind, ...result }), {
        status: result.ok ? 200 : 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // FULL / BATCH: distinct (kind, spotify_playlist_id), processado em lote.
    // mode "full" (compat) = batch a partir de offset=0 com limit padrão.
    // mode "batch" {offset, limit} = janela explícita. Retorna {total, processed_to, has_more}.
    const offset = Number(body?.offset ?? 0);
    const limit = Math.min(Number(body?.limit ?? 20), 40);

    const targets: { id: string; kind: "curator" | "managed" }[] = [];
    const seen = new Set<string>();
    const PAGE = 1000;
    for (let from = 0; from < 50000; from += PAGE) {
      const { data, error } = await supabase
        .from("v_curator_playlists_operational")
        .select("spotify_playlist_id")
        .not("spotify_playlist_id", "is", null)
        .range(from, from + PAGE - 1);
      if (error) break;
      const arr = (data ?? []) as any[];
      if (arr.length === 0) break;
      for (const r of arr) {
        const k = `curator|${r.spotify_playlist_id}`;
        if (!seen.has(k)) { seen.add(k); targets.push({ id: r.spotify_playlist_id, kind: "curator" }); }
      }
      if (arr.length < PAGE) break;
    }
    const { data: managed } = await supabase
      .from("managed_playlists")
      .select("spotify_playlist_id")
      .not("spotify_playlist_id", "is", null);
    for (const r of (managed ?? []) as any[]) {
      const k = `managed|${r.spotify_playlist_id}`;
      if (!seen.has(k)) { seen.add(k); targets.push({ id: r.spotify_playlist_id, kind: "managed" }); }
    }
    // Ordenação estável para batches reprodutíveis
    targets.sort((a, b) => (a.kind + a.id).localeCompare(b.kind + b.id));

    const slice = targets.slice(offset, offset + limit);
    let ok = 0, failed = 0;
    const errors: string[] = [];
    const BATCH = 2;
    for (let i = 0; i < slice.length; i += BATCH) {
      const sub = slice.slice(i, i + BATCH);
      const results = await Promise.all(sub.map((t) => processPlaylist(supabase, t.id, t.kind)));
      for (const r of results) {
        if (r.ok) ok++; else { failed++; if (errors.length < 5 && r.error) errors.push(r.error); }
      }
    }

    const processed_to = offset + slice.length;
    const has_more = processed_to < targets.length;
    await reportCronHealth(supabase, {
      job_name: "calculate-playlist-ecosystem-score",
      status: failed > 0 ? "partial" : "ok",
      startedAt,
      metrics: { mode, total: targets.length, ok, failed, processed_to, has_more },
    });
    return new Response(JSON.stringify({
      mode: body?.mode ?? "full",
      total: targets.length,
      offset, limit, processed_to, has_more,
      ok, failed, sampleErrors: errors,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    await reportCronHealth(supabase, { job_name: "calculate-playlist-ecosystem-score", status: "error", startedAt, message: String(e) });
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
