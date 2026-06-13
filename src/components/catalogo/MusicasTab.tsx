// MusicasTab — lista de faixas do catálogo com métricas de distribuição.
// KPIs + botão "Adicionar música" vivem na página pai (Catalogo.tsx);
// o dialog é aberto via evento global `catalogo:add-track`.
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Music2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { AddCatalogTrackDialog } from "./AddCatalogTrackDialog";

type CatalogTrack = {
  id: string;
  spotify_track_id: string;
  track_name: string;
  artist_name: string;
  cover_url: string | null;
  isrc: string | null;
  status: string;
  added_at: string;
};

type DistributionStats = {
  catalog_track_id: string;
  placements_total: number;
  placements_pending: number;
  placements_active: number;
  placements_failed: number;
};

async function fetchTracksWithStats(): Promise<Array<CatalogTrack & { stats: DistributionStats | null }>> {
  const [tracksRes, statsRes] = await Promise.all([
    supabase
      .from("catalog_tracks")
      .select("id, spotify_track_id, track_name, artist_name, cover_url, isrc, status, added_at")
      .order("added_at", { ascending: false })
      .limit(200),
    supabase
      .from("v_catalog_track_distribution_stats")
      .select("catalog_track_id, placements_total, placements_pending, placements_active, placements_failed"),
  ]);
  if (tracksRes.error) throw tracksRes.error;
  if (statsRes.error) throw statsRes.error;
  const statsMap = new Map<string, DistributionStats>(
    (statsRes.data ?? []).map((s: any) => [s.catalog_track_id, s as DistributionStats]),
  );
  return (tracksRes.data ?? []).map((t: any) => ({
    ...(t as CatalogTrack),
    stats: statsMap.get(t.id) ?? null,
  }));
}

function StatCell({ stats }: { stats: DistributionStats | null }) {
  if (!stats || stats.placements_total === 0) {
    return <span className="text-xs text-subtle-foreground">—</span>;
  }
  return (
    <div className="flex items-center gap-2 text-xs font-mono">
      <span className="text-foreground">{stats.placements_active}</span>
      <span className="text-subtle-foreground">/</span>
      <span className="text-foreground-body">{stats.placements_total}</span>
      {stats.placements_pending > 0 && (
        <span className="text-amber-400" title={`${stats.placements_pending} pendentes`}>
          •{stats.placements_pending}
        </span>
      )}
      {stats.placements_failed > 0 && (
        <span className="text-rose-400" title={`${stats.placements_failed} falhas`}>
          ✕{stats.placements_failed}
        </span>
      )}
    </div>
  );
}

export function MusicasTab() {
  const [addOpen, setAddOpen] = useState(false);
  const qc = useQueryClient();
  const tracksQ = useQuery({
    queryKey: ["catalog", "tracks"],
    queryFn: fetchTracksWithStats,
    staleTime: 15_000,
    refetchInterval: 20_000, // mantém métricas vivas enquanto o worker roda
  });

  useEffect(() => {
    const open = () => setAddOpen(true);
    window.addEventListener("catalogo:add-track", open);
    return () => window.removeEventListener("catalogo:add-track", open);
  }, []);

  return (
    <>
      <div className="border border-border rounded-2xl overflow-hidden bg-card">
        {tracksQ.isLoading ? (
          <div className="p-6 space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : (tracksQ.data ?? []).length === 0 ? (
          <div className="p-12 flex flex-col items-center justify-center text-center gap-3">
            <Music2 className="h-10 w-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Nenhuma música no catálogo ainda. Clique em "Adicionar música" pra começar.
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-14"></TableHead>
                <TableHead>Música</TableHead>
                <TableHead>Artista</TableHead>
                <TableHead>ISRC</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Distribuição</TableHead>
                <TableHead>Adicionada em</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(tracksQ.data ?? []).map((t) => (
                <TableRow key={t.id}>
                  <TableCell>
                    {t.cover_url ? (
                      <img
                        src={t.cover_url}
                        alt=""
                        className="h-10 w-10 rounded object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="h-10 w-10 rounded bg-muted flex items-center justify-center">
                        <Music2 className="h-4 w-4 text-muted-foreground" />
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="font-medium">{t.track_name}</TableCell>
                  <TableCell className="text-muted-foreground">{t.artist_name}</TableCell>
                  <TableCell className="text-muted-foreground text-xs font-mono">
                    {t.isrc ?? "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs capitalize">{t.status}</TableCell>
                  <TableCell>
                    <StatCell stats={t.stats} />
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {new Date(t.added_at).toLocaleDateString("pt-BR")}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <AddCatalogTrackDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onDistributed={() => {
          qc.invalidateQueries({ queryKey: ["catalog"] });
        }}
      />
    </>
  );
}
