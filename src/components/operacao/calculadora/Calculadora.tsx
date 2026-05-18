import { useMemo, useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { buildSnapshot, planEcoAllocations, closeCampaignFromCalculator } from "@/lib/campaignSnapshot";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { Top200Tab } from "./Top200Tab";
import { CalculadoraResultado, CalculadoraKpis } from "./CalculadoraResultado";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import {
  calcCampaign, reverseFromBudget, formatBRL, formatInt,
  DEFAULT_SPLIT, COST_PER_STREAM,
  type Modo, type Perfil, type CampaignResult,
} from "@/lib/campaignEngine";
import { Calculator, Table2, ArrowRight, Target as TargetIcon, Users, Wallet, Music, Search, CheckCircle2, X, Loader2, Settings2, LayoutGrid, CalendarIcon, FileText } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format, addDays, differenceInCalendarDays, startOfDay } from "date-fns";
import { ptBR } from "date-fns/locale";

type Secao = "todos" | "musica" | "meta" | "estrategia";

type Fonte = "manual" | "top200" | "concorrente" | "orcamento";

type TrackMeta = {
  title: string | null;
  artist: string | null;
  thumbnail_url: string | null;
  id: string;
  streamsDay?: number | null;   // streams/dia hoje (se estiver no Top 200)
  position?: number | null;     // posição atual no Top 200 (se estiver)
  chartDate?: string | null;
};

export interface CalculadoraHandoff {
  result: CampaignResult;
  trackUrl: string;
  track: TrackMeta | null;
  fonte: Fonte;
}

const STORAGE_KEY = "nx:calculadora:state:v1";

type PersistedState = {
  fonte: Fonte;
  trackUrl: string;
  track: TrackMeta | null;
  baselineStreamsDay: number;
  meta: number;
  days: number;
  budget: number;
  modo: Modo;
  perfil: Perfil;
  splitEco: number;
  clientId: string;
  curatorId: string;
};

function loadPersisted(): Partial<PersistedState> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

export function Calculadora({ onContinue }: { onContinue?: (h: CalculadoraHandoff) => void }) {
  const persisted = useMemo(loadPersisted, []);
  const navigate = useNavigate();
  const [subtab, setSubtab] = useState<"calc" | "top200">("calc");
  const [secao, setSecao] = useState<Secao>("musica");
  const [closing, setClosing] = useState(false);

  // Cliente e Curador (vinculação obrigatória pro fluxo de aprovação → deal real)
  const [clientId, setClientId] = useState<string>(persisted.clientId ?? "");
  const [curatorId, setCuratorId] = useState<string>(persisted.curatorId ?? "");
  const [clientsList, setClientsList] = useState<{ id: string; name: string }[]>([]);
  const [curatorsList, setCuratorsList] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    void (async () => {
      const [{ data: cls }, { data: crs }] = await Promise.all([
        supabase.from("clients").select("id, name").is("archived_at", null).order("name"),
        supabase.from("curators").select("id, name").order("name"),
      ]);
      setClientsList((cls ?? []) as { id: string; name: string }[]);
      const crList = (crs ?? []) as { id: string; name: string }[];
      setCuratorsList(crList);
      // Default Lá do Sul se existir e nada estiver selecionado
      if (!curatorId) {
        const ladoSul = crList.find(c => /l[áa]\s*do\s*sul/i.test(c.name));
        if (ladoSul) setCuratorId(ladoSul.id);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function salvarRascunho() {
    if (!result) return;
    if (!track?.id) {
      toast({ title: "Carregue o link da música antes de salvar", variant: "destructive" });
      return;
    }
    setClosing(true);
    try {
      const { data: playlists, error } = await supabase
        .from("managed_playlists")
        .select("id, followers")
        .is("archived_at", null);
      if (error) throw error;

      const snapshot = buildSnapshot(result, {
        spotifyTrackId: track.id,
        trackUrl: trackUrl || null,
        title: track.title,
        artist: track.artist,
        coverUrl: track.thumbnail_url,
        baselineStreamsDay,
      });

      const allocations = planEcoAllocations(
        result.streamsEco,
        result.days,
        (playlists ?? []).map(p => ({ id: p.id, followers: p.followers ?? 0 })),
        result.modo,
      );

      const deadlineISO = addDays(startDate, result.days).toISOString().slice(0, 10);

      const { campaignId } = await closeCampaignFromCalculator({
        snapshot,
        deadlineISO,
        allocations,
        clientId: clientId || null,
        curatorId: curatorId || null,
        status: "draft",
      });

      try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
      toast({
        title: "Rascunho salvo",
        description: curatorId
          ? "Revise na aba Campanhas Ativas e clique em Aprovar e disparar pra criar o deal real."
          : "Sem curador definido — você ainda pode editar antes de aprovar.",
      });
      navigate(`/campanhas`);
    } catch (e: any) {
      toast({ title: "Erro ao salvar rascunho", description: e.message ?? String(e), variant: "destructive" });
    } finally {
      setClosing(false);
    }
  }




  // Inputs (hidratados do localStorage)
  const [fonte, setFonte] = useState<Fonte>(persisted.fonte ?? "manual");
  const [trackUrl, setTrackUrl] = useState(persisted.trackUrl ?? "");
  const [track, setTrack] = useState<TrackMeta | null>(persisted.track ?? null);
  const [trackLoading, setTrackLoading] = useState(false);
  const [baselineStreamsDay, setBaselineStreamsDay] = useState<number>(persisted.baselineStreamsDay ?? 0);
  const [meta, setMeta] = useState<number>(persisted.meta ?? 1_000_000);
  const [days, setDays] = useState<number>(persisted.days ?? 60);
  const [budget, setBudget] = useState<number>(persisted.budget ?? 40_000);
  const [modo, setModo] = useState<Modo>(persisted.modo ?? "simultaneo");
  const [perfil, setPerfil] = useState<Perfil>(persisted.perfil ?? "mercado");
  const [splitEco, setSplitEco] = useState<number>(persisted.splitEco ?? DEFAULT_SPLIT.eco);
  const [startDate, setStartDate] = useState<Date>(() => {
    const raw = (persisted as any).startDateISO as string | undefined;
    if (raw) {
      const d = new Date(raw);
      if (!isNaN(d.getTime())) return startOfDay(d);
    }
    return startOfDay(new Date());
  });

  const endDate = useMemo(() => addDays(startDate, days), [startDate, days]);

  // Persiste tudo a cada mudança
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        fonte, trackUrl, track, baselineStreamsDay, meta, days, budget, modo, perfil, splitEco,
        clientId, curatorId,
        startDateISO: startDate.toISOString().slice(0, 10),
      }));
    } catch { /* quota cheia, ignora */ }
  }, [fonte, trackUrl, track, baselineStreamsDay, meta, days, budget, modo, perfil, splitEco, startDate, clientId, curatorId]);

  async function buscarMusica() {
    const url = trackUrl.trim();
    if (!url) { toast({ title: "Cole o link do Spotify primeiro" }); return; }
    setTrackLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("fetch-spotify-meta", { body: { url } });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error ?? "Não consegui ler esse link");
      if (data.type !== "track") throw new Error("O link precisa ser de uma faixa (track)");
      // Busca streams/dia atual da faixa no Top 200 (se estiver)
      let streamsDay: number | null = null;
      let position: number | null = null;
      let chartDate: string | null = null;
      try {
        const { data: latest } = await supabase
          .from("raw_chart_daily")
          .select("chart_date")
          .eq("chart_name", "top200_br")
          .order("chart_date", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (latest?.chart_date) {
          const { data: row } = await supabase
            .from("raw_chart_daily")
            .select("streams_day, position, chart_date")
            .eq("chart_name", "top200_br")
            .eq("chart_date", latest.chart_date)
            .eq("spotify_track_id", data.id)
            .maybeSingle();
          if (row) {
            streamsDay = Number(row.streams_day);
            position = row.position;
            chartDate = row.chart_date;
          } else {
            chartDate = latest.chart_date;
          }
        }
      } catch { /* sem chart, segue */ }
      setTrack({ id: data.id, title: data.title, artist: data.artist, thumbnail_url: data.thumbnail_url, streamsDay, position, chartDate });
      // Pré-preenche baseline com o que o Top 200 mostra, MAS só se o usuário ainda não digitou nada
      if (streamsDay != null && baselineStreamsDay === 0) {
        setBaselineStreamsDay(streamsDay);
      }
    } catch (e: any) {
      toast({ title: "Erro ao buscar música", description: e?.message ?? String(e), variant: "destructive" });
    } finally {
      setTrackLoading(false);
    }
  }

  // Quando fonte = orçamento, meta vira derivada
  const effectiveMeta = useMemo(() => {
    if (fonte === "orcamento") return reverseFromBudget(budget, splitEco);
    return meta;
  }, [fonte, budget, splitEco, meta]);

  const result = useMemo(() => calcCampaign({
    meta: effectiveMeta, days, modo, perfil, splitEcoPct: splitEco,
  }), [effectiveMeta, days, modo, perfil, splitEco]);

  return (
    <div className="space-y-6">
      {/* Sub-tabs */}
      <div className="flex items-center gap-1 border-b border-border">
        {([
          { id: "calc", label: "Calculadora", icon: Calculator },
          { id: "top200", label: "Top 200 BR", icon: Table2 },
        ] as const).map(t => {
          const Icon = t.icon;
          const active = subtab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setSubtab(t.id)}
              className={cn(
                "px-4 h-10 inline-flex items-center gap-2 text-sm font-medium border-b-2 -mb-px transition-colors",
                active ? "border-primary text-foreground"
                       : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {t.label}
            </button>
          );
        })}
      </div>

      {subtab === "top200" ? (
        <Top200Tab onPick={(streamsDay) => {
          // Heurística: meta = streams/dia × dias atuais
          setFonte("manual");
          setMeta(streamsDay * days);
          setSubtab("calc");
        }} />
      ) : (
        <div className="grid grid-cols-1 gap-6">
          {/* KPIs do resultado — topo da página */}
          <CalculadoraKpis r={result} />

          {/* Coluna esquerda: inputs */}
          <div className="space-y-4">
            {/* Filtro de seção — igual ao plano diário da execução */}
            <div className="flex items-center gap-1 rounded-xl border border-border bg-card p-1">
              {([
                { id: "musica", label: "Música", icon: Music },
                { id: "meta", label: "Meta", icon: TargetIcon },
                { id: "estrategia", label: "Estratégia", icon: Settings2 },
                { id: "todos", label: "Tudo", icon: LayoutGrid },
              ] as const).map(s => {
                const Icon = s.icon;
                const active = secao === s.id;
                return (
                  <button
                    key={s.id}
                    onClick={() => setSecao(s.id)}
                    className={cn(
                      "flex-1 h-9 inline-flex items-center justify-center gap-1.5 rounded-lg text-xs font-medium transition-colors",
                      active ? "bg-primary/15 text-primary"
                             : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {s.label}
                  </button>
                );
              })}
            </div>

            {/* Cliente + Curador — define dono da campanha e dono das playlists antes de aprovar */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Identificação</CardTitle>
                <CardDescription>
                  Selecione o cliente (dono da campanha) e o curador (dono das playlists). Ao aprovar, vira um deal real ligado ao curador.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Cliente</Label>
                  <Select value={clientId || "__none__"} onValueChange={v => setClientId(v === "__none__" ? "" : v)}>
                    <SelectTrigger><SelectValue placeholder="Sem cliente" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">— Sem cliente —</SelectItem>
                      {clientsList.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Curador (dono das playlists)</Label>
                  <Select value={curatorId || "__none__"} onValueChange={v => setCuratorId(v === "__none__" ? "" : v)}>
                    <SelectTrigger><SelectValue placeholder="Sem curador" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">— Sem curador (modo legado) —</SelectItem>
                      {curatorsList.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>


            {(secao === "todos" || secao === "musica") && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Música</CardTitle>
                <CardDescription>Cole o link do Spotify e clique em Buscar pra confirmar a faixa</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Music className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="https://open.spotify.com/track/..."
                      value={trackUrl}
                      onChange={e => { setTrackUrl(e.target.value); setTrack(null); }}
                      onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); buscarMusica(); } }}
                      className="pl-9"
                    />
                  </div>
                  <Button onClick={buscarMusica} disabled={trackLoading || !trackUrl.trim()} variant="outline">
                    {trackLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                    <span className="ml-1.5 hidden sm:inline">Buscar</span>
                  </Button>
                </div>

                {track && (
                  <div className="flex items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 p-3">
                    {track.thumbnail_url ? (
                      <img src={track.thumbnail_url} alt={track.title ?? ""} className="h-14 w-14 rounded-md object-cover shrink-0" />
                    ) : (
                      <div className="h-14 w-14 rounded-md bg-muted shrink-0 grid place-items-center">
                        <Music className="h-5 w-5 text-muted-foreground" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold truncate text-sm flex items-center gap-1.5">
                        <CheckCircle2 className="h-3.5 w-3.5 text-primary shrink-0" />
                        {track.title ?? "Faixa"}
                      </div>
                      {track.artist && <div className="text-xs text-muted-foreground truncate">{track.artist}</div>}
                      <div className="text-[11px] mt-1">
                        {track.streamsDay != null ? (
                          <span className="text-foreground">
                            <strong>{formatInt(track.streamsDay)}</strong> streams/dia hoje
                            {track.position != null && <span className="text-muted-foreground"> · #{track.position} Top 200</span>}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">Fora do Top 200 BR (base: 0 streams/dia)</span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => { setTrack(null); setTrackUrl(""); }}
                      className="text-muted-foreground hover:text-foreground shrink-0"
                      aria-label="Limpar"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                )}

                {/* Baseline manual — sempre visível, é a única verdade que a calculadora usa */}
                <div className="space-y-1.5 pt-1">
                  <Label className="text-xs flex items-center justify-between">
                    <span>Streams/dia atuais da música <span className="text-destructive">*</span></span>
                    {track?.streamsDay != null && baselineStreamsDay !== track.streamsDay && (
                      <button
                        type="button"
                        onClick={() => setBaselineStreamsDay(track.streamsDay!)}
                        className="text-[10px] text-primary hover:underline"
                      >
                        usar Top 200 ({formatInt(track.streamsDay)})
                      </button>
                    )}
                  </Label>
                  <NumberInput value={baselineStreamsDay} onChange={setBaselineStreamsDay} placeholder="ex: 20.000" />
                  <p className="text-[11px] text-muted-foreground">
                    Quanto a faixa tá rodando hoje. É a baseline que vai ser descontada do alvo pra saber o gap real.
                  </p>
                </div>
              </CardContent>
            </Card>
            )}

            {(secao === "todos" || secao === "meta") && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Fonte da meta</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <FonteBtn active={fonte === "manual"} onClick={() => setFonte("manual")} icon={TargetIcon} label="Manual" />
                  <FonteBtn active={fonte === "top200"} onClick={() => setFonte("top200")} icon={Table2} label="Top 200" />
                  <FonteBtn active={fonte === "concorrente"} onClick={() => setFonte("concorrente")} icon={Users} label="Concorrente" />
                  <FonteBtn active={fonte === "orcamento"} onClick={() => setFonte("orcamento")} icon={Wallet} label="Orçamento" />
                </div>

                {fonte === "manual" && (
                  <div>
                    <Label className="text-xs">Meta de streams</Label>
                    <NumberInput value={meta} onChange={setMeta} placeholder="1.000.000" />
                  </div>
                )}
                {fonte === "top200" && (
                  <Top200Picker
                    days={days}
                    currentStreamsDay={baselineStreamsDay}
                    onPick={(streamsDay, pos) => {
                      const gapDay = Math.max(0, streamsDay - baselineStreamsDay);
                      setMeta(gapDay * days);
                      toast({
                        title: `Posição #${pos}`,
                        description: baselineStreamsDay > 0
                          ? `Alvo ${formatInt(streamsDay)}/d − hoje ${formatInt(baselineStreamsDay)}/d = ${formatInt(gapDay)}/d × ${days}d = ${formatInt(gapDay * days)}`
                          : `${formatInt(streamsDay)} streams/dia × ${days}d = ${formatInt(streamsDay * days)}`,
                      });
                    }}
                    onOpenList={() => setSubtab("top200")}
                  />
                )}
                {fonte === "concorrente" && (
                  <div className="space-y-2">
                    <Label className="text-xs">Link do artista concorrente</Label>
                    <Input placeholder="https://open.spotify.com/artist/..." />
                    <p className="text-xs text-muted-foreground">
                      Em breve: leitura automática de streams médios. Por enquanto, defina manualmente abaixo.
                    </p>
                    <NumberInput value={meta} onChange={setMeta} />
                  </div>
                )}
                {fonte === "orcamento" && (
                  <div className="space-y-2">
                    <Label className="text-xs">Orçamento disponível (R$)</Label>
                    <NumberInput value={budget} onChange={setBudget} placeholder="40.000" />
                    <p className="text-xs text-muted-foreground">
                      Meta calculada: <span className="font-semibold text-foreground">{formatInt(effectiveMeta)} streams</span>
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
            )}

            {(secao === "todos" || secao === "estrategia") && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Estratégia</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label className="text-xs">Janela da campanha</Label>
                  <div className="grid grid-cols-2 gap-2 mt-1.5">
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="outline" className="justify-start text-left font-normal h-10">
                          <CalendarIcon className="h-3.5 w-3.5 mr-2 opacity-70" />
                          <div className="flex flex-col items-start leading-tight">
                            <span className="text-[10px] uppercase text-muted-foreground">Início</span>
                            <span className="text-xs">{format(startDate, "dd MMM yyyy", { locale: ptBR })}</span>
                          </div>
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          selected={startDate}
                          onSelect={(d) => d && setStartDate(startOfDay(d))}
                          initialFocus
                          locale={ptBR}
                          className={cn("p-3 pointer-events-auto")}
                        />
                      </PopoverContent>
                    </Popover>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="outline" className="justify-start text-left font-normal h-10">
                          <CalendarIcon className="h-3.5 w-3.5 mr-2 opacity-70" />
                          <div className="flex flex-col items-start leading-tight">
                            <span className="text-[10px] uppercase text-muted-foreground">Fim</span>
                            <span className="text-xs">{format(endDate, "dd MMM yyyy", { locale: ptBR })}</span>
                          </div>
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          selected={endDate}
                          onSelect={(d) => {
                            if (!d) return;
                            const diff = differenceInCalendarDays(startOfDay(d), startDate);
                            const clamped = Math.min(180, Math.max(15, diff));
                            setDays(clamped);
                          }}
                          disabled={(d) => differenceInCalendarDays(d, startDate) < 15}
                          initialFocus
                          locale={ptBR}
                          className={cn("p-3 pointer-events-auto")}
                        />
                      </PopoverContent>
                    </Popover>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1.5">
                    {days} dias · começa {format(startDate, "dd/MM", { locale: ptBR })} · termina {format(endDate, "dd/MM", { locale: ptBR })}
                  </p>
                </div>

                <div>
                  <Label className="text-xs">Duração: {days} dias</Label>
                  <Slider value={[days]} onValueChange={([v]) => setDays(v)} min={15} max={180} step={5} className="mt-2" />
                </div>

                <div>
                  <Label className="text-xs">Modo</Label>
                  <div className="grid grid-cols-2 gap-2 mt-1.5">
                    <ModeBtn active={modo === "simultaneo"} onClick={() => setModo("simultaneo")} label="Simultâneo" hint="largura ampla" />
                    <ModeBtn active={modo === "sequencial"} onClick={() => setModo("sequencial")} label="Sequencial" hint="pico marcado" />
                  </div>
                </div>

                <div>
                  <Label className="text-xs">Perfil de audiência</Label>
                  <div className="grid grid-cols-3 gap-2 mt-1.5">
                    {(["frio", "mercado", "engajado"] as Perfil[]).map(p => (
                      <ModeBtn key={p} active={perfil === p} onClick={() => setPerfil(p)} label={cap(p)} />
                    ))}
                  </div>
                </div>

                <div>
                  <Label className="text-xs">Split ecossistema: {splitEco}% próprio · {100 - splitEco}% externo</Label>
                  <Slider value={[splitEco]} onValueChange={([v]) => setSplitEco(v)} min={0} max={100} step={5} className="mt-2" />
                  <div className="text-[11px] text-muted-foreground mt-1.5 flex justify-between">
                    <span>Próprio R$ {(COST_PER_STREAM.eco * 1000).toFixed(0)}/mil</span>
                    <span>Externo R$ {(COST_PER_STREAM.ext * 1000).toFixed(0)}/mil</span>
                  </div>
                </div>
              </CardContent>
            </Card>
            )}
          </div>

          {/* Coluna direita: resultado */}
          <div className="space-y-4">
            {secao === "todos" && <CalculadoraResultado r={result} />}

            {secao === "todos" && (
              <>
                {onContinue ? (
                  <Button
                    size="lg"
                    className="w-full"
                    variant="solid"
                    onClick={() => onContinue({ result, trackUrl, track, fonte })}
                  >
                    Continuar para execução
                    <ArrowRight className="h-4 w-4 ml-2" />
                  </Button>
                ) : (
                  <Button
                    size="lg"
                    className="w-full"
                    variant="solid"
                    onClick={salvarRascunho}
                    disabled={closing}
                  >
                    {closing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FileText className="h-4 w-4 mr-2" />}
                    Salvar como rascunho
                    <ArrowRight className="h-4 w-4 ml-2" />
                  </Button>
                )}
                <p className="text-[11px] text-muted-foreground text-center">
                  Vai pra <strong>Campanhas Ativas</strong> como rascunho. Lá você revisa e clica em
                  <strong> Aprovar e disparar</strong> pra criar o deal real {curatorId ? "ligado ao curador selecionado" : "(selecione o curador antes pra ligar ao deal real)"}.
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function FonteBtn({ active, onClick, icon: Icon, label }: any) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "h-16 rounded-xl border flex flex-col items-center justify-center gap-1 transition-colors",
        active ? "border-primary bg-primary/10 text-primary"
               : "border-border hover:border-foreground/30 text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon className="h-4 w-4" />
      <span className="text-xs font-medium">{label}</span>
    </button>
  );
}

function ModeBtn({ active, onClick, label, hint }: { active: boolean; onClick: () => void; label: string; hint?: string }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "h-12 rounded-lg border text-xs font-medium transition-colors px-2",
        active ? "border-primary bg-primary/10 text-primary"
               : "border-border hover:border-foreground/30 text-muted-foreground hover:text-foreground",
      )}
    >
      <div>{label}</div>
      {hint && <div className="text-[10px] opacity-70">{hint}</div>}
    </button>
  );
}

/** Input numérico com separador de milhar BR. Zero nunca trava: campo aceita vazio. */
function NumberInput({
  value, onChange, placeholder,
}: { value: number; onChange: (v: number) => void; placeholder?: string }) {
  const display = value > 0 ? value.toLocaleString("pt-BR") : "";
  return (
    <Input
      inputMode="numeric"
      value={display}
      placeholder={placeholder}
      onChange={(e) => {
        const digits = e.target.value.replace(/\D/g, "");
        onChange(digits ? parseInt(digits, 10) : 0);
      }}
      onFocus={(e) => e.target.select()}
    />
  );
}

/** Seletor de posição do Top 200: dropdown 1-200 + atalho pra lista completa. */
function Top200Picker({
  days, currentStreamsDay = 0, onPick, onOpenList,
}: { days: number; currentStreamsDay?: number; onPick: (streamsDay: number, position: number) => void; onOpenList: () => void }) {
  const [pos, setPos] = useState<number | null>(null);
  const [posStreamsDay, setPosStreamsDay] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [chartDate, setChartDate] = useState<string | null>(null);

  async function handlePick(p: number) {
    setPos(p);
    setLoading(true);
    try {
      const { data: latest } = await supabase
        .from("raw_chart_daily")
        .select("chart_date")
        .eq("chart_name", "top200_br")
        .order("chart_date", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!latest?.chart_date) {
        toast({ title: "Sincronize o Top 200 primeiro", variant: "destructive" });
        return;
      }
      const { data } = await supabase
        .from("raw_chart_daily")
        .select("streams_day, chart_date")
        .eq("chart_name", "top200_br")
        .eq("chart_date", latest.chart_date)
        .eq("position", p)
        .maybeSingle();
      if (!data) {
        toast({ title: `Posição ${p} sem dados`, variant: "destructive" });
        return;
      }
      setChartDate(data.chart_date);
      setPosStreamsDay(Number(data.streams_day));
      onPick(Number(data.streams_day), p);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-2">
      <Label className="text-xs">Posição alvo no Top 200 BR</Label>
      <div className="flex gap-2">
        <select
          value={pos ?? ""}
          onChange={(e) => handlePick(Number(e.target.value))}
          className="flex-1 h-10 rounded-md border border-input bg-background px-3 text-sm"
          disabled={loading}
        >
          <option value="" disabled>Escolha a posição...</option>
          {Array.from({ length: 200 }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>#{n}</option>
          ))}
        </select>
        <Button variant="outline" size="sm" onClick={onOpenList} type="button">
          <Table2 className="h-3.5 w-3.5 mr-1" />
          Lista completa
        </Button>
      </div>
      {pos && posStreamsDay != null && chartDate && (() => {
        const gapDay = Math.max(0, posStreamsDay - currentStreamsDay);
        return (
          <div className="text-[11px] text-muted-foreground space-y-0.5 rounded-md border border-border bg-muted/30 p-2">
            <div>Posição #{pos}: <span className="text-foreground font-semibold">{posStreamsDay.toLocaleString("pt-BR")}</span> streams/dia</div>
            {currentStreamsDay > 0 && (
              <div>Sua música hoje: <span className="text-foreground">{currentStreamsDay.toLocaleString("pt-BR")}</span> streams/dia</div>
            )}
            <div className="pt-1 border-t border-border/50">
              Gap: <span className="text-foreground font-semibold">{gapDay.toLocaleString("pt-BR")}</span>/dia × {days}d = <span className="text-primary font-semibold">{(gapDay * days).toLocaleString("pt-BR")}</span> streams
            </div>
            <div className="opacity-70">snapshot {chartDate}</div>
          </div>
        );
      })()}
    </div>
  );
}

function cap(s: string) { return s.charAt(0).toUpperCase() + s.slice(1); }
