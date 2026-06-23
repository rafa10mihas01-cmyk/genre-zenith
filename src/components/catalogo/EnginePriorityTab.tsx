// Engine — Pergunta operacional: "Quais playlists mais entregam para o meu catálogo?"
// Ranking principal por plays entregues, agregando placements por playlist.
// O conteúdo antigo (scores, distribuição, calibração) fica em "Diagnóstico da Engine" (colapsado).
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Brain, Play, Save, RefreshCw, ChevronDown, ListMusic, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// Tipos
// ─────────────────────────────────────────────────────────────────────────────
type PlacementRow = {
  id: string;
  managed_playlist_id: string;
  catalog_track_id: string;
  status: string;
  added_at: string | null;
  created_at: string;
  removed_at: string | null;
};

type ManagedRow = {
  id: string;
  spotify_playlist_id: string;
  name: string;
  cover_url: string | null;
  spotify_url: string | null;
  archived_at: string | null;
  followers: number | null;
};

type CatalogTrackRow = {
  id: string;
  spotify_track_id: string | null;
};

type PlaylistDeliveryRow = {
  managed_playlist_id: string;
  spotify_playlist_id: string | null;
  display_name: string;
  cover_url: string | null;
  spotify_url: string | null;
  followers: number | null;
  total_plays_7d: number | null;
  exact_delivery: number;
  attributed_delivery: number;
  catalog_tracks: number;
  active_tracks: number;
  removed_tracks: number;
  last_delivery: string | null;
  status: "active" | "partial" | "removed";
  archived: boolean;
  growth_delta: number | null;
  source: "playlist_breakdown" | "catalog_growth" | "mixed" | "placement_only";
  exact_tracks: number;
  attributed_tracks: number;
};

type TrackTelemetryRow = {
  catalog_track_id: string;
  baseline_at: string | null;
  last_captured_at: string | null;
  last_plays_28d: number | null;
  growth_abs: number | null;
  growth_pct: number | null;
  snapshots_count: number;
};

type PlaylistBreakdownPoint = {
  current_plays_7d: number;
  delivery: number;
  growth_delta: number | null;
  last_at: string | null;
};

type PlaylistBreakdown = {
  byTrackPlaylist: Record<string, Record<string, PlaylistBreakdownPoint>>;
};

type ScoreRow = {
  placement_id: string;
  score: number;
  components: any;
  calculated_at: string;
  managed_playlist_id: string;
  catalog_track_id: string;
  track_name: string | null;
  artist_name: string | null;
};

// ─────────────────────────────────────────────────────────────────────────────
// Fetchers — fonte primária: catalog_placements (entrega real)
// ─────────────────────────────────────────────────────────────────────────────
// Uma única query: placements + managed_playlists embedded + catalog_tracks embedded.
type PlacementJoined = {
  id: string;
  managed_playlist_id: string;
  catalog_track_id: string;
  status: string;
  added_at: string | null;
  removed_at: string | null;
  managed_playlists: {
    id: string;
    spotify_playlist_id: string | null;
    name: string | null;
    cover_url: string | null;
    spotify_url: string | null;
    archived_at: string | null;
    followers: number | null;
  } | null;
  catalog_tracks: { id: string; spotify_track_id: string | null } | null;
};

async function fetchPlacementsJoined(): Promise<PlacementJoined[]> {
  const { data, error } = await supabase
    .from("catalog_placements")
    .select(
      `id, managed_playlist_id, catalog_track_id, status, added_at, removed_at,
       managed_playlists ( id, spotify_playlist_id, name, cover_url, spotify_url, archived_at, followers ),
       catalog_tracks ( id, spotify_track_id )`,
    )
    .in("status", ["active", "removed"])
    .limit(20000);
  if (error) throw error;
  return (data ?? []) as unknown as PlacementJoined[];
}


async function fetchTrackTelemetry(): Promise<Record<string, TrackTelemetryRow>> {
  const { data, error } = await supabase
    .from("v_catalog_track_telemetry")
    .select("catalog_track_id, baseline_at, last_captured_at, last_plays_28d, growth_abs, growth_pct, snapshots_count")
    .limit(20000);
  if (error) throw error;
  return Object.fromEntries(((data ?? []) as TrackTelemetryRow[]).map((r) => [r.catalog_track_id, r]));
}

// Breakdown exato quando existe: song_snapshot_playlists por snapshot da música.
// Importante: algumas coletas do catálogo gravam apenas total agregado em song_snapshots;
// nesses casos o fallback fica em v_catalog_track_telemetry, sem inventar nova fonte.
async function fetchPlaylistBreakdown(
  spotifyToCatalogTrack: Record<string, string>,
): Promise<PlaylistBreakdown> {
  const spotifyIds = new Set(Object.keys(spotifyToCatalogTrack));
  if (spotifyIds.size === 0) return { byTrackPlaylist: {} };
  const { data, error } = await supabase
    .from("song_snapshot_playlists")
    .select(
      "spotify_playlist_id, plays_7d, created_at, song_snapshots!inner(spotify_song_id, catalog_track_id, captured_at)",
    )
    .limit(50000);
  if (error) throw error;

  const series: Record<string, Record<string, Array<{ at: string; plays: number }>>> = {};
  for (const r of (data ?? []) as any[]) {
    const snap = r.song_snapshots;
    if (!snap) continue;
    const trackId = snap.catalog_track_id ?? spotifyToCatalogTrack[snap.spotify_song_id];
    if (!trackId) continue;
    const pid = r.spotify_playlist_id;
    const at = r.created_at ?? snap.captured_at;
    if (!pid || !at) continue;
    series[trackId] ??= {};
    series[trackId][pid] ??= [];
    series[trackId][pid].push({ at, plays: Number(r.plays_7d) || 0 });
  }

  const byTrackPlaylist: PlaylistBreakdown["byTrackPlaylist"] = {};
  for (const [trackId, byPlaylist] of Object.entries(series)) {
    byTrackPlaylist[trackId] = {};
    for (const [pid, points] of Object.entries(byPlaylist)) {
      points.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
      const first = points[0]?.plays ?? 0;
      const last = points[points.length - 1]?.plays ?? 0;
      const prev = points.length >= 2 ? points[points.length - 2].plays : null;
      byTrackPlaylist[trackId][pid] = {
        current_plays_7d: last,
        delivery: Math.max(0, last - first),
        growth_delta: prev == null ? null : last - prev,
        last_at: points[points.length - 1]?.at ?? null,
      };
    }
  }
  return { byTrackPlaylist };
}

async function fetchTopScores(): Promise<ScoreRow[]> {
  const { data, error } = await supabase
    .from("v_placement_priority_latest")
    .select("*")
    .order("score", { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data ?? []) as ScoreRow[];
}

async function fetchLatestRun() {
  const { data, error } = await supabase
    .from("engine_priority_runs")
    .select("*")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function fetchWeights(): Promise<Record<string, number>> {
  const { data, error } = await supabase
    .from("system_flags")
    .select("engine_priority_weights")
    .order("id")
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data?.engine_priority_weights ?? {}) as Record<string, number>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constantes de calibração
// ─────────────────────────────────────────────────────────────────────────────
const COMPONENT_KEYS = [
  "spotify_popularity",
  "campaign_boost",
  "growth",
  "release_age",
  "artist_score",
  "diversity_penalty",
  "learning_signal",
] as const;

const COMPONENT_LABELS: Record<string, string> = {
  spotify_popularity: "Popularidade Spotify",
  campaign_boost: "Boost de campanha",
  growth: "Crescimento",
  release_age: "Idade do lançamento",
  artist_score: "Força do artista",
  diversity_penalty: "Diversidade",
  learning_signal: "Aprendizado",
};

function bucket(score: number) {
  if (score < 20) return "0-20";
  if (score < 40) return "20-40";
  if (score < 60) return "40-60";
  if (score < 80) return "60-80";
  return "80+";
}

// ─────────────────────────────────────────────────────────────────────────────
// Componente principal
// ─────────────────────────────────────────────────────────────────────────────
export function EnginePriorityTab() {
  const qc = useQueryClient();
  const [selectedPlaylist, setSelectedPlaylist] = useState<PlaylistDeliveryRow | null>(null);

  const placementsQ = useQuery({
    queryKey: ["engine-delivery", "placements-joined-v2"],
    queryFn: fetchPlacementsJoined,
    staleTime: 15_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });

  const spotifyToCatalogTrack = useMemo(() => {
    const out: Record<string, string> = {};
    for (const p of placementsQ.data ?? []) {
      const id = p.catalog_tracks?.spotify_track_id;
      if (id) out[id] = p.catalog_track_id;
    }
    return out;
  }, [placementsQ.data]);

  const breakdownQ = useQuery({
    queryKey: ["engine-delivery", "playlist-breakdown", Object.keys(spotifyToCatalogTrack).length],
    queryFn: () => fetchPlaylistBreakdown(spotifyToCatalogTrack),
    enabled: Object.keys(spotifyToCatalogTrack).length > 0,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const telemetryQ = useQuery({
    queryKey: ["engine-delivery", "track-telemetry"],
    queryFn: fetchTrackTelemetry,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  useEffect(() => {
    const channel = supabase
      .channel("engine-priority-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "engine_priority_runs" }, () => {
        qc.invalidateQueries({ queryKey: ["engine-diagnostic"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "placement_priority_scores" }, () => {
        qc.invalidateQueries({ queryKey: ["engine-diagnostic"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "catalog_placements" }, () => {
        qc.invalidateQueries({ queryKey: ["engine-delivery"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "song_snapshots" }, () => {
        qc.invalidateQueries({ queryKey: ["engine-delivery"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "song_snapshot_playlists" }, () => {
        qc.invalidateQueries({ queryKey: ["engine-delivery"] });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [qc]);

  const rows = useMemo<PlaylistDeliveryRow[]>(() => {
    const placements = placementsQ.data ?? [];
    const byTrackPlaylist = breakdownQ.data?.byTrackPlaylist ?? {};
    const telemetry = telemetryQ.data ?? {};

    const byMp = new Map<string, PlacementJoined[]>();
    const activeByTrack = new Map<string, number>();
    for (const p of placements) {
      const list = byMp.get(p.managed_playlist_id) ?? [];
      list.push(p);
      byMp.set(p.managed_playlist_id, list);
      if (p.status === "active") {
        activeByTrack.set(p.catalog_track_id, (activeByTrack.get(p.catalog_track_id) ?? 0) + 1);
      }
    }

    const out: PlaylistDeliveryRow[] = [];
    for (const [mpId, list] of byMp.entries()) {
      const mp = list[0]?.managed_playlists ?? null;
      const active = list.filter((x) => x.status === "active").length;
      const removed = list.filter((x) => x.status === "removed").length;
      if (active === 0 && removed === 0) continue;
      const last_delivery =
        list.map((x) => x.added_at).filter(Boolean).sort().pop() ?? null;
      const status: PlaylistDeliveryRow["status"] =
        active > 0 && removed === 0 ? "active" : active > 0 ? "partial" : "removed";
      const pid = mp?.spotify_playlist_id ?? null;

      let exactCurrent = 0;
      let exactDelivery = 0;
      let exactGrowth = 0;
      let hasExactGrowth = false;
      let attributedDelivery = 0;
      const exactTracks = new Set<string>();
      const attributedTracks = new Set<string>();

      for (const p of list) {
        if (!pid) continue;
        const exact = byTrackPlaylist[p.catalog_track_id]?.[pid];
        if (exact) {
          exactTracks.add(p.catalog_track_id);
          exactCurrent += exact.current_plays_7d;
          exactDelivery += exact.delivery;
          if (exact.growth_delta != null) {
            exactGrowth += exact.growth_delta;
            hasExactGrowth = true;
          }
          continue;
        }

        if (p.status !== "active") continue;
        const tel = telemetry[p.catalog_track_id];
        const growth = Number(tel?.growth_abs ?? 0);
        const activeCount = activeByTrack.get(p.catalog_track_id) ?? 0;
        if (tel?.snapshots_count > 1 && growth > 0 && activeCount > 0) {
          attributedTracks.add(p.catalog_track_id);
          attributedDelivery += growth / activeCount;
        }
      }

      const totalDelivery = Math.round(exactDelivery + attributedDelivery);
      const source: PlaylistDeliveryRow["source"] =
        exactDelivery > 0 && attributedDelivery > 0
          ? "mixed"
          : exactDelivery > 0
            ? "playlist_breakdown"
            : attributedDelivery > 0
              ? "catalog_growth"
              : "placement_only";

      out.push({
        managed_playlist_id: mpId,
        spotify_playlist_id: pid,
        display_name: mp?.name ?? "Playlist sem nome",
        cover_url: mp?.cover_url ?? null,
        spotify_url: mp?.spotify_url ?? null,
        followers: mp?.followers ?? null,
        total_plays_7d: totalDelivery > 0 ? totalDelivery : exactCurrent > 0 ? exactCurrent : null,
        exact_delivery: Math.round(exactDelivery),
        attributed_delivery: Math.round(attributedDelivery),
        catalog_tracks: list.length,
        active_tracks: active,
        removed_tracks: removed,
        last_delivery,
        status,
        archived: !!mp?.archived_at,
        growth_delta: hasExactGrowth ? exactGrowth : attributedDelivery > 0 ? Math.round(attributedDelivery) : null,
        source,
        exact_tracks: exactTracks.size,
        attributed_tracks: attributedTracks.size,
      });
    }
    out.sort((a, b) => {
      const pa = deliveryValue(a);
      const pb = deliveryValue(b);
      if (pb !== pa) return pb - pa;
      if (b.active_tracks !== a.active_tracks) return b.active_tracks - a.active_tracks;
      return (b.last_delivery ?? "").localeCompare(a.last_delivery ?? "");
    });
    return out;
  }, [placementsQ.data, breakdownQ.data, telemetryQ.data]);

  const totalActiveTracks = rows.reduce((a, b) => a + b.active_tracks, 0);
  const totalActive = rows.filter((r) => r.status === "active").length;
  const totalPartial = rows.filter((r) => r.status === "partial").length;

  const loading = placementsQ.isLoading || telemetryQ.isLoading;



  return (
    <div className="space-y-6">
      {/* Cabeçalho da pergunta */}
      <section className="rounded-2xl border border-border bg-card p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Pergunta</div>
            <h2 className="text-base sm:text-lg font-semibold mt-0.5">
              Quais playlists mais entregam resultado para o catálogo?
            </h2>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => qc.invalidateQueries({ queryKey: ["engine-delivery"] })}
            className="gap-1.5 shrink-0"
          >
            <RefreshCw className="h-4 w-4" />
            <span className="hidden sm:inline">Recarregar</span>
          </Button>
        </div>
        <div className="grid grid-cols-3 gap-2 mt-4">
          <Kpi label="Faixas entregues" value={totalActiveTracks} />
          <Kpi label="Playlists ativas" value={totalActive} />
          <Kpi label="Parcialmente ativas" value={totalPartial} />
        </div>
      </section>


      {/* Ranking de playlists */}
      <section className="rounded-2xl border border-border bg-card">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <ListMusic className="h-4 w-4 text-primary shrink-0" />
            Ranking por entrega ({rows.length})
          </h3>
          <span className="text-[11px] text-muted-foreground">ordenado por entrega</span>
        </div>


        {loading && (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">Carregando…</div>
        )}
        {!loading && rows.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            Sem entregas registradas em catalog_placements.
          </div>
        )}


        {/* Mobile: cards compactos com scroll */}
        <div className="sm:hidden max-h-[60vh] overflow-y-auto divide-y divide-border/50">
          {rows.map((r, i) => (
            <PlaylistRowMobile key={r.managed_playlist_id} rank={i + 1} row={r} />
          ))}
        </div>


        {/* Desktop: tabela com scroll */}
        <div className="hidden sm:block max-h-[70vh] overflow-y-auto overflow-x-auto">

          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wider text-muted-foreground">
              <tr className="border-b border-border">
                <th className="text-left px-3 py-2 w-10">#</th>
                <th className="text-left px-3 py-2">Playlist</th>
                <th className="text-right px-3 py-2 w-28">Plays 7d</th>
                <th className="text-right px-3 py-2 w-24">Crescimento</th>
                <th className="text-right px-3 py-2 w-20">Faixas</th>
                <th className="text-left px-3 py-2 w-36">Última entrega</th>
                <th className="text-left px-3 py-2 w-28">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.managed_playlist_id} className="border-b border-border/50 hover:bg-muted/30">
                  <td className="px-3 py-2 tabular-nums text-muted-foreground">{i + 1}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2 min-w-0">
                      {r.cover_url && (
                        <img src={r.cover_url} alt="" className="w-8 h-8 rounded object-cover shrink-0" />
                      )}
                      <div className="min-w-0">
                        <div className="font-medium truncate">{r.display_name}</div>
                        <div className="text-[11px] text-muted-foreground">
                          {r.archived ? "Arquivada" : r.followers != null ? `${fmtNumber(r.followers)} seguidores` : "Gerenciada"}
                        </div>

                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold text-primary">
                    {fmtNumber(r.total_plays_7d)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <GrowthCell delta={r.growth_delta} />
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {r.active_tracks}
                    {r.removed_tracks > 0 && (
                      <span className="text-muted-foreground"> /{r.catalog_tracks}</span>
                    )}
                  </td>

                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {r.last_delivery
                      ? new Date(r.last_delivery).toLocaleDateString("pt-BR", {
                          day: "2-digit",
                          month: "2-digit",
                          year: "2-digit",
                        })
                      : "—"}
                  </td>
                  <td className="px-3 py-2">
                    <StatusPill status={r.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Diagnóstico da Engine (colapsado) */}
      <EngineDiagnostic />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// UI helpers
// ─────────────────────────────────────────────────────────────────────────────
function PlaylistRowMobile({ rank, row }: { rank: number; row: PlaylistDeliveryRow }) {
  const hasPlays = row.total_plays_7d != null && row.total_plays_7d > 0;
  return (
    <div className="px-3 py-2 flex items-center gap-2.5">
      <span className="text-[11px] tabular-nums text-muted-foreground w-4 shrink-0 text-right">
        {rank}
      </span>
      {row.cover_url ? (
        <img src={row.cover_url} alt="" className="w-8 h-8 rounded object-cover shrink-0" />
      ) : (
        <div className="w-8 h-8 rounded bg-muted shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-medium leading-tight truncate">{row.display_name}</div>
        <div className="flex items-center gap-1.5 mt-0.5 text-[10px] text-muted-foreground">
          <StatusDot status={row.status} />
          <span className="tabular-nums">{row.active_tracks}f</span>
          {row.last_delivery && (
            <span>
              ·{" "}
              {new Date(row.last_delivery).toLocaleDateString("pt-BR", {
                day: "2-digit",
                month: "2-digit",
              })}
            </span>
          )}
          {row.followers != null && row.followers > 0 && (
            <span>· {fmtNumber(row.followers)} seg.</span>
          )}
        </div>
      </div>
      {hasPlays ? (
        <div className="text-right shrink-0">
          <div className="text-sm font-semibold tabular-nums text-primary leading-none">
            {fmtNumber(row.total_plays_7d)}
          </div>
          <div className="text-[9px] text-muted-foreground mt-0.5">plays 7d</div>
          {row.growth_delta != null && (
            <div className="text-[10px] mt-0.5">
              <GrowthCell delta={row.growth_delta} compact />
            </div>
          )}
        </div>
      ) : (
        <ChevronDown className="h-3.5 w-3.5 -rotate-90 text-muted-foreground/40 shrink-0" />
      )}
    </div>
  );
}

function StatusDot({ status }: { status: PlaylistDeliveryRow["status"] }) {
  const cls =
    status === "active"
      ? "bg-primary"
      : status === "partial"
        ? "bg-amber-400"
        : "bg-muted-foreground/40";
  return <span className={cn("inline-block w-1.5 h-1.5 rounded-full", cls)} />;
}


function GrowthCell({ delta, compact }: { delta: number | null; compact?: boolean }) {
  if (delta == null) return <span className="text-muted-foreground text-xs">—</span>;
  if (delta === 0)
    return (
      <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground tabular-nums">
        <Minus className="h-3 w-3" />0
      </span>
    );
  const up = delta > 0;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 tabular-nums font-medium",
        compact ? "text-xs" : "text-sm",
        up ? "text-primary" : "text-rose-400",
      )}
    >
      {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {up ? "+" : ""}
      {fmtNumber(delta)}
    </span>
  );
}

function StatusPill({ status, compact }: { status: PlaylistDeliveryRow["status"]; compact?: boolean }) {
  const map = {
    active: { label: "Ativa", cls: "bg-primary/15 text-primary border-primary/30" },
    partial: { label: "Parcial", cls: "bg-amber-500/15 text-amber-400 border-amber-500/30" },
    left: { label: "Saiu", cls: "bg-muted text-muted-foreground border-border" },
  } as const;
  const s = map[status];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 font-medium",
        compact ? "text-[10px]" : "text-[11px]",
        s.cls,
      )}
    >
      {s.label}
    </span>
  );
}

function Kpi({ label, value }: { label: string; value: any }) {
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold tabular-nums mt-0.5">{value}</div>
    </div>
  );
}

function fmtNumber(n: number | null | undefined) {
  if (n == null) return "—";

  if (!Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (Math.abs(n) >= 1_000) return (n / 1_000).toFixed(1) + "k";
  return String(Math.round(n));
}

// ─────────────────────────────────────────────────────────────────────────────
// Diagnóstico da Engine — conteúdo antigo (scores, runs, calibração)
// ─────────────────────────────────────────────────────────────────────────────
function EngineDiagnostic() {
  const qc = useQueryClient();
  const topQ = useQuery({
    queryKey: ["engine-diagnostic", "top"],
    queryFn: fetchTopScores,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  const runQ = useQuery({
    queryKey: ["engine-diagnostic", "run"],
    queryFn: fetchLatestRun,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  const weightsQ = useQuery({ queryKey: ["engine-diagnostic", "weights"], queryFn: fetchWeights });

  const [draft, setDraft] = useState<Record<string, string> | null>(null);
  const [selected, setSelected] = useState<ScoreRow | null>(null);

  const weights = weightsQ.data ?? {};
  const effectiveDraft =
    draft ?? Object.fromEntries(COMPONENT_KEYS.map((k) => [k, String(weights[k] ?? 1)]));

  const rows = topQ.data ?? [];
  const latestRun = runQ.data;

  const distribution = useMemo(() => {
    const buckets: Record<string, number> = { "0-20": 0, "20-40": 0, "40-60": 0, "60-80": 0, "80+": 0 };
    for (const r of rows) buckets[bucket(r.score)] += 1;
    return buckets;
  }, [rows]);

  const runMut = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("engine_priority_compute_all", { _limit: 5000 });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Cálculo de prioridade executado");
      qc.invalidateQueries({ queryKey: ["engine-diagnostic"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Falha ao executar"),
  });

  const saveMut = useMutation({
    mutationFn: async () => {
      const parsed: Record<string, number> = {};
      for (const k of COMPONENT_KEYS) {
        const v = Number(effectiveDraft[k]);
        if (!Number.isFinite(v)) throw new Error(`Peso inválido em ${COMPONENT_LABELS[k]}`);
        parsed[k] = v;
      }
      const { data: row, error: e1 } = await supabase
        .from("system_flags")
        .select("id")
        .order("id")
        .limit(1)
        .maybeSingle();
      if (e1) throw e1;
      if (!row) throw new Error("system_flags vazio");
      const { error } = await supabase
        .from("system_flags")
        .update({ engine_priority_weights: parsed })
        .eq("id", row.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Pesos salvos. Próximo cálculo já usará a nova calibração.");
      setDraft(null);
      qc.invalidateQueries({ queryKey: ["engine-diagnostic", "weights"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Falha ao salvar"),
  });

  return (
    <details className="group rounded-2xl border border-border bg-card">
      <summary className="flex items-center justify-between gap-2 cursor-pointer list-none px-4 py-3">
        <div className="flex items-center gap-2">
          <Brain className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Diagnóstico da Engine</h3>
          <span className="text-[11px] text-muted-foreground">
            scores, pesos e última execução
          </span>
        </div>
        <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>

      <div className="px-4 pb-4 space-y-4 border-t border-border pt-4">
        {/* KPIs do último run */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Kpi
            label="Placements avaliados"
            value={latestRun?.placements_evaluated ?? "—"}
          />
          <Kpi
            label="Score médio"
            value={latestRun?.score_avg != null ? Number(latestRun.score_avg).toFixed(1) : "—"}
          />
          <Kpi
            label="Score p90"
            value={latestRun?.score_p90 != null ? Number(latestRun.score_p90).toFixed(1) : "—"}
          />
          <Kpi
            label="Duração"
            value={latestRun?.duration_ms != null ? `${latestRun.duration_ms} ms` : "—"}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => runMut.mutate()} disabled={runMut.isPending} className="gap-1.5">
            <Play className="h-4 w-4" />
            {runMut.isPending ? "Executando…" : "Executar agora"}
          </Button>
          {latestRun?.started_at && (
            <span className="text-[11px] text-muted-foreground">
              Último run: {new Date(latestRun.started_at).toLocaleString("pt-BR")}
            </span>
          )}
        </div>

        {/* Distribuição dos scores */}
        <div className="rounded-xl border border-border/60 p-3">
          <div className="text-xs font-semibold mb-2">Distribuição dos scores ({rows.length})</div>
          <div className="grid grid-cols-5 gap-1.5">
            {Object.entries(distribution).map(([k, v]) => {
              const max = Math.max(1, ...Object.values(distribution));
              const pct = (v / max) * 100;
              return (
                <div key={k} className="flex flex-col items-center gap-1">
                  <div className="w-full h-12 bg-border/40 rounded-md overflow-hidden flex items-end">
                    <div className="w-full bg-primary/60" style={{ height: `${pct}%` }} />
                  </div>
                  <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{k}</div>
                  <div className="text-xs font-semibold tabular-nums">{v}</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Top placements por score */}
        <div className="rounded-xl border border-border/60">
          <div className="px-3 py-2 border-b border-border text-xs font-semibold">
            Top placements por score
          </div>
          <div className="divide-y divide-border/50 max-h-72 overflow-y-auto">
            {rows.slice(0, 30).map((r, i) => (
              <button
                key={r.placement_id}
                onClick={() => setSelected(r)}
                className={cn(
                  "w-full text-left px-3 py-2 flex items-center gap-2 hover:bg-muted/30",
                  selected?.placement_id === r.placement_id && "bg-muted/40",
                )}
              >
                <span className="text-[10px] tabular-nums text-muted-foreground w-5">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium truncate">{r.track_name ?? "—"}</div>
                  <div className="text-[10px] text-muted-foreground truncate">{r.artist_name ?? "—"}</div>
                </div>
                <span className="text-sm font-semibold tabular-nums text-primary">
                  {Number(r.score).toFixed(1)}
                </span>
              </button>
            ))}
            {rows.length === 0 && (
              <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                Nenhum score calculado ainda.
              </div>
            )}
          </div>
        </div>

        {selected && (
          <div className="rounded-xl border border-primary/30 p-3">
            <div className="flex items-start justify-between mb-2">
              <div className="min-w-0">
                <div className="text-[10px] text-muted-foreground uppercase tracking-wider">
                  Composição do score
                </div>
                <div className="text-sm font-semibold truncate">
                  {selected.track_name} — {selected.artist_name}
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-[10px] text-muted-foreground">Final</div>
                <div className="text-lg font-bold text-primary tabular-nums">
                  {Number(selected.score).toFixed(1)}
                </div>
              </div>
            </div>
            <ComponentsBreakdown components={selected.components} />
          </div>
        )}

        {/* Calibração de pesos */}
        <div className="rounded-xl border border-border/60 p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs font-semibold">Calibração de pesos</div>
            <div className="flex items-center gap-2">
              {draft && (
                <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>
                  Cancelar
                </Button>
              )}
              <Button
                size="sm"
                onClick={() => saveMut.mutate()}
                disabled={!draft || saveMut.isPending}
                className="gap-1.5"
              >
                <Save className="h-4 w-4" />
                Salvar
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {COMPONENT_KEYS.map((k) => (
              <label key={k} className="flex flex-col gap-1">
                <span className="text-[11px] text-muted-foreground">{COMPONENT_LABELS[k]}</span>
                <Input
                  type="number"
                  step="0.05"
                  value={effectiveDraft[k]}
                  onChange={(e) => setDraft({ ...effectiveDraft, [k]: e.target.value })}
                  className="h-8 text-sm"
                />
              </label>
            ))}
          </div>
        </div>
      </div>
    </details>
  );
}

function ComponentsBreakdown({ components }: { components: any }) {
  if (!components) return <div className="text-xs text-muted-foreground">Sem componentes.</div>;
  const raw = components.raw ?? components;
  const weighted = components.weighted ?? null;
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      <div>
        <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">
          Valor bruto
        </div>
        <div className="space-y-0.5">
          {Object.entries(raw).map(([k, v]) => (
            <BreakdownRow
              key={k}
              k={COMPONENT_LABELS[k] ?? k}
              v={typeof v === "boolean" ? (v ? "sim" : "não") : String(v)}
            />
          ))}
        </div>
      </div>
      {weighted && (
        <div>
          <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">
            Contribuição (× peso)
          </div>
          <div className="space-y-0.5">
            {Object.entries(weighted).map(([k, v]) => {
              const num = Number(v);
              return (
                <BreakdownRow
                  key={k}
                  k={COMPONENT_LABELS[k] ?? k}
                  v={(num >= 0 ? "+" : "") + num.toFixed(2)}
                  positive={num > 0}
                  negative={num < 0}
                />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function BreakdownRow({
  k,
  v,
  positive,
  negative,
}: {
  k: string;
  v: string;
  positive?: boolean;
  negative?: boolean;
}) {
  return (
    <div className="flex items-center justify-between text-xs border-b border-border/40 py-1">
      <span className="text-muted-foreground">{k}</span>
      <span
        className={cn(
          "tabular-nums font-medium",
          positive && "text-primary",
          negative && "text-rose-400",
        )}
      >
        {v}
      </span>
    </div>
  );
}
