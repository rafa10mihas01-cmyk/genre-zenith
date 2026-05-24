// DealDetail — página dedicada do deal. Substitui o drawer.
// Segue o mesmo padrão de ClienteDetalhe / CuradorDetail: PageHeader rico,
// KPIs em hierarquia cockpit, e tabs (renderizadas pelo DealHistorySheet em modo asPage).
import { useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ChevronLeft,
  CreditCard,
  Activity,
  Target,
  ShieldCheck,
  Clock,
  CheckCircle2,
} from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

import { PageContainer } from "@/components/PageContainer";
import { PageHeader } from "@/components/PageHeader";
import { KpiBig } from "@/components/KpiBig";
import { Button } from "@/components/ui/button";
import { useCuratorDealDetail } from "@/hooks/useCuratorDealDetail";
import { DealHistorySheet } from "@/components/playlist-deals/DealHistorySheet";
import { computeCuratorStats } from "@/lib/curatorDealsUtils";

const fmtPlays = (n: number) => {
  if (!n || !Number.isFinite(n)) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return Math.round(n).toLocaleString("pt-BR");
};

const fmtBRL = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);

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

  const stats = useMemo(() => {
    if (!deal) return null;
    return computeCuratorStats(
      deal,
      logs.filter((l) => l.deal_id === deal.id),
      playlists.filter((p) => p.deal_id === deal.id),
      progressByDeal[deal.id] ?? null,
    );
  }, [deal, logs, playlists, progressByDeal]);

  return (
    <PageContainer>
      <PageHeader
        kicker="Operação · Deal"
        domain="deals"
        title={deal?.song_name ?? "Detalhe do deal"}
        subtitle={
          deal
            ? [
                deal.song_artist || null,
                deal.curator_name ? `Curador: ${deal.curator_name}` : null,
                deal.started_at
                  ? `Iniciado ${format(new Date(deal.started_at), "dd MMM yyyy", { locale: ptBR })}`
                  : null,
              ]
                .filter(Boolean)
                .join(" · ")
            : "Curadores, entregas e histórico"
        }
        actions={
          <Button onClick={back} variant="outline" size="sm" className="rounded-full gap-1 h-9">
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
        <>
          {/* KPIs — hierarquia cockpit, mesmo padrão do Cliente e Curador */}
          {stats && (
            <div className="grid grid-cols-2 md:grid-cols-7 gap-2 pt-4 mb-6">
              <KpiBig
                label="Entrega"
                value={`${stats.pct}%`}
                icon={Target}
                hint={
                  deal.target_plays
                    ? `${fmtPlays(stats.earned)} de ${fmtPlays(Number(deal.target_plays))}`
                    : `${fmtPlays(stats.earned)} entregues`
                }
                tier="hero"
                domain="deals"
                tone={stats.pct >= 100 ? "success" : "primary"}
              />
              <KpiBig
                label="Velocidade"
                value={stats.vel ? `${fmtPlays(stats.vel)}/dia` : "—"}
                icon={Activity}
                hint="média desde o início"
                domain="deals"
              />
              <KpiBig
                label="Previsão"
                value={
                  stats.eta === null
                    ? "—"
                    : stats.eta === 0
                    ? "Concluído"
                    : `${Math.round(stats.eta)}d`
                }
                icon={Clock}
                hint={stats.eta === 0 ? "meta batida" : "para bater meta"}
                domain="deals"
              />
              <KpiBig
                label="Score"
                value={`${stats.score}/100`}
                icon={ShieldCheck}
                hint={`${Math.round(stats.legitShare * 100)}% legítimo`}
                tone={stats.score >= 75 ? "success" : stats.score >= 50 ? "primary" : "default"}
                domain="curators"
              />
              <KpiBig
                label="Investido"
                value={deal.cost != null ? fmtBRL(Number(deal.cost)) : "—"}
                icon={CreditCard}
                hint={deal.closed_at ? "deal fechado" : "em andamento"}
                tier="quiet"
              />
              <KpiBig
                label="Status"
                value={
                  deal.closed_at
                    ? deal.closed_status === "completed"
                      ? "Concluído"
                      : "Cancelado"
                    : "Ativo"
                }
                icon={CheckCircle2}
                hint={
                  deal.closed_at
                    ? format(new Date(deal.closed_at), "dd MMM yyyy", { locale: ptBR })
                    : "em coleta"
                }
                tier="quiet"
                tone={deal.closed_at ? "default" : "primary"}
              />
            </div>
          )}

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
        </>
      )}
    </PageContainer>
  );
}
