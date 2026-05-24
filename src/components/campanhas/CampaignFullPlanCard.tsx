import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Grid3x3, Link2, Check, ExternalLink, Shuffle, Loader2 } from "lucide-react";
import { formatInt } from "@/lib/campaignEngine";
import type { CampaignSnapshot } from "@/lib/campaignSnapshot";
import { buildEcoPlaylistPlan, distributeEcoPositions, inferEcoPreferredPositions, type DailyPlaylistPlan } from "@/lib/campaignOperationalPlan";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

type EcoAlloc = {
  id: string;
  planned_streams: number;
  start_day: number;
  managed_playlists?: {
    name: string;
    cover_url: string | null;
    followers: number;
    spotify_url?: string | null;
  } | null;
};

type Props = {
  snapshot: CampaignSnapshot;
  startedAt: string;
  allocations: EcoAlloc[];
  engagementMultiplier?: number;
  shareToken?: string | null;
  showShare?: boolean;
  track?: {
    name: string;
    artist?: string | null;
    coverUrl?: string | null;
    spotifyUrl?: string | null;
  } | null;
};

function dateLabel(startedAt: string, day: number) {
  const base = new Date(startedAt);
  base.setDate(base.getDate() + day - 1);
  return base.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

export function CampaignFullPlanCard({
  snapshot,
  startedAt,
  allocations,
  engagementMultiplier = 30,
  shareToken,
  showShare = true,
  track = null,
}: Props) {
  const [showZeros, setShowZeros] = useState(false);
  const [mode, setMode] = useState<"diario" | "acumulado">("acumulado");
  const [copied, setCopied] = useState(false);

  function copyShareLink() {
    if (!shareToken) return;
    const url = `https://engine.nexcreatorx.com/p/plano/${shareToken}`;
    navigator.clipboard.writeText(url);
    setCopied(true);
    toast({
      title: "Link público copiado",
      description: "Qualquer pessoa com o link verá só este plano, sem entrar no sistema.",
    });
    setTimeout(() => setCopied(false), 2000);
  }

  const days = snapshot.days;

  const positionByAllocation = useMemo(
    () => {
      const positionInputs = allocations.map((a) => ({
        id: a.id,
        planned_streams: a.planned_streams,
        followers: a.managed_playlists?.followers ?? 0,
      }));
      const preferredSlots = inferEcoPreferredPositions(snapshot, positionInputs, engagementMultiplier);
      return distributeEcoPositions(
        positionInputs,
        days,
        engagementMultiplier,
        { preferredSlots },
      );
    },
    [allocations, days, engagementMultiplier, snapshot],
  );

  const plans = useMemo<DailyPlaylistPlan[]>(
    () => buildEcoPlaylistPlan(snapshot, allocations, {
      engagementMultiplier,
      startedAt,
      positions: positionByAllocation,
    }),
    [snapshot, allocations, engagementMultiplier, startedAt, positionByAllocation],
  );

  const spotifyByAllocation = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const a of allocations) m.set(a.id, a.managed_playlists?.spotify_url ?? null);
    return m;
  }, [allocations]);

  const dailyTotals = useMemo(() => {
    const arr = Array.from({ length: days }, () => 0);
    for (const p of plans) for (let i = 0; i < days; i++) arr[i] += p.daily[i] ?? 0;
    return arr;
  }, [plans, days]);

  const cumulativeTotals = useMemo(() => {
    const arr: number[] = [];
    let acc = 0;
    for (let i = 0; i < days; i++) {
      acc += dailyTotals[i] ?? 0;
      arr.push(acc);
    }
    return arr;
  }, [dailyTotals, days]);

  // ---- Resumo da distribuição (card no topo) ----
  const resumo = useMemo(() => {
    const capacidadeEcoDia = plans.reduce((s, p) => s + (p.capDia ?? 0), 0);
    const ecoCobertoTotal = plans.reduce((s, p) => s + (p.totalStreams ?? 0), 0);
    const metaEco = snapshot.streamsEco ?? 0;
    const metaExt = snapshot.streamsExt ?? Math.max(0, snapshot.meta - metaEco);
    const necDiaTotal = Math.round(snapshot.meta / Math.max(1, days));
    const necDiaEco = Math.round(metaEco / Math.max(1, days));
    const necDiaExt = Math.round(metaExt / Math.max(1, days));
    const pico = dailyTotals.length ? Math.max(...dailyTotals) : 0;
    const usoCap = capacidadeEcoDia > 0 ? Math.round((necDiaEco / capacidadeEcoDia) * 100) : 0;
    const deficitEco = Math.max(0, metaEco - ecoCobertoTotal);
    return {
      capacidadeEcoDia, ecoCobertoTotal, metaEco, metaExt,
      necDiaTotal, necDiaEco, necDiaExt, pico, usoCap, deficitEco,
      qtdPlaylists: plans.length,
    };
  }, [plans, dailyTotals, snapshot, days]);


  function cellValue(p: DailyPlaylistPlan, i: number) {
    if (mode === "diario") return p.daily[i] ?? 0;
    let acc = 0;
    for (let k = 0; k <= i; k++) acc += p.daily[k] ?? 0;
    return acc;
  }

  if (plans.length === 0) return null;

  const footerValues = mode === "diario" ? dailyTotals : cumulativeTotals;

  return (
    <Card className="mt-4">
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="text-sm flex items-center gap-2">
            <Grid3x3 className="h-4 w-4 text-primary" /> Plano completo da campanha
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Matriz dia × playlist · {mode === "diario" ? "streams previstos por dia" : "streams acumulados até o dia"}.
            Coluna <span className="font-medium text-foreground">Pos</span> = posição planejada da música na playlist.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="inline-flex rounded-md border border-border overflow-hidden">
            <button
              onClick={() => setMode("diario")}
              className={cn(
                "px-2.5 h-8 text-xs",
                mode === "diario" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground",
              )}
            >
              Diário
            </button>
            <button
              onClick={() => setMode("acumulado")}
              className={cn(
                "px-2.5 h-8 text-xs border-l border-border",
                mode === "acumulado" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground",
              )}
            >
              Acumulado
            </button>
          </div>
          <Button size="sm" variant="ghost" onClick={() => setShowZeros((s) => !s)}>
            {showZeros ? "Esconder zeros" : "Mostrar zeros"}
          </Button>
          {showShare && (
            <Button size="sm" variant="outline" onClick={copyShareLink}>
              {copied ? <Check className="h-4 w-4 mr-1.5" /> : <Link2 className="h-4 w-4 mr-1.5" />}
              {copied ? "Copiado" : "Copiar link público"}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {track && (
          <div className="mb-3 flex items-center gap-3 rounded-lg border border-border bg-elevated/30 p-2.5">
            {track.coverUrl ? (
              <img src={track.coverUrl} alt="" className="w-12 h-12 rounded-md object-cover flex-shrink-0" />
            ) : (
              <div className="w-12 h-12 rounded-md bg-muted flex-shrink-0" />
            )}
            <div className="min-w-0 flex-1">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Música da campanha</div>
              {track.spotifyUrl ? (
                <a
                  href={track.spotifyUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold text-sm truncate hover:text-primary inline-flex items-center gap-1.5 max-w-full"
                  title="Abrir música no Spotify"
                >
                  <span className="truncate">{track.name}</span>
                  <ExternalLink className="h-3 w-3 flex-shrink-0 opacity-70" />
                </a>
              ) : (
                <div className="font-semibold text-sm truncate">{track.name}</div>
              )}
              {track.artist && (
                <div className="text-xs text-muted-foreground truncate">{track.artist}</div>
              )}
            </div>
          </div>
        )}
        {/* Resumo da distribuição — leitura rápida */}
        <div className="mb-3 rounded-lg border border-border bg-elevated/30 p-4">
          <div className="flex items-baseline justify-between mb-3">
            <div>
              <div className="text-sm font-semibold">Resumo da distribuição</div>
              <div className="text-[11px] text-muted-foreground">
                Meta {formatInt(snapshot.meta)} streams em {days} dias · {resumo.qtdPlaylists} playlists do ecossistema
              </div>
            </div>
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Pico/dia previsto</div>
              <div className="text-base font-semibold tabular-nums">{formatInt(resumo.pico)}</div>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <ResumoStat
              label="Precisa/dia (total)"
              value={formatInt(resumo.necDiaTotal)}
              hint={`${formatInt(resumo.necDiaEco)} eco · ${formatInt(resumo.necDiaExt)} ext`}
            />
            <ResumoStat
              label="Capacidade eco/dia"
              value={formatInt(resumo.capacidadeEcoDia)}
              hint={`uso ${resumo.usoCap}% pra bater eco`}
              tone={resumo.usoCap > 90 ? "warning" : "primary"}
            />
            <ResumoStat
              label="Eco coberto pelo plano"
              value={formatInt(resumo.ecoCobertoTotal)}
              hint={`meta eco ${formatInt(resumo.metaEco)}${resumo.deficitEco > 0 ? ` · falta ${formatInt(resumo.deficitEco)}` : ""}`}
              tone={resumo.deficitEco > 0 ? "warning" : "primary"}
            />
            <ResumoStat
              label="Externo a comprar"
              value={formatInt(resumo.metaExt)}
              hint={`${formatInt(resumo.necDiaExt)}/dia em deals`}
            />
          </div>
        </div>

        <div className="rounded-lg border border-border overflow-hidden">
          <div className="max-h-[560px] overflow-auto">
            <table className="text-[11px] border-separate border-spacing-0 min-w-full">
              <thead className="sticky top-0 z-20 bg-card text-muted-foreground">
                <tr>
                  <th className="sticky left-0 z-30 bg-card text-left font-medium py-2 px-3 border-b border-r border-border min-w-[240px]">
                    Playlist
                  </th>
                  <th className="text-center font-medium py-2 px-2 border-b border-border w-14">Pos</th>
                  <th className="text-right font-medium py-2 px-2 border-b border-border w-20">Total</th>
                  {Array.from({ length: days }, (_, i) => (
                    <th
                      key={i}
                      className="text-right font-medium py-2 px-2 border-b border-border whitespace-nowrap min-w-[64px]"
                    >
                      <div className="tabular-nums">D{i + 1}</div>
                      <div className="text-[9px] text-muted-foreground/70 font-normal">
                        {dateLabel(startedAt, i + 1)}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {plans.map((p, rowIdx) => {
                  const pos = positionByAllocation.get(p.allocationId) ?? null;
                  const posClass =
                    pos == null
                      ? "text-muted-foreground"
                      : pos <= 5
                      ? "text-primary"
                      : pos <= 12
                      ? "text-foreground"
                      : "text-muted-foreground";
                  const spotifyUrl = spotifyByAllocation.get(p.allocationId);
                  return (
                    <tr key={p.allocationId} className={cn("hover:bg-primary/5", rowIdx % 2 === 1 && "bg-elevated/20")}>
                      <td
                        className={cn(
                          "sticky left-0 z-10 py-1.5 px-3 border-b border-r border-border/30",
                          rowIdx % 2 === 1 ? "bg-elevated/40" : "bg-card",
                        )}
                      >
                        <div className="flex items-center gap-2">
                          {p.coverUrl ? (
                            <img src={p.coverUrl} alt="" className="w-6 h-6 rounded object-cover flex-shrink-0" />
                          ) : (
                            <div className="w-6 h-6 rounded bg-muted flex-shrink-0" />
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="font-medium truncate flex items-center gap-1">
                              {spotifyUrl ? (
                                <a
                                  href={spotifyUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="hover:text-primary inline-flex items-center gap-1 truncate"
                                  title="Abrir playlist no Spotify"
                                >
                                  {p.playlistName}
                                  <ExternalLink className="h-2.5 w-2.5 flex-shrink-0 opacity-60" />
                                </a>
                              ) : (
                                p.playlistName
                              )}
                            </div>
                            <div className="text-[9px] text-muted-foreground tabular-nums">
                              {formatInt(p.followers)} saves · cap {formatInt(p.capDia)}/dia
                            </div>
                          </div>
                        </div>
                      </td>
                      <td
                        className={cn(
                          "text-center font-semibold py-1.5 px-2 border-b border-border/30 tabular-nums",
                          posClass,
                        )}
                        title={pos != null ? `Posição #${pos} na playlist` : undefined}
                      >
                        {pos != null ? `#${pos}` : "—"}
                      </td>
                      <td className="text-right tabular-nums font-semibold py-1.5 px-2 border-b border-border/30">
                        {formatInt(p.totalStreams)}
                      </td>
                      {Array.from({ length: days }, (_, i) => {
                        const v = cellValue(p, i);
                        const dailyV = p.daily[i] ?? 0;
                        const isStart = i + 1 === p.startDay;
                        const intensity = p.capDia > 0 ? Math.min(1, dailyV / p.capDia) : 0;
                        const isEmpty = mode === "diario" ? dailyV === 0 : v === 0;
                        return (
                          <td
                            key={i}
                            className={cn(
                              "text-right tabular-nums py-1.5 px-2 border-b border-border/30 whitespace-nowrap",
                              isEmpty && (showZeros ? "text-muted-foreground/40" : "text-transparent select-none"),
                              isStart && "ring-1 ring-inset ring-primary/40",
                            )}
                            style={
                              dailyV > 0 && mode === "diario"
                                ? { backgroundColor: `hsl(var(--primary) / ${0.06 + intensity * 0.22})` }
                                : undefined
                            }
                            title={isStart ? `Entrada D${p.startDay}` : undefined}
                          >
                            {v > 0 ? formatInt(v) : "0"}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="sticky bottom-0 z-20 bg-card font-semibold">
                <tr>
                  <td
                    className="sticky left-0 z-30 bg-card py-2 px-3 border-t-2 border-r border-border text-foreground"
                    colSpan={2}
                  >
                    Total {mode === "diario" ? "/ dia" : "acumulado"}
                  </td>
                  <td className="text-right tabular-nums py-2 px-2 border-t-2 border-border text-primary">
                    {formatInt(dailyTotals.reduce((s, v) => s + v, 0))}
                  </td>
                  {footerValues.map((v, i) => (
                    <td
                      key={i}
                      className="text-right tabular-nums py-2 px-2 border-t-2 border-border text-foreground whitespace-nowrap"
                    >
                      {formatInt(v)}
                    </td>
                  ))}
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
        <p className="text-[10px] text-muted-foreground mt-2">
          Dica: clique no nome da playlist pra abrir no Spotify. A coluna com borda verde marca o dia de entrada (D1 da playlist).
          Posições <span className="text-primary font-medium">#3–5</span> são as mais fortes; #6–12 médias; #13+ cauda.
        </p>
      </CardContent>
    </Card>
  );
}

function ResumoStat({
  label, value, hint, tone,
}: { label: string; value: string; hint?: string; tone?: "primary" | "warning" }) {
  return (
    <div className="rounded-md border border-border/70 bg-card px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">{label}</div>
      <div className={cn(
        "text-lg font-semibold tabular-nums leading-tight mt-0.5",
        tone === "primary" && "text-primary",
        tone === "warning" && "text-warning",
      )}>{value}</div>
      {hint && <div className="text-[10px] text-muted-foreground tabular-nums mt-0.5">{hint}</div>}
    </div>
  );
}
