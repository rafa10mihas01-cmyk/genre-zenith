import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { PageContainer } from "@/components/PageContainer";
import { PageHeader } from "@/components/PageHeader";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { BaselineView } from "@/components/campanhas/monitoramento/BaselineView";
import { ExecucaoView } from "@/components/campanhas/monitoramento/ExecucaoView";
import { HistoricoView } from "@/components/campanhas/monitoramento/HistoricoView";

export default function CampanhaMonitoramento() {
  const { id } = useParams<{ id: string }>();
  const [meta, setMeta] = useState<{ track_name: string | null; artist: string | null } | null>(null);

  useEffect(() => {
    if (!id) return;
    supabase.from("campaigns").select("track_name, artist").eq("id", id).maybeSingle()
      .then(({ data }) => setMeta(data as any));
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
        subtitle={meta ? `${meta.track_name ?? ""} · ${meta.artist ?? ""}` : "Baseline, execução e histórico de coletas"}
      />

      <Tabs defaultValue="baseline" className="mt-6">
        <TabsList>
          <TabsTrigger value="baseline">Baseline</TabsTrigger>
          <TabsTrigger value="execucao">Execução</TabsTrigger>
          <TabsTrigger value="historico">Histórico</TabsTrigger>
        </TabsList>
        <TabsContent value="baseline" className="mt-6">
          <BaselineView campaignId={id} />
        </TabsContent>
        <TabsContent value="execucao" className="mt-6">
          <ExecucaoView campaignId={id} />
        </TabsContent>
        <TabsContent value="historico" className="mt-6">
          <HistoricoView campaignId={id} />
        </TabsContent>
      </Tabs>
    </PageContainer>
  );
}
