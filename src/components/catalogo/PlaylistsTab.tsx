// PlaylistsTab — ocupação por playlist do catálogo.
// Desktop: tabela. Mobile: cards compactos com capa + barra de ocupação.
import { useQuery } from "@tanstack/react-query";
import { ListMusic } from "lucide-react";
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
  cover_url: string | null;
};

async function fetchOccupancy(): Promise<Row[]> {
  const { data, error } = await supabase
    .from("v_catalog_playlist_occupancy")
    .select("managed_playlist_id, playlist_name, catalog_capacity, active_placements, available_slots")
    .order("active_placements", { ascending: false })
    .limit(1000);
  if (error) throw error;
  const base = (data ?? []) as Omit<Row, "cover_url">[];
  if (base.length === 0) return [];
  const ids = base.map((r) => r.managed_playlist_id);
  const { data: covers } = await supabase
    .from("managed_playlists")
    .select("id, cover_url")
    .in("id", ids);
  const map = new Map<string, string | null>((covers ?? []).map((c: { id: string; cover_url: string | null }) => [c.id, c.cover_url]));
  return base.map((r) => ({ ...r, cover_url: map.get(r.managed_playlist_id) ?? null }));
}

function Cover({ url, alt }: { url: string | null; alt: string }) {
  if (url) {
    return <img src={url} alt={alt} className="h-10 w-10 rounded object-cover flex-shrink-0" loading="lazy" />;
  }
  return (
    <div className="h-10 w-10 rounded bg-muted flex items-center justify-center flex-shrink-0">
      <ListMusic className="h-4 w-4 text-muted-foreground" />
    </div>
  );
}

export function PlaylistsTab() {
  const q = useQuery({ queryKey: ["catalog", "occupancy"], queryFn: fetchOccupancy, staleTime: 30_000 });

  if (q.isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
    );
  }

  const rows = q.data ?? [];

  return (
    <>
      {/* Mobile: lista de cards compactos */}
      <div className="md:hidden border border-border rounded-2xl overflow-hidden bg-card divide-y divide-border">
        {rows.map((r) => {
          const pct = r.catalog_capacity > 0
            ? Math.min(100, Math.round((r.active_placements / r.catalog_capacity) * 100))
            : 0;
          const full = r.available_slots === 0;
          return (
            <div key={r.managed_playlist_id} className="p-3 flex items-center gap-3 min-w-0">
              <Cover url={r.cover_url} alt={r.playlist_name ?? ""} />
              <div className="min-w-0 flex-1">
                <div className="font-medium text-sm truncate">{r.playlist_name ?? "—"}</div>
                <div className="mt-1.5 flex items-center gap-2">
                  <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden">
                    <div
                      className={cn("h-full transition-all", full ? "bg-destructive" : "bg-primary")}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-[11px] text-muted-foreground tabular-nums whitespace-nowrap">
                    {r.active_placements}/{r.catalog_capacity}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Desktop: tabela completa */}
      <div className="hidden md:block border border-border rounded-2xl overflow-hidden bg-card">
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
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-3 min-w-0">
                      <Cover url={r.cover_url} alt={r.playlist_name ?? ""} />
                      <span className="truncate">{r.playlist_name ?? "—"}</span>
                    </div>
                  </TableCell>
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
    </>
  );
}
