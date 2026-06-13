// MusicasTab — lista de músicas no catálogo + KPIs operacionais + botão "Adicionar música".
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, Music2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Kpi } from "@/components/ui/kpi";
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

type Summary = {
  total_tracks: number;
  total_playlists: number;
  active_placements: number;
  capacity_total: number;
  capacity_used: number;
  capacity_available: number;
};

async function fetchSummary(): Promise<Summary> {
  const [tracksRes, playlistsRes, placementsRes, occupancyRes] = await Promise.all([
    supabase.from("catalog_tracks").select("id", { count: "exact", head: true }).eq("status", "active"),
    supabase.from("managed_playlists").select("id", { count: "exact", head: true }).eq("is_catalog", true),
    supabase.from("catalog_placements").select("id", { count: "exact", head: true }).eq("status", "active"),
    supabase.from("v_catalog_playlist_occupancy").select("catalog_capacity, active_placements, available_slots"),
  ]);

  const totals = (occupancyRes.data ?? []).reduce(
    (acc, row: any) => {
      acc.cap += row.catalog_capacity ?? 0;
      acc.used += row.active_placements ?? 0;
      acc.avail += row.available_slots ?? 0;
      return acc;
    },
    { cap: 0, used: 0, avail: 0 },
  );

  return {
    total_tracks: tracksRes.count ?? 0,
    total_playlists: playlistsRes.count ?? 0,
    active_placements: placementsRes.count ?? 0,
    capacity_total: totals.cap,
    capacity_used: totals.used,
    capacity_available: totals.avail,
  };
}

async function fetchTracks(): Promise<CatalogTrack[]> {
  const { data, error } = await supabase
    .from("catalog_tracks")
    .select("id, spotify_track_id, track_name, artist_name, cover_url, isrc, status, added_at")
    .order("added_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data ?? []) as CatalogTrack[];
}

export function MusicasTab() {
  const [addOpen, setAddOpen] = useState(false);

  const summaryQ = useQuery({ queryKey: ["catalog", "summary"], queryFn: fetchSummary, staleTime: 30_000 });
  const tracksQ = useQuery({ queryKey: ["catalog", "tracks"], queryFn: fetchTracks, staleTime: 30_000 });

  const s = summaryQ.data;
  const fmt = (n: number | null | undefined) =>
    typeof n === "number" ? n.toLocaleString("pt-BR") : "—";
  const pct =
    s && s.capacity_total > 0 ? Math.round((s.capacity_used / s.capacity_total) * 100) : null;

  return (
    <>
      {/* Resumo operacional */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Kpi label="Músicas no catálogo" value={fmt(s?.total_tracks)} variant="compact" />
        <Kpi label="Playlists do catálogo" value={fmt(s?.total_playlists)} variant="compact" />
        <Kpi label="Placements ativos" value={fmt(s?.active_placements)} variant="compact" />
        <Kpi label="Capacidade total" value={fmt(s?.capacity_total)} variant="compact" />
        <Kpi
          label="Capacidade utilizada"
          value={fmt(s?.capacity_used)}
          variant="compact"
          hint={pct != null ? `${pct}% ocupado` : undefined}
        />
        <Kpi label="Capacidade disponível" value={fmt(s?.capacity_available)} variant="compact" />
      </div>

      {/* Header + ação */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Músicas</h2>
          <p className="text-sm text-muted-foreground">
            Catálogo de faixas distribuídas na rede de playlists.
          </p>
        </div>
        <Button onClick={() => setAddOpen(true)} className="gap-2">
          <Plus className="h-4 w-4" />
          Adicionar música
        </Button>
      </div>

      {/* Tabela */}
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
                <TableHead>Adicionada em</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(tracksQ.data ?? []).map((t) => (
                <TableRow key={t.id}>
                  <TableCell>
                    {t.cover_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
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
          summaryQ.refetch();
          tracksQ.refetch();
        }}
      />
    </>
  );
}
