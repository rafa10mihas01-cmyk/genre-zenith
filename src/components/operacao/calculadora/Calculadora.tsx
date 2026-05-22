import { useMemo, useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { buildSnapshot, planEcoAllocations, closeCampaignFromCalculator } from "@/lib/campaignSnapshot";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { Top200Tab } from "./Top200Tab";
import { CalculadoraResultado, CalculadoraKpis } from "./CalculadoraResultado";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import {
  calcCampaign, reverseFromBudget, formatInt, formatBRL,
  DEFAULT_SPLIT, COST_PER_STREAM,
  type Modo, type Perfil, type CampaignResult,
} from "@/lib/campaignEngine";
import { usePricingSettings } from "@/hooks/usePricingSettings";
import { Table2, ArrowRight, ArrowLeft, Target as TargetIcon, Users, Wallet, Music, Search, CheckCircle2, X, Loader2, CalendarIcon, FileText, Plus, ListMusic, Layers, Zap, Pencil } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format, addDays, differenceInCalendarDays, startOfDay } from "date-fns";
import { ptBR } from "date-fns/locale";

type Fonte = "manual" | "top200" | "concorrente" | "orcamento";

type TrackMeta = {
  title: string | null;
  artist: string | null;
  thumbnail_url: string | null;
  id: string;
  streamsDay?: number | null;
  position?: number | null;
  chartDate?: string | null;
};

export interface CalculadoraHandoff {
  result: CampaignResult;
  trackUrl: string;
  track: TrackMeta | null;
  fonte: Fonte;
}

// ---------- Por-música (uma campanha cada) ----------
type Song = {
  uid: string;
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
  startDateISO: string; // yyyy-mm-dd
};

const STORAGE_KEY_V2 = "nx:calc:state:v2";
const STORAGE_KEY_V1 = "nx:calculadora:state:v1";

type PersistedV2 = {
  clientId: string;
  curatorId: string;
  songs: Song[];
  activeIdx: number;
};

function makeUid() {
  return Math.random().toString(36).slice(2, 10);
}

function emptySong(): Song {
  return {
    uid: makeUid(),
    fonte: "manual",
    trackUrl: "",
    track: null,
    baselineStreamsDay: 0,
    meta: 0,
    days: 60,
    budget: 0,
    modo: "simultaneo",
    perfil: "mercado",
    splitEco: DEFAULT_SPLIT.eco,
    startDateISO: startOfDay(new Date()).toISOString().slice(0, 10),
  };
}

function loadPersisted(): PersistedV2 {
  try {
    localStorage.removeItem(STORAGE_KEY_V2);
    localStorage.removeItem(STORAGE_KEY_V1);
  } catch { /* ignore */ }
  return { clientId: "", curatorId: "", songs: [emptySong()], activeIdx: 0 };
}

export function Calculadora({ onContinue }: { onContinue?: (h: CalculadoraHandoff) => void }) {
  const initial = useMemo(loadPersisted, []);
  const navigate = useNavigate();
  const { costs: pricingCosts } = usePricingSettings();
  const [closing, setClosing] = useState(false);
  const [top200Open, setTop200Open] = useState(false);
  // Wizard: 1 Sessão · 2 Músicas · 3 Revisão.
  // Se já existe contexto salvo, abre direto em "Músicas".
  const [step, setStep] = useState<1 | 2 | 3>(
    () => ((initial.clientId || initial.curatorId) && initial.songs.length > 0 ? 2 : 1),
  );

  // Contexto fixo da sessão
  const [clientId, setClientId] = useState<string>(initial.clientId);
  const [curatorId, setCuratorId] = useState<string>(initial.curatorId);
  const [clientsList, setClientsList] = useState<{ id: string; name: string }[]>([]);
  const [curatorsList, setCuratorsList] = useState<{ id: string; name: string }[]>([]);

  // Lista de músicas + ativa
  const [songs, setSongs] = useState<Song[]>(initial.songs);
  const [activeIdx, setActiveIdx] = useState<number>(initial.activeIdx);
  const active = songs[activeIdx] ?? songs[0];

  const [trackLoading, setTrackLoading] = useState(false);

  useEffect(() => {
    void (async () => {
      const [{ data: cls }, { data: crs }] = await Promise.all([
        supabase.from("clients").select("id, name").is("archived_at", null).order("name"),
        supabase.from("curators").select("id, name").order("name"),
      ]);
      setClientsList((cls ?? []) as { id: string; name: string }[]);
      const crList = (crs ?? []) as { id: string; name: string }[];
      setCuratorsList(crList);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persistência
  useEffect(() => {
    try {
      localStorage.removeItem(STORAGE_KEY_V2);
      localStorage.removeItem(STORAGE_KEY_V1);
    } catch { /* ignore */ }
  }, []);

  // --- Helpers pra mutar a música ativa ---
  const patchActive = useCallback((patch: Partial<Song>) => {
    setSongs(prev => prev.map((s, i) => i === activeIdx ? { ...s, ...patch } : s));
  }, [activeIdx]);

  const setFonte = (v: Fonte) => patchActive({ fonte: v });
  const setTrackUrl = (v: string) => patchActive({ trackUrl: v });
  const setTrack = (v: TrackMeta | null) => patchActive({ track: v });
  const setBaselineStreamsDay = (v: number) => patchActive({ baselineStreamsDay: v });
  const setMeta = (v: number) => patchActive({ meta: v });
  const setDays = (v: number) => patchActive({ days: v });
  const setBudget = (v: number) => patchActive({ budget: v });
  const setModo = (v: Modo) => patchActive({ modo: v });
  const setPerfil = (v: Perfil) => patchActive({ perfil: v });
  const setSplitEco = (v: number) => patchActive({ splitEco: v });
  const setStartDate = (d: Date) => patchActive({ startDateISO: startOfDay(d).toISOString().slice(0, 10) });

  // --- Multi-música ops ---
  function addSong() {
    setSongs(prev => [...prev, emptySong()]);
    setActiveIdx(songs.length);
  }

  function removeSong(idx: number) {
    if (songs.length === 1) {
      setSongs([emptySong()]);
      setActiveIdx(0);
      return;
    }
    const next = songs.filter((_, i) => i !== idx);
    setSongs(next);
    setActiveIdx(prev => Math.min(prev, next.length - 1));
  }

  // Derivados da música ativa
  const startDate = useMemo(() => {
    const d = new Date(active.startDateISO);
    return isNaN(d.getTime()) ? startOfDay(new Date()) : startOfDay(d);
  }, [active.startDateISO]);
  const endDate = useMemo(() => addDays(startDate, active.days), [startDate, active.days]);

  const effectiveMeta = useMemo(() => {
    if (active.fonte === "orcamento") return reverseFromBudget(active.budget, active.splitEco, pricingCosts);
    return active.meta;
  }, [active.fonte, active.budget, active.splitEco, active.meta, pricingCosts]);

  const result = useMemo(() => calcCampaign({
    meta: effectiveMeta, days: active.days, modo: active.modo, perfil: active.perfil, splitEcoPct: active.splitEco,
  }, pricingCosts), [effectiveMeta, active.days, active.modo, active.perfil, active.splitEco, pricingCosts]);

  function isSongReady(s: Song): boolean {
    return !!s.track?.id && s.baselineStreamsDay >= 0 && (s.fonte === "orcamento" ? s.budget > 0 : s.meta > 0);
  }
  const readyCount = songs.filter(isSongReady).length;

  // Agregados (para Revisão) — calcula curva de cada música pronta.
  const songResults = useMemo(() => songs.map(s => ({
    song: s,
    ready: isSongReady(s),
    r: calcCampaign({
      meta: s.fonte === "orcamento" ? reverseFromBudget(s.budget, s.splitEco) : s.meta,
      days: s.days, modo: s.modo, perfil: s.perfil, splitEcoPct: s.splitEco,
    }),
  })), [songs]);
  const totals = useMemo(() => {
    const ready = songResults.filter(x => x.ready);
    return {
      count: ready.length,
      totalMeta: ready.reduce((s, x) => s + x.r.meta, 0),
      totalCost: ready.reduce((s, x) => s + x.r.custoTotal, 0),
      maxDays: ready.reduce((s, x) => Math.max(s, x.r.days), 0),
      totalEco: ready.reduce((s, x) => s + x.r.streamsEco, 0),
      totalExt: ready.reduce((s, x) => s + x.r.streamsExt, 0),
    };
  }, [songResults]);

  const clientName = clientsList.find(c => c.id === clientId)?.name ?? "Sem cliente";
  const curatorName = curatorsList.find(c => c.id === curatorId)?.name ?? "Sem curador";

  async function buscarMusica() {
    const url = active.trackUrl.trim();
    if (!url) { toast({ title: "Cole o link do Spotify primeiro" }); return; }
    setTrackLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("fetch-spotify-meta", { body: { url } });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error ?? "Não consegui ler esse link");
      if (data.type !== "track") throw new Error("O link precisa ser de uma faixa (track)");
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
      const newTrack: TrackMeta = { id: data.id, title: data.title, artist: data.artist, thumbnail_url: data.thumbnail_url, streamsDay, position, chartDate };
      patchActive({
        track: newTrack,
        baselineStreamsDay: (streamsDay != null && active.baselineStreamsDay === 0) ? streamsDay : active.baselineStreamsDay,
      });
    } catch (e: any) {
      toast({ title: "Erro ao buscar música", description: e?.message ?? String(e), variant: "destructive" });
    } finally {
      setTrackLoading(false);
    }
  }

  async function closeOne(song: Song): Promise<{ ok: boolean; campaignId?: string; error?: string }> {
    if (!song.track?.id) return { ok: false, error: "Sem música carregada" };
    try {
      const { data: playlists, error } = await supabase
        .from("managed_playlists")
        .select("id, followers")
        .is("archived_at", null);
      if (error) throw error;

      const effMeta = song.fonte === "orcamento" ? reverseFromBudget(song.budget, song.splitEco) : song.meta;
      const r = calcCampaign({ meta: effMeta, days: song.days, modo: song.modo, perfil: song.perfil, splitEcoPct: song.splitEco });

      const snapshot = buildSnapshot(r, {
        spotifyTrackId: song.track.id,
        trackUrl: song.trackUrl || null,
        title: song.track.title,
        artist: song.track.artist,
        coverUrl: song.track.thumbnail_url,
        baselineStreamsDay: song.baselineStreamsDay,
      });

      const allocations = planEcoAllocations(
        r.streamsEco,
        r.days,
        (playlists ?? []).map(p => ({ id: p.id, followers: p.followers ?? 0 })),
        r.modo,
      );

      const startD = startOfDay(new Date(song.startDateISO));
      const deadlineISO = addDays(startD, r.days).toISOString().slice(0, 10);

      const { campaignId } = await closeCampaignFromCalculator({
        snapshot,
        deadlineISO,
        allocations,
        clientId: clientId || null,
        curatorId: curatorId || null,
        status: "draft",
      });
      return { ok: true, campaignId };
    } catch (e: any) {
      return { ok: false, error: e?.message ?? String(e) };
    }
  }

  async function salvarRascunhoAtiva() {
    if (!active.track?.id) {
      toast({ title: "Carregue o link da música antes de salvar", variant: "destructive" });
      return;
    }
    setClosing(true);
    const res = await closeOne(active);
    if (!res.ok) {
      toast({ title: "Erro ao salvar rascunho", description: res.error, variant: "destructive" });
      setClosing(false);
      return;
    }
    if (songs.length === 1) {
      try { localStorage.removeItem(STORAGE_KEY_V2); localStorage.removeItem(STORAGE_KEY_V1); } catch { /* ignore */ }
      setClosing(false);
      toast({ title: "Rascunho salvo", description: "Revise na aba Aprovação e clique em Aprovar e disparar." });
      navigate(`/campanhas`);
      return;
    }
    removeSong(activeIdx);
    setClosing(false);
    toast({ title: "Rascunho salvo" });
  }

  async function fecharTodas() {
    const ready = songs.filter(isSongReady);
    if (ready.length === 0) {
      toast({ title: "Nenhuma música pronta", variant: "destructive" });
      return;
    }
    setClosing(true);
    let ok = 0;
    const errors: string[] = [];
    for (const s of ready) {
      const r = await closeOne(s);
      if (r.ok) ok++;
      else errors.push(`${s.track?.title ?? "Faixa"}: ${r.error}`);
    }
    setClosing(false);
    if (ok > 0) {
      const remaining = songs.filter(s => !isSongReady(s));
      if (remaining.length === 0) {
        try { localStorage.removeItem(STORAGE_KEY_V2); localStorage.removeItem(STORAGE_KEY_V1); } catch { /* ignore */ }
        setSongs([emptySong()]);
        setActiveIdx(0);
      } else {
        setSongs(remaining);
        setActiveIdx(0);
      }
      toast({
        title: `${ok} campanha(s) salvas como rascunho`,
        description: errors.length ? `Falharam: ${errors.length}` : "Revise em Aprovação e aprove pra criar os deals.",
      });
      if (errors.length === 0) navigate(`/campanhas`);
    } else {
      toast({ title: "Falha ao fechar campanhas", description: errors.join(" · "), variant: "destructive" });
    }
  }

  const canGoStep2 = !!(curatorId || clientId);
  const canGoStep3 = readyCount > 0;

  return (
    <div className="space-y-6">
      {/* ============== STEPPER ============== */}
      <div className="rounded-2xl border border-border bg-card px-4 py-3">
        <div className="flex items-center gap-2 sm:gap-3">
          {([
            { n: 1 as const, label: "Sessão",  hint: canGoStep2 ? `${clientName} · ${curatorName}` : "Cliente & curador" },
            { n: 2 as const, label: "Músicas", hint: `${songs.length} em planejamento` },
            { n: 3 as const, label: "Revisão", hint: `${readyCount} pronta(s)` },
          ]).map((s, i, arr) => {
            const isActive = step === s.n;
            const done = step > s.n;
            const nextStep = arr[i + 1];
            // Linha só fica verde cheia se o PRÓXIMO passo também estiver concluído.
            // Se o próximo é o ativo, fica suave (não dá sensação de "preenchido até lá").
            const nextDone = nextStep ? step > nextStep.n : false;
            const connectorClass = done && nextDone
              ? "bg-primary/40"
              : done
                ? "bg-primary/15"
                : "bg-border";
            const clickable = s.n === 1 || (s.n === 2 && canGoStep2) || (s.n === 3 && canGoStep3);
            return (
              <div key={s.n} className="flex items-center flex-1 gap-2 sm:gap-3 min-w-0">
                <button
                  type="button"
                  onClick={() => clickable && setStep(s.n)}
                  disabled={!clickable}
                  className={cn(
                    "flex items-center gap-2.5 min-w-0 text-left transition-opacity rounded-lg px-1.5 py-1 -mx-1.5",
                    !clickable && "opacity-50 cursor-not-allowed",
                    clickable && !isActive && "hover:bg-muted/30",
                  )}
                >
                  <span className={cn(
                    "shrink-0 h-7 w-7 rounded-full grid place-items-center text-xs font-semibold border-2 transition-colors",
                    isActive ? "bg-transparent text-primary border-primary"
                    : done ? "bg-primary/15 text-primary border-primary/40"
                    : "bg-muted text-muted-foreground border-border",
                  )}>{done ? <CheckCircle2 className="h-3.5 w-3.5" /> : s.n}</span>
                  <span className="min-w-0 hidden sm:block">
                    <span className={cn("block text-sm font-semibold truncate", isActive ? "text-foreground" : "text-muted-foreground")}>{s.label}</span>
                    <span className="block text-[11px] text-muted-foreground truncate">{s.hint}</span>
                  </span>
                  <span className={cn("sm:hidden text-sm font-semibold truncate", isActive ? "text-foreground" : "text-muted-foreground")}>
                    {s.label}
                  </span>
                </button>
                {i < arr.length - 1 && (
                  <span className={cn("flex-1 h-px", connectorClass)} />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ============== STEP 1 — SESSÃO ============== */}
      {step === 1 && (
        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Sessão</CardTitle>
              <CardDescription>Cliente e curador valem pra todas as músicas desta sessão.</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                <Label className="text-xs">Curador <span className="text-destructive">*</span></Label>
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

          <div className="flex justify-end">
            <Button size="lg" variant="solid" onClick={() => setStep(2)} disabled={!canGoStep2}>
              Avançar pra Músicas <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          </div>
        </div>
      )}

      {/* ============== STEP 2 — MÚSICAS ============== */}
      {step === 2 && (
        <div className="space-y-5">
          <SessionChip clientName={clientName} curatorName={curatorName} onEdit={() => setStep(1)} />

          {/* Trilha horizontal de músicas (substitui sidebar) */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-xs text-muted-foreground inline-flex items-center gap-1.5">
                <ListMusic className="h-3.5 w-3.5" />
                Músicas em planejamento
                <span className="text-foreground font-medium ml-0.5">({songs.length})</span>
                {readyCount > 0 && (
                  <span className="ml-1 text-primary">· {readyCount} pronta{readyCount > 1 ? "s" : ""}</span>
                )}
              </div>
              <Button variant="outline" size="sm" onClick={addSong}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Adicionar música
              </Button>
            </div>

            <div className="flex gap-2 overflow-x-auto nx-scroll pb-1 -mx-1 px-1">
              {songResults.map((x, idx) => {
                const isActive = idx === activeIdx;
                const hasTrack = !!x.song.track?.title;
                const label = x.song.track?.title ?? "Em preparação";
                const artist = x.song.track?.artist;
                return (
                  <div
                    key={x.song.uid}
                    className={cn(
                      "group relative shrink-0 w-[240px] rounded-xl border bg-card transition-all",
                      isActive
                        ? "border-primary/60 ring-1 ring-primary/30 shadow-[0_0_0_1px_hsl(var(--primary)/0.15)]"
                        : "border-border hover:border-border/80 hover:bg-muted/20",
                    )}
                  >
                    <button
                      onClick={() => setActiveIdx(idx)}
                      className="w-full text-left p-2.5 pr-8 flex items-center gap-2.5"
                    >
                      {x.song.track?.thumbnail_url ? (
                        <img src={x.song.track.thumbnail_url} alt="" className="h-10 w-10 rounded-md object-cover shrink-0" />
                      ) : (
                        <div className={cn(
                          "h-10 w-10 rounded-md grid place-items-center shrink-0 border border-dashed",
                          isActive ? "bg-primary/5 border-primary/30" : "bg-muted/40 border-border/60",
                        )}>
                          <Music className={cn("h-4 w-4", isActive ? "text-primary/70" : "text-muted-foreground/60")} />
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <span className="text-[10px] font-semibold text-muted-foreground tabular-nums">#{idx + 1}</span>
                          <span className={cn(
                            "h-1.5 w-1.5 rounded-full shrink-0",
                            x.ready ? "bg-primary" : "bg-muted-foreground/30",
                          )} />
                          <span className="text-[10px] uppercase tracking-wider text-muted-foreground truncate">
                            {x.ready ? `${formatInt(x.r.meta)} · ${x.r.days}d` : "aguardando"}
                          </span>
                        </div>
                        <div className={cn(
                          "text-sm font-medium truncate",
                          isActive ? "text-foreground" : hasTrack ? "text-muted-foreground" : "text-muted-foreground/70 italic",
                        )}>
                          {label}
                        </div>
                        {artist && (
                          <div className="text-[11px] text-muted-foreground truncate">{artist}</div>
                        )}
                      </div>
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); removeSong(idx); }}
                      className="absolute right-1.5 top-1.5 h-6 w-6 inline-flex items-center justify-center text-muted-foreground hover:text-foreground rounded opacity-0 group-hover:opacity-100 transition-opacity"
                      aria-label="Remover música"
                      title={songs.length === 1 ? "Limpar esta música" : "Remover música"}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })}

              {/* Card "adicionar" inline pra preencher o espaço quando há poucas músicas */}
              <button
                onClick={addSong}
                className="shrink-0 w-[180px] rounded-xl border border-dashed border-border/60 hover:border-primary/40 hover:bg-muted/20 transition-colors flex items-center justify-center gap-2 text-xs text-muted-foreground hover:text-foreground"
              >
                <Plus className="h-3.5 w-3.5" />
                Nova música
              </button>
            </div>
          </div>

          {/* Formulário vertical único — Música → Meta → Estratégia */}
          <div className="space-y-5">
              {/* KPIs SÓ da música ativa (operação atual). */}
              <CalculadoraKpis r={result} />

              {/* Música */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Música</CardTitle>
                  <CardDescription>Cole o link do Spotify da faixa.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Music className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        placeholder="https://open.spotify.com/track/..."
                        value={active.trackUrl}
                        onChange={e => { setTrackUrl(e.target.value); setTrack(null); }}
                        onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); buscarMusica(); } }}
                        className="pl-9"
                      />
                    </div>
                    <Button onClick={buscarMusica} disabled={trackLoading || !active.trackUrl.trim()} variant="outline">
                      {trackLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                      <span className="ml-1.5 hidden sm:inline">Buscar</span>
                    </Button>
                  </div>

                  {active.track && (
                    <div className="flex items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 p-3">
                      {active.track.thumbnail_url ? (
                        <img src={active.track.thumbnail_url} alt={active.track.title ?? ""} className="h-14 w-14 rounded-md object-cover shrink-0" />
                      ) : (
                        <div className="h-14 w-14 rounded-md bg-muted shrink-0 grid place-items-center">
                          <Music className="h-5 w-5 text-muted-foreground" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold truncate text-sm flex items-center gap-1.5">
                          <CheckCircle2 className="h-3.5 w-3.5 text-primary shrink-0" />
                          {active.track.title ?? "Faixa"}
                        </div>
                        {active.track.artist && <div className="text-xs text-muted-foreground truncate">{active.track.artist}</div>}
                        <div className="text-[11px] mt-1">
                          {active.track.streamsDay != null ? (
                            <span className="text-foreground">
                              <strong>{formatInt(active.track.streamsDay)}</strong> streams/dia hoje
                              {active.track.position != null && <span className="text-muted-foreground"> · #{active.track.position} Top 200</span>}
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

                  <div className="space-y-1.5 pt-1">
                    <Label className="text-xs flex items-center justify-between">
                      <span>Streams/dia atuais <span className="text-destructive">*</span></span>
                      {active.track?.streamsDay != null && active.baselineStreamsDay !== active.track.streamsDay && (
                        <button
                          type="button"
                          onClick={() => setBaselineStreamsDay(active.track!.streamsDay!)}
                          className="text-[10px] text-primary hover:underline"
                        >
                          usar Top 200 ({formatInt(active.track.streamsDay)})
                        </button>
                      )}
                    </Label>
                    <NumberInput value={active.baselineStreamsDay} onChange={setBaselineStreamsDay} placeholder="ex: 20.000" />
                  </div>
                </CardContent>
              </Card>

              {/* Fonte da meta */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Fonte da meta</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <FonteBtn active={active.fonte === "manual"} onClick={() => setFonte("manual")} icon={TargetIcon} label="Manual" />
                    <FonteBtn active={active.fonte === "top200"} onClick={() => setFonte("top200")} icon={Table2} label="Top 200" />
                    <FonteBtn active={active.fonte === "concorrente"} onClick={() => setFonte("concorrente")} icon={Users} label="Concorrente" />
                    <FonteBtn active={active.fonte === "orcamento"} onClick={() => setFonte("orcamento")} icon={Wallet} label="Orçamento" />
                  </div>

                  {active.fonte === "manual" && (
                    <div>
                      <Label className="text-xs">Meta de streams</Label>
                      <NumberInput value={active.meta} onChange={setMeta} placeholder="1.000.000" />
                    </div>
                  )}
                  {active.fonte === "top200" && (
                    <Top200Picker
                      days={active.days}
                      currentStreamsDay={active.baselineStreamsDay}
                      onPick={(streamsDay, pos) => {
                        const gapDay = Math.max(0, streamsDay - active.baselineStreamsDay);
                        setMeta(gapDay * active.days);
                        toast({
                          title: `Posição #${pos}`,
                          description: active.baselineStreamsDay > 0
                            ? `Alvo ${formatInt(streamsDay)}/d − hoje ${formatInt(active.baselineStreamsDay)}/d = ${formatInt(gapDay)}/d × ${active.days}d = ${formatInt(gapDay * active.days)}`
                            : `${formatInt(streamsDay)} streams/dia × ${active.days}d = ${formatInt(streamsDay * active.days)}`,
                        });
                      }}
                      onOpenList={() => setTop200Open(true)}
                    />
                  )}
                  {active.fonte === "concorrente" && (
                    <div className="space-y-2">
                      <Label className="text-xs">Link do artista concorrente</Label>
                      <Input placeholder="https://open.spotify.com/artist/..." />
                      <p className="text-xs text-muted-foreground">
                        Em breve: leitura automática de streams médios. Por enquanto, defina manualmente abaixo.
                      </p>
                      <NumberInput value={active.meta} onChange={setMeta} />
                    </div>
                  )}
                  {active.fonte === "orcamento" && (
                    <div className="space-y-2">
                      <Label className="text-xs">Orçamento disponível (R$)</Label>
                      <NumberInput value={active.budget} onChange={setBudget} placeholder="40.000" />
                      <p className="text-xs text-muted-foreground">
                        Meta calculada: <span className="font-semibold text-foreground">{formatInt(effectiveMeta)} streams</span>
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Estratégia */}
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
                            onSelect={(d) => d && setStartDate(d)}
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
                      {active.days} dias · começa {format(startDate, "dd/MM", { locale: ptBR })} · termina {format(endDate, "dd/MM", { locale: ptBR })}
                    </p>
                  </div>

                  <div>
                    <Label className="text-xs">Duração: {active.days} dias</Label>
                    <Slider value={[active.days]} onValueChange={([v]) => setDays(v)} min={15} max={180} step={5} className="mt-2" />
                  </div>

                  <div>
                    <Label className="text-xs">Modo</Label>
                    <div className="grid grid-cols-2 gap-2 mt-1.5">
                      <ModeBtn active={active.modo === "simultaneo"} onClick={() => setModo("simultaneo")} label="Simultâneo" hint="largura ampla" />
                      <ModeBtn active={active.modo === "sequencial"} onClick={() => setModo("sequencial")} label="Sequencial" hint="pico marcado" />
                    </div>
                  </div>

                  <div>
                    <Label className="text-xs">Perfil de audiência</Label>
                    <div className="grid grid-cols-3 gap-2 mt-1.5">
                      {(["frio", "mercado", "engajado"] as Perfil[]).map(p => (
                        <ModeBtn key={p} active={active.perfil === p} onClick={() => setPerfil(p)} label={cap(p)} />
                      ))}
                    </div>
                  </div>

                  <div>
                    <Label className="text-xs">Split ecossistema: {active.splitEco}% próprio · {100 - active.splitEco}% externo</Label>
                    <Slider value={[active.splitEco]} onValueChange={([v]) => setSplitEco(v)} min={0} max={100} step={5} className="mt-2" />
                    <div className="text-[11px] text-muted-foreground mt-1.5 flex justify-between">
                      <span>Próprio R$ {(COST_PER_STREAM.eco * 1000).toFixed(0)}/mil</span>
                      <span>Externo R$ {(COST_PER_STREAM.ext * 1000).toFixed(0)}/mil</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
          </div>

          <div className="flex items-center justify-between pt-1">
            <Button variant="ghost" onClick={() => setStep(1)}>
              <ArrowLeft className="h-4 w-4 mr-2" /> Sessão
            </Button>
            <Button size="lg" variant="solid" onClick={() => setStep(3)} disabled={!canGoStep3}>
              Revisar ({readyCount}) <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          </div>
        </div>
      )}

      {/* ============== STEP 3 — REVISÃO ============== */}
      {step === 3 && (
        <div className="space-y-5">
          <SessionChip clientName={clientName} curatorName={curatorName} onEdit={() => setStep(1)} />

          {/* KPIs agregados — só desta operação. */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <ReviewKpi icon={TargetIcon} label="Meta agregada" value={formatInt(totals.totalMeta)} hint={`${totals.count} de ${songs.length} música(s)`} />
            <ReviewKpi icon={Wallet} label="Custo total" value={formatBRL(totals.totalCost)} hint={`R$ ${totals.totalMeta > 0 ? (totals.totalCost / totals.totalMeta).toFixed(3) : "0.000"}/stream`} />
            <ReviewKpi icon={Zap} label="Duração máx" value={`${totals.maxDays}d`} hint="janela mais longa" />
            <ReviewKpi
              icon={Layers}
              label="Eco / Ext"
              value={`${totals.totalMeta > 0 ? Math.round((totals.totalEco / totals.totalMeta) * 100) : 0}% / ${totals.totalMeta > 0 ? Math.round((totals.totalExt / totals.totalMeta) * 100) : 0}%`}
              hint={`${formatInt(totals.totalEco)} eco · ${formatInt(totals.totalExt)} ext`}
            />
          </div>

          {/* Resumo música a música */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Músicas desta operação</CardTitle>
              <CardDescription>Cada linha vira 1 campanha + 1 deal independente. Clique pra voltar à música no passo anterior.</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {songResults.map((x, idx) => (
                <button
                  key={x.song.uid}
                  type="button"
                  onClick={() => { setActiveIdx(idx); setStep(2); }}
                  className={cn(
                    "w-full flex items-center gap-3 p-4 border-t border-border first:border-t-0 text-left transition-colors hover:bg-muted/30",
                    !x.ready && "opacity-60",
                  )}
                >
                  {x.song.track?.thumbnail_url ? (
                    <img src={x.song.track.thumbnail_url} alt="" className="h-11 w-11 rounded-md object-cover shrink-0" />
                  ) : (
                    <div className="h-11 w-11 rounded-md bg-muted grid place-items-center shrink-0">
                      <Music className="h-4 w-4 text-muted-foreground" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate">
                      {idx + 1}. {x.song.track?.title ?? "Sem faixa"}
                    </div>
                    <div className="text-[11px] text-muted-foreground truncate">
                      {x.song.track?.artist ?? "—"} · {x.r.days}d · {x.song.modo} · {x.song.perfil} · split {x.song.splitEco}/{100 - x.song.splitEco}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-sm font-semibold tabular-nums">{formatInt(x.r.meta)}</div>
                    <div className="text-[11px] text-muted-foreground tabular-nums">{formatBRL(x.r.custoTotal)}</div>
                  </div>
                  {!x.ready && <Badge variant="outline" className="text-[10px] shrink-0">incompleta</Badge>}
                </button>
              ))}
            </CardContent>
          </Card>

          {/* Distribuição + curva da música ativa (referência) */}
          {active.track?.id && (
            <div className="space-y-2">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Preview de curva · {active.track.title}
              </div>
              <CalculadoraResultado r={result} />
            </div>
          )}

          {/* Ações de fechamento */}
          <div className="flex items-center justify-between gap-3 pt-1">
            <Button variant="ghost" onClick={() => setStep(2)}>
              <ArrowLeft className="h-4 w-4 mr-2" /> Voltar pra músicas
            </Button>
            <div className="flex items-center gap-2">
              {onContinue ? (
                <Button
                  size="lg"
                  className="w-full"
                  variant="solid"
                  onClick={() => onContinue({ result, trackUrl: active.trackUrl, track: active.track, fonte: active.fonte })}
                >
                  Continuar para execução
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              ) : (
                <>
                  <Button
                    size="lg"
                    variant="outline"
                    onClick={salvarRascunhoAtiva}
                    disabled={closing || !active.track?.id}
                  >
                    {closing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FileText className="h-4 w-4 mr-2" />}
                    Salvar só ativa
                  </Button>
                  <Button
                    size="lg"
                    variant="solid"
                    onClick={fecharTodas}
                    disabled={closing || readyCount === 0}
                  >
                    {closing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
                    Fechar campanhas ({readyCount})
                  </Button>
                </>
              )}
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground text-center">
            Cada música vira <strong>1 campanha + 1 deal</strong> independente. Vão pra <strong>Aprovação</strong>
            {curatorId ? "" : " — selecione o curador antes pra ligar ao deal real"}.
          </p>
        </div>
      )}

      {/* Top 200 BR — agora em modal, acionado pela fonte "Top 200" */}
      <Dialog open={top200Open} onOpenChange={setTop200Open}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>Top 200 BR</DialogTitle>
          </DialogHeader>
          <Top200Tab onPick={(streamsDay) => {
            patchActive({ fonte: "manual", meta: streamsDay * active.days });
            setTop200Open(false);
          }} />
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Chip de contexto da sessão — fica no topo dos passos 2 e 3 com botão pra editar. */
function SessionChip({ clientName, curatorName, onEdit }: { clientName: string; curatorName: string; onEdit: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-border border-l-2 border-l-primary/60 bg-card/60 px-4 py-2.5">
      <div className="flex items-center gap-4 min-w-0 text-xs">
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" aria-hidden />
          <span className="text-[10px] uppercase tracking-[0.14em] font-semibold text-primary">Sessão ativa</span>
        </div>
        <div className="h-8 w-px bg-border shrink-0" />
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Cliente</div>
          <div className="text-sm font-medium truncate text-foreground">{clientName}</div>
        </div>
        <div className="h-8 w-px bg-border shrink-0" />
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Curador</div>
          <div className="text-sm font-medium truncate text-foreground">{curatorName}</div>
        </div>
      </div>
      <Button variant="ghost" size="sm" onClick={onEdit} className="shrink-0 text-muted-foreground hover:text-foreground">
        <Pencil className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

function ReviewKpi({ icon: Icon, label, value, hint }: { icon: any; label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="text-xl font-semibold mt-1 tabular-nums">{value}</div>
      {hint && <div className="text-xs text-muted-foreground mt-0.5">{hint}</div>}
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
