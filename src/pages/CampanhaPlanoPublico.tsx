// Página pública do plano da campanha — para enviar ao responsável de marketing.
// Acesso: /plano/:token  (sem login). Lê via edge function get-campaign-plan-public.
import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { PageLoader } from "@/components/PageLoader";
import { Card, CardContent } from "@/components/ui/card";
import { NexEngineLogo } from "@/components/NexEngineLogo";
import { Music, CalendarDays, Target, TrendingUp, Grid3x3 } from "lucide-react";
import type { CampaignSnapshot } from "@/lib/campaignSnapshot";
import { buildEcoPlaylistPlan, type DailyPlaylistPlan, applyWeekdaySeasonality } from "@/lib/campaignOperationalPlan";
import { formatInt } from "@/lib/campaignEngine";
import { cn } from "@/lib/utils";

type AllocRow = {
  id: string;
  planned_streams: number;
  start_day: number;
  status: string;
  managed_playlists: { name: string; cover_url: string | null; followers: number } | null;
};

type CampaignPublic = {
  track_name: string;
  artist: string | null;
  cover_url: string | null;
  goal_plays: number;
  deadline: string | null;
  started_at: string | null;
  status: string;
  total_delivered: number;
  engagement_multiplier: number;
  simulation_snapshot: CampaignSnapshot | null;
};

function dateLabel(startedAt: string, day: number) {
  const base = new Date(startedAt);
  base.setDate(base.getDate() + day - 1);
  return base.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

function daysSince(startedAt: string) {
  const start = new Date(startedAt);
  start.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.floor((today.getTime() - start.getTime()) / 86400000) + 1; // D1 no dia de início
}

export default function CampanhaPlanoPublico() {
  const { token } = useParams<{ token: string }>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [camp, setCamp] = useState<CampaignPublic | null>(null);
  const [allocs, setAllocs] = useState<AllocRow[]>([]);

  useEffect(() => {
    if (!token) return;
    (async () => {
      setLoading(true);
      const { data, error: fnErr } = await supabase.functions.invoke("get-campaign-plan-public", {
        body: { token },
      });
      if (fnErr || !data?.ok) {
        setError(data?.error ?? fnErr?.message ?? "not_found");
      } else {
        setCamp(data.campaign);
        setAllocs(data.allocations ?? []);
        setError(null);
      }
      setLoading(false);
    })();
  }, [token]);

  const snapshot = camp?.simulation_snapshot ?? null;

  // Plano por playlist (matriz dia × playlist).
  const plans = useMemo<DailyPlaylistPlan[]>(() => {
    if (!snapshot || !camp?.started_at) return [];
    return buildEcoPlaylistPlan(snapshot, allocs as any, {
      engagementMultiplier: camp.engagement_multiplier,
      startedAt: camp.started_at,
    });
  }, [snapshot, allocs, camp?.started_at, camp?.engagement_multiplier]);

  // Curva (com sazonalidade aplicada) — base para meta diária + acumulada.
  const curva = useMemo(() => {
    if (!snapshot || !camp?.started_at) return [];
    return applyWeekdaySeasonality(snapshot.curva, camp.started_at);
  }, [snapshot, camp?.started_at]);

  const dailyTotals = useMemo(() => {
    if (!snapshot) return [];
    const days = snapshot.days;
    const arr = Array.from({ length: days }, () => 0);
    for (const p of plans) for (let i = 0; i < days; i++) arr[i] += p.daily[i] ?? 0;
    return arr;
  }, [plans, snapshot]);

  if (loading) return <PageLoader />;
  if (error || !camp || !snapshot) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-6">
        <Card className="max-w-md w-full">
          <CardContent className="p-6 text-center space-y-2">
            <h1 className="text-lg font-semibold">Link inválido</h1>
            <p className="text-sm text-muted-foreground">
              Este plano não existe ou o link foi desativado.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const today = camp.started_at ? Math.min(snapshot.days, Math.max(1, daysSince(camp.started_at))) : 1;
  const dayIndex = today - 1;
  const isBeforeStart = camp.started_at ? new Date() < new Date(camp.started_at) : false;
  const isAfterEnd = today > snapshot.days;

  // Meta do dia (curva) e acumulado esperado até hoje (inclusive).
  const metaHoje = curva[dayIndex]?.streamsDay ?? 0;
  const acumuladoEsperado = curva.slice(0, today).reduce((s, p) => s + p.streamsDay, 0);
  const metaTotal = snapshot.meta;
  const pctAcum = metaTotal > 0 ? Math.min(100, (acumuladoEsperado / metaTotal) * 100) : 0;

  // Próximos 3 dias (preview rápido).
  const proximos = curva.slice(today, today + 3).map((p, i) => ({
    label: dateLabel(camp.started_at!, today + 1 + i),
    day: today + 1 + i,
    meta: p.streamsDay,
    acum: curva.slice(0, today + 1 + i).reduce((s, x) => s + x.streamsDay, 0),
  }));

  return (
    <div className="min-h-screen bg-background py-8 sm:py-10">
      <div className="w-full max-w-[1280px] mx-auto px-5 sm:px-6 lg:px-8 space-y-6">
        {/* Topbar simples */}
        <div className="flex items-center justify-between gap-3 pb-3 border-b border-border/50">
          <div className="flex items-center gap-2.5">
            <NexEngineLogo variant="mark" size={20} />
            <div className="text-[12.5px] font-semibold tracking-tight">Plano da campanha</div>
          </div>
          <div className="text-[10.5px] uppercase tracking-wider text-muted-foreground">
            Acompanhamento — só leitura
          </div>
        </div>

        {/* Header com música + meta total */}
        <Card>
          <CardContent className="p-5 sm:p-6 flex items-center gap-4 sm:gap-5">
            {camp.cover_url ? (
              <img src={camp.cover_url} alt="" className="w-16 h-16 sm:w-20 sm:h-20 rounded-xl object-cover ring-1 ring-border" />
            ) : (
              <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-xl bg-muted grid place-items-center">
                <Music className="h-6 w-6 text-muted-foreground" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="text-[10px] uppercase tracking-[0.18em] text-primary/80 font-semibold mb-1">
                Campanha em andamento
              </div>
              <h1 className="text-xl sm:text-2xl font-semibold tracking-tight truncate">{camp.track_name}</h1>
              {camp.artist && (
                <p className="text-sm text-muted-foreground truncate mt-0.5">{camp.artist}</p>
              )}
              <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground tabular-nums">
                <CalendarDays className="h-3.5 w-3.5" />
                {camp.started_at ? new Date(camp.started_at).toLocaleDateString("pt-BR") : "—"}
                {camp.deadline && <> → {new Date(camp.deadline).toLocaleDateString("pt-BR")}</>}
                <span className="text-muted-foreground/50">·</span>
                <span>{snapshot.days} dias</span>
              </div>
            </div>
            <div className="hidden sm:block text-right">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Meta total</div>
              <div className="text-2xl font-bold tabular-nums tracking-tight">{formatInt(metaTotal)}</div>
              <div className="text-[10px] text-muted-foreground">streams</div>
            </div>
          </CardContent>
        </Card>

        {/* HERO — meta de hoje + acumulado esperado */}
        <Card className="overflow-hidden">
          <CardContent className="p-0">
            <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_1fr]">
              {/* Meta do dia */}
              <div className="p-6 sm:p-8 bg-primary/[0.06] border-b lg:border-b-0 lg:border-r border-border">
                <div className="flex items-center gap-2 text-[10.5px] uppercase tracking-[0.18em] text-primary font-semibold mb-2">
                  <Target className="h-3.5 w-3.5" />
                  {isBeforeStart ? "A campanha começa em breve" : isAfterEnd ? "Campanha encerrada" : `Meta de hoje · D${today} · ${dateLabel(camp.started_at!, today)}`}
                </div>
                <div className="flex items-end gap-3 flex-wrap">
                  <span className="text-5xl sm:text-6xl font-bold tabular-nums leading-none tracking-tight text-primary">
                    {formatInt(metaHoje)}
                  </span>
                  <span className="text-sm text-muted-foreground pb-1.5">streams hoje</span>
                </div>
                <div className="mt-5 rounded-xl bg-card/60 ring-1 ring-border p-4">
                  <div className="flex items-center justify-between text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">
                    <span className="inline-flex items-center gap-1.5">
                      <TrendingUp className="h-3.5 w-3.5" />
                      Acumulado esperado até hoje
                    </span>
                    <span className="tabular-nums text-foreground/80">{pctAcum.toFixed(1)}% da meta</span>
                  </div>
                  <div className="text-3xl sm:text-4xl font-bold tabular-nums leading-none tracking-tight">
                    {formatInt(acumuladoEsperado)}
                    <span className="text-base font-normal text-muted-foreground ml-2">/ {formatInt(metaTotal)}</span>
                  </div>
                  <div className="mt-3 h-2 rounded-full bg-muted overflow-hidden">
                    <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${pctAcum}%` }} />
                  </div>
                  <p className="mt-3 text-[11.5px] text-muted-foreground leading-relaxed">
                    Olhe assim: <span className="text-foreground font-medium">a meta do dia é {formatInt(metaHoje)} plays</span>, e a música <span className="text-foreground font-medium">deveria estar com {formatInt(acumuladoEsperado)} plays no total</span> ao fim do dia de hoje. Se o número real estiver muito abaixo, é hora de reforçar.
                  </p>
                </div>
              </div>

              {/* Próximos 3 dias */}
              <div className="p-6 sm:p-8">
                <div className="text-[10.5px] uppercase tracking-[0.18em] text-muted-foreground font-semibold mb-3">
                  Próximos dias
                </div>
                {proximos.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Sem próximos dias — campanha no fim.</p>
                ) : (
                  <div className="space-y-2.5">
                    {proximos.map((p) => (
                      <div key={p.day} className="flex items-center justify-between gap-3 rounded-lg border border-border/60 px-3.5 py-2.5">
                        <div className="min-w-0">
                          <div className="text-[10.5px] uppercase tracking-wider text-muted-foreground">D{p.day} · {p.label}</div>
                          <div className="text-sm font-semibold tabular-nums">{formatInt(p.meta)} <span className="text-[11px] text-muted-foreground font-normal">streams no dia</span></div>
                        </div>
                        <div className="text-right">
                          <div className="text-[10.5px] uppercase tracking-wider text-muted-foreground">Acumulado</div>
                          <div className="text-sm font-semibold tabular-nums">{formatInt(p.acum)}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Resumo: nº de playlists + investimento (sem custo de externo se zero) */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <SummaryStat label="Playlists próprias" value={String(allocs.length)} />
          <SummaryStat label="Duração" value={`${snapshot.days} dias`} />
          <SummaryStat label="Pico previsto" value={`${formatInt(snapshot.picoPorDia)}/dia`} />
          <SummaryStat label="Média diária" value={`${formatInt(snapshot.mediaPorDia)}/dia`} />
        </div>

        {/* Tabela completa do plano */}
        {plans.length > 0 && (
          <Card>
            <CardContent className="p-5 sm:p-6">
              <div className="flex items-center justify-between gap-3 mb-4">
                <div>
                  <h2 className="text-base font-semibold inline-flex items-center gap-2">
                    <Grid3x3 className="h-4 w-4 text-primary" /> Plano completo · dia × playlist
                  </h2>
                  <p className="text-xs text-muted-foreground mt-1">
                    Cada célula = streams previstos naquele dia. A coluna destacada é o dia de hoje.
                  </p>
                </div>
              </div>
              <div className="rounded-lg border border-border overflow-hidden">
                <div className="max-h-[640px] overflow-auto">
                  <table className="text-[11.5px] border-separate border-spacing-0 min-w-full">
                    <thead className="sticky top-0 z-20 bg-card text-muted-foreground">
                      <tr>
                        <th className="sticky left-0 z-30 bg-card text-left font-medium py-2.5 px-3 border-b border-r border-border min-w-[240px]">
                          Playlist
                        </th>
                        <th className="text-right font-medium py-2.5 px-2 border-b border-border w-24">Total</th>
                        {Array.from({ length: snapshot.days }, (_, i) => (
                          <th
                            key={i}
                            className={cn(
                              "text-right font-medium py-2.5 px-2 border-b border-border whitespace-nowrap min-w-[70px]",
                              i === dayIndex && !isBeforeStart && !isAfterEnd && "bg-primary/10 text-primary",
                            )}
                          >
                            <div className="tabular-nums">D{i + 1}</div>
                            <div className="text-[9.5px] font-normal opacity-70">{dateLabel(camp.started_at!, i + 1)}</div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {plans.map((p, rowIdx) => (
                        <tr key={p.allocationId} className={cn(rowIdx % 2 === 1 && "bg-elevated/20")}>
                          <td className={cn("sticky left-0 z-10 py-2 px-3 border-b border-r border-border/30", rowIdx % 2 === 1 ? "bg-elevated/40" : "bg-card")}>
                            <div className="flex items-center gap-2.5">
                              {p.coverUrl ? (
                                <img src={p.coverUrl} alt="" className="w-7 h-7 rounded object-cover shrink-0" />
                              ) : (
                                <div className="w-7 h-7 rounded bg-muted shrink-0" />
                              )}
                              <div className="min-w-0">
                                <div className="font-medium truncate">{p.playlistName}</div>
                                <div className="text-[9.5px] text-muted-foreground tabular-nums">
                                  {formatInt(p.followers)} saves
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="text-right tabular-nums font-semibold py-2 px-2 border-b border-border/30">
                            {formatInt(p.totalStreams)}
                          </td>
                          {p.daily.map((v, i) => {
                            const intensity = p.capDia > 0 ? Math.min(1, v / p.capDia) : 0;
                            const isToday = i === dayIndex && !isBeforeStart && !isAfterEnd;
                            return (
                              <td
                                key={i}
                                className={cn(
                                  "text-right tabular-nums py-2 px-2 border-b border-border/30 whitespace-nowrap",
                                  v === 0 && "text-muted-foreground/30",
                                  isToday && "ring-1 ring-inset ring-primary/50",
                                )}
                                style={v > 0 ? { backgroundColor: `hsl(var(--primary) / ${0.05 + intensity * 0.22})` } : undefined}
                              >
                                {v > 0 ? formatInt(v) : "·"}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="sticky bottom-0 z-20 bg-card font-semibold">
                      <tr>
                        <td className="sticky left-0 z-30 bg-card py-2.5 px-3 border-t-2 border-r border-border">
                          Total / dia
                        </td>
                        <td className="text-right tabular-nums py-2.5 px-2 border-t-2 border-border text-primary">
                          {formatInt(dailyTotals.reduce((s, v) => s + v, 0))}
                        </td>
                        {dailyTotals.map((v, i) => {
                          const acum = curva.slice(0, i + 1).reduce((s, p) => s + p.streamsDay, 0);
                          const isToday = i === dayIndex && !isBeforeStart && !isAfterEnd;
                          return (
                            <td
                              key={i}
                              className={cn(
                                "text-right tabular-nums py-2.5 px-2 border-t-2 border-border whitespace-nowrap",
                                isToday && "bg-primary/10 text-primary",
                              )}
                              title={`Acumulado: ${formatInt(acum)}`}
                            >
                              <div>{formatInt(v)}</div>
                              <div className="text-[9px] font-normal opacity-60">∑ {formatInt(acum)}</div>
                            </td>
                          );
                        })}
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
              <p className="text-[10.5px] text-muted-foreground mt-3">
                A coluna verde é o dia de hoje. Em cada total/dia, "∑" mostra o acumulado esperado até aquele dia.
              </p>
            </CardContent>
          </Card>
        )}

        <div className="text-center text-[10.5px] text-muted-foreground pt-2 pb-4">
          Gerado por <span className="font-semibold text-foreground/80">NexEngine</span> · acesso somente leitura
        </div>
      </div>
    </div>
  );
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className="text-lg font-semibold tabular-nums mt-1">{value}</div>
      </CardContent>
    </Card>
  );
}
