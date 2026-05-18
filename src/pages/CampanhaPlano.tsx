import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { PageContainer } from "@/components/PageContainer";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CampaignFullPlanCard } from "@/components/campanhas/CampaignFullPlanCard";
import type { CampaignSnapshot } from "@/lib/campaignSnapshot";
import { ArrowLeft, Printer, Link2, Check } from "lucide-react";
import { toast } from "@/hooks/use-toast";

type Camp = {
  id: string;
  track_name: string;
  artist: string | null;
  started_at: string;
  deadline: string | null;
  simulation_snapshot: CampaignSnapshot | null;
  engagement_multiplier: number | null;
};

type Alloc = {
  id: string;
  planned_streams: number;
  start_day: number;
  managed_playlists?: { name: string; cover_url: string | null; followers: number } | null;
};

export default function CampanhaPlano() {
  const { id } = useParams<{ id: string }>();
  const [camp, setCamp] = useState<Camp | null>(null);
  const [allocs, setAllocs] = useState<Alloc[]>([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!id) return;
    (async () => {
      setLoading(true);
      const [{ data: c }, { data: a }] = await Promise.all([
        supabase
          .from("campaigns")
          .select("id, track_name, artist, started_at, deadline, simulation_snapshot, engagement_multiplier")
          .eq("id", id)
          .maybeSingle(),
        supabase
          .from("campaign_eco_allocations")
          .select("id, planned_streams, start_day, managed_playlists(name, cover_url, followers)")
          .eq("campaign_id", id)
          .order("planned_streams", { ascending: false }),
      ]);
      setCamp(c as any);
      setAllocs((a ?? []) as any);
      setLoading(false);
    })();
  }, [id]);

  function copyLink() {
    navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    toast({ title: "Link copiado", description: "Cole onde quiser enviar." });
    setTimeout(() => setCopied(false), 2000);
  }

  if (loading) {
    return (
      <PageContainer>
        <Skeleton className="h-8 w-64 mb-4" />
        <Skeleton className="h-96 w-full" />
      </PageContainer>
    );
  }

  if (!camp || !camp.simulation_snapshot) {
    return (
      <PageContainer>
        <p className="text-muted-foreground">Campanha não encontrada ou sem plano gerado.</p>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <div className="flex items-center justify-between gap-3 mb-6 print:hidden">
        <Button asChild variant="ghost" size="sm">
          <Link to={`/campanhas/${camp.id}/execucao`}>
            <ArrowLeft className="h-4 w-4 mr-1.5" /> Voltar à execução
          </Link>
        </Button>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={copyLink}>
            {copied ? <Check className="h-4 w-4 mr-1.5" /> : <Link2 className="h-4 w-4 mr-1.5" />}
            {copied ? "Copiado" : "Copiar link"}
          </Button>
          <Button size="sm" variant="outline" onClick={() => window.print()}>
            <Printer className="h-4 w-4 mr-1.5" /> Imprimir / PDF
          </Button>
        </div>
      </div>

      <div className="mb-4">
        <h1 className="text-2xl font-semibold">{camp.track_name}</h1>
        {camp.artist && <p className="text-muted-foreground">{camp.artist}</p>}
        <p className="text-xs text-muted-foreground mt-2">
          Início {new Date(camp.started_at).toLocaleDateString("pt-BR")}
          {camp.deadline && ` · Prazo ${new Date(camp.deadline).toLocaleDateString("pt-BR")}`}
          {` · ${camp.simulation_snapshot.days} dias`}
        </p>
      </div>

      <CampaignFullPlanCard
        snapshot={camp.simulation_snapshot}
        startedAt={camp.started_at}
        allocations={allocs as any}
        engagementMultiplier={camp.engagement_multiplier ?? 30}
        showShare={false}
      />
    </PageContainer>
  );
}
