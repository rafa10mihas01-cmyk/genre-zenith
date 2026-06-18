import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BarChart3, RefreshCw, Activity } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { AnalyticsTabs } from "@/components/AnalyticsTabs";
import { PageContainer } from "@/components/PageContainer";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useScreenField } from "@/lib/screen-state";
import { useSetSidebarKpis } from "@/contexts/SidebarContext";

import { PerformanceKpis } from "@/components/performance/PerformanceKpis";
import { GenreRanking } from "@/components/performance/GenreRanking";
import { PlaylistsTable } from "@/components/performance/PlaylistsTable";
import { TopMovers } from "@/components/performance/TopMovers";
import { FollowersTimeline } from "@/components/performance/FollowersTimeline";
import MatrizPlaylists from "@/pages/MatrizPlaylists";
import type { DatasetRow, GenreRow } from "@/components/performance/types";

type ManagedPlaylistRow = {
  id: string;
  genre_id: string | null;
  name: string;
  spotify_playlist_id: string;
  spotify_url: string;
  followers: number;
  tracks_count: number;
  imported_at: string;
  updated_at: string;
  last_metrics_at: string | null;
};

type MetricsSnapshotRow = {
  spotify_playlist_id: string;
  followers: number;
  total_tracks: number | null;
  collected_at: string;
};

/**
 * /performance — lê APENAS o inventário vivo:
 *   - managed_playlists (playlists atuais da operação)
 *   - playlist_metrics_snapshots filtrado por essas playlists
 *   - playlist_brain apenas para timestamp/status
 *
 * Aposentado aqui: get_performance_dataset (baseado em playlist_templates antigas).
 */
export default function Performance() {
  const qc = useQueryClient();
  const [tracking, setTracking] = useState(false);
  const [activeTab, setActiveTab] = useScreenField<string>("/performance", "tab", "visao");

  const PERF_KEY = ["performance_dataset"] as const;

  const query = useQuery({
    queryKey: PERF_KEY,
    queryFn: async () => {
      const [{ data: playlists, error: playlistsError }, { data: gs }, { data: pb }] = await Promise.all([
        supabase
          .from("managed_playlists")
          .select("id, genre_id, name, spotify_playlist_id, spotify_url, followers, tracks_count, imported_at, updated_at, last_metrics_at")
          .is("archived_at", null)
          .order("imported_at", { ascending: false }),
        supabase.from("genres").select("id, nome").order("nome"),
        supabase
          .from("playlist_brain")
          .select("updated_at")
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      if (playlistsError) {
        toast.error(`Falha ao carregar playlists atuais: ${playlistsError.message}`);
        throw playlistsError;
      }

      const currentPlaylists = ((playlists ?? []) as ManagedPlaylistRow[]);
      const spotifyIds = currentPlaylists.map((p) => p.spotify_playlist_id).filter(Boolean);
      const { data: snapshots } = spotifyIds.length > 0
        ? await supabase
            .from("playlist_metrics_snapshots")
            .select("spotify_playlist_id, followers, total_tracks, collected_at")
            .in("spotify_playlist_id", spotifyIds)
            .order("collected_at", { ascending: true })
            .limit(10000)
        : { data: [] as MetricsSnapshotRow[] };

      const snapshotsByPlaylist = new Map<string, MetricsSnapshotRow[]>();
      ((snapshots ?? []) as MetricsSnapshotRow[]).forEach((snapshot) => {
        const list = snapshotsByPlaylist.get(snapshot.spotify_playlist_id) ?? [];
        list.push(snapshot);
        snapshotsByPlaylist.set(snapshot.spotify_playlist_id, list);
      });

      const liveDataset: DatasetRow[] = currentPlaylists.map((playlist) => {
        const history = snapshotsByPlaylist.get(playlist.spotify_playlist_id) ?? [];
        const first = history[0];
        const last = history[history.length - 1];
        const followersStart = first?.followers ?? playlist.followers ?? 0;
        const followersNow = last?.followers ?? playlist.followers ?? 0;
        const growth = followersNow - followersStart;
        const firstDate = first?.collected_at ?? playlist.imported_at;
        const lastDate = last?.collected_at ?? playlist.last_metrics_at ?? playlist.updated_at;
        const hours = Math.max(0, (new Date(lastDate).getTime() - new Date(firstDate).getTime()) / 36e5);

        return {
          template_id: playlist.id,
          genre_id: playlist.genre_id,
          nome: playlist.name,
          spotify_playlist_id: playlist.spotify_playlist_id,
          spotify_url: playlist.spotify_url,
          followers_start: followersStart,
          followers_now: followersNow,
          crescimento_absoluto: growth,
          crescimento_percentual: followersStart > 0 ? Number(((growth / followersStart) * 100).toFixed(2)) : null,
          tempo_horas: hours > 0 ? hours : null,
          total_tracks: last?.total_tracks ?? playlist.tracks_count ?? null,
          created_on_spotify_at: playlist.imported_at,
          last_snapshot_at: last?.collected_at ?? playlist.last_metrics_at,
        };
      });

      return {
        dataset: liveDataset,
        genres: ((gs as GenreRow[]) ?? []),
        lastUpdate: ((pb as any)?.updated_at as string | undefined) ?? null,
      };
    },
  });

  const dataset = useMemo(() => query.data?.dataset ?? [], [query.data?.dataset]);
  const genres = query.data?.genres ?? [];
  const lastUpdate = query.data?.lastUpdate ?? null;
  const loading = query.isLoading && !query.data;
  const load = () => qc.invalidateQueries({ queryKey: PERF_KEY });

  useSetSidebarKpis([
    {
      label: "Com dados",
      value: dataset.filter((d) => (d.followers_now ?? 0) > 0).length,
      intent: "primary",
    },
    {
      label: "Aguardando",
      value: dataset.filter((d) => !d.followers_now || d.followers_now === 0).length,
      intent: "warning",
    },
    { label: "Total", value: dataset.length, intent: "default" },
  ]);

  async function runTrack() {
    setTracking(true);
    try {
      const { data, error } = await supabase.functions.invoke("track-playlist-metrics", { body: {} });
      if (error) throw error;
      toast.success(`Snapshots ok: ${data?.snapshots_ok ?? 0} (falharam: ${data?.failed ?? 0})`);
      await load();
    } catch (e: any) {
      toast.error(`Falha ao coletar: ${e.message}`);
    } finally { setTracking(false); }
  }

  const totalPubs = dataset.length;
  const spotifyPlaylistIds = useMemo(() => dataset.map((d) => d.spotify_playlist_id).filter(Boolean), [dataset]);

  const heroStatus = useMemo(() => {
    if (loading && totalPubs === 0) {
      return { label: "Carregando dados", tone: "info" as const, pulse: true };
    }
    if (tracking) {
      return { label: "Coletando dados…", tone: "info" as const, pulse: true };
    }
    if (totalPubs === 0) {
      return { label: "Sem dados", tone: "muted" as const, pulse: false };
    }
    const withData = dataset.filter((d) => (d.followers_now ?? 0) > 0).length;
    if (withData === 0) {
      return { label: "Aguardando histórico", tone: "warning" as const, pulse: true };
    }
    return { label: "Sistema ativo", tone: "success" as const, pulse: false };
  }, [loading, tracking, totalPubs, dataset]);

  return (
    <PageContainer>
      <PageHeader
        domain="system"
        title="Performance"
        subtitle="Crescimento e resultados das playlists"
        actions={
          <Button variant="outline" size="sm" onClick={runTrack} disabled={tracking}>
            <RefreshCw className={`h-4 w-4 xl:mr-2 ${tracking ? "animate-spin" : ""}`} />
            <span className="hidden xl:inline">Coletar dados</span>
          </Button>
        }
      />
      <AnalyticsTabs />

      <HeroStatus status={heroStatus} totalPubs={totalPubs} lastUpdate={lastUpdate} />

      {totalPubs === 0 && !loading ? (
        <Card className="p-6 md:p-8 text-center">
          <BarChart3 className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
          <h3 className="font-bold text-base md:text-lg">Sem playlists publicadas</h3>
          <p className="text-xs md:text-sm text-muted-foreground mt-1.5 max-w-md mx-auto">
            Quando o módulo Operação publicar playlists no Spotify, elas aparecem aqui com métricas reais.
          </p>
        </Card>
      ) : (
        <>
          <PerformanceKpis dataset={dataset} loading={loading && totalPubs === 0} />

          <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-3 md:space-y-4">
            <TabsList>
              <TabsTrigger value="visao">Visão geral</TabsTrigger>
              <TabsTrigger value="detalhe">Detalhe ({totalPubs})</TabsTrigger>
              <TabsTrigger value="matriz">Matriz</TabsTrigger>
            </TabsList>

            <TabsContent value="visao" className="space-y-3 md:space-y-4 animate-tab-in mt-0">
              <FollowersTimeline playlistIds={spotifyPlaylistIds} />
              <TopMovers dataset={dataset} />
              <GenreRanking dataset={dataset} genres={genres} />
            </TabsContent>

            <TabsContent value="detalhe" className="min-h-[480px] animate-tab-in mt-0">
              <PlaylistsTable dataset={dataset} genres={genres} altaIds={new Set()} baixaIds={new Set()} />
            </TabsContent>

            <TabsContent value="matriz" className="min-h-[480px] animate-tab-in mt-0">
              <MatrizPlaylists embedded />
            </TabsContent>
          </Tabs>
        </>
      )}
    </PageContainer>
  );
}

/* ----------------------------------------------------------- */
type HeroTone = "info" | "primary" | "success" | "warning" | "muted";

const TONE_DOT: Record<HeroTone, string> = {
  info:    "bg-info",
  primary: "bg-primary",
  success: "bg-success",
  warning: "bg-warning",
  muted:   "bg-muted-foreground",
};

const TONE_TEXT: Record<HeroTone, string> = {
  info:    "text-info",
  primary: "text-primary",
  success: "text-success",
  warning: "text-warning",
  muted:   "text-muted-foreground",
};

function HeroStatus({
  status,
  totalPubs,
  lastUpdate,
}: {
  status: { label: string; tone: HeroTone; pulse: boolean };
  totalPubs: number;
  lastUpdate: string | null;
}) {
  return (
    <Card className="p-3 md:p-4 flex items-center gap-3 md:gap-4">
      <div className="relative shrink-0">
        <span className={`block h-2.5 w-2.5 rounded-full ${TONE_DOT[status.tone]}`} aria-hidden />
        {status.pulse && (
          <span className={`absolute inset-0 rounded-full ${TONE_DOT[status.tone]} opacity-60 animate-ping`} aria-hidden />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Activity className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground font-bold">
            Estado do sistema
          </span>
        </div>
        <div className={`text-sm md:text-base font-semibold leading-tight mt-0.5 ${TONE_TEXT[status.tone]}`}>
          {status.label}
        </div>
        {lastUpdate && (
          <div className="text-[10px] text-muted-foreground mt-0.5 tabular-nums">
            Última coleta: {new Date(lastUpdate).toLocaleString("pt-BR")}
          </div>
        )}
      </div>
      <div className="hidden sm:flex flex-col items-end shrink-0">
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">
          Publicadas
        </span>
        <span className="text-base md:text-lg font-bold tabular-nums leading-tight">
          {totalPubs}
        </span>
      </div>
    </Card>
  );
}
