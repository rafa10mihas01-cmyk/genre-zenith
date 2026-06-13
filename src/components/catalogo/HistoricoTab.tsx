// HistoricoTab — auditoria de cada execução de "Distribuir" (catalog_distribution_batches).
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";

type Row = {
  id: string;
  created_at: string;
  catalog_track_id: string;
  total_eligible_playlists: number;
  skipped_already_present: number;
  skipped_no_capacity: number;
  placements_created: number;
  track: { track_name: string; artist_name: string } | null;
};

async function fetchBatches(): Promise<Row[]> {
  const { data, error } = await supabase
    .from("catalog_distribution_batches")
    .select(`
      id, created_at, catalog_track_id,
      total_eligible_playlists, skipped_already_present, skipped_no_capacity, placements_created,
      track:catalog_tracks!catalog_distribution_batches_catalog_track_id_fkey(track_name, artist_name)
    `)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data ?? []) as unknown as Row[];
}

export function HistoricoTab() {
  const q = useQuery({ queryKey: ["catalog", "batches"], queryFn: fetchBatches, staleTime: 30_000 });

  if (q.isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }

  const rows = q.data ?? [];
  if (rows.length === 0) {
    return (
      <div className="border border-border rounded-2xl bg-card p-12 text-center">
        <p className="text-sm text-muted-foreground">
          Nenhuma distribuição executada ainda.
        </p>
      </div>
    );
  }

  return (
    <div className="border border-border rounded-2xl overflow-hidden bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Quando</TableHead>
            <TableHead>Música</TableHead>
            <TableHead className="text-right">Elegíveis</TableHead>
            <TableHead className="text-right">Já presente</TableHead>
            <TableHead className="text-right">Sem vaga</TableHead>
            <TableHead className="text-right">Criados</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                {new Date(r.created_at).toLocaleString("pt-BR")}
              </TableCell>
              <TableCell>
                {r.track ? (
                  <div>
                    <div className="font-medium">{r.track.track_name}</div>
                    <div className="text-xs text-muted-foreground">{r.track.artist_name}</div>
                  </div>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell className="text-right">{r.total_eligible_playlists}</TableCell>
              <TableCell className="text-right text-muted-foreground">{r.skipped_already_present}</TableCell>
              <TableCell className="text-right text-muted-foreground">{r.skipped_no_capacity}</TableCell>
              <TableCell className="text-right font-semibold">{r.placements_created}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
