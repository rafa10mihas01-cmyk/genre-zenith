import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { CampaignFullPlanCard } from "@/components/campanhas/CampaignFullPlanCard";
import type { CampaignSnapshot } from "@/lib/campaignSnapshot";
import { Printer, ExternalLink } from "lucide-react";
import { NexEngineLogo } from "@/components/NexEngineLogo";

type Camp = {
  id: string;
  track_name: string;
  artist: string | null;
  cover_url: string | null;
  spotify_track_url: string | null;
  spotify_track_id: string | null;
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

export default function PlanoCampanhaPublico() {
  const { token } = useParams<{ token: string }>();
  const [camp, setCamp] = useState<Camp | null>(null);
  const [allocs, setAllocs] = useState<Alloc[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase.functions.invoke("get-shared-campaign-plan", {
        body: { token },
      });
      if (error || (data as any)?.error) {
        setErr((data as any)?.error ?? error?.message ?? "Erro");
      } else {
        setCamp((data as any).campaign);
        setAllocs((data as any).allocations ?? []);
      }
      setLoading(false);
    })();
  }, [token]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background p-6 max-w-7xl mx-auto">
        <Skeleton className="h-8 w-64 mb-4" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (err || !camp || !camp.simulation_snapshot) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="text-center">
          <p className="text-muted-foreground">Plano indisponível ou link inválido.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto p-6">
        <div className="flex items-center justify-between mb-6 print:hidden">
          <NexEngineLogo variant="auto" className="h-7 w-auto" />
          <Button size="sm" variant="outline" onClick={() => window.print()}>
            <Printer className="h-4 w-4 mr-1.5" /> Imprimir / PDF
          </Button>
        </div>

        <div className="mb-4 flex items-center gap-4">
          {camp.cover_url && (
            <img src={camp.cover_url} alt="" className="w-16 h-16 rounded object-cover" />
          )}
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold flex items-center gap-2">
              {camp.spotify_track_url ? (
                <a
                  href={camp.spotify_track_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-primary inline-flex items-center gap-1.5"
                >
                  {camp.track_name}
                  <ExternalLink className="h-4 w-4 opacity-60" />
                </a>
              ) : (
                camp.track_name
              )}
            </h1>
            {camp.artist && <p className="text-muted-foreground">{camp.artist}</p>}
            <p className="text-xs text-muted-foreground mt-1">
              Início {new Date(camp.started_at).toLocaleDateString("pt-BR")}
              {camp.deadline && ` · Prazo ${new Date(camp.deadline).toLocaleDateString("pt-BR")}`}
              {` · ${camp.simulation_snapshot.days} dias`}
            </p>
          </div>
        </div>

        <CampaignFullPlanCard
          snapshot={camp.simulation_snapshot}
          startedAt={camp.started_at}
          allocations={allocs as any}
          engagementMultiplier={camp.engagement_multiplier ?? 30}
          showShare={false}
        />

        <p className="text-[10px] text-muted-foreground mt-6 text-center">
          Plano gerado pela NexEngine. Acesso somente leitura.
        </p>
      </div>
    </div>
  );
}
