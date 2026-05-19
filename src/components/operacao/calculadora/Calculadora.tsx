import { useMemo, useState, useEffect, useCallback } from "react";
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
  calcCampaign, reverseFromBudget, formatInt,
  DEFAULT_SPLIT, COST_PER_STREAM,
  type Modo, type Perfil, type CampaignResult,
} from "@/lib/campaignEngine";
import { Calculator, Table2, ArrowRight, Target as TargetIcon, Users, Wallet, Music, Search, CheckCircle2, X, Loader2, Settings2, LayoutGrid, CalendarIcon, FileText, Plus, ListMusic } from "lucide-react";
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
    meta: 1_000_000,
    days: 60,
    budget: 40_000,
    modo: "simultaneo",
    perfil: "mercado",
    splitEco: DEFAULT_SPLIT.eco,
    startDateISO: startOfDay(new Date()).toISOString().slice(0, 10),
  };
}

function loadPersisted(): PersistedV2 {
  try {
    const rawV2 = localStorage.getItem(STORAGE_KEY_V2);
    if (rawV2) {
      const parsed = JSON.parse(rawV2) as PersistedV2;
      if (parsed?.songs?.length) {
        // garante uid em todas
        parsed.songs = parsed.songs.map(s => ({ ...emptySong(), ...s, uid: s.uid ?? makeUid() }));
        parsed.activeIdx = Math.min(Math.max(0, parsed.activeIdx ?? 0), parsed.songs.length - 1);
        return parsed;
      }
    }
    // migra v1 → v2 (uma música)
    const rawV1 = localStorage.getItem(STORAGE_KEY_V1);
    if (rawV1) {
      const v1 = JSON.parse(rawV1);
      const s = emptySong();
      return {
        clientId: v1.clientId ?? "",
        curatorId: v1.curatorId ?? "",
        songs: [{
          ...s,
          fonte: v1.fonte ?? s.fonte,
          trackUrl: v1.trackUrl ?? s.trackUrl,
          track: v1.track ?? s.track,
          baselineStreamsDay: v1.baselineStreamsDay ?? s.baselineStreamsDay,
          meta: v1.meta ?? s.meta,
          days: v1.days ?? s.days,
          budget: v1.budget ?? s.budget,
          modo: v1.modo ?? s.modo,
          perfil: v1.perfil ?? s.perfil,
          splitEco: v1.splitEco ?? s.splitEco,
          startDateISO: v1.startDateISO ?? s.startDateISO,
        }],
        activeIdx: 0,
      };
    }
  } catch { /* ignore */ }
  return { clientId: "", curatorId: "", songs: [emptySong()], activeIdx: 0 };
}

export function Calculadora({ onContinue }: { onContinue?: (h: CalculadoraHandoff) => void }) {
  const initial = useMemo(loadPersisted, []);
  const navigate = useNavigate();
  const [subtab, setSubtab] = useState<"calc" | "top200">("calc");
  const [secao, setSecao] = useState<Secao>("musica");
  const [closing, setClosing] = useState(false);

  // Contexto fixo da sessão
  const [clientId, setClientId] = useState<string>(initial.clientId);
  const [curatorId, setCuratorId] = useState<string>(initial.curatorId);
  const [clientsList, setClientsList] = useState<{ id: string; name: string }[]>([]);
  const [curatorsList, setCuratorsList] = useState<{ id: string; name: string }[]>([]);

  // Lista de músicas + ativa
  const [songs, setSongs] = useState<Song[]>(initial.songs);
  const [activeIdx, setActiveIdx] = useState<number>(initial.activeIdx);
  const active = songs[activeIdx] ?? songs[0];

  // Loader auxiliar (busca de música) por índice
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
      if (!curatorId) {
        const ladoSul = crList.find(c => /l[áa]\s*do\s*sul/i.test(c.name));
        if (ladoSul) setCuratorId(ladoSul.id);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persistência
  useEffect(() => {
    try {
      const payload: PersistedV2 = { clientId, curatorId, songs, activeIdx };
      localStorage.setItem(STORAGE_KEY_V2, JSON.stringify(payload));
    } catch { /* ignore */ }
  }, [clientId, curatorId, songs, activeIdx]);

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
    setActiveIdx(songs.length); // novo índice
    setSecao("musica");
  }

  function removeSong(idx: number) {
    if (songs.length === 1) {
      // não remove a última — só reseta
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
    if (active.fonte === "orcamento") return reverseFromBudget(active.budget, active.splitEco);
    return active.meta;
  }, [active.fonte, active.budget, active.splitEco, active.meta]);

  const result = useMemo(() => calcCampaign({
    meta: effectiveMeta, days: active.days, modo: active.modo, perfil: active.perfil, splitEcoPct: active.splitEco,
  }), [effectiveMeta, active.days, active.modo, active.perfil, active.splitEco]);

  // Validação por música (pra "Fechar todas")
  function isSongReady(s: Song): boolean {
    return !!s.track?.id && s.baselineStreamsDay >= 0 && (s.fonte === "orcamento" ? s.budget > 0 : s.meta > 0);
  }
  const readyCount = songs.filter(isSongReady).length;

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

  // --- Fechamento (1 música ou todas) ---
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
    // remove só essa música do rascunho. Se for a única, limpa tudo.
    if (songs.length === 1) {
      try { localStorage.removeItem(STORAGE_KEY_V2); localStorage.removeItem(STORAGE_KEY_V1); } catch { /* ignore */ }
      setClosing(false);
      toast({ title: "Rascunho salvo", description: "Revise na aba Rascunhos e clique em Aprovar e disparar." });
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
      // limpa rascunhos salvos com sucesso
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
        description: errors.length ? `Falharam: ${errors.length}` : "Revise em Rascunhos e aprove pra criar os deals.",
      });
      if (errors.length === 0) navigate(`/campanhas`);
    } else {
      toast({ title: "Falha ao fechar campanhas", description: errors.join(" · "), variant: "destructive" });
    }
  }

  return (
    <div className="space-y-6">
      {/* Sub-tabs Calculadora / Top200 */}
      <div className="flex items-center gap-1 border-b border-border">
        {([
          { id: "calc", label: "Calculadora", icon: Calculator },
          { id: "top200", label: "Top 200 BR", icon: Table2 },
        ] as const).map(t => {
          const Icon = t.icon;
          const isActive = subtab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setSubtab(t.id)}
              className={cn(
                "px-4 h-10 inline-flex items-center gap-2 text-sm font-medium border-b-2 -mb-px transition-colors",
                isActive ? "border-primary text-foreground"
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
          patchActive({ fonte: "manual", meta: streamsDay * active.days });
          setSubtab("calc");
        }} />
      ) : (
        <div className="grid grid-cols-1 gap-6">
          {/* KPIs do resultado (música ativa) */}
          <CalculadoraKpis r={result} />

          {/* Contexto fixo: Cliente + Curador (1x por sessão) */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Identificação da sessão</CardTitle>
              <CardDescription>
                Cliente e curador valem pra TODAS as músicas abaixo. Cada música abaixo vira uma campanha independente.
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

          {/* Faixa de Músicas — cada tab é uma campanha em planejamento */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <ListMusic className="h-3.5 w-3.5" />
                <span>Músicas em planejamento ({songs.length}) · cada uma vira 1 campanha + 1 deal</span>
              </div>
              <Button variant="outline" size="sm" onClick={addSong}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Música
              </Button>
            </div>
            <div className="flex items-center gap-1 overflow-x-auto scrollbar-none border-b border-border -mx-1 px-1">
              {songs.map((s, idx) => {
                const isActive = idx === activeIdx;
                const ready = isSongReady(s);
                const label = s.track?.title ?? "Sem faixa";
                return (
                  <div key={s.uid} className="relative shrink-0">
                    <button
                      onClick={() => setActiveIdx(idx)}
                      className={cn(
                        "h-10 pl-3 pr-8 inline-flex items-center gap-2 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap max-w-[220px]",
                        isActive ? "border-primary text-foreground"
                                 : "border-transparent text-muted-foreground hover:text-foreground",
                      )}
                      title={label}
                    >
                      <span className={cn(
                        "h-1.5 w-1.5 rounded-full shrink-0",
                        ready ? "bg-primary" : "bg-muted-foreground/40",
                      )} />
                      <span className="truncate">{idx + 1}. {label}</span>
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); removeSong(idx); }}
                      className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 inline-flex items-center justify-center text-muted-foreground hover:text-foreground rounded"
                      aria-label="Remover música"
                      title={songs.length === 1 ? "Limpar esta música" : "Remover música"}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Inputs (operam sobre a música ativa) */}
          <div className="space-y-4">
            <div className="flex items-center gap-1 rounded-xl border border-border bg-card p-1">
              {([
                { id: "musica", label: "Música", icon: Music },
                { id: "meta", label: "Meta", icon: TargetIcon },
                { id: "estrategia", label: "Estratégia", icon: Settings2 },
                { id: "todos", label: "Tudo", icon: LayoutGrid },
              ] as const).map(s => {
                const Icon = s.icon;
                const isActive = secao === s.id;
                return (
                  <button
                    key={s.id}
                    onClick={() => setSecao(s.id)}
                    className={cn(
                      "flex-1 h-9 inline-flex items-center justify-center gap-1.5 rounded-lg text-xs font-medium transition-colors",
                      isActive ? "bg-primary/15 text-primary"
                               : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {s.label}
                  </button>
                );
              })}
            </div>

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
                    <span>Streams/dia atuais da música <span className="text-destructive">*</span></span>
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
                    onOpenList={() => setSubtab("top200")}
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
            )}
          </div>

          {/* Resultado + ações de fechamento */}
          <div className="space-y-4">
            {secao === "todos" && <CalculadoraResultado r={result} />}

            {secao === "todos" && (
              <>
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
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <Button
                      size="lg"
                      variant="outline"
                      onClick={salvarRascunhoAtiva}
                      disabled={closing || !active.track?.id}
                    >
                      {closing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FileText className="h-4 w-4 mr-2" />}
                      Fechar esta música
                    </Button>
                    <Button
                      size="lg"
                      variant="solid"
                      onClick={fecharTodas}
                      disabled={closing || readyCount === 0}
                    >
                      {closing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
                      Fechar todas ({readyCount})
                    </Button>
                  </div>
                )}
                <p className="text-[11px] text-muted-foreground text-center">
                  Cada música vira <strong>1 campanha + 1 deal</strong> independente, ligados ao mesmo cliente e curador.
                  Vão pra <strong>Rascunhos</strong> {curatorId ? "" : "— selecione o curador antes pra ligar ao deal real"}.
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
