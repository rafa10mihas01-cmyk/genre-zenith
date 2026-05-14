import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { formatNumber } from "@/lib/format";
import { Target, Info, Sparkles, ListMusic, AlertTriangle, CheckCircle2, XCircle, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

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

// % de tráfego diário por posição (curva teórica)
const POSITION_PCT: Record<number, number> = {
  1: 0.12, 2: 0.10, 3: 0.08, 4: 0.07, 5: 0.06,
  6: 0.05, 7: 0.045, 8: 0.04, 9: 0.035, 10: 0.03,
  11: 0.02, 12: 0.018, 13: 0.016, 14: 0.014, 15: 0.013,
  16: 0.012, 17: 0.011, 18: 0.010, 19: 0.009, 20: 0.008,
};
function posPct(p: number) {
  return POSITION_PCT[p] ?? 0.003;
}

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

export function PlanejadorMeta() {
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [genres, setGenres] = useState<Genre[]>([]);
  const [loading, setLoading] = useState(true);

  const [meta, setMeta] = useState<number>(10_000_000);
  const [days, setDays] = useState<number>(30);
  const [genreId, setGenreId] = useState<string>("");
  const [profile, setProfile] = useState<typeof PROFILES[number]["id"]>("mercado");
  

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

  const ind = useMemo(() => calcIndicators(slots, dailyTarget, filtered.length), [slots, dailyTarget, filtered.length]);

  return (
    <section className="space-y-4 animate-tab-in">
      <div className="nx-card flex items-start gap-3 !py-3">
        <Info className="h-4 w-4 text-primary mt-0.5 shrink-0" />
        <p className="text-xs text-muted-foreground leading-relaxed">
          <strong className="text-foreground">Planejador de meta teórico.</strong> Simulação baseada em comportamento
          médio de playlists Spotify. Valores teóricos usados como planejamento operacional — não alimentam o cérebro,
          scores ou automações.
        </p>
      </div>

      {/* Form */}
      <div className="nx-card space-y-4">
        <div className="flex items-center gap-2">
          <Target className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Definir meta</h3>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Field label="Meta de plays" hint={metaExtenso(meta)}>
            <Input
              type="number"
              value={meta}
              onChange={(e) => setMeta(Math.max(0, Number(e.target.value) || 0))}
              className="h-9 bg-elevated border-border tabular-nums"
            />
          </Field>
          <Field label="Duração (dias)">
            <Input
              type="number"
              value={days}
              onChange={(e) => setDays(Math.max(1, Number(e.target.value) || 1))}
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

      {/* Resumo da meta vs capacidade natural */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <SimKpi label="Meta / dia" value={formatNumber(dailyTarget)} hint={`${formatNumber(meta)} em ${days} ${days === 1 ? "dia" : "dias"}`} />
        <SimKpi
          label={`Capacidade — ${INTENSITY_LABEL[plan.intensity].label}`}
          value={formatNumber(plan.naturalCapacity)}
          hint={INTENSITY_LABEL[plan.intensity].hint}
          tone={INTENSITY_LABEL[plan.intensity].tone}
        />
        <SimKpi
          label="Entregue / dia"
          value={formatNumber(plan.delivered)}
          hint={`${Math.round(ind.coverage * 100)}% da meta · ${slots.length}/${filtered.length} playlists`}
          tone={ind.coverage >= 0.85 ? "ok" : ind.coverage >= 0.6 ? "warn" : "bad"}
        />
        {plan.deficit > 0 ? (
          <SimKpi
            label="Falta / dia"
            value={formatNumber(plan.deficit)}
            hint={`teto do nicho: ${formatNumber(plan.maxCapacity)}/dia`}
            tone="bad"
          />
        ) : (
          <SimKpi
            label="Saldo ocioso"
            value={formatNumber(plan.surplus)}
            hint={`teto do nicho: ${formatNumber(plan.maxCapacity)}/dia`}
            tone="ok"
          />
        )}
      </div>

      {/* Aviso de déficit */}
      {plan.deficit > 0 && (
        <div className="nx-card flex items-start gap-3 !py-3 border-warning/40">
          <AlertTriangle className="h-4 w-4 text-warning mt-0.5 shrink-0" />
          <p className="text-xs leading-relaxed">
            <strong className="text-warning">Ecossistema no teto.</strong>{" "}
            <span className="text-muted-foreground">
              Mesmo puxando todas as {filtered.length} playlists do nicho para posições altas (modo Máximo),
              o teto teórico é <strong className="text-foreground tabular-nums">{formatNumber(plan.maxCapacity)}/dia</strong>.
              Faltam <strong className="text-foreground tabular-nums">{formatNumber(plan.deficit)}/dia</strong>{" "}
              ({formatNumber(plan.deficit * days)} no total) para fechar a meta sem spam.
            </span>
          </p>
        </div>
      )}

      {/* Indicadores */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Indicator label="Concentração" value={ind.concentration} invert />
        <Indicator label="Diversidade" value={ind.diversity} />
        <Indicator label="Naturalidade" value={ind.naturalness} />
        <Indicator label="Saturação teórica" value={ind.saturation} invert />
      </div>

      {/* Distribuição */}
      <div className="nx-card space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold">Distribuição automática sugerida</h3>
          </div>
          <div className="text-[11px] text-muted-foreground tabular-nums">
            {slots.length} alocações · {filtered.length} playlists no nicho
          </div>
        </div>

        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 rounded-lg" />)}
          </div>
        ) : slots.length === 0 ? (
          <div className="text-sm text-muted-foreground text-center py-6 flex flex-col items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-warning" />
            Nenhuma distribuição possível com os parâmetros atuais.
            {filtered.length === 0 && <span className="text-xs">Nenhuma playlist neste nicho.</span>}
          </div>
        ) : (
          <div className="overflow-x-auto -mx-1">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-muted-foreground border-b border-border">
                  <th className="py-2 px-2">Playlist</th>
                  <th className="py-2 px-2 w-20">Posição</th>
                  <th className="py-2 px-2">Faixa</th>
                  <th className="py-2 px-2 text-right">Plays/dia</th>
                  <th className="py-2 px-2 text-right">Plays/mês</th>
                  <th className="py-2 px-2 text-right">% da meta</th>
                </tr>
              </thead>
              <tbody>
                {slots.map((s, i) => (
                  <tr key={`${s.playlistId}-${s.position}-${i}`} className="border-b border-border/40">
                    <td className="py-2 px-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="w-7 h-7 rounded-md bg-elevated border border-border overflow-hidden shrink-0">
                          {s.cover ? (
                            <img src={s.cover} alt="" className="w-full h-full object-cover" loading="lazy" />
                          ) : (
                            <div className="w-full h-full grid place-items-center text-muted-foreground">
                              <ListMusic className="h-3.5 w-3.5" />
                            </div>
                          )}
                        </div>
                        <span className="truncate font-medium">{s.playlistName}</span>
                      </div>
                    </td>
                    <td className="py-2 px-2 tabular-nums font-semibold">#{s.position}</td>
                    <td className="py-2 px-2">
                      <span className={cn(
                        "inline-flex items-center px-1.5 h-5 rounded text-[10px] font-medium border",
                        s.band === "top" && "bg-primary/15 text-primary border-primary/40",
                        s.band === "mid" && "bg-warning/10 text-warning border-warning/30",
                        s.band === "low" && "bg-muted text-muted-foreground border-border",
                      )}>
                        {s.band === "top" ? "Topo" : s.band === "mid" ? "Meio" : "Cauda"}
                      </span>
                    </td>
                    <td className="py-2 px-2 tabular-nums text-right font-medium">{formatNumber(s.playsDay)}</td>
                    <td className="py-2 px-2 tabular-nums text-right text-muted-foreground">{formatNumber(s.playsMonth)}</td>
                    <td className="py-2 px-2 tabular-nums text-right text-muted-foreground">
                      {dailyTarget ? ((s.playsDay / dailyTarget) * 100).toFixed(1) : "0"}%
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-semibold">
                  <td colSpan={3} className="py-2 px-2 text-muted-foreground">Total simulado</td>
                  <td className="py-2 px-2 tabular-nums text-right">{formatNumber(ind.delivered)}</td>
                  <td className="py-2 px-2 tabular-nums text-right">{formatNumber(ind.delivered * 30)}</td>
                  <td className="py-2 px-2 tabular-nums text-right">
                    {dailyTarget ? Math.round(ind.coverage * 100) : 0}%
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      <div className="nx-card flex items-start gap-3 !py-3">
        <Info className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
        <p className="text-xs text-muted-foreground leading-relaxed">
          Simulação baseada em comportamento médio de playlists Spotify. Valores teóricos usados como planejamento
          operacional. Nada disso altera scores, health, capacity, automações ou cérebro do sistema.
        </p>
      </div>
    </section>
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

function Indicator({ label, value, invert }: { label: string; value: number; invert?: boolean }) {
  const pct = Math.max(0, Math.min(1, value));
  // Quando invert=true, valor alto = ruim (concentração, saturação)
  const score = invert ? 1 - pct : pct;
  const tone = score >= 0.7 ? "ok" : score >= 0.4 ? "warn" : "bad";
  return (
    <div className="nx-card space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground font-semibold">{label}</div>
        <div className="text-xs tabular-nums font-medium">{Math.round(pct * 100)}%</div>
      </div>
      <div className="h-1.5 rounded-full bg-elevated overflow-hidden">
        <div
          className={cn(
            "h-full rounded-full transition-all",
            tone === "ok" && "bg-primary",
            tone === "warn" && "bg-warning",
            tone === "bad" && "bg-destructive",
          )}
          style={{ width: `${pct * 100}%` }}
        />
      </div>
    </div>
  );
}
