import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Grid3x3, Link2, Check, ExternalLink, Shuffle, Loader2, Radio, AudioLines, HelpCircle, CalendarClock, Activity, Layers, ShoppingCart, TrendingUp } from "lucide-react";
import { formatInt } from "@/lib/campaignEngine";
import type { CampaignSnapshot } from "@/lib/campaignSnapshot";
import { buildEcoPlaylistPlan, distributeEcoPositions, inferEcoPreferredPositions, chartTierFromTopPosition, type DailyPlaylistPlan } from "@/lib/campaignOperationalPlan";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { KpiBig } from "@/components/KpiBig";

type EcoAlloc = {
  id: string;
  planned_streams: number;
  start_day: number;
  position?: number | null;
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
  /** Quando informado, habilita botão "Redistribuir posições" (admin/interno). */
  campaignId?: string;
  /** Callback após gravar novas posições no banco — usado pra recarregar allocs. */
  onPositionsRedistributed?: () => void;
  /** Total estimado de plays orgânicos/rádio/autoplay (default 18% da meta). */
  radioGoal?: number;
  /** Soma dos plays já coletados em organic_plays_snapshots (null = sem dados, mostra "estimado"). */
  radioCollectedTotal?: number | null;
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
  campaignId,
  onPositionsRedistributed,
  radioGoal,
  radioCollectedTotal = null,
}: Props) {
  const [showZeros, setShowZeros] = useState(false);
  const [mode, setMode] = useState<"diario" | "acumulado">("diario");
  const [copied, setCopied] = useState(false);
  const [redistributing, setRedistributing] = useState(false);

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

  const days = snapshot.effectiveDays ?? snapshot.days;

  const positionByAllocation = useMemo(
    () => {
      const allPersisted = allocations.length > 0 && allocations.every(a => Number.isFinite((a as any).position) && (a as any).position >= 1);
      if (allPersisted) return new Map(allocations.map(a => [a.id, (a as any).position as number]));
      const top = (snapshot as any)?.music?.top200Position ?? (snapshot as any)?.music?.top200Pos ?? null;
      const positionInputs = allocations.map((a) => ({
        id: a.id,
        planned_streams: a.planned_streams,
        followers: a.managed_playlists?.followers ?? 0,
        genreSource: ((a as any).genre_source as "primary" | "affinity" | null) ?? "primary",
      }));
      return distributeEcoPositions(
        positionInputs,
        days,
        engagementMultiplier,
        { chartTier: chartTierFromTopPosition(top) },
      );
    },
    [allocations, days, engagementMultiplier, snapshot],
  );

  async function handleRedistribute() {
    if (!campaignId || redistributing) return;
    setRedistributing(true);
    try {
      const top = (snapshot as any)?.music?.top200Position ?? (snapshot as any)?.music?.top200Pos ?? null;
      const positionInputs = allocations.map((a) => ({
        id: a.id,
        planned_streams: a.planned_streams,
        followers: a.managed_playlists?.followers ?? 0,
        genreSource: ((a as any).genre_source as "primary" | "affinity" | null) ?? "primary",
      }));
      const fresh = distributeEcoPositions(positionInputs, days, engagementMultiplier, { chartTier: chartTierFromTopPosition(top) });
      const results = await Promise.all(
        Array.from(fresh.entries()).map(([allocId, pos]) =>
          supabase.from("campaign_eco_allocations").update({ position: pos }).eq("id", allocId),
        ),
      );
      const firstErr = results.find(r => r.error);
      if (firstErr?.error) throw firstErr.error;
      toast({
        title: "Posições redistribuídas",
        description: "Plano regravado com novo sorteio. Recarregando…",
      });
      onPositionsRedistributed?.();
    } catch (e) {
      toast({
        title: "Falha ao redistribuir",
        description: (e as Error)?.message ?? "Erro desconhecido",
        variant: "destructive",
      });
    } finally {
      setRedistributing(false);
    }
  }

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

  // Extrai spotify_playlist_id da URL pra cruzar com playlist_execution_jobs.
  const spotifyIdByAllocation = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of allocations) {
      const url = a.managed_playlists?.spotify_url ?? "";
      const match = url.match(/playlist\/([A-Za-z0-9]+)/);
      if (match) m.set(a.id, match[1]);
    }
    return m;
  }, [allocations]);

  // Status real dos jobs de ADD por playlist (apenas modo interno, com campaignId).
  type JobAgg = { done: number; pending: number; failed: number };
  const [jobStatusBySpid, setJobStatusBySpid] = useState<Map<string, JobAgg>>(new Map());
  useEffect(() => {
    if (!campaignId) return;
    let cancelled = false;
    const load = async () => {
      const { data } = await supabase
        .from("playlist_execution_jobs")
        .select("spotify_playlist_id, status")
        .eq("campaign_id", campaignId)
        .eq("job_type", "playlist.track.add");
      if (cancelled) return;
      const m = new Map<string, JobAgg>();
      for (const j of (data ?? []) as { spotify_playlist_id: string; status: string }[]) {
        const cur = m.get(j.spotify_playlist_id) ?? { done: 0, pending: 0, failed: 0 };
        if (j.status === "done") cur.done++;
        else if (j.status === "failed") cur.failed++;
        else cur.pending++;
        m.set(j.spotify_playlist_id, cur);
      }
      setJobStatusBySpid(m);
    };
    load();
    const ch = supabase
      .channel(`cfpc-jobs-${campaignId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "playlist_execution_jobs", filter: `campaign_id=eq.${campaignId}` },
        () => load(),
      )
      .subscribe();
    return () => { cancelled = true; supabase.removeChannel(ch); };
  }, [campaignId]);

  // Linha "Rádio · Autoplay · Mixes" — só renderiza quando o consumidor
  // (somente página interna) passar `radioGoal` explicitamente. Distribuída
  // na curva da campanha (snapshot.curva.streamsDay). Soma exata = radioTotal.
  const radioTotal = radioGoal != null ? Math.max(0, Math.round(radioGoal)) : 0;
  const radioDaily = useMemo(() => {
    const arr = Array.from({ length: days }, () => 0);
    if (radioTotal <= 0) return arr;
    const curva = snapshot.curva ?? [];
    // Rampa própria: D1–D6 = 0 (Spotify só começa a empurrar autoplay/rádio
    // depois de ~1 semana de sinal). A partir do D7, o peso de cada dia é
    // o streamsDay da curva eco com lag de 5 dias (curva[i-5]). Assim a
    // rádio sempre reflete o que foi tocado 5 dias antes.
    const LAG = 5;
    const START = 6; // index 6 = D7 (1-indexed)
    const weights: number[] = Array.from({ length: days }, (_, i) => {
      if (i < START) return 0;
      const src = i - LAG;
      return Math.max(0, Number(curva[src]?.streamsDay ?? 0));
    });
    const sum = weights.reduce((s, w) => s + w, 0);
    if (sum <= 0) {
      // Fallback: distribui linear a partir do D7.
      const activeDays = Math.max(1, days - START);
      const flat = Math.floor(radioTotal / activeDays);
      for (let i = START; i < days; i++) arr[i] = flat;
      arr[days - 1] += radioTotal - flat * activeDays;
      return arr;
    }
    let allocated = 0;
    let lastIdx = START;
    for (let i = START; i < days; i++) if (weights[i] > 0) lastIdx = i;
    for (let i = START; i < days; i++) {
      if (i === lastIdx) continue;
      const v = Math.round((weights[i] / sum) * radioTotal);
      arr[i] = v;
      allocated += v;
    }
    arr[lastIdx] = Math.max(0, radioTotal - allocated);
    return arr;
  }, [snapshot.curva, days, radioTotal]);
  const radioCollected = radioCollectedTotal != null && radioCollectedTotal > 0;

  const dailyTotals = useMemo(() => {
    const arr = Array.from({ length: days }, () => 0);
    for (const p of plans) for (let i = 0; i < days; i++) arr[i] += p.daily[i] ?? 0;
    for (let i = 0; i < days; i++) arr[i] += radioDaily[i] ?? 0;
    return arr;
  }, [plans, days, radioDaily]);

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
    // Média/dia REAL do plano (rampa + boost + tail). É o que realmente vamos entregar por dia.
    const planDays = snapshot.effectiveDays ?? days;
    const mediaDiaReal = planDays > 0 ? Math.round(ecoCobertoTotal / planDays) : 0;
    const usoCap = mediaDiaReal > 0 ? Math.round((necDiaEco / mediaDiaReal) * 100) : 0;
    const deficitEco = Math.max(0, metaEco - ecoCobertoTotal);
    return {
      capacidadeEcoDia, mediaDiaReal, ecoCobertoTotal, metaEco, metaExt,
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
      <CardHeader className="flex-row items-center justify-between gap-3 space-y-0 py-3">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <Grid3x3 className="h-4 w-4 text-primary shrink-0" />
          <CardTitle className="text-sm whitespace-nowrap">Plano completo</CardTitle>
          {track && (
            <div className="flex items-center gap-2 min-w-0 pl-2 ml-1 border-l border-border">
              {track.coverUrl ? (
                <img src={track.coverUrl} alt="" className="w-6 h-6 rounded object-cover flex-shrink-0" />
              ) : (
                <div className="w-6 h-6 rounded bg-muted flex-shrink-0" />
              )}
              {track.spotifyUrl ? (
                <a
                  href={track.spotifyUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-medium truncate hover:text-primary inline-flex items-center gap-1 min-w-0"
                  title={`${track.name}${track.artist ? " — " + track.artist : ""} · Abrir no Spotify`}
                >
                  <span className="truncate">{track.name}</span>
                  {track.artist && <span className="text-muted-foreground truncate">· {track.artist}</span>}
                  <ExternalLink className="h-3 w-3 flex-shrink-0 opacity-70" />
                </a>
              ) : (
                <div className="text-xs font-medium truncate">
                  {track.name}{track.artist && <span className="text-muted-foreground"> · {track.artist}</span>}
                </div>
              )}
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-2 shrink-0">
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
          {showShare && (
            <Button size="sm" variant="outline" onClick={copyShareLink}>
              {copied ? <Check className="h-4 w-4 mr-1.5" /> : <Link2 className="h-4 w-4 mr-1.5" />}
              {copied ? "Copiado" : "Copiar link"}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-0">


        <div className="rounded-lg border border-border overflow-hidden">
          <div className="max-h-[80vh] overflow-auto">
            <table className="text-[11px] border-separate border-spacing-0 min-w-full">
              <thead className="sticky top-0 z-20 bg-card text-muted-foreground">
                <tr>
                  <th className="sticky left-0 z-30 bg-card text-left font-medium py-2 px-3 border-b border-r border-border min-w-[200px]">
                    Playlist
                  </th>
                  <th className="text-center font-medium py-2 px-2 border-b border-border w-14">
                    <Popover>
                      <PopoverTrigger asChild>
                        <button className="inline-flex items-center gap-1 hover:text-foreground" aria-label="O que é Pos?">
                          Pos
                          <HelpCircle className="h-3 w-3 opacity-60" />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent side="bottom" align="center" className="w-72 text-xs leading-relaxed">
                        <div className="font-semibold mb-1 text-foreground">Posição planejada</div>
                        <p className="text-muted-foreground">
                          Sorteada pelo simulador com base em força da playlist + tier do artista.
                          É <span className="text-foreground font-medium">forçada via REORDER</span> imediatamente após o ADD —
                          o bot adiciona no fim e move pra esta posição.
                        </p>
                      </PopoverContent>
                    </Popover>
                  </th>
                  <th className="text-right font-medium py-2 px-2 border-b border-border w-16">Total</th>
                  {Array.from({ length: days }, (_, i) => (
                    <th
                      key={i}
                      className="text-right font-medium py-2 px-1.5 border-b border-border whitespace-nowrap min-w-[48px]"
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
                {radioTotal > 0 && (
                  <tr className="bg-primary/[0.07] hover:bg-primary/10">
                    <td className="sticky left-0 z-10 py-2 px-3 border-b border-r border-border/30 border-t-2 border-t-primary/40 leading-tight bg-primary/[0.07]">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-primary/15 grid place-items-center flex-shrink-0">
                          <AudioLines className="h-5 w-5 text-primary" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-[12px] font-semibold truncate text-foreground">Rádio · Autoplay · Mixes</div>
                          <div className="text-[11px] text-muted-foreground tabular-nums">
                            {radioCollected ? (
                              <>
                                <span className="text-primary font-medium uppercase tracking-wider">coletado</span>
                                {" · "}{formatInt(Math.round(radioCollectedTotal ?? 0))} plays reais
                              </>
                            ) : (
                              <>
                                <span className="uppercase tracking-wider">estimado</span>
                                {" · "}{Math.round(((snapshot.splitOrganicPct ?? 15)))}% da meta · lag 5d
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="text-center font-semibold py-0 px-2 border-b border-border/30 border-t-2 border-t-primary/40 leading-tight tabular-nums text-primary">
                      #1
                    </td>
                    <td className="text-right tabular-nums font-semibold py-0 px-2 border-b border-border/30 border-t-2 border-t-primary/40 leading-tight">
                      {formatInt(radioTotal)}
                    </td>
                    {Array.from({ length: days }, (_, i) => {
                      const dailyV = radioDaily[i] ?? 0;
                      let v = 0;
                      if (mode === "diario") v = dailyV;
                      else for (let k = 0; k <= i; k++) v += radioDaily[k] ?? 0;
                      const isEmpty = mode === "diario" ? dailyV === 0 : v === 0;
                      const peak = Math.max(1, ...radioDaily);
                      const intensity = peak > 0 ? Math.min(1, dailyV / peak) : 0;
                      return (
                        <td
                          key={i}
                          className={cn(
                            "text-right tabular-nums py-0 px-2 border-b border-border/30 border-t-2 border-t-primary/40 leading-tight whitespace-nowrap",
                            isEmpty && (showZeros ? "text-muted-foreground/40" : "text-transparent select-none"),
                          )}
                          style={
                            dailyV > 0 && mode === "diario"
                              ? { backgroundColor: `hsl(var(--primary) / ${0.06 + intensity * 0.22})` }
                              : undefined
                          }
                        >
                          {v > 0 ? formatInt(v) : "0"}
                        </td>
                      );
                    })}
                  </tr>
                )}
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
                          "sticky left-0 z-10 py-0 px-3 border-b border-r border-border/30 leading-tight",
                          rowIdx % 2 === 1 ? "bg-elevated/40" : "bg-card",
                        )}
                      >
                        <div className="flex items-center gap-2">
                          {p.coverUrl ? (
                            <img src={p.coverUrl} alt="" className="w-4 h-4 rounded object-cover flex-shrink-0" />
                          ) : (
                            <div className="w-4 h-4 rounded bg-muted flex-shrink-0" />
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
                          "text-center font-semibold py-0 px-2 border-b border-border/30 leading-tight tabular-nums",
                          posClass,
                        )}
                        title={pos != null ? `Posição #${pos} na playlist` : undefined}
                      >
                        {pos != null ? `#${pos}` : "—"}
                      </td>
                      <td className="text-right tabular-nums font-semibold py-0 px-2 border-b border-border/30 leading-tight">
                        {formatInt(p.totalStreams)}
                      </td>
                      {Array.from({ length: days }, (_, i) => {
                        const v = cellValue(p, i);
                        const dailyV = p.daily[i] ?? 0;
                        const isStart = i + 1 === p.startDay;
                        const intensity = p.capDia > 0 ? Math.min(1, dailyV / p.capDia) : 0;
                        const isEmpty = mode === "diario" ? dailyV === 0 : v === 0;
                        const dayPos = p.positionByDay?.[i] ?? pos ?? null;
                        const isDemoted = pos != null && dayPos != null && dayPos > pos;
                        return (
                          <td
                            key={i}
                            className={cn(
                              "text-right tabular-nums py-0 px-2 border-b border-border/30 leading-tight whitespace-nowrap",
                              isEmpty && (showZeros ? "text-muted-foreground/40" : "text-transparent select-none"),
                              isStart && "ring-1 ring-inset ring-primary/40",
                            )}
                            style={
                              dailyV > 0 && mode === "diario"
                                ? { backgroundColor: `hsl(var(--primary) / ${0.06 + intensity * 0.22})` }
                                : undefined
                            }
                            title={
                              isDemoted
                                ? `Rebaixado para #${dayPos} (desmame)`
                                : isStart
                                  ? `Entrada D${p.startDay}`
                                  : undefined
                            }
                          >
                            {v > 0 ? (
                              <span className="inline-flex items-baseline gap-1 justify-end">
                                <span>{formatInt(v)}</span>
                                {isDemoted && mode === "diario" && (
                                  <span className="text-[9px] font-medium text-warning tabular-nums">
                                    #{dayPos}
                                  </span>
                                )}
                              </span>
                            ) : (
                              "0"
                            )}
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
          Badge <span className="text-warning font-medium">#N</span> no fim do plano indica desmame: a música é rebaixada gradualmente nos últimos 20% dos dias (pos → ×2 → ×5 → ×15 → ×30) antes de sair da playlist.
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

export function CampaignFullPlanSummary({
  snapshot,
  startedAt,
  allocations,
  engagementMultiplier = 30,
}: {
  snapshot: CampaignSnapshot;
  startedAt: string;
  allocations: EcoAlloc[];
  engagementMultiplier?: number;
}) {
  const days = snapshot.effectiveDays ?? snapshot.days;

  const positionByAllocation = useMemo(() => {
    const allPersisted = allocations.length > 0 && allocations.every(a => Number.isFinite((a as any).position) && (a as any).position >= 1);
    if (allPersisted) return new Map(allocations.map(a => [a.id, (a as any).position as number]));
    const top = (snapshot as any)?.music?.top200Position ?? (snapshot as any)?.music?.top200Pos ?? null;
    const positionInputs = allocations.map((a) => ({
      id: a.id,
      planned_streams: a.planned_streams,
      followers: a.managed_playlists?.followers ?? 0,
      genreSource: ((a as any).genre_source as "primary" | "affinity" | null) ?? "primary",
    }));
    return distributeEcoPositions(positionInputs, days, engagementMultiplier, { chartTier: chartTierFromTopPosition(top) });
  }, [allocations, days, engagementMultiplier, snapshot]);

  const plans = useMemo<DailyPlaylistPlan[]>(
    () => buildEcoPlaylistPlan(snapshot, allocations, { engagementMultiplier, startedAt, positions: positionByAllocation }),
    [snapshot, allocations, engagementMultiplier, startedAt, positionByAllocation],
  );

  const dailyTotals = useMemo(() => {
    const arr = Array.from({ length: days }, () => 0);
    for (const p of plans) for (let i = 0; i < days; i++) arr[i] += p.daily[i] ?? 0;
    return arr;
  }, [plans, days]);

  const resumo = useMemo(() => {
    const capacidadeEcoDia = plans.reduce((s, p) => s + (p.capDia ?? 0), 0);
    const ecoCobertoTotal = plans.reduce((s, p) => s + (p.totalStreams ?? 0), 0);
    const metaEco = snapshot.streamsEco ?? 0;
    const metaExt = snapshot.streamsExt ?? Math.max(0, snapshot.meta - metaEco);
    const necDiaTotal = Math.round(snapshot.meta / Math.max(1, days));
    const necDiaEco = Math.round(metaEco / Math.max(1, days));
    const necDiaExt = Math.round(metaExt / Math.max(1, days));
    const pico = dailyTotals.length ? Math.max(...dailyTotals) : 0;
    const planDays = snapshot.effectiveDays ?? days;
    const mediaDiaReal = planDays > 0 ? Math.round(ecoCobertoTotal / planDays) : 0;
    const usoCap = mediaDiaReal > 0 ? Math.round((necDiaEco / mediaDiaReal) * 100) : 0;
    const deficitEco = Math.max(0, metaEco - ecoCobertoTotal);
    return { capacidadeEcoDia, mediaDiaReal, ecoCobertoTotal, metaEco, metaExt, necDiaTotal, necDiaEco, necDiaExt, pico, usoCap, deficitEco, qtdPlaylists: plans.length };
  }, [plans, dailyTotals, snapshot, days]);

  if (plans.length === 0) return null;

  return (
    <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
      <KpiBig
        tier="hero"
        icon={CalendarClock}
        label="Precisa/dia (total)"
        value={formatInt(resumo.necDiaTotal)}
        hint={`${formatInt(resumo.necDiaEco)} eco · ${formatInt(resumo.necDiaExt)} ext`}
        domain="campaigns"
      />
      <KpiBig
        icon={Activity}
        label="Eco entrega/dia"
        value={formatInt(resumo.mediaDiaReal)}
        hint={`base ${formatInt(resumo.capacidadeEcoDia)} · uso ${resumo.usoCap}%`}
        domain="playlists"
      />
      <KpiBig
        icon={Layers}
        label="Eco coberto"
        value={formatInt(resumo.ecoCobertoTotal)}
        hint={`meta ${formatInt(resumo.metaEco)}${resumo.deficitEco > 0 ? ` · falta ${formatInt(resumo.deficitEco)}` : ""}`}
        domain="curators"
      />
      <KpiBig
        icon={ShoppingCart}
        label="Externo a comprar"
        value={formatInt(resumo.metaExt)}
        hint={`${formatInt(resumo.necDiaExt)}/dia em deals`}
        domain="deals"
      />
      <KpiBig
        tier="quiet"
        icon={TrendingUp}
        label="Pico/dia previsto"
        value={formatInt(resumo.pico)}
        hint={`${resumo.qtdPlaylists} playlists`}
        domain="clients"
      />
    </div>
  );
}
