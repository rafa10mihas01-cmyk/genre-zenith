import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ExecucaoView } from "./ExecucaoView";
import { PlaylistHistoryDrawer } from "./PlaylistHistoryDrawer";

type Props = { campaignId: string };

export function MonitoramentoTab({ campaignId }: Props) {
  const [kpis, setKpis] = useState<{ status: string | null; capturedAt: string | null; playlists: number }>({
    status: null,
    capturedAt: null,
    playlists: 0,
  });
  const [drawerPlaylistId, setDrawerPlaylistId] = useState<string | null>(null);

  useEffect(() => {
    if (!campaignId) return;
    (async () => {
      const [{ data: c }, { count }] = await Promise.all([
        supabase.from("campaigns").select("baseline_status, baseline_captured_at").eq("id", campaignId).maybeSingle(),
        supabase
          .from("campaign_playlist_collections")
          .select("playlist_id", { count: "exact", head: true })
          .eq("campaign_id", campaignId)
          .eq("is_baseline", true),
      ]);
      setKpis({
        status: (c as any)?.baseline_status ?? null,
        capturedAt: (c as any)?.baseline_captured_at ?? null,
        playlists: count ?? 0,
      });
    })();
  }, [campaignId]);

  return (
    <div className="space-y-6">
      <section className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-5">
            <div className="text-xs text-muted-foreground uppercase tracking-wide">Baseline</div>
            <div className="mt-2"><BaselineStatusBadge status={kpis.status} /></div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="text-xs text-muted-foreground uppercase tracking-wide">Capturada em</div>
            <div className="mt-2 text-foreground font-semibold">
              {kpis.capturedAt ? new Date(kpis.capturedAt).toLocaleString("pt-BR") : "—"}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="text-xs text-muted-foreground uppercase tracking-wide">Playlists na baseline</div>
            <div className="mt-2 text-2xl font-semibold text-foreground">{kpis.playlists}</div>
          </CardContent>
        </Card>
      </section>

      <ExecucaoView campaignId={campaignId} onOpenHistory={setDrawerPlaylistId} />

      <PlaylistHistoryDrawer
        campaignId={campaignId}
        playlistId={drawerPlaylistId}
        open={!!drawerPlaylistId}
        onOpenChange={(o) => { if (!o) setDrawerPlaylistId(null); }}
      />
    </div>
  );
}

function BaselineStatusBadge({ status }: { status: string | null }) {
  if (status === "captured") return <Badge className="bg-primary text-primary-foreground">Capturada</Badge>;
  if (status === "pending") return <Badge variant="outline">Pendente</Badge>;
  return <Badge variant="outline">{status ?? "—"}</Badge>;
}
