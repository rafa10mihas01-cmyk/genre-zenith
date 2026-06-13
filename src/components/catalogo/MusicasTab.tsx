// MusicasTab — lista de faixas do catálogo.
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
  const qc = useQueryClient();
  const tracksQ = useQuery({ queryKey: ["catalog", "tracks"], queryFn: fetchTracks, staleTime: 30_000 });

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
