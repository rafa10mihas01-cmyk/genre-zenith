import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
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
};

export function BaselineView({ campaignId }: { campaignId: string }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [campMeta, setCampMeta] = useState<{ status: string | null; capturedAt: string | null }>({ status: null, capturedAt: null });
  const covers = usePlaylistCovers((rows ?? []).map((r) => r.playlist_id));

  useEffect(() => {
    (async () => {
      const [{ data: r }, { data: c }] = await Promise.all([
        supabase
          .from("campaign_playlist_collections")
          .select("playlist_id, playlist_url, playlist_name_at_capture, plays_7d, captured_at, proof_screenshot_url")
          .eq("campaign_id", campaignId)
          .eq("is_baseline", true)
          .order("plays_7d", { ascending: false }),
        supabase
          .from("campaigns")
          .select("baseline_status, baseline_captured_at")
          .eq("id", campaignId)
          .maybeSingle(),
      ]);
      setRows((r ?? []) as Row[]);
      setCampMeta({
        status: (c as any)?.baseline_status ?? null,
        capturedAt: (c as any)?.baseline_captured_at ?? null,
      });
    })();
  }, [campaignId]);

  if (!rows) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-5">
            <div className="text-xs text-muted-foreground uppercase tracking-wide">Status</div>
            <div className="mt-2"><BaselineStatusBadge status={campMeta.status} /></div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="text-xs text-muted-foreground uppercase tracking-wide">Capturada em</div>
            <div className="mt-2 text-foreground font-semibold">
              {campMeta.capturedAt ? new Date(campMeta.capturedAt).toLocaleString("pt-BR") : "—"}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="text-xs text-muted-foreground uppercase tracking-wide">Playlists na baseline</div>
            <div className="mt-2 text-2xl font-semibold text-foreground">{rows.length}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">Nenhuma baseline registrada ainda.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Playlist</TableHead>
                  <TableHead>Playlist ID</TableHead>
                  <TableHead className="text-right">Plays 7d (baseline)</TableHead>
                  <TableHead>Capturada em</TableHead>
                  <TableHead>Prova</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.playlist_id}>
                    <TableCell>
                      <div className="font-medium text-foreground">{r.playlist_name_at_capture ?? "—"}</div>
                      {r.playlist_url && (
                        <a href={r.playlist_url} target="_blank" rel="noreferrer"
                           className="text-xs text-muted-foreground inline-flex items-center gap-1 hover:text-primary">
                          abrir no Spotify <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{r.playlist_id}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatInt(Number(r.plays_7d ?? 0))}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {new Date(r.captured_at).toLocaleString("pt-BR")}
                    </TableCell>
                    <TableCell>
                      {r.proof_screenshot_url ? (
                        <a href={r.proof_screenshot_url} target="_blank" rel="noreferrer"
                           className="text-primary inline-flex items-center gap-1 text-sm">
                          <ImageIcon className="h-3 w-3" /> ver
                        </a>
                      ) : <span className="text-muted-foreground text-xs">—</span>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function BaselineStatusBadge({ status }: { status: string | null }) {
  if (status === "captured") return <Badge className="bg-primary text-primary-foreground">Capturada</Badge>;
  if (status === "pending") return <Badge variant="outline">Pendente</Badge>;
  return <Badge variant="outline">{status ?? "—"}</Badge>;
}
