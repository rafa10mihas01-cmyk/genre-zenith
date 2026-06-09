// DealDetail — página dedicada do deal. Substitui o drawer.
// Segue o mesmo padrão de ClienteDetalhe / CuradorDetail: PageHeader rico,
// KPIs em hierarquia cockpit, e tabs (renderizadas pelo DealHistorySheet em modo asPage).
import { lazy, Suspense, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ChevronLeft,
  CreditCard,
  Activity,
  Target,
  ShieldCheck,
  Clock,
} from "lucide-react";
import { toast } from "sonner";


import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

import { PageContainer } from "@/components/PageContainer";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { useCuratorDealDetail } from "@/hooks/useCuratorDealDetail";
import { useBackOrFallback } from "@/hooks/useBackOrFallback";
// Perf: DealHistorySheet tem 1.412 linhas + 20 useEffect/useState. Carregar
// sob demanda corta o JS inicial da página em ~80% e mostra o hero/KPI antes.
const DealHistorySheet = lazy(() =>
  import("@/components/playlist-deals/DealHistorySheet").then((m) => ({ default: m.DealHistorySheet })),
);
import { CuratorDealAccessManager } from "@/components/playlist-deals/CuratorDealAccessManager";
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
    deal,
    logs,
    playlists,
    songs,
    progress,
    loading,
    reload,
  } = useCuratorDealDetail(dealId);

  const back = useBackOrFallback("/deals");

  const stats = useMemo(() => {
    if (!deal) return null;
    return computeCuratorStats(deal, logs, playlists, progress);
  }, [deal, logs, playlists, progress]);


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
          <div className="flex items-center gap-2">
            {deal && (deal.slug || deal.public_token) && (
              <CuratorDealAccessManager
                dealId={deal.id}
                slug={deal.slug}
                publicToken={deal.public_token}
              />
            )}
            <Button onClick={back} variant="outline" size="sm" className="rounded-full gap-1 h-9">
              <ChevronLeft className="h-4 w-4" />
              Campanhas
            </Button>
          </div>
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
          {/* Hero do deal — entrega dominante + chips de apoio */}
          {stats && (() => {
            const pct = Math.max(0, Math.min(100, stats.pct));
            const target = Number(deal.target_plays || 0);
            const remaining = Math.max(0, target - stats.earned);
            const isClosed = !!deal.closed_at;
            const statusLabel = isClosed
              ? deal.closed_status === "completed" ? "Concluído" : "Cancelado"
              : "Ativo";
            const statusTone = isClosed
              ? deal.closed_status === "completed"
                ? "bg-success/15 text-success border-success/30"
                : "bg-muted text-muted-foreground border-border"
              : "bg-primary/15 text-primary border-primary/30";

            return (
              <div className="rounded-2xl border border-border bg-card p-4 sm:p-5 mb-6 mt-4 space-y-4">
                {/* Cabeçalho: label + status */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground">
                    <Target className="h-3.5 w-3.5 text-primary" />
                    Entrega
                  </div>
                  <span className={`inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full text-[11px] font-semibold border ${statusTone}`}>
                    <span className="h-1.5 w-1.5 rounded-full bg-current" />
                    {statusLabel}
                  </span>
                </div>

                {/* % dominante */}
                <div className="flex items-baseline gap-3 flex-wrap">
                  <div className={`text-4xl sm:text-5xl font-semibold tabular-nums leading-none ${pct >= 100 ? "text-success" : "text-foreground"}`}>
                    {pct}%
                  </div>
                  <div className="text-[12px] text-muted-foreground tabular-nums">
                    {fmtPlays(stats.earned)}
                    {target > 0 && <> de {fmtPlays(target)}</>}
                    {target > 0 && remaining > 0 && <> · faltam {fmtPlays(remaining)}</>}
                  </div>
                </div>

                {/* Barra de progresso */}
                <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${pct >= 100 ? "bg-success" : "bg-primary"}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>

                {/* Linha de apoio — velocidade · ETA · investido */}
                <div className="flex items-center gap-x-4 gap-y-1.5 flex-wrap text-[12px] text-foreground-body tabular-nums">
                  <span className="inline-flex items-center gap-1.5">
                    <Activity className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="font-semibold text-foreground">
                      {stats.vel ? `${fmtPlays(stats.vel)}/dia` : "—"}
                    </span>
                  </span>
                  <span className="text-muted-foreground/40">·</span>
                  <span className="inline-flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="font-semibold text-foreground">
                      {stats.eta === null ? "—" : stats.eta === 0 ? "meta batida" : `${Math.round(stats.eta)}d`}
                    </span>
                    {stats.eta !== null && stats.eta > 0 && (
                      <span className="text-muted-foreground">p/ meta</span>
                    )}
                  </span>
                  <span className="text-muted-foreground/40">·</span>
                  <span className="inline-flex items-center gap-1.5">
                    <CreditCard className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="font-semibold text-foreground">
                      {deal.cost != null ? fmtBRL(Number(deal.cost)) : "—"}
                    </span>
                  </span>
                </div>

                {/* Score */}
                <div className="flex items-center gap-2 pt-3 border-t border-border/60 text-[12px]">
                  <ShieldCheck className={`h-3.5 w-3.5 ${stats.score >= 75 ? "text-success" : stats.score >= 50 ? "text-primary" : "text-muted-foreground"}`} />
                  <span className="text-muted-foreground">Score</span>
                  <span className={`font-semibold tabular-nums ${stats.score >= 75 ? "text-success" : "text-foreground"}`}>
                    {stats.score}/100
                  </span>
                  <span className="text-muted-foreground">· {Math.round(stats.legitShare * 100)}% legítimo</span>
                </div>

                {isClosed && deal.closed_at && (
                  <div className="text-[11px] text-muted-foreground pt-1">
                    Fechado em {format(new Date(deal.closed_at), "dd MMM yyyy", { locale: ptBR })}
                  </div>
                )}
              </div>
            );
          })()}

          <Suspense fallback={<div className="rounded-2xl border border-border/50 bg-card h-[480px] animate-pulse" />}>
            <DealHistorySheet
              asPage
              open
              deal={deal}
              songs={songs}
              allLogs={logs}
              allPlaylists={playlists}
              progress={progress ?? undefined}
              onClose={back}
              onReload={reload}
            />
          </Suspense>
        </>
      )}
    </PageContainer>
  );
}
