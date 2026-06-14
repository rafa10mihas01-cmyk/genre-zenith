import { useMemo, useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { buildSnapshot, closeCampaignFromCalculator } from "@/lib/campaignSnapshot";
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
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { Top200Tab } from "./Top200Tab";
import { CalculadoraResultado, CalculadoraKpis } from "./CalculadoraResultado";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import {
  calcCampaign, reverseFromBudget, metaFromBudgetSell, estimateBudgetMargin, formatInt, formatBRL,
  DEFAULT_SPLIT, COST_PER_STREAM,
  type Modo, type Perfil, type CampaignResult,
} from "@/lib/campaignEngine";
import { usePricingSettings } from "@/hooks/usePricingSettings";
import { formatCompact } from "@/lib/format";
import { Table2, ArrowRight, ArrowLeft, Target as TargetIcon, Users, Wallet, Music, Search, CheckCircle2, X, Loader2, CalendarIcon, FileText, Plus, ListMusic, Layers, Zap, Pencil, AlertTriangle } from "lucide-react";
import { useEcosystemCapacity } from "@/hooks/useEcosystemCapacity";
import { CapacidadeRealCard } from "./CapacidadeRealCard";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format, addDays, differenceInCalendarDays, startOfDay } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  calculateTrackDailyStreams,
  planRealCapacity,
  POSITION_PCT,
  ecoPlanTotalMultiplier,
  MIN_PLAYLIST_SAVES_FOR_CAMPAIGN,
  ECO_CURVE_LOSS_COMPENSATION,
} from "@/lib/campaignOperationalPlan";

// ─── Free First (anti-canibalização local da Calculadora) ─────────────
// Quando true, particiona o pool em Grupo A (livres) e Grupo B (ocupadas
// por outras campanhas active/approved cuja janela sobrepõe a desta).
// A é consumido sozinho até cobrir ~95% da meta diária; B só entra se sobrar gap.
// Espelha a regra já existente em approve-campaign-plan/replan-campaign-eco.
// Setar false desliga a regra e restaura comportamento anterior (sem mudanças).
const CALCULATOR_FREE_FIRST_ENABLED = true;
import type { EcoAllocationPlan } from "@/lib/campaignSnapshot";
import { TrackPresencePanel } from "@/components/campanhas/TrackPresencePanel";

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
  splitOrganic: number;
  clientProfile: "gravadora" | "artista";
  engagementMultiplier: number;
  startDateISO: string; // yyyy-mm-dd
  clientPriceTotal: number; // R$ que o cliente paga (manual) — 0 = usa tabela
  genre: string; // p/ filtrar playlists na distribuição
  /** Marca a música como Funk Mandelão — bloqueia Trap de alto valor (>30k seguidores). */
  isMandelao: boolean;
  // Top 200 picker (controlado pra meta recalcular sozinho quando days muda)
  top200Pos: number | null;
  top200StreamsDay: number | null;
  top200ChartDate: string | null;
};


const ENGAGEMENT_PRESETS = [18, 35, 50] as const;

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

const GENRE_OPTIONS = [
  "Funk", "Sertanejo", "Pop", "Rap / Trap", "Rock", "Eletrônica",
  "Gospel", "MPB", "Pagode / Samba", "Forró", "Indie / Alternativo", "Outro",
];

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
    splitOrganic: 15,
    clientProfile: "artista",
    engagementMultiplier: 35,
    startDateISO: startOfDay(new Date()).toISOString().slice(0, 10),
    clientPriceTotal: 0,
    genre: "",
    isMandelao: false,
    top200Pos: null,
    top200StreamsDay: null,
    top200ChartDate: null,
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
  const { costs: pricingCosts, settings: pricingSettings } = usePricingSettings();
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
  const [campaignType, setCampaignType] = useState<"ecosystem" | "external" | "hybrid">("ecosystem");
  const [collectionMode, setCollectionMode] = useState<"bot" | "spreadsheet">("bot");
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
  const setSplitOrganic = (v: number) => patchActive({ splitOrganic: Math.max(0, Math.min(50, v)) });
  const setClientProfile = (v: "gravadora" | "artista") => patchActive({ clientProfile: v });
  const setEngagementMultiplier = (v: number) => patchActive({ engagementMultiplier: Math.max(1, Math.min(200, Math.round(v || 1))) });
  const setStartDate = (d: Date) => patchActive({ startDateISO: startOfDay(d).toISOString().slice(0, 10) });
  const setClientPriceTotal = (v: number) => patchActive({ clientPriceTotal: v });
  const setGenre = (v: string) => patchActive({ genre: v });

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
    if (active.fonte === "orcamento") return metaFromBudgetSell(active.budget, pricingSettings.price_per_stream_sell);
    if (active.fonte === "top200" && active.top200StreamsDay != null) {
      const gapDay = Math.max(0, active.top200StreamsDay - active.baselineStreamsDay);
      return gapDay * Math.max(1, active.days);
    }
    return active.meta;
  }, [active.fonte, active.budget, active.splitEco, active.meta, active.top200StreamsDay, active.baselineStreamsDay, active.days, pricingSettings.price_per_stream_sell]);

  const result = useMemo(() => calcCampaign({
    meta: effectiveMeta, days: active.days, modo: active.modo, perfil: active.perfil, splitEcoPct: active.splitEco,
    splitOrganicPct: active.splitOrganic, clientProfile: active.clientProfile,
  }, pricingCosts), [effectiveMeta, active.days, active.modo, active.perfil, active.splitEco, active.splitOrganic, active.clientProfile, pricingCosts]);


  const preferredSlots = useMemo(() => {
    const pos = active.track?.position ?? 999;
    return pos <= 50 ? [1, 2, 3] : [3];
  }, [active.track?.position]);

  // Capacidade real do ecossistema filtrada por gênero da música ativa.
  const ecoCap = useEcosystemCapacity(active.genre, active.days, active.engagementMultiplier ?? 35, preferredSlots, active.track?.position ?? null, result.streamsEco);
  const ecoNeeded = result.streamsEco;
  const ecoUsagePct = ecoCap.capacityTotal > 0
    ? Math.round((ecoNeeded / ecoCap.capacityTotal) * 100)
    : 0;
  const ecoOverflow = ecoNeeded > ecoCap.capacityTotal && ecoCap.capacityTotal > 0;
  const suggestedExtPct = ecoOverflow && result.meta > 0
    ? Math.min(100, Math.round(((result.streamsExt + (ecoNeeded - ecoCap.capacityTotal)) / result.meta) * 100))
    : null;
  const suggestedEcoPct = suggestedExtPct != null ? 100 - suggestedExtPct : null;

  function songEffectiveMeta(s: Song): number {
    if (s.fonte === "orcamento") return metaFromBudgetSell(s.budget, pricingSettings.price_per_stream_sell);
    if (s.fonte === "top200" && s.top200StreamsDay != null) {
      return Math.max(0, s.top200StreamsDay - s.baselineStreamsDay) * Math.max(1, s.days);
    }
    return s.meta;
  }

  function isSongReady(s: Song): boolean {
    return !!s.track?.id && s.baselineStreamsDay >= 0 && songEffectiveMeta(s) > 0;
  }
  const readyCount = songs.filter(isSongReady).length;

  // Agregados (para Revisão) — calcula curva de cada música pronta.
  const songResults = useMemo(() => songs.map(s => ({
    song: s,
    ready: isSongReady(s),
    r: calcCampaign({
      meta: songEffectiveMeta(s),
      days: s.days, modo: s.modo, perfil: s.perfil, splitEcoPct: s.splitEco,
      splitOrganicPct: s.splitOrganic, clientProfile: s.clientProfile,
    }, pricingCosts),
  })), [songs, pricingCosts]);

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

  async function buscarMusica(overrideUrl?: string) {
    const url = (overrideUrl ?? active.trackUrl).trim();
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

  async function closeOne(song: Song): Promise<{ ok: boolean; campaignId?: string; error?: string; shortfall?: { capacity: number; missing: number; suggestedExtPct: number } }> {
    if (!song.track?.id) return { ok: false, error: "Sem música carregada" };
    try {
      const { data: playlistsRaw, error } = await supabase
        .from("managed_playlists")
        .select("id, followers, genre_id")
        .is("archived_at", null);
      if (error) throw error;

      // Não descarta playlist pequena: se for do gênero primário, soma capacidade.
      const playlists = (playlistsRaw ?? []).filter(p => (p.followers ?? 0) > 0);

      // Reserva de inventário: busca (playlist, posição) já ocupadas por
      // campanhas ativas OU rascunhos criados nas últimas 48h. Usado depois
      // pra dropar allocations colidentes (mesma playlist + mesma posição).
      const reservationCutoffIso = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
      const { data: reservedRows } = await supabase
        .from("campaign_eco_allocations")
        .select("managed_playlist_id, position, campaigns!inner(status, created_at)")
        .or(`status.eq.active,and(status.eq.draft,created_at.gte.${reservationCutoffIso})`, { foreignTable: "campaigns" });
      const reservedKeys = new Set<string>(
        ((reservedRows ?? []) as any[])
          .filter(r => Number.isFinite(r.position))
          .map(r => `${r.managed_playlist_id}:${r.position}`),
      );
      // Mapa playlist → set de posições já reservadas, pra "descer" posição
      // em vez de dropar (corrige bug Botadão: Carnívoro ocupa pos #1 das
      // mesmas 20 Funks → cascade não achava slot e zerava o plano).
      const reservedByPlaylist = new Map<string, Set<number>>();
      for (const k of reservedKeys) {
        const [pid, posStr] = k.split(":");
        const pos = Number(posStr);
        if (!pid || !Number.isFinite(pos)) continue;
        if (!reservedByPlaylist.has(pid)) reservedByPlaylist.set(pid, new Set());
        reservedByPlaylist.get(pid)!.add(pos);
      }


      const effMeta = songEffectiveMeta(song);
      const r = calcCampaign({ meta: effMeta, days: song.days, modo: song.modo, perfil: song.perfil, splitEcoPct: song.splitEco, splitOrganicPct: song.splitOrganic, clientProfile: song.clientProfile }, pricingCosts);

      const snapshot = buildSnapshot(
        r,
        {
          spotifyTrackId: song.track.id,
          trackUrl: song.trackUrl || null,
          title: song.track.title,
          artist: song.track.artist,
          coverUrl: song.track.thumbnail_url,
          baselineStreamsDay: song.baselineStreamsDay,
          genre: song.genre || null,
          isMandelao: song.isMandelao || false,
          top200Position: song.top200Pos ?? song.track.position ?? null,
          top200StreamsDay: song.top200StreamsDay ?? song.track.streamsDay ?? null,
          top200ChartDate: song.top200ChartDate ?? song.track.chartDate ?? null,
        },
        {
          clientPriceTotal: song.clientPriceTotal > 0 ? song.clientPriceTotal : null,
          pricePerStreamSell: song.clientPriceTotal > 0 && effMeta > 0
            ? song.clientPriceTotal / effMeta
            : pricingSettings.price_per_stream_sell,
        },
      );

      // Seleção por gênero: gênero principal SEMPRE primeiro.
      // Vizinhos só podem entrar quando o inventário primário não existir ou
      // quando a capacidade real primária deixar gap operacional.
      const allPlaylists = playlists as { id: string; followers: number | null; genre_id: string | null }[];
      let coreSlice = allPlaylists;
      let neighborSlice: typeof allPlaylists = [];
      let neighborAffinityByPlaylistId: Map<string, number> | undefined;

      if (song.genre) {
        const slug = song.genre
          .toLowerCase()
          .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
          .replace(/[^a-z0-9]+/g, " ")
          .trim()
          .split(/\s+/)[0];
        const { data: gRow } = await supabase
          .from("genres")
          .select("id")
          .or(`slug.eq.${slug},nome.ilike.${slug}%`)
          .limit(1)
          .maybeSingle();
        const campaignGenreId = gRow?.id ?? null;

        if (campaignGenreId) {
          const { data: aff } = await supabase
            .from("genre_affinities")
            .select("genre_a_id, genre_b_id, score")
            .or(`genre_a_id.eq.${campaignGenreId},genre_b_id.eq.${campaignGenreId}`)
            .gte("score", 0.6);
          const affByGenreId = new Map<string, number>();
          for (const row of (aff ?? []) as { genre_a_id: string; genre_b_id: string; score: number }[]) {
            const other = row.genre_a_id === campaignGenreId ? row.genre_b_id : row.genre_a_id;
            affByGenreId.set(other, Number(row.score));
          }
          coreSlice = allPlaylists.filter(p => p.genre_id === campaignGenreId);
          neighborSlice = allPlaylists.filter(p => {
            if (!p.genre_id || p.genre_id === campaignGenreId) return false;
            return (affByGenreId.get(p.genre_id) ?? 0) >= 0.6;
          });
          neighborAffinityByPlaylistId = new Map(
            neighborSlice
              .map(p => [p.id, affByGenreId.get(p.genre_id!) ?? 0] as const)
              .filter(([, s]) => s > 0),
          );

          if (coreSlice.length === 0 && neighborSlice.length > 0) {
            // Sem core: trata vizinhos como core (caso de borda preservado).
            coreSlice = neighborSlice;
            neighborSlice = [];
            neighborAffinityByPlaylistId = undefined;
          }
        }
      }

      // ─── Filtro Mandelão ───
      // Se a música é Funk Mandelão, bloqueia playlists Trap de alto valor
      // (>30k seguidores) — não casa com letra pesada. Trap menor entra,
      // mas é empurrada pras posições finais (pos ≥6) no map abaixo.
      const MANDELAO_TRAP_FOLLOWERS_CAP = 30_000;
      let mandelaoTrapIds = new Set<string>();
      let mandelaoBlockedCount = 0;
      if (song.isMandelao) {
        const { data: trapRow } = await supabase
          .from("genres")
          .select("id")
          .eq("slug", "trap")
          .maybeSingle();
        const trapGenreId = trapRow?.id ?? null;
        if (trapGenreId) {
          const beforeCount = neighborSlice.length;
          neighborSlice = neighborSlice.filter(p => {
            if (p.genre_id !== trapGenreId) return true;
            const keep = (p.followers ?? 0) <= MANDELAO_TRAP_FOLLOWERS_CAP;
            if (keep) mandelaoTrapIds.add(p.id);
            return keep;
          });
          mandelaoBlockedCount = beforeCount - neighborSlice.length;
          if (mandelaoBlockedCount > 0) {
            console.info(`[Calculadora] Mandelão: bloqueou ${mandelaoBlockedCount} playlists Trap >30k seguidores`);
          }
        }
      }




      // Capacidade total do eco = uma posição diária por playlist, sem repetir a música.
      const compatiblePlaylists = [...coreSlice, ...neighborSlice].sort((a, b) => (b.followers ?? 0) - (a.followers ?? 0));
      const slots = (song.track?.position ?? 999) <= 50 ? [1, 2, 3] : [3];
      const capacityPerDay = compatiblePlaylists.reduce((sum, playlist, index) => (
        sum + calculateTrackDailyStreams(playlist.followers ?? 0, song.engagementMultiplier ?? 35, slots[index % slots.length] ?? 3)
      ), 0);
      const capacity = capacityPerDay * r.days;
      let shortfall: { capacity: number; missing: number; suggestedExtPct: number } | undefined;
      if (r.streamsEco > capacity && r.meta > 0) {
        const missing = r.streamsEco - capacity;
        const newExt = r.streamsExt + missing;
        const suggestedExtPct = Math.min(100, Math.round((newExt / r.meta) * 100));
        shortfall = { capacity, missing, suggestedExtPct };
      }

      // Alocações operam sobre a duração REAL do plano (effectiveDays).
      // Deadline contratual continua usando r.days (linha abaixo).
      const planDays = r.effectiveDays;
      const dailyNeed = planDays > 0 ? r.streamsEco / planDays : 0;
      // ─── NOVO: aloca via planRealCapacity (early-stop 95%, min saves, vizinho pos 5+, 70/30 gravadora).
      // O planEcoAllocations antigo não respeitava essas regras e despejava o pool inteiro
      // (camp Carnívoro: 306 playlists, 148 com <100 saves, todas em #1).
      // Agora a calculadora gera EXATAMENTE o que a CapacidadeRealCard mostra.
      const mode = song.clientProfile === "gravadora" ? "balanced" : "cascade";
      const corePool = coreSlice
        .filter(p => (p.followers ?? 0) >= MIN_PLAYLIST_SAVES_FOR_CAMPAIGN)
        .map(p => ({ id: p.id, followers: p.followers ?? 0, source: "primary" as const }));
      const neighborPool = neighborSlice
        .filter(p => (p.followers ?? 0) >= MIN_PLAYLIST_SAVES_FOR_CAMPAIGN)
        .map(p => ({ id: p.id, followers: p.followers ?? 0, source: "neighbor" as const }));

      // ─── Free First: detecta playlists OCUPADAS por outras campanhas
      // active/approved cuja janela sobrepõe a janela desta nova campanha.
      // Particiona Grupo A (livres) e Grupo B (ocupadas) e consome A primeiro.
      // A própria campanha ainda não existe no banco (closeOne cria depois),
      // então não há risco de auto-filtrar.
      const occupiedSet = new Set<string>();
      const startMs = new Date(song.startDateISO).getTime();
      const winStartMs = isNaN(startMs) ? Date.now() : startMs;
      const winEndMs = winStartMs + Math.max(1, planDays) * 86400000;
      if (CALCULATOR_FREE_FIRST_ENABLED) {
        const candidateIds = [...corePool, ...neighborPool].map(p => p.id);
        if (candidateIds.length > 0) {
          try {
            const { data: occRows } = await supabase
              .from("campaign_eco_allocations")
              .select("managed_playlist_id, campaigns!inner(status, started_at, simulation_snapshot)")
              .in("managed_playlist_id", candidateIds)
              .in("status", ["pending", "approved", "dispatched"]);
            for (const row of (occRows ?? []) as any[]) {
              const c = row?.campaigns;
              if (!c || !["active", "approved"].includes(c.status)) continue;
              if (!c.started_at) continue;
              const cs = new Date(c.started_at).getTime();
              if (!Number.isFinite(cs)) continue;
              const snap = c.simulation_snapshot ?? {};
              const dd = Math.max(1, Number(snap.effectiveDays ?? snap.days ?? 30));
              const ce = cs + dd * 86400000;
              // overlap test (semi-aberto)
              if (ce <= winStartMs || cs >= winEndMs) continue;
              if (row.managed_playlist_id) occupiedSet.add(row.managed_playlist_id);
            }
          } catch (e) {
            // Degradação segura: sem occupied → comportamento legado.
            console.warn("[Calculadora] FreeFirst: falha ao buscar ocupadas, seguindo sem partição", e);
          }
        }
      }

      const isFreeFirstActive = CALCULATOR_FREE_FIRST_ENABLED && occupiedSet.size > 0;
      let realPlan: ReturnType<typeof planRealCapacity>;
      if (isFreeFirstActive) {
        const coreA = corePool.filter(p => !occupiedSet.has(p.id));
        const coreB = corePool.filter(p => occupiedSet.has(p.id));
        const neighA = neighborPool.filter(p => !occupiedSet.has(p.id));
        const neighB = neighborPool.filter(p => occupiedSet.has(p.id));

        // Fase A: só livres.
        const planA = planRealCapacity(
          [...coreA, ...neighA],
          dailyNeed,
          song.engagementMultiplier ?? 35,
          undefined,
          { mode },
        );
        let combinedAllocs = [...planA.allocations];
        let coveredDaily = planA.coveredDaily;
        let remainingDaily = planA.remaining; // já em escala compensada (×1.15)

        // Fase B: só se ainda faltar gap após esgotar A.
        const stopThresholdCompensated = dailyNeed * ECO_CURVE_LOSS_COMPENSATION * 0.05;
        if (remainingDaily > stopThresholdCompensated && (coreB.length > 0 || neighB.length > 0)) {
          const newDailyNeed = remainingDaily / ECO_CURVE_LOSS_COMPENSATION;
          const planB = planRealCapacity(
            [...coreB, ...neighB],
            newDailyNeed,
            song.engagementMultiplier ?? 35,
            undefined,
            { mode },
          );
          combinedAllocs.push(...planB.allocations);
          coveredDaily += planB.coveredDaily;
          remainingDaily = planB.remaining;
        }

        realPlan = { allocations: combinedAllocs, coveredDaily, remaining: remainingDaily };
        console.info(
          `[Calculadora] FreeFirst ON: grupoA=${coreA.length + neighA.length} (usadas=${planA.allocations.length}) | grupoB=${coreB.length + neighB.length} (usadas=${combinedAllocs.length - planA.allocations.length}) | ocupadas detectadas=${occupiedSet.size}`,
        );
      } else {
        realPlan = planRealCapacity(
          [...corePool, ...neighborPool],
          dailyNeed,
          song.engagementMultiplier ?? 35,
          undefined,
          { mode },
        );
      }

      // Converte RealCapacityAlloc → EcoAllocationPlan. planned_streams usa o
      // multiplicador de plano (rampa) pra bater com o buildEcoPlan do servidor.
      const planMultiplier = ecoPlanTotalMultiplier(planDays);
      const totalAllocs = realPlan.allocations.length;
      const rawAllocations: EcoAllocationPlan[] = realPlan.allocations.map((a, index) => {
        const score = a.source === "neighbor"
          ? (neighborAffinityByPlaylistId?.get(a.id) ?? null)
          : null;
        // Mandelão em Trap menor → posição final (mínimo 6) pra não competir com hits do gênero.
        const isMandelaoTrap = song.isMandelao && mandelaoTrapIds.has(a.id);
        const finalPosition = isMandelaoTrap ? Math.max(a.position, 6) : a.position;
        return {
          managed_playlist_id: a.id,
          planned_streams: Math.max(1, Math.round(a.cap_dia * planMultiplier)),
          start_day: 1 + Math.floor((index / Math.max(1, totalAllocs - 1)) * Math.max(0, Math.min(planDays - 1, Math.ceil(planDays * (r.modo === "sequencial" ? 0.7 : 0.25)) - 1))),
          position: finalPosition,
          genre_source: a.source === "neighbor" ? "affinity" : "primary",
          genre_affinity_score: score,
        };
      });

      // Em vez de dropar allocations com (playlist, posição) já reservadas
      // em campanhas ativas ou rascunhos recentes, DESCE a posição até achar
      // um slot livre (máx pos 20). Mantém a playlist no plano com cap_dia
      // menor — mais realista pra múltiplas campanhas simultâneas no mesmo
      // gênero (ex: 2-4 Funks rodando juntas).
      const MAX_POSITION = 20;
      let descendedCount = 0;
      let droppedCount = 0;
      const allocations: EcoAllocationPlan[] = [];
      for (const a of rawAllocations) {
        const taken = reservedByPlaylist.get(a.managed_playlist_id);
        let pos = a.position;
        if (taken) {
          while (taken.has(pos) && pos < MAX_POSITION) pos += 1;
          if (taken.has(pos)) { droppedCount += 1; continue; }
        }
        if (pos !== a.position) {
          descendedCount += 1;
          // Recalcula cap_dia/planned_streams pro novo slot (posição menor = menos %).
          const followers = compatiblePlaylists.find(p => p.id === a.managed_playlist_id)?.followers ?? 0;
          const newDaily = calculateTrackDailyStreams(followers, song.engagementMultiplier ?? 35, pos);
          allocations.push({ ...a, position: pos, planned_streams: Math.max(1, Math.round(newDaily * planMultiplier)) });
        } else {
          allocations.push(a);
        }
        // Reserva o slot escolhido pra evitar colisão entre allocations desta mesma campanha.
        if (!reservedByPlaylist.has(a.managed_playlist_id)) reservedByPlaylist.set(a.managed_playlist_id, new Set());
        reservedByPlaylist.get(a.managed_playlist_id)!.add(pos);
      }
      if (descendedCount > 0) {
        console.info(`[Calculadora] ${descendedCount} allocations desceram posição por conflito com campanhas ativas`);
      }
      if (droppedCount > 0) {
        console.info(`[Calculadora] Dropped ${droppedCount} allocations (sem slot livre até pos ${MAX_POSITION})`);
      }

      // ─── CLAMP DE OVERSHOOT (Fix #1):
      // O engine define o alvo (r.streamsEco) respeitando split contratado.
      // planRealCapacity preenche cada playlist por cap_dia inteiro e pode
      // ultrapassar o alvo no último item. Aparamos o excedente sem mexer
      // em ranking/seleção/posição: itens anteriores ficam intactos, apenas
      // o item que cruza a fronteira é reduzido pra fechar exatamente o
      // alvo; os subsequentes (excedentes puros) são descartados.
      // Déficit (sum < target) continua permitido — é capacidade real menor
      // que a demanda, problema legítimo que o realign downward já cobre.
      const ecoTarget = Math.max(0, Math.round(r.streamsEco));
      let trimmedCount = 0;
      let trimmedAmount = 0;
      if (ecoTarget > 0) {
        const clamped: EcoAllocationPlan[] = [];
        let acc = 0;
        for (const a of allocations) {
          if (acc >= ecoTarget) {
            trimmedCount += 1;
            trimmedAmount += a.planned_streams;
            continue;
          }
          const room = ecoTarget - acc;
          if (a.planned_streams > room) {
            trimmedAmount += a.planned_streams - room;
            trimmedCount += 1;
            clamped.push({ ...a, planned_streams: room });
            acc = ecoTarget;
          } else {
            clamped.push(a);
            acc += a.planned_streams;
          }
        }
        allocations.length = 0;
        allocations.push(...clamped);
        if (trimmedAmount > 0) {
          console.info(`[Calculadora] clamp overshoot: target=${ecoTarget} aparado=${trimmedAmount} (${trimmedCount} allocations afetadas)`);
        }
      }

      console.info(`[Calculadora] planRealCapacity: ${allocations.length} playlists (modo=${mode}, dailyNeed=${Math.round(dailyNeed)}, coberto=${Math.round(realPlan.coveredDaily)}/dia, primárias=${corePool.length}, vizinhos=${neighborPool.length})`);



      const startD = startOfDay(new Date(song.startDateISO));

      const deadlineISO = addDays(startD, r.days).toISOString().slice(0, 10);

      const { campaignId } = await closeCampaignFromCalculator({
        snapshot,
        deadlineISO,
        allocations,
        engagementMultiplier: song.engagementMultiplier ?? 35,
        clientId: clientId || null,
        curatorId: curatorId || null,
        status: "draft",
        campaignType,
        collectionMode,
      });
      return { ok: true, campaignId, shortfall };
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
      if (res.shortfall) {
        toast({
          title: "Rascunho salvo — eco insuficiente",
          description: `Ecossistema compatível cobre ${formatInt(res.shortfall.capacity)} streams. Faltam ${formatInt(res.shortfall.missing)} — considere subir o externo pra ~${res.shortfall.suggestedExtPct}%.`,
        });
      } else {
        toast({ title: "Rascunho salvo", description: "Revise na aba Aprovação e clique em Aprovar e disparar." });
      }
      navigate(`/campanhas`);
      return;
    }
    removeSong(activeIdx);
    setClosing(false);
    if (res.shortfall) {
      toast({
        title: "Rascunho salvo — eco insuficiente",
        description: `Faltam ${formatInt(res.shortfall.missing)} streams no eco. Sugiro externo ~${res.shortfall.suggestedExtPct}%.`,
      });
    } else {
      toast({ title: "Rascunho salvo" });
    }
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
        <div className="flex flex-col gap-6">
          {/* Duas colunas equilibradas: fonte de coleta + sessão. Alturas casam naturalmente. */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-stretch">
            {/* ─── Fonte de coleta ─── */}
            <Card className="flex flex-col">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <CardTitle className="text-base">Fonte de coleta</CardTitle>
                    <CardDescription className="text-xs mt-1">
                      Como os números entram no sistema durante a campanha.
                    </CardDescription>
                  </div>
                  <Badge variant="outline" className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground border-border/60 shrink-0">
                    Etapa 1
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="pt-0 flex-1 flex flex-col gap-3">
                {([
                  {
                    id: "bot" as const,
                    title: "Spotify",
                    icon: Music,
                    description: "Coleta automática de saves, plays e posição.",
                    tag: "Automático",
                  },
                  {
                    id: "spreadsheet" as const,
                    title: "Excel",
                    icon: FileText,
                    description: "Planilha do curador — playlists fora da rede.",
                    tag: "Manual",
                  },
                ]).map(opt => {
                  const active = collectionMode === opt.id;
                  const Icon = opt.icon;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setCollectionMode(opt.id)}
                      className={cn(
                        "group relative overflow-hidden rounded-xl border px-4 py-4 text-left transition-all duration-200 flex items-start gap-3",
                        active
                          ? "border-primary/50 bg-primary/[0.04] ring-1 ring-primary/30"
                          : "border-border/70 hover:border-foreground/25 hover:bg-accent/20",
                      )}
                    >
                      <span
                        className={cn(
                          "shrink-0 grid place-items-center h-10 w-10 rounded-lg transition-colors",
                          active ? "bg-primary/15 text-primary" : "bg-muted/40 text-muted-foreground group-hover:text-foreground",
                        )}
                      >
                        <Icon className="h-5 w-5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={cn("text-[15px] font-semibold tracking-tight", active ? "text-foreground" : "text-foreground")}>
                            {opt.title}
                          </span>
                          <span className={cn(
                            "text-[10px] uppercase tracking-wider font-medium px-1.5 py-0.5 rounded",
                            active ? "bg-primary/15 text-primary" : "bg-muted/40 text-muted-foreground",
                          )}>
                            {opt.tag}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1 leading-snug">
                          {opt.description}
                        </p>
                      </div>
                      {active && (
                        <CheckCircle2 className="absolute top-3 right-3 h-4 w-4 text-primary" />
                      )}
                    </button>
                  );
                })}
              </CardContent>
            </Card>

            {/* ─── Sessão ─── */}
            <Card className="flex flex-col">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <CardTitle className="text-base">Sessão</CardTitle>
                    <CardDescription className="text-xs mt-1">
                      Valem pra todas as músicas desta sessão.
                    </CardDescription>
                  </div>
                  <Badge variant="outline" className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground border-border/60 shrink-0">
                    Etapa 1
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="pt-0 flex-1 flex flex-col gap-4">
                {/* Cliente — campo ativo */}
                <div className="rounded-xl border border-border/70 bg-background/40 p-4">
                  <div className="flex items-start gap-3">
                    <span className="shrink-0 grid place-items-center h-10 w-10 rounded-lg bg-muted/40 text-muted-foreground">
                      <Users className="h-5 w-5" />
                    </span>
                    <div className="min-w-0 flex-1 space-y-2">
                      <div>
                        <Label className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70 font-medium">
                          Cliente
                        </Label>
                        <p className="text-[11px] text-muted-foreground/70 leading-snug mt-0.5">
                          Dono do plano.
                        </p>
                      </div>
                      <Select value={clientId || "__none__"} onValueChange={v => setClientId(v === "__none__" ? "" : v)}>
                        <SelectTrigger className="h-10 text-sm justify-center sm:justify-between text-muted-foreground data-[state=open]:text-foreground [&>span]:text-muted-foreground sm:[&>span]:text-foreground">
                          <SelectValue placeholder="Selecione um cliente" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">Sem cliente</SelectItem>
                          {clientsList.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>

                {/* Curador — bloco informativo, definido após aprovação */}
                <div className="rounded-xl border border-dashed border-border/60 bg-background/20 p-4">
                  <div className="flex items-start gap-3">
                    <span className="shrink-0 grid place-items-center h-10 w-10 rounded-lg bg-muted/30 text-muted-foreground/70">
                      <Layers className="h-5 w-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Label className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70 font-medium">
                          Curador
                        </Label>
                        <span className="text-[10px] uppercase tracking-wider font-medium px-1.5 py-0.5 rounded bg-muted/40 text-muted-foreground">
                          Pós-aprovação
                        </span>
                      </div>
                      <p className="text-sm text-foreground/85 mt-1.5 leading-snug">
                        Definido após a aprovação do planejamento.
                      </p>
                      <p className="text-[11px] text-muted-foreground/70 leading-snug mt-1">
                        Os curadores serão criados como deals na aba Curadores — um ou vários por música, conforme a divisão real do trabalho.
                      </p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Rodapé de ação — alinhado à direita, texto-guia à esquerda */}
          <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-1">
            <p className="text-xs text-muted-foreground/70">
              Você pode voltar e editar estas escolhas em qualquer momento antes de aprovar o plano.
            </p>
            <Button
              size="lg"
              variant="solid"
              className="sm:min-w-[260px]"
              onClick={() => setStep(2)}
              disabled={!canGoStep2 || (campaignType !== "ecosystem" && !curatorId)}
            >
              Avançar pra Músicas <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          </div>
        </div>
      )}



      {/* ============== STEP 2 — MÚSICAS ============== */}
      {step === 2 && (
        <div className="space-y-5">


          {/* Régua única: sessão + músicas (substitui a antiga trilha horizontal) */}
          <SessionChip
            clientName={clientName}
            curatorName={curatorName}
            onEdit={() => setStep(1)}
            songs={songResults}
            activeIdx={activeIdx}
            setActiveIdx={setActiveIdx}
            addSong={addSong}
            removeSong={removeSong}
            songsCount={songs.length}
            readyCount={readyCount}
          />


          {/* Formulário vertical único — Música → Meta → Estratégia */}
          <div className="space-y-5">
              {/* KPIs SÓ da música ativa (operação atual). */}
              <CalculadoraKpis r={result} pricePerStreamSell={pricingSettings.price_per_stream_sell} />






              {/* Música + Fonte da meta lado a lado (desktop) */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              {/* Música */}
              <Card className="h-full">
                <CardHeader>
                  <CardTitle className="text-sm">Música</CardTitle>
                  <CardDescription>Cole o link do Spotify da faixa.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Input
                    placeholder="Cole o link do Spotify"
                    value={active.trackUrl}
                    onChange={e => { setTrackUrl(e.target.value); setTrack(null); }}
                    onPaste={e => {
                      const pasted = e.clipboardData.getData("text").trim();
                      if (pasted.includes("open.spotify.com")) {
                        e.preventDefault();
                        setTrackUrl(pasted);
                        setTrack(null);
                        setTimeout(() => buscarMusica(pasted), 0);
                      }
                    }}
                    onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); buscarMusica(); } }}
                    onBlur={() => { if (active.trackUrl.trim() && !active.track && !trackLoading) buscarMusica(); }}
                    className="text-center placeholder:text-muted-foreground/40 placeholder:font-normal"
                  />
                  {trackLoading && (
                    <div className="flex items-center justify-center gap-2 text-[11px] text-muted-foreground">
                      <Loader2 className="h-3 w-3 animate-spin" /> Buscando faixa…
                    </div>
                  )}

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

                  {active.track?.id && (
                    <TrackPresencePanel spotifyTrackId={active.track.id} />
                  )}


                  <div className="space-y-1.5 pt-1">
                    <Label className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70 font-medium flex items-center justify-between">
                      <span>
                        Streams/dia atuais <span className="text-destructive normal-case">*</span>
                      </span>
                      {active.track?.streamsDay != null && active.baselineStreamsDay !== active.track.streamsDay && (
                        <button
                          type="button"
                          onClick={() => setBaselineStreamsDay(active.track!.streamsDay!)}
                          className="text-[10px] text-primary hover:underline normal-case tracking-normal"
                        >
                          usar Top 200 ({formatInt(active.track.streamsDay)})
                        </button>
                      )}
                    </Label>
                    <NumberInput value={active.baselineStreamsDay} onChange={setBaselineStreamsDay} placeholder="ex: 20.000" />
                  </div>

                  <div className="space-y-1.5 pt-1">
                    <Label className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70 font-medium">
                      Gênero <span className="normal-case tracking-normal text-muted-foreground/60 font-normal">(filtra playlists na distribuição)</span>
                    </Label>
                    <Select value={active.genre || "__none__"} onValueChange={(v) => setGenre(v === "__none__" ? "" : v)}>
                      <SelectTrigger className="text-muted-foreground/80 [&>span]:flex-1 [&>span]:text-center [&[data-state=closed]>span]:text-muted-foreground/60">
                        <SelectValue placeholder="Selecione o gênero" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">Sem gênero</SelectItem>
                        {GENRE_OPTIONS.map(g => <SelectItem key={g} value={g}>{g}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    {active.genre.toLowerCase().startsWith("funk") && (
                      <label className="mt-2 flex items-start gap-2 rounded-xl border border-border bg-card/40 px-3 py-2.5 cursor-pointer hover:bg-card/70 transition">
                        <input
                          type="checkbox"
                          checked={active.isMandelao}
                          onChange={(e) => patchActive({ isMandelao: e.target.checked })}
                          className="mt-0.5 h-4 w-4 accent-primary cursor-pointer"
                        />
                        <span className="text-xs leading-snug">
                          <span className="font-medium text-foreground">Mandelão</span>
                          <span className="block text-muted-foreground/80 text-[11px] mt-0.5">
                            Bloqueia Trap acima de 30k seguidores. Trap menor entra nas posições finais.
                          </span>
                        </span>
                      </label>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Fonte da meta */}
              <Card className="h-full">
                <CardHeader>
                  <CardTitle className="text-sm">Fonte da meta</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-1 gap-2">
                    <FonteBtn active={active.fonte === "manual"} onClick={() => setFonte("manual")} icon={TargetIcon} label="Manual" />
                    <FonteBtn active={active.fonte === "orcamento"} onClick={() => setFonte("orcamento")} icon={Wallet} label="Orçamento" />
                    <FonteBtn active={active.fonte === "top200"} onClick={() => setFonte("top200")} icon={Table2} label="Top 200" />
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
                      value={active.top200Pos}
                      valueStreamsDay={active.top200StreamsDay}
                      valueChartDate={active.top200ChartDate}
                      onPick={(streamsDay, pos, chartDate) => {
                        patchActive({ top200Pos: pos, top200StreamsDay: streamsDay, top200ChartDate: chartDate });
                        const gapDay = Math.max(0, streamsDay - active.baselineStreamsDay);
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
                  {active.fonte === "orcamento" && (() => {
                    const sell = pricingSettings.price_per_stream_sell;
                    const meta = metaFromBudgetSell(active.budget, sell);
                    const { cost, margin, marginPct } = estimateBudgetMargin(
                      active.budget, meta, active.splitEco, pricingCosts,
                    );
                    return (
                      <div className="space-y-2">
                        <Label className="text-xs">Orçamento disponível (R$)</Label>
                        <NumberInput value={active.budget} onChange={setBudget} placeholder="40.000" />
                        {active.budget > 0 && sell > 0 ? (
                          <div className="rounded-lg border border-border bg-muted/20 px-3 py-2 space-y-1 text-xs">
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">Meta entregável</span>
                              <span className="font-semibold text-foreground tabular-nums">{formatInt(meta)} streams</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">Custo interno estimado</span>
                              <span className="tabular-nums">{formatBRL(cost)}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">Margem estimada</span>
                              <span className={cn("font-semibold tabular-nums", margin >= 0 ? "text-primary" : "text-destructive")}>
                                {formatBRL(margin)} ({marginPct.toFixed(0)}%)
                              </span>
                            </div>
                            <p className="text-[10px] text-muted-foreground pt-1 border-t border-border">
                              Preço de venda: R$ {(sell * 1000).toFixed(0)}/mil · split {active.splitEco}% eco / {100 - active.splitEco}% ext
                            </p>
                          </div>
                        ) : sell <= 0 ? (
                          <p className="text-xs text-destructive">Configure o preço de venda em Financeiro → Pricing antes de usar orçamento.</p>
                        ) : (
                          <p className="text-xs text-muted-foreground">Digite o orçamento pra calcular a meta.</p>
                        )}
                      </div>
                    );
                  })()}
                </CardContent>
              </Card>
              </div>

              {/* Valor cliente removido — preço já vem da tabela definida em Financeiro */}





              {/* Estratégia */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Estratégia</CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div>
                    <Label className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70 font-medium">Janela da campanha</Label>
                    <div className="grid grid-cols-2 gap-3 mt-2">
                      <div className="space-y-1.5">
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70 pl-1">Início</span>
                        <Popover>
                          <PopoverTrigger asChild>
                            <Button variant="outline" className="w-full justify-center text-center font-normal h-10 text-sm">
                              <CalendarIcon className="h-3.5 w-3.5 mr-2 opacity-60" />
                              {format(startDate, "dd MMM yyyy", { locale: ptBR })}
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
                      </div>
                      <div className="space-y-1.5">
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70 pl-1">Fim</span>
                        <Popover>
                          <PopoverTrigger asChild>
                            <Button variant="outline" className="w-full justify-center text-center font-normal h-10 text-sm">
                              <CalendarIcon className="h-3.5 w-3.5 mr-2 opacity-60" />
                              {format(endDate, "dd MMM yyyy", { locale: ptBR })}
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
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-2">
                      {active.days} dias · começa {format(startDate, "dd/MM", { locale: ptBR })} · termina {format(endDate, "dd/MM", { locale: ptBR })}
                    </p>
                  </div>

                  <div>
                    <Label className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70 font-medium">Duração <span className="text-muted-foreground/60 normal-case tracking-normal">· {active.days} dias</span></Label>
                    <Slider value={[active.days]} onValueChange={([v]) => setDays(v)} min={15} max={180} step={5} className="mt-3" />
                  </div>

                  {/* Modo (sempre simultâneo) e Perfil (sempre mercado) — fixados como default no automático */}


                  <div>
                    <Label className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70 font-medium">Capacidade das playlists</Label>
                    <div className="flex flex-wrap items-center gap-2 mt-2">
                      {ENGAGEMENT_PRESETS.map(p => (
                        <button
                          key={p}
                          type="button"
                          onClick={() => setEngagementMultiplier(p)}
                          className={cn(
                            "h-9 px-3.5 rounded-md text-xs font-medium tabular-nums border transition-colors",
                            (active.engagementMultiplier ?? 35) === p
                              ? "bg-primary text-primary-foreground border-primary"
                              : "border-border text-muted-foreground hover:text-foreground hover:bg-elevated/60",
                          )}
                        >
                          ×{p}
                        </button>
                      ))}
                      <Input
                        type="number"
                        min={1}
                        max={200}
                        value={active.engagementMultiplier ?? 35}
                        onChange={(e) => setEngagementMultiplier(Number(e.target.value))}
                        className="h-9 w-20 text-xs tabular-nums text-center"
                      />
                    </div>
                  </div>


                  <div>
                    <Label className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70 font-medium">Perfil do cliente</Label>
                    <div className="grid grid-cols-2 gap-2 mt-1.5">
                      <ModeBtn
                        active={active.clientProfile === "artista"}
                        onClick={() => setClientProfile("artista")}
                        label="Artista / Empresário"
                        tooltip="Meta contratada inclui o orgânico estimado. Eco+curadores cobrem só a meta operacional (meta − orgânico). Custo cai proporcionalmente."
                      />
                      <ModeBtn
                        active={active.clientProfile === "gravadora"}
                        onClick={() => setClientProfile("gravadora")}
                        label="Gravadora"
                        tooltip="Meta contratada é só pago. Eco+curadores cobrem a meta inteira; orgânico vem como bônus em cima. Custo calculado sobre a meta cheia."
                      />
                    </div>
                  </div>

                  <div style={{ ["--primary" as string]: "210 90% 60%" } as React.CSSProperties}>
                    <Label className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70 font-medium">
                      Rádio Spotify <span className="text-muted-foreground/60 normal-case tracking-normal">· {active.splitOrganic}%</span>
                    </Label>
                    <Slider value={[active.splitOrganic]} onValueChange={([v]) => setSplitOrganic(v)} min={0} max={50} step={5} className="mt-2" />
                    <p className="text-[11px] text-muted-foreground mt-1.5">
                      {active.clientProfile === "artista"
                        ? `Reservamos ${active.splitOrganic}% da meta como entrega de rádio Spotify esperada. Eco+externo cobrem ${100 - active.splitOrganic}%.`
                        : `Estimativa de bônus de rádio Spotify ${active.splitOrganic}% em cima da meta paga (não reduz custo).`}
                    </p>
                  </div>

                  {/* DISTRIBUIÇÃO DA CAMPANHA — 3 canais reais (Eco / Curadores / Rádio).
                      "Curadores" = bucket interno streamsExt (mantido por compatibilidade
                      no engine; nomenclatura operacional alinhada à realidade). */}
                  {(() => {
                    const meta = result.meta || 0;
                    const eco = result.streamsEco || 0;
                    const curadores = result.streamsExt || 0;
                    const radio = result.streamsOrganic || 0;
                    const pct = (n: number) => (meta > 0 ? Math.round((n / meta) * 100) : 0);
                    const total = eco + curadores + radio;
                    const channels = [
                      { key: "eco", label: "Eco", v: eco, p: pct(eco), dot: "bg-primary" },
                      { key: "cur", label: "Curadores", v: curadores, p: pct(curadores), dot: "bg-amber-500" },
                      { key: "rad", label: "Rádio", v: radio, p: pct(radio), dot: "bg-blue-500" },
                    ];
                    return (
                      <div className="rounded-xl border border-border bg-card/40 px-4 py-4 space-y-4">
                        <div className="flex items-baseline justify-between">
                          <div>
                            <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground/80 font-medium">
                              Distribuição da campanha
                            </div>
                            <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground/60 mt-1">Meta total</div>
                          </div>
                          <div className="text-[28px] font-semibold tabular-nums leading-none text-foreground">
                            {formatCompact(meta)}
                          </div>
                        </div>
                        <div className="h-2 rounded-full bg-muted/40 overflow-hidden flex">
                          {channels.map(c => c.v > 0 && (
                            <div key={c.key} className={cn("h-full", c.dot)} style={{ width: `${c.p}%` }} />
                          ))}
                        </div>
                        <div className="grid grid-cols-3 gap-3">
                          {channels.map(c => (
                            <div key={c.key} className="flex flex-col gap-1">
                              <div className="flex items-center gap-1.5">
                                <span className={cn("h-2 w-2 rounded-full", c.dot)} />
                                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{c.label}</span>
                              </div>
                              <div className="text-[17px] font-semibold tabular-nums leading-none text-foreground">{formatCompact(c.v)}</div>
                              <div className="text-[11px] tabular-nums text-muted-foreground">{c.p}%</div>
                            </div>
                          ))}
                        </div>
                        <div className="flex items-baseline justify-between pt-3 border-t border-border/40">
                          <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">Total</span>
                          <span className="text-[13px] font-medium tabular-nums text-foreground">
                            {formatCompact(total)} <span className="text-muted-foreground">· 100%</span>
                          </span>
                        </div>
                      </div>
                    );
                  })()}




                  <div>
                    <Label className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70 font-medium">Playlists próprias × Curadores <span className="text-muted-foreground/60 normal-case tracking-normal">· {active.splitEco}% próprias · {100 - active.splitEco}% curadores</span></Label>
                    <Slider value={[active.splitEco]} onValueChange={([v]) => setSplitEco(v)} min={0} max={100} step={5} className="mt-2" />
                    <div className="text-[11px] text-muted-foreground mt-1.5 flex justify-between">
                      <span>Próprias R$ {(pricingCosts.eco * 1000).toFixed(0)}/mil</span>
                      <span>Curadores R$ {(pricingCosts.ext * 1000).toFixed(0)}/mil</span>
                    </div>

                    {/* Capacidade real do eco vs. o que o split exige */}
                    {ecoCap.loading ? (
                      <div className="mt-3 text-[11px] text-muted-foreground flex items-center gap-2">
                        <Loader2 className="h-3 w-3 animate-spin" /> Medindo capacidade do ecossistema…
                      </div>
                    ) : !active.genre ? (
                      <div className="mt-3 rounded-md border border-border/60 bg-muted/10 px-2.5 py-2 text-[11px] text-muted-foreground">
                        Escolha o gênero da música pra ver quanto o ecossistema aguenta.
                      </div>
                    ) : ecoCap.capacityTotal === 0 ? (
                      <div className="mt-3 rounded-md border border-destructive/40 bg-destructive/5 px-2.5 py-2 text-[11px] text-destructive">
                        Sem playlists compatíveis com "{active.genre}". Toda a meta vai precisar vir dos curadores.
                      </div>
                    ) : (
                      <div className={cn(
                        "mt-3 rounded-lg border px-3.5 py-3",
                        ecoOverflow
                          ? "border-destructive/50 bg-destructive/5"
                          : ecoUsagePct >= 90
                            ? "border-amber-500/40 bg-amber-500/5"
                            : "border-primary/30 bg-primary/5",
                      )}>
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-muted-foreground uppercase tracking-wide">
                            Capacidade eco · {active.genre}
                            {ecoCap.neighborCount > 0 && (
                              <span className="text-muted-foreground/70 normal-case tracking-normal"> (+{ecoCap.neighborCount} vizinhos)</span>
                            )}
                          </span>
                          <span className={cn(
                            "font-medium tabular-nums",
                            ecoOverflow ? "text-destructive" : ecoUsagePct >= 90 ? "text-amber-600 dark:text-amber-400" : "text-primary",
                          )}>
                            {ecoUsagePct}% usado
                          </span>
                        </div>
                        {(() => {
                          const days = result.effectiveDays || 1;
                          const ecoPerDay = Math.round(result.streamsEco / days);
                          const extPerDay = Math.round(result.streamsExt / days);
                          const organicPct = active.splitOrganic ?? 0;
                          const ecoRealPct = Math.round(result.splitEcoPct * (1 - organicPct / 100));
                          const extRealPct = Math.max(0, 100 - ecoRealPct - organicPct);
                          const genreLabel = ecoCap.neighborCount > 0
                            ? `${active.genre}+vizinhos`
                            : active.genre;
                          const Card = ({ label, total, pct, perDay, sub, accent }: {
                            label: string;
                            total: string;
                            pct?: string;
                            perDay?: string;
                            sub?: string;
                            accent?: string;
                          }) => (
                            <div className="flex flex-col gap-1 rounded-md border border-border/40 bg-background/40 px-3 py-2.5 min-w-0">
                              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
                              <span className={cn("text-[18px] font-semibold tabular-nums leading-none", accent)}>{total}</span>
                              <div className="flex items-baseline justify-between gap-2 text-[11px] text-muted-foreground/80 tabular-nums">
                                {pct && <span>{pct}</span>}
                                {perDay && <span className="font-medium text-muted-foreground">{perDay}</span>}
                              </div>
                              {sub && <span className="text-[10px] text-muted-foreground/60 truncate">{sub}</span>}
                            </div>
                          );
                          const totalPerDay = ecoPerDay + extPerDay + (result.streamsOrganic > 0 ? Math.round(result.streamsOrganic / days) : 0);
                          return (
                            <div className="mt-2 space-y-2">
                              <div className="rounded-md border border-border/40 bg-background/40 px-3 py-2.5">
                                <div className="flex items-baseline justify-between gap-3">
                                  <div className="flex flex-col min-w-0">
                                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Meta contratada</span>
                                    {result.streamsOrganic > 0 && (
                                      <span className="text-[10px] text-muted-foreground/70 mt-0.5">
                                        operacional (eco+curadores): <span className="tabular-nums text-muted-foreground">{formatCompact(result.metaOperacional)}</span>
                                      </span>
                                    )}
                                  </div>
                                  <span className="text-[20px] font-semibold tabular-nums text-foreground leading-none">{formatCompact(result.meta)}</span>
                                </div>
                                <div className="flex items-baseline justify-between gap-2 pt-2 mt-2 border-t border-border/30 text-[11px]">
                                  <span className="text-muted-foreground">Ritmo total necessário</span>
                                  <span className="tabular-nums font-medium text-foreground">{formatCompact(totalPerDay)}/dia · {days}d</span>
                                </div>
                              </div>
                              <div className={cn(
                                "grid gap-2",
                                result.streamsOrganic > 0 ? "grid-cols-3" : "grid-cols-2",
                              )}>
                                <Card
                                  label="Eco"
                                  total={formatCompact(result.streamsEco)}
                                  pct={ecoRealPct > 0 ? `${ecoRealPct}%` : undefined}
                                  perDay={`${formatCompact(ecoPerDay)}/dia`}
                                  sub={`${ecoCap.playlistsSelected != null ? `${ecoCap.playlistsSelected} de ${ecoCap.playlistCount}` : `${ecoCap.playlistCount}`} pl · ${genreLabel}`}
                                />
                                <Card
                                  label="Curadores"
                                  total={formatCompact(result.streamsExt)}
                                  pct={extRealPct > 0 ? `${extRealPct}%` : undefined}
                                  perDay={`${formatCompact(extPerDay)}/dia`}
                                  sub="em deals"
                                />
                                {result.streamsOrganic > 0 && (
                                  <Card
                                    label="Rádio"
                                    total={formatCompact(result.streamsOrganic)}
                                    pct={`${organicPct}%`}
                                    perDay={`${formatCompact(Math.round(result.streamsOrganic / days))}/dia`}
                                    sub={active.clientProfile === "gravadora" ? "Spotify · bônus" : "Spotify"}
                                  />
                                )}
                              </div>
                            </div>
                          );
                        })()}



                        {ecoOverflow && suggestedEcoPct != null && (
                          <div className="flex items-center justify-between gap-2 pt-1 border-t border-destructive/20">
                            <span className="text-[11px] text-destructive flex items-center gap-1">
                              <AlertTriangle className="h-3 w-3" />
                              Faltam {formatInt(ecoNeeded - ecoCap.capacityTotal)} — sobe pros curadores
                            </span>
                            <button
                              type="button"
                              onClick={() => setSplitEco(suggestedEcoPct)}
                              className="text-[11px] font-medium text-primary hover:underline whitespace-nowrap"
                            >
                              Aplicar {suggestedEcoPct}/{suggestedExtPct}
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    {/* NOVO: capacidade REAL entregável (algoritmo por dailyNeed,
                        idêntico ao replan-campaign-eco / approve-campaign-plan).
                        Mostra exatamente o que o sistema vai entregar — operador
                        pode negociar com o cliente em cima do número real. */}
                    <CapacidadeRealCard
                      genre={active.genre}
                      dailyNeed={result.effectiveDays > 0 ? Math.round(result.streamsEco / result.effectiveDays) : 0}
                      multiplier={active.engagementMultiplier ?? 35}
                      clientProfile={active.clientProfile}
                    />
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
          <SessionChip
            clientName={clientName}
            curatorName={curatorName}
            onEdit={() => setStep(1)}
            songs={songResults}
            activeIdx={activeIdx}
            setActiveIdx={setActiveIdx}
            addSong={addSong}
            removeSong={removeSong}
            songsCount={songs.length}
            readyCount={readyCount}
          />


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
              <CardDescription className="text-xs">Toque numa linha pra editar a música.</CardDescription>
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
          <div className="flex flex-col gap-3 pt-1 sm:flex-row sm:items-center sm:justify-between">
            <Button variant="ghost" onClick={() => setStep(2)} className="self-start sm:self-auto">
              <ArrowLeft className="h-4 w-4 mr-2" /> Voltar pra músicas
            </Button>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              {onContinue ? (
                <Button
                  size="lg"
                  className="w-full sm:w-auto"
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
                    className="w-full sm:w-auto"
                  >
                    {closing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FileText className="h-4 w-4 mr-2" />}
                    Salvar só ativa
                  </Button>
                  <Button
                    size="lg"
                    variant="solid"
                    onClick={fecharTodas}
                    disabled={closing || readyCount === 0}
                    className="w-full sm:w-auto"
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
        <DialogContent className="max-w-5xl max-h-[85vh] flex flex-col p-0 gap-0">
          <DialogHeader className="px-6 pt-6 pb-3 border-b border-border shrink-0">
            <DialogTitle>Top 200 BR</DialogTitle>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-y-auto nx-scroll px-6 py-4">
            <Top200Tab onPick={(streamsDay) => {
              patchActive({ fonte: "manual", meta: streamsDay * active.days });
              setTop200Open(false);
            }} />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Régua compacta: sessão (cliente/curador) + chips de músicas + botão "nova música" + editar. */
function SessionChip({
  clientName, curatorName, onEdit,
  songs, activeIdx, setActiveIdx, addSong, removeSong, songsCount, readyCount,
}: {
  clientName: string;
  curatorName: string;
  onEdit: () => void;
  songs: Array<{ song: any; ready: boolean; r: any }>;
  activeIdx: number;
  setActiveIdx: (i: number) => void;
  addSong: () => void;
  removeSong: (idx: number) => void;
  songsCount: number;
  readyCount: number;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-border border-l-2 border-l-primary/60 bg-card/60 px-3 py-2.5">
      {/* Bloco sessão (compacto) */}
      <div className="flex items-center gap-3 shrink-0 text-xs">
        <div className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" aria-hidden />
          <span className="text-[10px] uppercase tracking-[0.14em] font-semibold text-primary">Sessão</span>
        </div>
        <div className="h-8 w-px bg-border" />
        <div className="min-w-0">
          <div className="text-[9px] uppercase tracking-wider text-muted-foreground leading-none mb-1">Cliente</div>
          <div className="text-xs font-medium truncate text-foreground leading-tight max-w-[120px]">{clientName}</div>
        </div>
        <div className="h-8 w-px bg-border" />
        <div className="min-w-0">
          <div className="text-[9px] uppercase tracking-wider text-muted-foreground leading-none mb-1">Curador</div>
          <div className="text-xs font-medium truncate text-foreground leading-tight max-w-[120px]">{curatorName}</div>
        </div>
        <Button variant="ghost" size="sm" onClick={onEdit} className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground">
          <Pencil className="h-3 w-3" />
        </Button>
      </div>


      {/* Chips de músicas + nova */}
      <div className="flex items-center gap-1.5 flex-1 min-w-full sm:min-w-0 basis-full sm:basis-auto overflow-x-auto nx-scroll sm:border-l sm:border-border sm:pl-3">
        <span className="text-[9px] uppercase tracking-wider text-muted-foreground shrink-0 mr-1">
          Músicas <span className="text-foreground font-medium">({songsCount})</span>
          {readyCount > 0 && <span className="text-primary ml-1">· {readyCount} ok</span>}
        </span>
        {songs.map((x, idx) => {
          const isActive = idx === activeIdx;
          const label = x.song.track?.title ?? "Em preparação";
          return (
            <div
              key={x.song.uid}
              className={cn(
                "group relative flex-1 min-w-[120px] max-w-[280px] inline-flex items-center gap-1.5 rounded-md border pl-2 pr-1.5 py-1 text-xs transition-colors",
                isActive
                  ? "border-primary/60 bg-primary/5 text-foreground"
                  : "border-border bg-card hover:border-border/80 text-muted-foreground hover:text-foreground",
              )}
            >
              <button onClick={() => setActiveIdx(idx)} className="inline-flex items-center gap-1.5 flex-1 min-w-0">
                <span className="text-[10px] font-semibold tabular-nums opacity-70 shrink-0">#{idx + 1}</span>
                <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", x.ready ? "bg-primary" : "bg-muted-foreground/30")} />
                <span className="truncate flex-1 text-left">{label}</span>
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); removeSong(idx); }}
                className="ml-0.5 h-4 w-4 shrink-0 inline-flex items-center justify-center text-muted-foreground/60 hover:text-foreground rounded opacity-0 group-hover:opacity-100 transition-opacity"
                aria-label="Remover música"
              >
                <X className="h-3 w-3" />
              </button>
            </div>

          );
        })}
        <button
          onClick={addSong}
          className="shrink-0 inline-flex items-center gap-1 rounded-md border border-dashed border-border/60 hover:border-primary/40 hover:bg-muted/20 px-2 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <Plus className="h-3 w-3" /> Nova
        </button>
      </div>
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

function ModeBtn({ active, onClick, label, hint, tooltip }: { active: boolean; onClick: () => void; label: string; hint?: string; tooltip?: string }) {
  const btn = (
    <button
      onClick={onClick}
      className={cn(
        "h-12 rounded-lg border text-xs font-medium transition-colors px-2 w-full",
        active ? "border-primary bg-primary/10 text-primary"
               : "border-border hover:border-foreground/30 text-muted-foreground hover:text-foreground",
      )}
    >
      <div>{label}</div>
      {hint && <div className="text-[10px] opacity-70">{hint}</div>}
    </button>
  );
  if (!tooltip) return btn;
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>{btn}</TooltipTrigger>
        <TooltipContent side="top" className="max-w-[260px] text-xs leading-relaxed">
          {tooltip}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
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
      className="text-center placeholder:text-muted-foreground/40 placeholder:font-normal placeholder:tracking-normal tabular-nums"
    />
  );
}

function Top200Picker({
  days, currentStreamsDay = 0, value, valueStreamsDay, valueChartDate, onPick, onOpenList,
}: {
  days: number;
  currentStreamsDay?: number;
  value?: number | null;
  valueStreamsDay?: number | null;
  valueChartDate?: string | null;
  onPick: (streamsDay: number, position: number, chartDate: string) => void;
  onOpenList: () => void;
}) {
  const pos = value ?? null;
  const posStreamsDay = valueStreamsDay ?? null;
  const chartDate = valueChartDate ?? null;
  const [loading, setLoading] = useState(false);

  async function handlePick(p: number) {
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
      onPick(Number(data.streams_day), p, data.chart_date);
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
