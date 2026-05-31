import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { PageContainer } from "@/components/PageContainer";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft } from "lucide-react";
import { ExecucaoView } from "@/components/campanhas/monitoramento/ExecucaoView";
import { PlaylistHistoryDrawer } from "@/components/campanhas/monitoramento/PlaylistHistoryDrawer";

export default function CampanhaMonitoramento() {
  const { id } = useParams<{ id: string }>();
  const [meta, setMeta] = useState<{ track_name: string | null; artist: string | null } | null>(null);
  const [kpis, setKpis] = useState<{ status: string | null; capturedAt: string | null; playlists: number }>({
    status: null,
    capturedAt: null,
    playlists: 0,
  });
  const [drawerPlaylistId, setDrawerPlaylistId] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    (async () => {
      const [{ data: c }, { count }] = await Promise.all([
        supabase.from("campaigns").select("track_name, artist, baseline_status, baseline_captured_at").eq("id", id).maybeSingle(),
        supabase
          .from("campaign_playlist_collections")
          .select("playlist_id", { count: "exact", head: true })
          .eq("campaign_id", id)
          .eq("is_baseline", true),
      ]);
      setMeta(c as any);
      setKpis({
        status: (c as any)?.baseline_status ?? null,
        capturedAt: (c as any)?.baseline_captured_at ?? null,
        playlists: count ?? 0,
      });
    })();
  }, [id]);

  if (!id) return null;

  return (
    <PageContainer>
      <div className="flex items-center gap-3 mb-4">
        <Button asChild variant="outline" size="sm">
          <Link to={`/campanhas/${id}/execucao`}><ArrowLeft className="h-4 w-4 mr-1" /> Voltar</Link>
        </Button>
      </div>
      <PageHeader
        title="Monitoramento da campanha"
        subtitle={meta ? `${meta.track_name ?? ""} · ${meta.artist ?? ""}` : "Playlists monitoradas, crescimento e provas"}
      />

      <section className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-6">
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

      <div className="mt-6">
        <ExecucaoView campaignId={id} onOpenHistory={setDrawerPlaylistId} />
      </div>

      <PlaylistHistoryDrawer
        campaignId={id}
        playlistId={drawerPlaylistId}
        open={!!drawerPlaylistId}
        onOpenChange={(o) => { if (!o) setDrawerPlaylistId(null); }}
      />
    </PageContainer>
  );
}

function BaselineStatusBadge({ status }: { status: string | null }) {
  if (status === "captured") return <Badge className="bg-primary text-primary-foreground">Capturada</Badge>;
  if (status === "pending") return <Badge variant="outline">Pendente</Badge>;
  return <Badge variant="outline">{status ?? "—"}</Badge>;
}
