import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatInt, formatBRL } from "@/lib/campaignEngine";
import type { CampaignSnapshot } from "@/lib/campaignSnapshot";
import { cn } from "@/lib/utils";
import { Music, TrendingUp, TrendingDown, Minus, ArrowRight, ExternalLink, ChevronDown, Target, Activity, Gauge, CalendarDays } from "lucide-react";
import { useState } from "react";
import type { EcoAllocation } from "../types";
import { KpiBig } from "@/components/KpiBig";
import { deliveryPct } from "@/lib/campaignPct";

type CompactItem = { name: string; image_url: string | null; delivered: number; planned?: number | null; lastDelta?: number | null };
function formatPlays(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return "0";
  const v = Number(n);
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
  return Math.round(v).toString();
}
function CompactPlaylistList({
  title, counterLabel, items, emptyText,
}: { title: string; counterLabel: string; items: CompactItem[]; emptyText: string }) {
  const delivering = items.filter((p) => p.delivered > 0).length;
  return (
    <>
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="text-[15px] font-semibold tracking-tight">{title}</div>
        <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-primary bg-primary/10 ring-1 ring-primary/20 rounded-full px-2.5 py-1 tabular-nums shrink-0">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full rounded-full bg-primary opacity-75 animate-ping" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
          </span>
          {counterLabel}
        </span>
      </div>
      {items.length === 0 ? (
        <div className="text-xs text-muted-foreground py-6 text-center">{emptyText}</div>
      ) : (
        <ul className="space-y-1.5 max-h-[600px] overflow-y-auto pr-1">
          {items.map((p, i) => {
            const isDelivering = p.delivered > 0;
            return (
              <li
                key={`${p.name}-${i}`}
                className={cn(
                  "rounded-lg border bg-card px-3 py-2 transition-all hover:bg-muted/30",
                  isDelivering ? "border-success/30" : "border-border",
                )}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className={cn(
                    "relative h-10 w-10 rounded-md overflow-hidden bg-muted ring-1 shrink-0",
                    isDelivering ? "ring-success/40" : "ring-border",
                  )}>
                    {p.image_url ? (
                      <img src={p.image_url} alt={p.name} className="h-full w-full object-cover" loading="lazy" />
                    ) : (
                      <div className="h-full w-full flex items-center justify-center">
                        <Music className="h-3.5 w-3.5 text-muted-foreground" />
                      </div>
                    )}
                    {isDelivering && (
                      <span className="absolute -top-0.5 -right-0.5 flex h-2 w-2">
                        <span className="absolute inline-flex h-full w-full rounded-full bg-success opacity-75 animate-ping" />
                        <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
                      </span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className={cn(
                      "text-[12px] font-medium truncate leading-tight",
                      isDelivering ? "text-foreground" : "text-muted-foreground",
                    )} title={p.name}>{p.name}</p>
                    <div className="flex items-center gap-2 mt-1 text-[10px] tabular-nums text-muted-foreground">
                      <span className={cn(
                        "inline-flex items-center gap-1 font-medium",
                        isDelivering ? "text-success" : "text-muted-foreground/70",
                      )}>
                        <span className={cn("h-1.5 w-1.5 rounded-full", isDelivering ? "bg-success" : "bg-muted-foreground/40")} />
                        {isDelivering ? "Entregando" : "Aguardando"}
                      </span>
                      <span className="text-border">·</span>
                      <span>últ. import: <span className={cn("font-medium", p.lastDelta != null && p.lastDelta > 0 ? "text-foreground" : "text-muted-foreground/70")}>
                        {p.lastDelta == null ? "—" : `+${formatPlays(p.lastDelta)}`}
                      </span></span>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    {p.delivered > 0 ? (
                      <div className={cn("text-[15px] font-bold tabular-nums leading-none", isDelivering ? "text-success" : "text-foreground")}>
                        +{formatPlays(p.delivered)}
                      </div>
                    ) : (
                      <div className="text-[14px] font-semibold tabular-nums text-muted-foreground/60 leading-none">—</div>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}


type EcoSnap = {
  managed_playlist_id: string;
  plays_24h: number | null;
  plays_7d: number | null;
  plays_28d: number | null;
  captured_at: string;
};

type ProofPreview = {
  id: string;
  captured_at: string;
  playlist_name: string;
  screenshot_url: string | null;
  delta_plays: number | null;
};

type Props = {
  snapshot: CampaignSnapshot;
  delivered: number;
  daysElapsed: number;
  showFinance: boolean;
  hideDeliveryPlan?: boolean;
  hideCurveShortcut?: boolean;
  hideCurveCard?: boolean;
  hideKpis?: boolean;
  hideSplitRows?: boolean;
  allocations?: EcoAllocation[];
  snapshots?: EcoSnap[];
  proofs?: ProofPreview[];
  /** Plays entregues pela Rádio desde o início da campanha (current - start). */
  radioDelta?: number;
  /** Quebra real vinda da view de crescimento — sobrescreve cálculo legado dos cards Eco/Ext/Org. */
  deliveryBreakdown?: { curators: number; ecosystem: number; organic: number } | null;
  onJumpTab?: (tab: "playlists" | "proofs" | "curve" | "finance") => void;
  // Slot opcional que substitui o card "Curva de entrega" dentro do grid principal.
  // Usado pra subir o monitoramento ao lugar da curva planejada.
  curveSlot?: React.ReactNode;
  /** Override do "Playlists no ar" — fonte real por playlist já reconciliada. */
  topDeliveringPlaylists?: Array<{ name: string; image_url: string | null; delivered: number; planned?: number | null; current?: number | null; baseline?: number | null; lastDelta?: number | null }>;
  // Rebalanceamento eco/ext em runtime
  splitLockedAt?: string | null;
  lockedEcoStreams?: number | null;
  ecoMaxPct?: number | null;
  canManageSplit?: boolean;
  onLockSplit?: (ecoStreams: number) => void | Promise<void>;
  onUnlockSplit?: () => void | Promise<void>;
};

export function OverviewTab({
  snapshot, delivered, daysElapsed, showFinance, hideDeliveryPlan = false, hideCurveShortcut = false, hideCurveCard = false, hideKpis = false, hideSplitRows = false,
  allocations = [], snapshots = [], proofs = [], radioDelta = 0, deliveryBreakdown = null, onJumpTab,
  curveSlot,
  topDeliveringPlaylists,
  splitLockedAt = null, lockedEcoStreams = null, ecoMaxPct = 70,
  canManageSplit = false, onLockSplit, onUnlockSplit,
}: Props) {

  // Slot externo (ex: monitoramento) tem precedência sobre o card padrão de curva.
  const showCurveCard = !hideCurveCard && !curveSlot;
  const [planOpen, setPlanOpen] = useState(false);
  const [savingLock, setSavingLock] = useState(false);
  const pct = deliveryPct(delivered, snapshot.meta);
  // `curva` pode vir indefinida quando o snapshot é entregue por endpoints
  // públicos sanitizados (ex: get-shared-campaign-plan no portal do cliente).
  const curva = Array.isArray(snapshot.curva) ? snapshot.curva : [];
  const plannedToDate = curva.slice(0, daysElapsed).reduce((s, p) => s + p.streamsDay, 0);
  const adherence = plannedToDate > 0 ? Math.round((delivered / plannedToDate) * 100) : 0;

  // ---- Plano de entrega: SNAPSHOT da calculadora é a fonte da verdade ----
  // Tudo abaixo respeita splitEcoPct / splitOrganicPct fechados na calculadora.
  const daysRemaining = Math.max(1, snapshot.days - daysElapsed);
  const restante = Math.max(0, snapshot.meta - delivered);
  const ritmoNecessario = Math.round(restante / daysRemaining);

  // Última snapshot por playlist — mantida APENAS pra montar Top playlists
  // (delivered/delta24 por playlist específica). NÃO é mais usada pra
  // agregados eco/ext — esses vêm exclusivamente de deliveryBreakdown
  // (fn_campaign_playlist_growth, mesma fonte da execução).
  const latestByPl = new Map<string, EcoSnap>();
  for (const s of snapshots) {
    if (!latestByPl.has(s.managed_playlist_id)) latestByPl.set(s.managed_playlist_id, s);
  }
  // Auditoria visual: playlists próprias (somente exibido na linha auxiliar abaixo
  // do SplitRow eco). Mantido em separado pra não contaminar o cálculo agregado.
  const ecoDeliveredPlaylists = Array.from(latestByPl.values())
    .reduce((acc, s) => acc + Number(s.plays_28d ?? s.plays_7d ?? 0), 0);
  const radioDeliveredSafe = Math.max(0, Math.round(radioDelta));

  // FONTE ÚNICA: fn_campaign_playlist_growth via prop deliveryBreakdown.
  // Sem fallback legado — quando a view não tem dados, mostramos 0.
  const ecoDelivered = (deliveryBreakdown?.ecosystem ?? 0) + radioDeliveredSafe;
  const extDelivered = deliveryBreakdown?.curators ?? 0;
  const orgDelivered = deliveryBreakdown?.organic ?? 0;



  // Valores fechados pela calculadora — única fonte da verdade.
  const ecoTarget = Math.max(0, Math.round(snapshot.streamsEco ?? 0));
  const extTarget = Math.max(0, Math.round(snapshot.streamsExt ?? 0));
  const orgTarget = Math.max(0, Math.round(snapshot.streamsOrganic ?? 0));
  const paidTotal = ecoTarget + extTarget; // o que eco+ext cobrem (sem orgânico)
  const ecoEffectivePct = paidTotal > 0 ? Math.round((ecoTarget / paidTotal) * 100) : 0;
  const extEffectivePct = paidTotal > 0 ? 100 - ecoEffectivePct : 0;
  const orgPctOfMeta = snapshot.meta > 0 ? Math.round((orgTarget / snapshot.meta) * 100) : 0;

  // Lock — mantém UI de travar/destravar, mas só sinaliza divergência se alguém
  // travou em valor diferente do snapshot (e oferece "alinhar à calculadora").
  const isLocked = !!splitLockedAt;
  const lockedDiverged =
    isLocked &&
    lockedEcoStreams !== null &&
    lockedEcoStreams !== undefined &&
    Math.abs(Number(lockedEcoStreams) - ecoTarget) > Math.max(1000, ecoTarget * 0.01);

  const today = curva.length > 0 ? curva[Math.max(0, Math.min(curva.length - 1, daysElapsed - 1))] : undefined;
  const todayTotal = today?.streamsDay ?? 0;
  // Usa proporções da própria curva (já fechadas pela calculadora 50/50/etc).
  const todayEco = today?.streamsEcoDay ?? Math.round(todayTotal * (ecoEffectivePct / 100));
  const todayExt = today?.streamsExtDay ?? Math.max(0, todayTotal - todayEco);


  const handleLock = async () => {
    if (!onLockSplit) return;
    setSavingLock(true);
    try { await onLockSplit(ecoTarget); } finally { setSavingLock(false); }
  };
  const handleUnlock = async () => {
    if (!onUnlockSplit) return;
    setSavingLock(true);
    try { await onUnlockSplit(); } finally { setSavingLock(false); }
  };

  // Top playlists no ar — só entra se estiver ativa/dispatched/done E tiver entrega real.
  const topPlaylists = allocations
    .filter(a => a.status === "active" || a.status === "dispatched" || a.status === "done")
    .map(a => ({
      a,
      delivered: Number(latestByPl.get(a.managed_playlist_id)?.plays_28d ?? latestByPl.get(a.managed_playlist_id)?.plays_7d ?? 0),
      delta24: latestByPl.get(a.managed_playlist_id)?.plays_24h ?? 0,
    }))
    .filter(x => x.delivered > 0 || Number(x.delta24 ?? 0) > 0)
    .sort((x, y) => (y.delivered - x.delivered) || (y.a.planned_streams - x.a.planned_streams))
    .slice(0, 10);


  return (
    <div className="space-y-6">
      {/* KPIs — padrão Curadores: hero (Entregue) + secundários + quiet (Duração) */}
      {!hideKpis && (
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiBig
          tier="hero"
          icon={Activity}
          label="Entregue"
          value={formatInt(delivered)}
          hint={`${pct}% da meta`}
          domain="campaigns"
        />
        <KpiBig
          icon={Target}
          label="Meta"
          value={formatInt(snapshot.meta)}
          hint="streams"
          domain="deals"
        />
        <KpiBig
          icon={Gauge}
          label="Aderência"
          value={`${adherence}%`}
          hint={`vs ${formatInt(plannedToDate)} planejados`}
          domain={adherence >= 85 ? "campaigns" : "system"}
        />
        <KpiBig
          tier="quiet"
          icon={CalendarDays}
          label="Duração"
          value={`${snapshot.days}d`}
          hint={snapshot.modo === "simultaneo" ? "simultâneo" : "sequencial"}
          domain="curators"
        />
      </section>
      )}


      {/* Split eco/ext/org — extraído do Plano de entrega pra leitura imediata */}
      {!hideSplitRows && (
      <section className={cn("grid grid-cols-1 gap-3", orgTarget > 0 ? "md:grid-cols-3" : "md:grid-cols-2")}>
        <div className="space-y-2">
          <SplitRow
            tone="eco"
            label="Ecossistema"
            metaTotal={ecoTarget}
            metaPct={ecoEffectivePct}
            deliveredTotal={ecoDelivered}
            perDayContract={Math.round(Math.max(0, ecoTarget - ecoDelivered) / daysRemaining)}
            perDayReal={Math.round(ecoTarget / Math.max(1, snapshot.effectiveDays ?? snapshot.days))}
          />
          {/* Auditoria — Rádio dentro do Ecossistema, separada visualmente */}
          {(radioDeliveredSafe > 0 || ecoDeliveredPlaylists > 0) && (
            <div className="rounded-md border border-border/40 bg-muted/10 px-3 py-2 text-[11px] tabular-nums flex items-center justify-between gap-3">
              <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                <span className="h-1.5 w-1.5 rounded-full bg-primary/70" />
                Playlists próprias
              </span>
              <span className="text-foreground/90">{formatInt(ecoDeliveredPlaylists)}</span>
              <span className="inline-flex items-center gap-1.5 text-muted-foreground ml-3">
                <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                Rádio
              </span>
              <span className="text-foreground/90">+{formatInt(radioDeliveredSafe)}</span>
            </div>
          )}
        </div>
        <SplitRow
          tone="ext"
          label="Externo"
          metaTotal={extTarget}
          metaPct={extEffectivePct}
          deliveredTotal={extDelivered}
          perDayContract={Math.round(Math.max(0, extTarget - extDelivered) / daysRemaining)}
          perDayReal={Math.round(extTarget / Math.max(1, snapshot.effectiveDays ?? snapshot.days))}
        />
        {orgTarget > 0 && (
          <SplitRow
            tone="org"
            label="Rádio"
            metaTotal={orgTarget}
            metaPct={orgPctOfMeta}
            deliveredTotal={0}
            perDayContract={Math.round(orgTarget / Math.max(1, snapshot.days))}
            perDayReal={Math.round(orgTarget / Math.max(1, snapshot.effectiveDays ?? snapshot.days))}
          />
        )}
      </section>
      )}

      {/* Plano de entrega — 2 cards: contratado vs real (diluído no effectiveDays) */}
      {!hideDeliveryPlan && (() => {

        const effDays = Math.max(1, snapshot.effectiveDays ?? snapshot.days);
        const realPerDay = Math.round(snapshot.meta / effDays);
        return (
          <section className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <RitmoCard
              tone="contract"
              label="Ritmo contratado"
              hint={`${daysRemaining}d restantes · ${formatInt(restante)} a entregar`}
              value={ritmoNecessario}
              footer={`Meta ${formatInt(snapshot.meta)} em ${snapshot.days}d`}
            />
            <RitmoCard
              tone="real"
              label="Ritmo real (plano)"
              hint={`Diluído em ${effDays}d de execução (com buffer)`}
              value={realPerDay}
              footer={`Média do plano · pico ${formatInt(snapshot.picoPorDia)}/dia`}
            />
          </section>
        );
      })()}

      {/* Bloco "Detalhes do plano" removido — coberto pelos KPIs + cards eco/ext/org. */}





      {/* Grid principal: Curva (ou slot) + Top playlists */}
      <div className={cn("grid grid-cols-1 gap-4", (showCurveCard || curveSlot) ? "lg:grid-cols-3" : "")}>
        {curveSlot ? (
          <div className="lg:col-span-2 h-full">{curveSlot}</div>



        ) : showCurveCard ? (
        <Card className="lg:col-span-2">
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="text-sm font-semibold">Curva de entrega</div>
                <div className="text-xs text-muted-foreground">Planejado por dia · acumulado</div>
              </div>
              <div className="text-right text-xs text-muted-foreground tabular-nums">
                média {formatInt(snapshot.mediaPorDia)}/dia · pico {formatInt(snapshot.picoPorDia)}
              </div>
            </div>
            <MiniCurva curva={curva} elapsedDays={daysElapsed} />
            {onJumpTab && !hideCurveShortcut && (
              <div className="mt-3 text-right">
                <Button variant="ghost" size="sm" onClick={() => onJumpTab("curve")} className="h-7 text-xs">
                  Ver curva completa <ArrowRight className="h-3 w-3 ml-1" />
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
        ) : null}

        <Card>
          <CardContent className="p-5">
            {(() => {
              // Override do portal do cliente (fonte: engine view)
              if (topDeliveringPlaylists !== undefined) {
                const delivering = topDeliveringPlaylists
                  .filter((p) => p.delivered > 0)
                  .sort((a, b) => b.delivered - a.delivered);
                const top = delivering.slice(0, 10);
                return (
                  <CompactPlaylistList
                    title="Playlists entregando"
                    counterLabel={`${delivering.length} ativas`}
                    items={top.map((p) => ({
                      name: p.name,
                      image_url: p.image_url,
                      delivered: p.delivered,
                      planned: Number(p.planned ?? 0),
                      lastDelta: p.lastDelta ?? null,
                    }))}
                    emptyText="Aguardando primeira entrega."
                  />
                );
              }
              // Comportamento original (interno)
              return (
                <CompactPlaylistList
                  title="Playlists entregando"
                  counterLabel={`${topPlaylists.length} ativas`}
                  items={topPlaylists.map(({ a, delivered: d }) => ({
                    name: a.managed_playlists?.name ?? "—",
                    image_url: a.managed_playlists?.cover_url ?? null,
                    delivered: d,
                    planned: a.planned_streams,
                  }))}
                  emptyText="Nenhuma playlist entregando agora."
                />
              );
            })()}
            {onJumpTab && (allocations.length > 0 || (topDeliveringPlaylists?.length ?? 0) > 0) && (
              <div className="mt-3 text-right">
                <Button variant="ghost" size="sm" onClick={() => onJumpTab("playlists")} className="h-7 text-xs">
                  Ver todas <ArrowRight className="h-3 w-3 ml-1" />
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>


      {/* Financeiro só interno: custo NexEngine x venda pro cliente x margem */}
      {showFinance && (() => {
        const venda = snapshot.clientPriceTotal
          ?? (snapshot.pricePerStreamSell ? snapshot.meta * snapshot.pricePerStreamSell : 0);
        const custo = snapshot.custoTotal ?? 0;
        const margem = venda - custo;
        const margemPct = venda > 0 ? Math.round((margem / venda) * 100) : 0;
        return (
          <Card>
            <CardContent className="p-5">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="text-sm font-semibold">Resumo financeiro interno</div>
                  <div className="text-xs text-muted-foreground">
                    {snapshot.pricePerStreamSell
                      ? `Tabela de venda: R$ ${(snapshot.pricePerStreamSell * 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 0 })} / 1M streams`
                      : "Tabela de venda não definida"}
                  </div>
                </div>
                {onJumpTab && (
                  <Button variant="ghost" size="sm" onClick={() => onJumpTab("finance")} className="h-7 text-xs">
                    Detalhes <ArrowRight className="h-3 w-3 ml-1" />
                  </Button>
                )}
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                <Kpi label="Custo (eu pago)" value={formatBRL(custo)} sub={`CPP R$ ${snapshot.custoPorStream.toFixed(3).replace(".", ",")}`} compact />
                <Kpi label="Venda (cliente paga)" value={formatBRL(venda)} sub={`${formatInt(snapshot.meta)} streams`} tone="primary" compact />
                <Kpi
                  label="Margem"
                  value={formatBRL(margem)}
                  sub={`${margemPct}% sobre venda`}
                  tone={margem > 0 ? "primary" : "warning"}
                  compact
                />
                {(snapshot.streamsOrganic ?? 0) > 0 ? (
                  <Kpi
                    label="Orgânico"
                    value={`${formatInt(snapshot.streamsOrganic ?? 0)}`}
                    sub={`${snapshot.splitOrganicPct ?? 0}% · ${formatBRL(snapshot.custoOrganic ?? 0)}`}
                    compact
                  />
                ) : (
                  <Kpi label="Split eco / ext" value={`${snapshot.splitEcoPct}% / ${100 - snapshot.splitEcoPct}%`} sub={`${formatInt(snapshot.streamsEco)} eco`} compact />
                )}
              </div>
            </CardContent>
          </Card>
        );
      })()}

    </div>
  );
}

function Kpi({ label, value, sub, tone, compact }: { label: string; value: string; sub?: string; tone?: "primary" | "warning"; compact?: boolean }) {
  return (
    <KpiBig
      label={label}
      value={value}
      hint={sub}
      tone={tone}
      tier={compact ? "quiet" : "default"}
    />
  );
}


function SplitRow({
  tone, label, metaTotal, metaPct, deliveredTotal, perDayContract, perDayReal,
}: {
  tone: "eco" | "ext" | "org";
  label: string;
  metaTotal: number;
  metaPct: number;
  deliveredTotal: number;
  perDayContract: number;
  perDayReal: number;
}) {
  const pct = metaTotal > 0 ? Math.min(100, Math.round((deliveredTotal / metaTotal) * 100)) : 0;
  const dotClass = tone === "eco" ? "bg-primary" : tone === "ext" ? "bg-[hsl(265_60%_60%)]" : "bg-[hsl(330_70%_60%)]";
  const barClass = dotClass;
  // Degradê sutil tonal pra diferenciar do fundo sem virar bloco colorido.
  const gradientStyle: React.CSSProperties =
    tone === "eco"
      ? { backgroundImage: "linear-gradient(135deg, hsl(141 76% 36% / 0.10), hsl(141 76% 36% / 0.02) 60%, transparent)" }
      : tone === "ext"
      ? { backgroundImage: "linear-gradient(135deg, hsl(265 60% 60% / 0.12), hsl(265 60% 60% / 0.03) 60%, transparent)" }
      : { backgroundImage: "linear-gradient(135deg, hsl(330 70% 60% / 0.10), hsl(330 70% 60% / 0.02) 60%, transparent)" };
  const borderClass =
    tone === "eco"
      ? "border-[hsl(141_76%_36%/0.25)]"
      : tone === "ext"
      ? "border-[hsl(265_60%_60%/0.28)]"
      : "border-[hsl(330_70%_60%/0.25)]";

  return (
    <div className={cn("rounded-lg border px-4 py-3", borderClass)} style={gradientStyle}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className={cn("h-2 w-2 rounded-full", dotClass)} />
          <span className="text-xs font-medium">{label}</span>
          <span className="text-[10px] text-muted-foreground tabular-nums">{metaPct}%</span>
        </div>
        <div className="text-right">
          <div className="text-[11px] text-foreground font-medium tabular-nums leading-none">
            {formatInt(perDayReal)}<span className="text-muted-foreground font-normal">/dia real</span>
          </div>
          <div className="text-[10px] text-muted-foreground tabular-nums mt-0.5">
            {formatInt(perDayContract)}/dia contratado
          </div>
        </div>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div className={cn("h-full", barClass)} style={{ width: `${pct}%` }} />
      </div>
      <div className="flex items-baseline justify-between mt-1.5 text-[11px] tabular-nums">
        <span className="text-muted-foreground">
          <span className="text-foreground font-medium">{formatInt(deliveredTotal)}</span>
          {" "}/ {formatInt(metaTotal)}
        </span>
        <span className="text-muted-foreground">{pct}%</span>
      </div>
    </div>
  );
}

function RitmoCard({
  tone, label, hint, value, footer,
}: {
  tone: "contract" | "real";
  label: string;
  hint: string;
  value: number;
  footer: string;
}) {
  const gradientStyle: React.CSSProperties =
    tone === "contract"
      ? { backgroundImage: "linear-gradient(135deg, hsl(210 80% 55% / 0.10), hsl(210 80% 55% / 0.02) 60%, transparent)" }
      : { backgroundImage: "linear-gradient(135deg, hsl(40 90% 55% / 0.10), hsl(40 90% 55% / 0.02) 60%, transparent)" };
  const borderClass =
    tone === "contract"
      ? "border-[hsl(210_80%_55%/0.25)]"
      : "border-[hsl(40_90%_55%/0.25)]";
  const dotClass = tone === "contract" ? "bg-[hsl(210_80%_55%)]" : "bg-[hsl(40_90%_55%)]";

  return (
    <div className={cn("rounded-lg border px-4 py-4", borderClass)} style={gradientStyle}>
      <div className="flex flex-col gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={cn("h-2 w-2 rounded-full shrink-0", dotClass)} />
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">{label}</span>
          </div>
          <div className="text-[11px] text-muted-foreground mt-1 leading-snug">{hint}</div>
        </div>
        <div>
          <div className="text-2xl font-semibold tabular-nums leading-none">
            {formatInt(value)}<span className="text-xs text-muted-foreground font-normal">/dia</span>
          </div>
          <div className="text-[10px] text-muted-foreground tabular-nums mt-1.5">{footer}</div>
        </div>
      </div>
    </div>
  );
}


function DeltaInline({ value }: { value: number | null }) {
  if (value == null || value === 0) {
    return <span className="text-[10px] text-muted-foreground inline-flex items-center gap-0.5 shrink-0 tabular-nums"><Minus className="h-2.5 w-2.5" />—</span>;
  }
  if (value > 0) {
    return <span className="text-[10px] text-primary inline-flex items-center gap-0.5 shrink-0 tabular-nums font-medium"><TrendingUp className="h-2.5 w-2.5" />+{formatInt(value)}</span>;
  }
  return <span className="text-[10px] text-destructive inline-flex items-center gap-0.5 shrink-0 tabular-nums"><TrendingDown className="h-2.5 w-2.5" />{formatInt(value)}</span>;
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diff / 3_600_000);
  if (h < 1) return "agora";
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function MiniCurva({ curva, elapsedDays }: { curva: CampaignSnapshot["curva"]; elapsedDays: number }) {
  if (curva.length === 0) return null;
  const w = 720, h = 180, pad = 16;
  const maxS = Math.max(...curva.map(p => p.streamsDay), 1);
  const maxC = curva[curva.length - 1].cumulative;
  const xs = (i: number) => pad + (i / Math.max(curva.length - 1, 1)) * (w - pad * 2);
  const ysBar = (v: number) => h - pad - (v / maxS) * (h - pad * 2);
  const yC = (v: number) => h - pad - (v / maxC) * (h - pad * 2);
  const lineCum = curva.map((p, i) => `${i === 0 ? "M" : "L"} ${xs(i)} ${yC(p.cumulative)}`).join(" ");
  const barW = Math.max(1, (w - pad * 2) / curva.length - 1);
  const todayX = elapsedDays > 0 ? xs(Math.min(elapsedDays - 1, curva.length - 1)) : null;

  return (
    <div className="w-full">
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-32" preserveAspectRatio="none">
        {curva.map((p, i) => (
          <rect
            key={p.day}
            x={xs(i) - barW / 2}
            y={ysBar(p.streamsDay)}
            width={barW}
            height={h - pad - ysBar(p.streamsDay)}
            fill="hsl(var(--primary))"
            opacity={i < elapsedDays ? 0.45 : 0.18}
          />
        ))}
        <path d={lineCum} fill="none" stroke="hsl(var(--primary))" strokeWidth={1.5} />
        {todayX !== null && (
          <line x1={todayX} y1={pad} x2={todayX} y2={h - pad} stroke="hsl(var(--primary))" strokeDasharray="2 2" opacity={0.5} />
        )}
      </svg>
      <div className="flex justify-between text-[10px] text-muted-foreground mt-1 tabular-nums">
        <span>D1</span>
        <span>Hoje · D{elapsedDays || 1}</span>
        <span>D{curva.length}</span>
      </div>
    </div>
  );
}
