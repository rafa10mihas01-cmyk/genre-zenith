import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { formatNumber } from "@/lib/format";
import { Target, Info, Sparkles, ListMusic, AlertTriangle } from "lucide-react";
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

function planDistribution(opts: {
  playlists: Playlist[];
  dailyTarget: number;
  multiplier: number;
  days: number;
}): Slot[] {
  const { playlists, dailyTarget, multiplier } = opts;
  if (!playlists.length || dailyTarget <= 0) return [];

  // Regra: 1 playlist = 1 posição. Espalhar entre o máximo de playlists do nicho.
  // Cap por playlist = 20% da meta diária (anti-concentração).
  const HARD_CAP = Math.max(Math.round(dailyTarget * 0.20), 1);

  // Ordena playlists das maiores p/ menores (maiores entram primeiro p/ pegar share maior).
  const pool = playlists.filter(p => p.followers > 0).slice().sort((a, b) => b.followers - a.followers);
  if (!pool.length) return [];

  // Rotação de bandas para parecer natural: top, mid, low, mid, top, low...
  const BAND_ROTATION: Array<"top" | "mid" | "low"> = ["top", "mid", "low", "mid", "top", "low", "mid"];
  const RANGES: Record<"top" | "mid" | "low", number[]> = {
    top: [2, 3, 4, 5],          // evita #1 puro p/ parecer mais natural
    mid: [6, 7, 8, 9, 10],
    low: [11, 12, 13, 14, 15, 16, 17, 18],
  };

  // Share ideal por playlist (distribuição horizontal).
  const idealShare = Math.min(dailyTarget / pool.length, HARD_CAP);

  const chosen: Slot[] = [];
  let remaining = dailyTarget;

  for (let i = 0; i < pool.length; i++) {
    if (remaining <= 0) break;
    const p = pool[i];
    const dailyTotal = (p.followers * multiplier) / 30;
    const maxPos = Math.max(p.tracks_count || 20, 18);

    // Banda alvo (rotacionando) — fallback para outras se a banda não couber.
    const bandOrder = [
      BAND_ROTATION[i % BAND_ROTATION.length],
      ...(["top", "mid", "low"] as const).filter(b => b !== BAND_ROTATION[i % BAND_ROTATION.length]),
    ];

    let bestPos = -1;
    let bestDelta = Infinity;
    let bestBand: "top" | "mid" | "low" = "mid";
    let bestCap = 0;

    for (const band of bandOrder) {
      for (const pos of RANGES[band]) {
        if (pos > maxPos) continue;
        const cap = Math.round(dailyTotal * posPct(pos));
        if (cap < 50) continue;
        const take = Math.min(cap, HARD_CAP, remaining);
        // Queremos a posição cuja entrega fique mais perto do idealShare,
        // sem ultrapassar HARD_CAP nem o restante.
        const delta = Math.abs(take - idealShare);
        if (delta < bestDelta) {
          bestDelta = delta;
          bestPos = pos;
          bestBand = band;
          bestCap = take;
        }
      }
      // Se já achou na banda preferida com share ≥ 50% do ideal, fica nela.
      if (bestPos !== -1 && bestCap >= idealShare * 0.5) break;
    }

    if (bestPos === -1 || bestCap <= 0) continue;

    chosen.push({
      playlistId: p.id,
      playlistName: p.name,
      cover: p.cover_url,
      position: bestPos,
      playsDay: bestCap,
      playsMonth: bestCap * 30,
      band: bestBand,
    });
    remaining -= bestCap;
  }

  return chosen;
}

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

  const slots = useMemo(
    () => planDistribution({
      playlists: filtered,
      dailyTarget,
      multiplier: profileObj.mult,
      days,
    }),
    [filtered, dailyTarget, profileObj.mult, days],
  );

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
          Distribuição: 1 posição por playlist · máx. 20% da meta por playlist · espalha entre todas as playlists do nicho.
        </div>
      </div>

      {/* Resumo da meta */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <SimKpi label="Meta total" value={formatNumber(meta)} hint={`${days} dias`} />
        <SimKpi label="Necessário/dia" value={formatNumber(dailyTarget)} hint="meta ÷ duração" />
        <SimKpi
          label="Cobertura simulada"
          value={`${Math.round(ind.coverage * 100)}%`}
          hint={`${formatNumber(ind.delivered)}/dia entregue`}
          tone={ind.coverage >= 0.85 ? "ok" : ind.coverage >= 0.6 ? "warn" : "bad"}
        />
        <SimKpi
          label="Risco da campanha"
          value={ind.risk === "baixo" ? "Baixo" : ind.risk === "medio" ? "Médio" : "Alto"}
          hint="cobertura + concentração"
          tone={ind.risk === "baixo" ? "ok" : ind.risk === "medio" ? "warn" : "bad"}
        />
      </div>

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
