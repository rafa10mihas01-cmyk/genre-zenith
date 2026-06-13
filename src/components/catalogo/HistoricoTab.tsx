// HistoricoTab — auditoria de cada execução de "Distribuir".
// Desktop: tabela. Mobile: cards compactos no mesmo padrão de PlaylistsTab.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { History } from "lucide-react";
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
  track: { track_name: string; artist_name: string; cover_url: string | null } | null;
};

async function fetchBatches(): Promise<Row[]> {
  const { data, error } = await supabase
    .from("catalog_distribution_batches")
    .select(`
      id, created_at, catalog_track_id,
      total_eligible_playlists, skipped_already_present, skipped_no_capacity, placements_created,
      track:catalog_tracks!catalog_distribution_batches_catalog_track_id_fkey(track_name, artist_name, cover_url)
    `)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data ?? []) as unknown as Row[];
}

function Cover({ url, alt }: { url: string | null; alt: string }) {
  const [err, setErr] = useState(false);
  if (url && !err) {
    return (
      <img
        src={url}
        alt={alt}
        className="h-10 w-10 rounded object-cover flex-shrink-0"
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setErr(true)}
      />
    );
  }
  return (
    <div className="h-10 w-10 rounded bg-muted flex items-center justify-center flex-shrink-0">
      <History className="h-4 w-4 text-muted-foreground" />
    </div>
  );
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function HistoricoTab() {
  const q = useQuery({ queryKey: ["catalog", "batches"], queryFn: fetchBatches, staleTime: 30_000 });

  if (q.isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
    );
  }

  const rows = q.data ?? [];
  if (rows.length === 0) {
    return (
      <div className="border border-border rounded-2xl bg-card p-12 text-center">
        <p className="text-sm text-muted-foreground">Nenhuma distribuição executada ainda.</p>
      </div>
    );
  }

  return (
    <>
      {/* Mobile: cards compactos */}
      <div className="md:hidden border border-border rounded-2xl overflow-hidden bg-card divide-y divide-border">
        {rows.map((r) => (
          <div key={r.id} className="p-3 flex items-center gap-3 min-w-0">
            <Cover url={r.track?.cover_url ?? null} alt={r.track?.track_name ?? ""} />
            <div className="min-w-0 flex-1">
              <div className="font-medium text-sm truncate">{r.track?.track_name ?? "—"}</div>
              <div className="text-xs text-muted-foreground truncate">{r.track?.artist_name ?? ""}</div>
              <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground tabular-nums">
                <span>{fmtDate(r.created_at)}</span>
                <span>·</span>
                <span className="text-foreground font-medium">{r.placements_created}</span>
                <span>criados</span>
                {r.skipped_already_present > 0 && <span>· {r.skipped_already_present} já</span>}
                {r.skipped_no_capacity > 0 && <span>· {r.skipped_no_capacity} sem vaga</span>}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Desktop: tabela completa */}
      <div className="hidden md:block border border-border rounded-2xl overflow-hidden bg-card">
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
                    <div className="flex items-center gap-3 min-w-0">
                      <Cover url={r.track.cover_url} alt={r.track.track_name} />
                      <div className="min-w-0">
                        <div className="font-medium truncate">{r.track.track_name}</div>
                        <div className="text-xs text-muted-foreground truncate">{r.track.artist_name}</div>
                      </div>
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
    </>
  );
}
