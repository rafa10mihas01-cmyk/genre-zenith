// PlaylistsTab — ocupação por playlist do catálogo (view v_catalog_playlist_occupancy).
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type Row = {
  managed_playlist_id: string;
  playlist_name: string | null;
  catalog_capacity: number;
  active_placements: number;
  available_slots: number;
};

async function fetchOccupancy(): Promise<Row[]> {
  const { data, error } = await supabase
    .from("v_catalog_playlist_occupancy")
    .select("managed_playlist_id, playlist_name, catalog_capacity, active_placements, available_slots")
    .order("active_placements", { ascending: false })
    .limit(1000);
  if (error) throw error;
  return (data ?? []) as Row[];
}

export function PlaylistsTab() {
  const q = useQuery({ queryKey: ["catalog", "occupancy"], queryFn: fetchOccupancy, staleTime: 30_000 });

  if (q.isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }

  const rows = q.data ?? [];

  return (
    <div className="border border-border rounded-2xl overflow-hidden bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Playlist</TableHead>
            <TableHead className="text-right">Capacidade</TableHead>
            <TableHead className="text-right">Ocupadas</TableHead>
            <TableHead className="text-right">Disponíveis</TableHead>
            <TableHead className="w-40">Ocupação</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const pct = r.catalog_capacity > 0
              ? Math.min(100, Math.round((r.active_placements / r.catalog_capacity) * 100))
              : 0;
            const full = r.available_slots === 0;
            return (
              <TableRow key={r.managed_playlist_id}>
                <TableCell className="font-medium">{r.playlist_name ?? "—"}</TableCell>
                <TableCell className="text-right text-muted-foreground">{r.catalog_capacity}</TableCell>
                <TableCell className="text-right">{r.active_placements}</TableCell>
                <TableCell className={cn("text-right", full ? "text-destructive" : "text-muted-foreground")}>
                  {r.available_slots}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                      <div
                        className={cn("h-full transition-all", full ? "bg-destructive" : "bg-primary")}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="text-xs text-muted-foreground tabular-nums w-8 text-right">{pct}%</span>
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
