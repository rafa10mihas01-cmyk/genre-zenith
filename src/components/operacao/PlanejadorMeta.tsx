import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { formatNumber } from "@/lib/format";
import { Target, Info, Sparkles, ListMusic, AlertTriangle, CheckCircle2, XCircle, ChevronDown, Music2, Loader2, Send, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { getPositionPct } from "@/lib/campaignOperationalPlan";
import { getErrorMessage } from "@/lib/errors";

// Extrai spotify_track_id de URL/URI do Spotify
function extractTrackId(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  const m = s.match(/track[/:]([A-Za-z0-9]{15,})/);
  if (m) return m[1];
  if (/^[A-Za-z0-9]{15,}$/.test(s)) return s;
  return null;
}

type ApplyResult = { playlist_id: string; name?: string; status: "added" | "moved" | "skip" | "error"; message?: string };


/**
 * PLANEJADOR DE META — Simulador teórico isolado.
 * NÃO altera cérebro, scores, health, capacity real, analytics ou automações.
 * Apenas lê followers/genre/tracks_count e aplica curva teórica de mercado.
 */

type Playlist = {
  id: string;
  name: string;
  cover_url: string | null;
  followers: number;
  tracks_count: number;
  genre_id: string | null;
  genre_name: string | null;
};

type Genre = { id: string; nome: string };

// Perfis teóricos: plays/save ativo por mês
const PROFILES = [
  { id: "mercado", label: "Mercado", mult: 30, hint: "comportamento médio" },
  { id: "engajado", label: "Engajado", mult: 45, hint: "audiência aquecida" },
  { id: "frio", label: "Frio", mult: 18, hint: "playlist passiva" },
] as const;

// % de tráfego diário por posição — usa a curva canônica de @/lib/campaignOperationalPlan
// (verdade única do sistema; não duplicar valores aqui).
const posPct = getPositionPct;

type Slot = {
  playlistId: string;
  playlistName: string;
  cover: string | null;
  position: number;
  playsDay: number;
  playsMonth: number;
  band: "top" | "mid" | "low";
};

type Intensity = "leve" | "normal" | "forte" | "maximo";

type PlanResult = {
  slots: Slot[];
  naturalCapacity: number; // capacidade total do modo escolhido
  baselineCapacity: number; // capacidade natural no modo "normal" (referência de mercado)
  maxCapacity: number;      // teto absoluto do nicho (modo "maximo")
  delivered: number;
  deficit: number;
  surplus: number;
  intensity: Intensity;
};

// Mix de posições por intensidade. Mais pressão = posições melhores em mais playlists.
// Cada playlist segue 1 vez (1 música por playlist), mas escolhemos a posição da curva.
const INTENSITY_MODES: Record<Intensity, {
  topShare: number; midShare: number; // resto = low
  topPos: number[]; midPos: number[]; lowPos: number[];
}> = {
  leve:    { topShare: 0.15, midShare: 0.30, topPos: [4, 5],          midPos: [8, 9, 10],          lowPos: [12, 14, 15, 16, 17, 18] },
  normal:  { topShare: 0.30, midShare: 0.40, topPos: [2, 3, 4, 5],    midPos: [6, 7, 8, 9, 10],    lowPos: [11, 12, 13, 14, 15, 16, 17, 18] },
  forte:   { topShare: 0.55, midShare: 0.35, topPos: [2, 3, 4],       midPos: [5, 6, 7, 8],        lowPos: [9, 10, 11, 12] },
  maximo:  { topShare: 0.80, midShare: 0.20, topPos: [2, 3],          midPos: [4, 5, 6],           lowPos: [7, 8, 9] },
};

type Candidate = { p: Playlist; pos: number; cap: number; band: "top" | "mid" | "low" };

function buildCandidates(pool: Playlist[], multiplier: number, mode: Intensity): Candidate[] {
  const m = INTENSITY_MODES[mode];
  const total = pool.length;
  const topCount = Math.max(1, Math.round(total * m.topShare));
  const midCount = Math.max(0, Math.round(total * m.midShare));
  return pool.map((p, i) => {
    let bandPos: number[]; let band: "top" | "mid" | "low";
    if (i < topCount) { bandPos = m.topPos; band = "top"; }
    else if (i < topCount + midCount) { bandPos = m.midPos; band = "mid"; }
    else { bandPos = m.lowPos; band = "low"; }
    const idxInBand = band === "top" ? i : band === "mid" ? i - topCount : i - topCount - midCount;
    const pos = bandPos[idxInBand % bandPos.length];
    const dailyTotal = (p.followers * multiplier) / 30;
    const cap = Math.round(dailyTotal * posPct(pos));
    return { p, pos, cap, band };
  });
}

function planDistribution(opts: {
  playlists: Playlist[];
  dailyTarget: number;
  multiplier: number;
  days: number;
}): PlanResult {
  const { playlists, dailyTarget, multiplier } = opts;
  const empty: PlanResult = {
    slots: [], naturalCapacity: 0, baselineCapacity: 0, maxCapacity: 0,
    delivered: 0, deficit: dailyTarget, surplus: 0, intensity: "normal",
  };
  if (!playlists.length || dailyTarget <= 0) return empty;

  const pool = playlists.filter(p => p.followers > 0).slice().sort((a, b) => b.followers - a.followers);
  if (!pool.length) return empty;

  // Capacidades de referência
  const baselineCands = buildCandidates(pool, multiplier, "normal");
  const baselineCapacity = baselineCands.reduce((s, c) => s + c.cap, 0);
  const maxCands = buildCandidates(pool, multiplier, "maximo");
  const maxCapacity = maxCands.reduce((s, c) => s + c.cap, 0);

  // Escolhe a menor intensidade cuja capacidade já cobre a meta (entrega sem forçar).
  // Se nem o "maximo" cobre, usa "maximo" e expõe déficit.
  const order: Intensity[] = ["leve", "normal", "forte", "maximo"];
  let chosen: Intensity = "maximo";
  let chosenCands: Candidate[] = maxCands;
  let chosenCap = maxCapacity;
  for (const mode of order) {
    const cands = mode === "normal" ? baselineCands : mode === "maximo" ? maxCands : buildCandidates(pool, multiplier, mode);
    const cap = cands.reduce((s, c) => s + c.cap, 0);
    if (cap >= dailyTarget) {
      chosen = mode; chosenCands = cands; chosenCap = cap; break;
    }
  }

  // Distribuição: usa capacidade natural do modo até bater meta; última entra parcial se passar.
  const slots: Slot[] = [];
  let remaining = dailyTarget;
  for (const c of chosenCands) {
    if (c.cap <= 0) continue;
    if (remaining <= 0) break;
    const take = Math.min(c.cap, remaining);
    if (take < 1) continue;
    slots.push({
      playlistId: c.p.id, playlistName: c.p.name, cover: c.p.cover_url,
      position: c.pos, playsDay: take, playsMonth: take * 30, band: c.band,
    });
    remaining -= take;
  }

  const delivered = slots.reduce((s, x) => s + x.playsDay, 0);
  const deficit = Math.max(0, dailyTarget - delivered);
  const surplus = Math.max(0, chosenCap - delivered);

  return {
    slots, naturalCapacity: chosenCap, baselineCapacity, maxCapacity,
    delivered, deficit, surplus, intensity: chosen,
  };
}

const INTENSITY_LABEL: Record<Intensity, { label: string; hint: string; tone: "ok" | "warn" | "bad" }> = {
  leve:   { label: "Leve",     hint: "campanha tranquila — posições naturais baixas/médias", tone: "ok" },
  normal: { label: "Natural",  hint: "mix de mercado — topo, meio e cauda equilibrados", tone: "ok" },
  forte:  { label: "Forte",    hint: "puxando posições melhores em mais playlists", tone: "warn" },
  maximo: { label: "Máximo",   hint: "ecossistema no teto — todas em posições altas", tone: "bad" },
};

function calcIndicators(slots: Slot[], dailyTarget: number, totalPlaylists: number) {
  const delivered = slots.reduce((s, x) => s + x.playsDay, 0);
  const coverage = dailyTarget > 0 ? Math.min(delivered / dailyTarget, 1) : 0;

  // Concentração: % do top 1 vs total
  const top = [...slots].sort((a, b) => b.playsDay - a.playsDay)[0]?.playsDay ?? 0;
  const concentration = delivered > 0 ? top / delivered : 0;

  // Diversidade: # playlists únicas / # slots
  const uniques = new Set(slots.map(s => s.playlistId)).size;
  const diversity = slots.length > 0 ? uniques / slots.length : 0;

  // Naturalidade: balanceamento entre bands (top / mid / low)
  const bands = { top: 0, mid: 0, low: 0 };
  slots.forEach(s => { bands[s.band] += s.playsDay; });
  const ideal = delivered / 3;
  const dev = (Math.abs(bands.top - ideal) + Math.abs(bands.mid - ideal) + Math.abs(bands.low - ideal)) / (delivered || 1);
  const naturalness = Math.max(0, 1 - dev / 2);

  // Saturação: % das playlists do nicho efetivamente usadas
  const saturation = totalPlaylists > 0 ? uniques / totalPlaylists : 0;

  // Risco: combina coverage baixo + concentração alta + saturação alta
  let risk: "baixo" | "medio" | "alto" = "baixo";
  if (coverage < 0.6 || concentration > 0.4 || saturation > 0.85) risk = "alto";
  else if (coverage < 0.85 || concentration > 0.25 || saturation > 0.6) risk = "medio";

  return { delivered, coverage, concentration, diversity, naturalness, saturation, risk };
}

export type PlanejadorInitial = {
  meta?: number;
  days?: number;
  profile?: "mercado" | "engajado" | "frio";
  trackUrl?: string;
  fonteLabel?: string; // ex: "Herdado do plano financeiro"
};

export function PlanejadorMeta({ initial }: { initial?: PlanejadorInitial } = {}) {
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [genres, setGenres] = useState<Genre[]>([]);
  const [loading, setLoading] = useState(true);

  const [meta, setMeta] = useState<number>(initial?.meta ?? 10_000_000);
  const [days, setDays] = useState<number>(initial?.days ?? 30);
  const [genreId, setGenreId] = useState<string>("");
  const [profile, setProfile] = useState<typeof PROFILES[number]["id"]>(initial?.profile ?? "mercado");

  // Aplicar música real
  const [trackInput, setTrackInput] = useState(initial?.trackUrl ?? "");
  const trackId = useMemo(() => extractTrackId(trackInput), [trackInput]);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [applying, setApplying] = useState(false);
  const [results, setResults] = useState<ApplyResult[] | null>(null);
  const herdado = !!initial;

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [pl, gr] = await Promise.all([
        supabase
          .from("managed_playlists")
          .select("id, name, cover_url, followers, tracks_count, genre_id, archived_at")
          .is("archived_at", null),
        supabase.from("genres").select("id, nome").order("nome"),
      ]);
      const genreMap = new Map(((gr.data ?? []) as any[]).map(g => [g.id, g.nome]));
      setGenres((gr.data ?? []) as any[]);
      setPlaylists(((pl.data ?? []) as any[]).map(d => ({
        id: d.id,
        name: d.name,
        cover_url: d.cover_url,
        followers: d.followers ?? 0,
        tracks_count: d.tracks_count ?? 0,
        genre_id: d.genre_id,
        genre_name: d.genre_id ? (genreMap.get(d.genre_id) ?? null) : null,
      })));
      setLoading(false);
    })();
  }, []);

  const filtered = useMemo(() => {
    if (!genreId) return playlists;
    return playlists.filter(p => p.genre_id === genreId);
  }, [playlists, genreId]);

  const profileObj = PROFILES.find(p => p.id === profile)!;
  const dailyTarget = days > 0 ? Math.ceil(meta / days) : 0;

  const plan = useMemo(
    () => planDistribution({
      playlists: filtered,
      dailyTarget,
      multiplier: profileObj.mult,
      days,
    }),
    [filtered, dailyTarget, profileObj.mult, days],
  );
  const slots = plan.slots;

  const slotKey = (s: Slot) => `${s.playlistId}-${s.position}`;
  const activeSlots = useMemo(
    () => slots.filter((s) => !excluded.has(slotKey(s))),
    [slots, excluded],
  );
  const toggleSlot = (key: string) => {
    setExcluded(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };
  // reset excluídos quando plano muda
  useEffect(() => { setExcluded(new Set()); setResults(null); }, [slots.length, genreId, profile, dailyTarget]);

  const applyPlan = async () => {
    if (!trackId) {
      toast({ title: "Cole o link da música do Spotify", variant: "destructive" });
      return;
    }
    if (activeSlots.length === 0) {
      toast({ title: "Nenhuma playlist selecionada", variant: "destructive" });
      return;
    }
    setApplying(true);
    setResults(null);
    try {
      const payload = activeSlots.map(s => ({ playlist_id: s.playlistId, position: s.position }));
      const { data, error } = await supabase.functions.invoke("apply-meta-plan", {
        body: { spotify_track_id: trackId, slots: payload },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "falha ao aplicar");
      setResults(data.results ?? []);
      const c = data.counts ?? {};
      toast({
        title: "Plano aplicado",
        description: `Adicionada: ${c.added ?? 0} · Movida: ${c.moved ?? 0} · Pulada: ${c.skip ?? 0} · Erro: ${c.error ?? 0}`,
      });
    } catch (e: unknown) {
      toast({ title: "Erro ao aplicar plano", description: getErrorMessage(e) , variant: "destructive" });
    } finally {
      setApplying(false);
    }
  };

  const ind = useMemo(() => calcIndicators(slots, dailyTarget, filtered.length), [slots, dailyTarget, filtered.length]);


  return (
    <section className="space-y-8 animate-tab-in">
      {/* ───────────── ETAPA 1 — OBJETIVO DA CAMPANHA ───────────── */}
      <Stage
        number={1}
        title="Objetivo da campanha"
        subtitle="Defina o destino: meta, prazo, nicho e perfil de audiência."
      >
        {herdado ? (
          <div className="nx-card flex items-center justify-between gap-3 border-primary/30 bg-primary/5">
            <div className="flex items-center gap-2 text-sm">
              <Target className="h-4 w-4 text-primary" />
              <span className="text-muted-foreground">Fonte da meta:</span>
              <span className="font-semibold text-foreground">{initial?.fonteLabel ?? "Herdado do plano financeiro"}</span>
            </div>
            <span className="text-[11px] text-muted-foreground">Edite abaixo se precisar ajustar</span>
          </div>
        ) : (
          <div className="nx-card space-y-3">
            <div className="flex items-center gap-2">
              <Target className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold">Fonte da meta</h3>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <SourcePill active label="Manual" hint="você define o número" />
              <SourcePill label="Top 200 Spotify" hint="em breve" disabled />
              <SourcePill label="Artista concorrente" hint="em breve" disabled />
              <SourcePill label="Orçamento" hint="em breve" disabled />
            </div>
          </div>
        )}

        <div className="nx-card space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Field label="Meta de plays" hint={metaExtenso(meta)}>
              <Input
                type="number"
                value={meta === 0 ? "" : meta}
                onFocus={(e) => e.target.select()}
                onChange={(e) => setMeta(Math.max(0, Number(e.target.value) || 0))}
                className="h-9 bg-elevated border-border tabular-nums"
              />
            </Field>
            <Field label="Duração (dias)">
              <Input
                type="number"
                value={days === 0 ? "" : days}
                onFocus={(e) => e.target.select()}
                onChange={(e) => setDays(Math.max(0, Number(e.target.value) || 0))}
                className="h-9 bg-elevated border-border tabular-nums"
              />
            </Field>
            <Field label="Nicho">
              <select
                value={genreId}
                onChange={(e) => setGenreId(e.target.value)}
                className="h-9 w-full rounded-md bg-elevated border border-border px-2 text-sm"
              >
                <option value="">Todos</option>
                {genres.map(g => <option key={g.id} value={g.id}>{g.nome}</option>)}
              </select>
            </Field>
            <Field label="Perfil">
              <select
                value={profile}
                onChange={(e) => setProfile(e.target.value as any)}
                className="h-9 w-full rounded-md bg-elevated border border-border px-2 text-sm"
              >
                {PROFILES.map(p => <option key={p.id} value={p.id}>{p.label} ({p.mult}x)</option>)}
              </select>
            </Field>
          </div>
          <div className="text-[11px] text-muted-foreground">
            Cada playlist entra 1 vez, na sua capacidade natural. Maiores no topo, médias no meio, menores na cauda.
          </div>
        </div>
      </Stage>

      {/* ───────────── ETAPA 2 — VIABILIDADE DO ECOSSISTEMA ───────────── */}
      <Stage
        number={2}
        title="Viabilidade do ecossistema"
        subtitle="O mercado suporta essa meta? Saúde, naturalidade e saturação."
      >
        <VerdictCard
          plan={plan}
          ind={ind}
          dailyTarget={dailyTarget}
          meta={meta}
          days={days}
          filteredCount={filtered.length}
        />

        <div className="grid grid-cols-3 gap-3">
          <SimKpi label="Meta / dia" value={formatNumber(dailyTarget)} hint={`${formatNumber(meta)} em ${days} ${days === 1 ? "dia" : "dias"}`} />
          <SimKpi
            label="Entregue / dia"
            value={formatNumber(plan.delivered)}
            hint={`${Math.round(ind.coverage * 100)}% da meta`}
            tone={ind.coverage >= 0.85 ? "ok" : ind.coverage >= 0.6 ? "warn" : "bad"}
          />
          {plan.deficit > 0 ? (
            <SimKpi label="Falta / dia" value={formatNumber(plan.deficit)} hint={`${formatNumber(plan.deficit * days)} no total`} tone="bad" />
          ) : (
            <SimKpi label="Saldo ocioso" value={formatNumber(plan.surplus)} hint="capacidade de sobra" tone="ok" />
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <HealthCheck
            label="Concentração"
            status={ind.concentration <= 0.20 ? "ok" : ind.concentration <= 0.35 ? "warn" : "bad"}
            headline={
              ind.concentration <= 0.20 ? "Sem playlist dominante" :
              ind.concentration <= 0.35 ? "Uma playlist puxando muito" :
              "Concentrado demais numa playlist"
            }
            detail={`A maior playlist responde por ${Math.round(ind.concentration * 100)}% da entrega · saudável até 20%`}
          />
          <HealthCheck
            label="Diversidade"
            status={ind.diversity >= 0.85 ? "ok" : ind.diversity >= 0.6 ? "warn" : "bad"}
            headline={
              ind.diversity >= 0.85 ? "Espalhado em várias playlists" :
              ind.diversity >= 0.6 ? "Poucas playlists carregando" :
              "Pouquíssimas playlists ativas"
            }
            detail={`${slots.length} de ${filtered.length} playlists do nicho em uso`}
          />
          <HealthCheck
            label="Naturalidade"
            status={ind.naturalness >= 0.7 ? "ok" : ind.naturalness >= 0.4 ? "warn" : "bad"}
            headline={
              ind.naturalness >= 0.7 ? "Mix natural topo · meio · cauda" :
              ind.naturalness >= 0.4 ? "Distribuição um pouco torta" :
              "Empilhado nas posições do topo"
            }
            detail={`Quanto mais equilibrado entre topo, meio e cauda, mais natural — aqui: ${Math.round(ind.naturalness * 100)}%`}
          />
          <HealthCheck
            label="Saturação do nicho"
            status={ind.saturation <= 0.6 ? "ok" : ind.saturation <= 0.85 ? "warn" : "bad"}
            headline={
              ind.saturation <= 0.6 ? "Sobra capacidade no nicho" :
              ind.saturation <= 0.85 ? "Quase no limite do nicho" :
              "Nicho no teto — sem folga"
            }
            detail={`${Math.round(ind.saturation * 100)}% das playlists do nicho engajadas · saudável até 60%`}
          />
        </div>
      </Stage>

      {/* ───────────── ETAPA 3 — ESTRATÉGIA OPERACIONAL ───────────── */}
      <Stage
        number={3}
        title="Estratégia operacional"
        subtitle="Como vamos executar: playlists, posições e distribuição por faixa."
      >
        <DistributionTable
          loading={loading}
          slots={slots}
          filteredCount={filtered.length}
          dailyTarget={dailyTarget}
          delivered={ind.delivered}
          coverage={ind.coverage}
          excluded={excluded}
          onToggleSlot={toggleSlot}
          slotKey={slotKey}
        />
      </Stage>

      {/* ───────────── ETAPA 4 — APLICAÇÃO ───────────── */}
      <Stage
        number={4}
        title="Aplicação"
        subtitle="Aprovar o plano e executar nas playlists reais."
      >
        <div className="nx-card space-y-3">
          <div className="flex items-center gap-2">
            <Send className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold">Aplicar este plano numa música</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-2">
            <div className="relative">
              <Music2 className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={trackInput}
                onChange={(e) => setTrackInput(e.target.value)}
                placeholder="Cole o link do Spotify (https://open.spotify.com/track/...)"
                className="h-9 pl-8 bg-elevated border-border"
              />
            </div>
            <Button
              onClick={applyPlan}
              disabled={applying || !trackId || activeSlots.length === 0}
              className="h-9 gap-2"
            >
              {applying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              {applying ? "Aplicando..." : `Aplicar em ${activeSlots.length} playlist${activeSlots.length === 1 ? "" : "s"}`}
            </Button>
          </div>
          <div className="text-[11px] text-muted-foreground flex items-center gap-3 flex-wrap">
            {trackId ? (
              <span className="inline-flex items-center gap-1 text-primary">
                <CheckCircle2 className="h-3 w-3" /> faixa válida ({trackId.slice(0, 8)}…)
              </span>
            ) : trackInput ? (
              <span className="inline-flex items-center gap-1 text-destructive">
                <XCircle className="h-3 w-3" /> link inválido
              </span>
            ) : (
              <span>Sem música, só o planejamento teórico aparece acima.</span>
            )}
            <span>·</span>
            <span>Não existe → insere na posição. Já existe → move pra posição planejada.</span>
          </div>

          {results && results.length > 0 && (
            <div className="border border-border rounded-lg overflow-hidden">
              <div className="px-3 py-2 bg-elevated/40 text-[10px] uppercase tracking-[0.15em] text-muted-foreground font-semibold">
                Resultado da última aplicação
              </div>
              <div className="max-h-64 overflow-y-auto divide-y divide-border/40">
                {results.map((r, i) => (
                  <div key={i} className="flex items-center justify-between gap-2 px-3 py-1.5 text-xs">
                    <span className="truncate">{r.name ?? r.playlist_id}</span>
                    <span className={cn(
                      "inline-flex items-center gap-1 px-1.5 h-5 rounded text-[10px] font-semibold shrink-0",
                      r.status === "added" && "bg-primary/15 text-primary",
                      r.status === "moved" && "bg-warning/15 text-warning",
                      r.status === "skip" && "bg-muted text-muted-foreground",
                      r.status === "error" && "bg-destructive/15 text-destructive",
                    )} title={r.message}>
                      {r.status === "added" ? "Adicionada" :
                       r.status === "moved" ? "Movida" :
                       r.status === "skip" ? "Pulada" : "Erro"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="nx-card flex items-start gap-3 !py-3">
          <Info className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
          <p className="text-xs text-muted-foreground leading-relaxed">
            Planejamento baseado em comportamento médio de playlists Spotify. Os números servem como referência
            operacional — não alimentam scores, health, capacity ou automações do cérebro.
          </p>
        </div>
      </Stage>
    </section>
  );
}

function Stage({
  number, title, subtitle, children,
}: { number: number; title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 pb-2 border-b border-border">
        <div className="h-8 w-8 rounded-full bg-primary/15 border border-primary/40 text-primary inline-flex items-center justify-center text-sm font-semibold tabular-nums shrink-0">
          {number}
        </div>
        <div className="space-y-0.5 min-w-0">
          <h2 className="text-base font-semibold leading-tight">{title}</h2>
          <p className="text-xs text-muted-foreground leading-snug">{subtitle}</p>
        </div>
      </div>
      <div className="space-y-3 md:pl-11">
        {children}
      </div>
    </div>
  );
}

function SourcePill({
  label, hint, active, disabled,
}: { label: string; hint: string; active?: boolean; disabled?: boolean }) {
  return (
    <div className={cn(
      "rounded-lg border px-3 py-2 space-y-0.5 transition-colors",
      active && "bg-primary/10 border-primary/40",
      !active && !disabled && "bg-elevated border-border",
      disabled && "bg-elevated/40 border-border/60 opacity-60",
    )}>
      <div className={cn(
        "text-xs font-semibold",
        active ? "text-primary" : "text-foreground",
      )}>{label}</div>
      <div className="text-[10px] text-muted-foreground">{hint}</div>
    </div>
  );
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="space-y-1.5">
      <div className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground font-semibold">{label}</div>
      {children}
      {hint && <div className="text-[11px] text-primary tabular-nums font-medium">{hint}</div>}
    </div>
  );
}

function metaExtenso(n: number): string {
  if (!n || n <= 0) return "—";
  if (n >= 1_000_000_000) {
    const v = n / 1_000_000_000;
    return `${v.toFixed(v >= 10 ? 0 : 1).replace(".", ",")} ${v === 1 ? "bilhão" : "bilhões"}`;
  }
  if (n >= 1_000_000) {
    const v = n / 1_000_000;
    return `${v.toFixed(v >= 10 ? 0 : 1).replace(".", ",")} ${v === 1 ? "milhão" : "milhões"}`;
  }
  if (n >= 1_000) {
    const v = n / 1_000;
    return `${v.toFixed(v >= 10 ? 0 : 1).replace(".", ",")} mil`;
  }
  return n.toLocaleString("pt-BR");
}

function SimKpi({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "ok" | "warn" | "bad" }) {
  return (
    <div className="nx-card space-y-1.5">
      <div className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground font-semibold">{label}</div>
      <div className={cn(
        "text-2xl font-semibold tabular-nums",
        tone === "ok" && "text-primary",
        tone === "warn" && "text-warning",
        tone === "bad" && "text-destructive",
      )}>{value}</div>
      {hint && <div className="text-[10px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

function HealthCheck({
  label, status, headline, detail,
}: { label: string; status: "ok" | "warn" | "bad"; headline: string; detail: string }) {
  const Icon = status === "ok" ? CheckCircle2 : status === "warn" ? AlertTriangle : XCircle;
  return (
    <div className={cn(
      "nx-card flex items-start gap-3 border",
      status === "ok"   && "border-primary/30",
      status === "warn" && "border-warning/30",
      status === "bad"  && "border-destructive/30",
    )}>
      <Icon className={cn(
        "h-4 w-4 mt-0.5 shrink-0",
        status === "ok"   && "text-primary",
        status === "warn" && "text-warning",
        status === "bad"  && "text-destructive",
      )} />
      <div className="space-y-1 min-w-0">
        <div className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground font-semibold">{label}</div>
        <div className="text-sm font-medium">{headline}</div>
        <div className="text-[11px] text-muted-foreground leading-relaxed">{detail}</div>
      </div>
    </div>
  );
}

type VerdictTone = "ok" | "warn" | "bad";

function buildVerdict(opts: {
  plan: PlanResult; ind: ReturnType<typeof calcIndicators>; dailyTarget: number; meta: number; days: number;
}): { tone: VerdictTone; title: string; recommendation: string; score: number } {
  const { plan, ind, dailyTarget, meta, days } = opts;
  const coverage = ind.coverage; // 0..1
  // Score 0..100: meta atendida pesa 60%, naturalidade 20%, anti-concentração 10%, anti-saturação 10%
  const score = Math.round(
    coverage * 60 +
    ind.naturalness * 20 +
    (1 - Math.min(1, ind.concentration / 0.5)) * 10 +
    (1 - Math.min(1, ind.saturation / 1)) * 10
  );

  if (plan.deficit > 0) {
    // Inviável — sugere alternativas concretas
    const newDays = Math.max(days + 1, Math.ceil(meta / Math.max(plan.maxCapacity, 1)));
    const viableMeta = plan.maxCapacity * days;
    return {
      tone: "bad",
      title: "Inviável sem forçar o ecossistema",
      score,
      recommendation:
        `Para fechar essa meta no natural, estenda para ~${newDays} dias ` +
        `ou reduza para até ${formatNumber(viableMeta)} no mesmo prazo. ` +
        (plan.intensity === "maximo" ? "O nicho já está no modo Máximo." : ""),
    };
  }

  if (plan.intensity === "maximo" || ind.naturalness < 0.4 || ind.concentration > 0.4) {
    return {
      tone: "warn",
      title: "Forçando o ecossistema",
      score,
      recommendation:
        "A meta cabe, mas puxa posições altas demais ou concentra numa playlist. " +
        "Aumente o prazo, abra o nicho ou reduza a meta para uma campanha mais natural.",
    };
  }

  if (coverage >= 0.95 && ind.naturalness >= 0.6 && ind.concentration <= 0.25) {
    return {
      tone: "ok",
      title: "Campanha saudável",
      score,
      recommendation:
        "Distribuição equilibrada entre topo, meio e cauda, sem concentração. Pode operar tranquilo.",
    };
  }

  return {
    tone: "warn",
    title: "Operável, mas pode melhorar",
    score,
    recommendation:
      "A meta cabe no nicho. Para deixar mais natural, considere mais dias ou abrir o filtro de nicho.",
  };
}

function VerdictCard({
  plan, ind, dailyTarget, meta, days, filteredCount,
}: {
  plan: PlanResult; ind: ReturnType<typeof calcIndicators>;
  dailyTarget: number; meta: number; days: number; filteredCount: number;
}) {
  const v = buildVerdict({ plan, ind, dailyTarget, meta, days });
  const [openWhy, setOpenWhy] = useState(false);
  const Icon = v.tone === "ok" ? CheckCircle2 : v.tone === "warn" ? AlertTriangle : XCircle;
  return (
    <div className={cn(
      "nx-card border-l-4",
      v.tone === "ok"   && "border-l-primary",
      v.tone === "warn" && "border-l-warning",
      v.tone === "bad"  && "border-l-destructive",
    )}>
      <div className="flex items-start gap-4">
        <Icon className={cn(
          "h-6 w-6 shrink-0 mt-0.5",
          v.tone === "ok"   && "text-primary",
          v.tone === "warn" && "text-warning",
          v.tone === "bad"  && "text-destructive",
        )} />
        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex items-center gap-3 flex-wrap">
            <h3 className="text-base font-semibold">{v.title}</h3>
            <span className={cn(
              "inline-flex items-center gap-1 h-6 px-2 rounded-full text-[10px] font-semibold tabular-nums border",
              v.tone === "ok"   && "bg-primary/10 text-primary border-primary/40",
              v.tone === "warn" && "bg-warning/10 text-warning border-warning/40",
              v.tone === "bad"  && "bg-destructive/10 text-destructive border-destructive/40",
            )}>Saúde {v.score}/100</span>
            <span className="inline-flex items-center gap-1 h-6 px-2 rounded-full text-[10px] font-medium border bg-elevated text-muted-foreground border-border">
              Modo {INTENSITY_LABEL[plan.intensity].label}
            </span>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">{v.recommendation}</p>
          <button
            type="button"
            onClick={() => setOpenWhy(o => !o)}
            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronDown className={cn("h-3 w-3 transition-transform", openWhy && "rotate-180")} />
            {openWhy ? "Ocultar diagnóstico" : "Por que essa nota?"}
          </button>
          {openWhy && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 text-[11px] animate-tab-in">
              <WhyRow label="Cobertura" value={`${Math.round(ind.coverage * 100)}%`} weight="60%" />
              <WhyRow label="Naturalidade" value={`${Math.round(ind.naturalness * 100)}%`} weight="20%" />
              <WhyRow label="Anti-concentração" value={`${Math.round((1 - Math.min(1, ind.concentration / 0.5)) * 100)}%`} weight="10%" />
              <WhyRow label="Folga do nicho" value={`${Math.round((1 - ind.saturation) * 100)}%`} weight="10%" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function WhyRow({ label, value, weight }: { label: string; value: string; weight: string }) {
  return (
    <div className="rounded-md bg-elevated/50 border border-border px-2 py-1.5 space-y-0.5">
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="flex items-baseline gap-1">
        <span className="text-sm font-semibold tabular-nums">{value}</span>
        <span className="text-[9px] text-muted-foreground">peso {weight}</span>
      </div>
    </div>
  );
}

function DistributionTable({
  loading, slots, filteredCount, dailyTarget, delivered, coverage,
  excluded, onToggleSlot, slotKey,
}: {
  loading: boolean;
  slots: Slot[];
  filteredCount: number;
  dailyTarget: number;
  delivered: number;
  coverage: number;
  excluded?: Set<string>;
  onToggleSlot?: (key: string) => void;
  slotKey?: (s: Slot) => string;
}) {
  const [query, setQuery] = useState("");
  const [grouped, setGrouped] = useState(true);

  const sorted = useMemo(
    () => [...slots].sort((a, b) => b.playsDay - a.playsDay),
    [slots],
  );
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter(s => s.playlistName.toLowerCase().includes(q));
  }, [sorted, query]);

  const ordered = useMemo(() => {
    if (!grouped) return filtered;
    const order = { top: 0, mid: 1, low: 2 } as const;
    return [...filtered].sort((a, b) => order[a.band] - order[b.band] || b.playsDay - a.playsDay);
  }, [filtered, grouped]);

  const maxPlays = sorted[0]?.playsDay ?? 1;

  // Totais por faixa para mini sumário
  const bandTotals = useMemo(() => {
    const t = { top: 0, mid: 0, low: 0 };
    slots.forEach(s => { t[s.band] += s.playsDay; });
    return t;
  }, [slots]);
  const bandCounts = useMemo(() => {
    const c = { top: 0, mid: 0, low: 0 };
    slots.forEach(s => { c[s.band] += 1; });
    return c;
  }, [slots]);

  return (
    <div className="nx-card !p-0 overflow-hidden">
      {/* Header */}
      <div className="p-4 sm:p-5 space-y-3 border-b border-border">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold">Distribuição automática sugerida</h3>
          </div>
          <div className="text-[11px] text-muted-foreground tabular-nums">
            {slots.length} alocações · {filteredCount} playlists no nicho
          </div>
        </div>

        {/* Mini sumário por faixa */}
        <div className="grid grid-cols-3 gap-2">
          <BandSummary tone="top" label="Topo" count={bandCounts.top} plays={bandTotals.top} delivered={delivered} />
          <BandSummary tone="mid" label="Meio" count={bandCounts.mid} plays={bandTotals.mid} delivered={delivered} />
          <BandSummary tone="low" label="Cauda" count={bandCounts.low} plays={bandTotals.low} delivered={delivered} />
        </div>

        {/* Toolbar: busca + agrupar */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[180px]">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filtrar playlists..."
              className="h-8 bg-elevated border-border rounded-full text-xs pl-3"
            />
          </div>
          <button
            type="button"
            onClick={() => setGrouped(g => !g)}
            className={cn(
              "h-8 px-3 rounded-full text-[11px] font-medium border transition-colors",
              grouped
                ? "bg-primary/15 text-primary border-primary/40"
                : "bg-elevated text-muted-foreground border-border hover:text-foreground",
            )}
          >
            {grouped ? "Agrupado por faixa" : "Ordenar por plays"}
          </button>
        </div>
      </div>

      {/* Body */}
      {loading ? (
        <div className="p-4 space-y-2">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-11 rounded-lg" />)}
        </div>
      ) : ordered.length === 0 ? (
        <div className="text-sm text-muted-foreground text-center py-8 flex flex-col items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-warning" />
          {slots.length === 0
            ? "Nenhuma distribuição possível com os parâmetros atuais."
            : "Nenhuma playlist encontrada com esse filtro."}
          {filteredCount === 0 && <span className="text-xs">Nenhuma playlist neste nicho.</span>}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-separate border-spacing-0">
            <thead className="bg-elevated/40">
              <tr className="text-muted-foreground">
                {onToggleSlot && (
                  <th className="text-left font-medium py-2.5 px-2 w-8 border-b border-border">
                    <input
                      type="checkbox"
                      checked={excluded?.size === 0}
                      onChange={() => {
                        const allOff = excluded && excluded.size === slots.length;
                        if (excluded && excluded.size > 0 && !allOff) {
                          // todas marcadas → não faz nada
                        }
                        // toggle: se algum excluído, restaura tudo; senão exclui tudo
                        if ((excluded?.size ?? 0) > 0) {
                          slots.forEach(s => excluded?.has(slotKey!(s)) && onToggleSlot(slotKey!(s)));
                        } else {
                          slots.forEach(s => onToggleSlot(slotKey!(s)));
                        }
                      }}
                      className="h-3.5 w-3.5 accent-primary cursor-pointer"
                      title="Marcar/desmarcar tudo"
                    />
                  </th>
                )}
                <th className="text-left font-medium py-2.5 px-3 w-10 border-b border-border">#</th>
                <th className="text-left font-medium py-2.5 px-3 border-b border-border">Playlist</th>
                <th className="text-left font-medium py-2.5 px-3 w-16 border-b border-border">Pos.</th>
                <th className="text-left font-medium py-2.5 px-3 border-b border-border min-w-[160px]">Participação</th>
                <th className="text-right font-medium py-2.5 px-3 w-24 border-b border-border">Plays/dia</th>
                <th className="text-right font-medium py-2.5 px-3 w-24 border-b border-border hidden sm:table-cell">Plays/mês</th>
              </tr>
            </thead>
            <tbody>
              {ordered.map((s, i) => {
                const prev = ordered[i - 1];
                const showBandHeader = grouped && (!prev || prev.band !== s.band);
                const sharePct = dailyTarget ? (s.playsDay / dailyTarget) * 100 : 0;
                const widthPct = Math.max(2, (s.playsDay / maxPlays) * 100);
                const barColor =
                  s.band === "top" ? "bg-primary" :
                  s.band === "mid" ? "bg-warning" :
                  "bg-muted-foreground/40";
                return (
                  <React.Fragment key={`${s.playlistId}-${s.position}-${i}`}>
                    {showBandHeader && (
                      <tr key={`hd-${s.band}`} className="bg-elevated/60">
                        <td colSpan={onToggleSlot ? 7 : 6} className="py-1.5 px-3 text-[10px] uppercase tracking-[0.15em] font-semibold text-muted-foreground border-b border-border">
                          <span className="inline-flex items-center gap-1.5">
                            <span className={cn(
                              "w-1.5 h-1.5 rounded-full",
                              s.band === "top" && "bg-primary",
                              s.band === "mid" && "bg-warning",
                              s.band === "low" && "bg-muted-foreground/50",
                            )} />
                            {s.band === "top" ? "Topo · #1–#5" : s.band === "mid" ? "Meio · #6–#10" : "Cauda · #11+"}
                            <span className="text-muted-foreground/70 normal-case tracking-normal font-normal ml-1">
                              ({bandCounts[s.band]} playlist{bandCounts[s.band] !== 1 ? "s" : ""})
                            </span>
                          </span>
                        </td>
                      </tr>
                    )}
                    <tr
                      key={`${s.playlistId}-${s.position}-${i}`}
                      className={cn(
                        "transition-colors hover:bg-elevated/60 group",
                        i % 2 === 1 && "bg-elevated/20",
                        onToggleSlot && excluded?.has(slotKey!(s)) && "opacity-40",
                      )}
                    >
                      {onToggleSlot && (
                        <td className="py-2.5 px-2 border-b border-border/30">
                          <input
                            type="checkbox"
                            checked={!excluded?.has(slotKey!(s))}
                            onChange={() => onToggleSlot(slotKey!(s))}
                            className="h-3.5 w-3.5 accent-primary cursor-pointer"
                          />
                        </td>
                      )}
                      <td className="py-2.5 px-3 tabular-nums text-muted-foreground border-b border-border/30">
                        {i + 1}
                      </td>
                      <td className="py-2.5 px-3 border-b border-border/30">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="w-8 h-8 rounded-md bg-elevated border border-border overflow-hidden shrink-0">
                            {s.cover ? (
                              <img src={s.cover} alt="" className="w-full h-full object-cover" loading="lazy" />
                            ) : (
                              <div className="w-full h-full grid place-items-center text-muted-foreground">
                                <ListMusic className="h-3.5 w-3.5" />
                              </div>
                            )}
                          </div>
                          <span className="truncate font-medium" title={s.playlistName}>{s.playlistName}</span>
                        </div>
                      </td>
                      <td className="py-2.5 px-3 border-b border-border/30">
                        <span className={cn(
                          "inline-flex items-center justify-center min-w-[36px] h-5 px-1.5 rounded text-[10px] font-semibold tabular-nums border",
                          s.band === "top" && "bg-primary/15 text-primary border-primary/40",
                          s.band === "mid" && "bg-warning/10 text-warning border-warning/30",
                          s.band === "low" && "bg-muted text-muted-foreground border-border",
                        )}>
                          #{s.position}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 border-b border-border/30">
                        <div className="flex items-center gap-2 min-w-[140px]">
                          <div className="flex-1 h-1.5 bg-elevated rounded-full overflow-hidden">
                            <div className={cn("h-full rounded-full transition-all", barColor)} style={{ width: `${widthPct}%` }} />
                          </div>
                          <span className="tabular-nums text-[11px] text-muted-foreground w-10 text-right">
                            {sharePct.toFixed(1)}%
                          </span>
                        </div>
                      </td>
                      <td className="py-2.5 px-3 tabular-nums text-right font-semibold border-b border-border/30">
                        {formatNumber(s.playsDay)}
                      </td>
                      <td className="py-2.5 px-3 tabular-nums text-right text-muted-foreground border-b border-border/30 hidden sm:table-cell">
                        {formatNumber(s.playsMonth)}
                      </td>
                    </tr>
                  </React.Fragment>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="font-semibold bg-elevated/40">
                <td colSpan={onToggleSlot ? 4 : 3} className="py-2.5 px-3 text-muted-foreground text-[11px] uppercase tracking-[0.15em]">
                  Total simulado
                </td>
                <td className="py-2.5 px-3 text-right text-muted-foreground tabular-nums">
                  {dailyTarget ? Math.round(coverage * 100) : 0}% da meta
                </td>
                <td className="py-2.5 px-3 tabular-nums text-right">{formatNumber(delivered)}</td>
                <td className="py-2.5 px-3 tabular-nums text-right text-muted-foreground hidden sm:table-cell">
                  {formatNumber(delivered * 30)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

function BandSummary({ tone, label, count, plays, delivered }: {
  tone: "top" | "mid" | "low"; label: string; count: number; plays: number; delivered: number;
}) {
  const pct = delivered > 0 ? Math.round((plays / delivered) * 100) : 0;
  return (
    <div className={cn(
      "rounded-lg border bg-elevated/40 px-3 py-2 space-y-1",
      tone === "top" && "border-primary/30",
      tone === "mid" && "border-warning/30",
      tone === "low" && "border-border",
    )}>
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.15em] text-muted-foreground font-semibold">
        <span className={cn(
          "w-1.5 h-1.5 rounded-full",
          tone === "top" && "bg-primary",
          tone === "mid" && "bg-warning",
          tone === "low" && "bg-muted-foreground/50",
        )} />
        {label}
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className="text-base font-semibold tabular-nums">{count}</span>
        <span className="text-[10px] text-muted-foreground">{count === 1 ? "playlist" : "playlists"}</span>
      </div>
      <div className="text-[10px] text-muted-foreground tabular-nums">
        {formatNumber(plays)}/dia · {pct}%
      </div>
    </div>
  );
}
