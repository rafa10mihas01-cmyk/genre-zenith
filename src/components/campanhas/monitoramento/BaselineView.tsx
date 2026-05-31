import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import { formatInt } from "@/lib/campaignEngine";
import { usePlaylistCovers } from "@/hooks/usePlaylistCovers";
import { PlaylistCell } from "./PlaylistCell";
import { ProofThumb } from "./ProofThumb";

type Row = {
  playlist_id: string;
  playlist_url: string | null;
  playlist_name_at_capture: string | null;
  plays_7d: number | null;
  captured_at: string;
  proof_screenshot_url: string | null;
  proof_screenshot_urls: string[] | null;
};

export function BaselineView({ campaignId }: { campaignId: string }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const covers = usePlaylistCovers((rows ?? []).map((r) => r.playlist_id));

  useEffect(() => {
    (async () => {
      const { data: r } = await supabase
        .from("campaign_playlist_collections")
        .select("playlist_id, playlist_url, playlist_name_at_capture, plays_7d, captured_at, proof_screenshot_url, proof_screenshot_urls")
        .eq("campaign_id", campaignId)
        .eq("is_baseline", true)
        .order("plays_7d", { ascending: false });
      setRows((r ?? []) as Row[]);
    })();
  }, [campaignId]);

  if (!rows) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="space-y-6">


      <Card>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">Nenhuma baseline registrada ainda.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Playlist</TableHead>
                  <TableHead className="text-right">Plays 7d (baseline)</TableHead>
                  <TableHead>Capturada em</TableHead>
                  <TableHead>Prova</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const meta = covers[r.playlist_id];
                  return (
                    <TableRow key={r.playlist_id}>
                      <TableCell>
                        <PlaylistCell
                          playlistId={r.playlist_id}
                          name={r.playlist_name_at_capture ?? meta?.name ?? null}
                          url={r.playlist_url}
                          coverUrl={meta?.cover_url ?? null}
                          followers={meta?.followers ?? null}
                        />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatInt(Number(r.plays_7d ?? 0))}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {new Date(r.captured_at).toLocaleString("pt-BR")}
                      </TableCell>
                      <TableCell>
                        <ProofThumb urls={r.proof_screenshot_urls} url={r.proof_screenshot_url} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

