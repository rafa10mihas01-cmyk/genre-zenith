import { useNavigate, useParams } from "react-router-dom";
import { ChevronLeft, Receipt } from "lucide-react";
import { PageContainer } from "@/components/PageContainer";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { useCuratorDeals } from "@/hooks/useCuratorDeals";
import { DealHistorySheet } from "@/components/playlist-deals/DealHistorySheet";

/**
 * Página dedicada de detalhe da campanha — substitui o sheet em cascata
 * por uma rota navegável (`/playlist-deals/:dealId`). Toda a lógica,
 * abas e dados continuam vindo do mesmo componente DealHistorySheet,
 * agora renderizado em modo `asPage`.
 */
export default function DealDetail() {
  const { dealId } = useParams<{ dealId: string }>();
  const navigate = useNavigate();
  const {
    deals,
    logs,
    playlists,
    songs,
    progressByDeal,
    loading,
    reload,
  } = useCuratorDeals();

  const deal = deals.find((d) => d.id === dealId) ?? null;

  const back = () => navigate("/playlist-deals");

  return (
    <PageContainer>
      <PageHeader
        kicker="Módulo de Operação"
        icon={Receipt}
        domain="deals"
        title={deal?.song_name ?? "Detalhe do deal"}
        subtitle="Curadores, entregas e histórico"
        actions={
          <Button onClick={back} variant="ghost" size="sm" className="rounded-full gap-1">
            <ChevronLeft className="h-4 w-4" />
            Campanhas
          </Button>
        }
      />



      {loading && !deal ? (
        <div className="rounded-2xl border border-border/50 bg-card h-[480px] animate-pulse" />
      ) : !deal ? (
        <div className="rounded-2xl border border-border/50 bg-card p-10 text-center">
          <div className="text-foreground font-semibold mb-1">Deal não encontrado</div>
          <div className="text-[13px] text-muted-foreground mb-4">
            Este deal pode ter sido excluído ou o link está incorreto.
          </div>
          <Button onClick={back} variant="outline" className="rounded-full">
            Voltar para campanhas
          </Button>
        </div>
      ) : (
        <DealHistorySheet
          asPage
          open
          deal={deal}
          songs={songs.filter((s) => s.deal_id === deal.id)}
          allLogs={logs}
          allPlaylists={playlists}
          progress={progressByDeal[deal.id]}
          onClose={back}
          onReload={reload}
        />
      )}
    </PageContainer>
  );
}
