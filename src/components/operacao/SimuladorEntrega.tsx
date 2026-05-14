import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { formatNumber } from "@/lib/format";
import { ArrowLeft, Calculator, Search, Info, ListMusic, Target } from "lucide-react";
import { cn } from "@/lib/utils";
import { PlanejadorMeta } from "./PlanejadorMeta";

type SimMode = "playlist" | "meta";

type SimPlaylist = {
  id: string;
  name: string;
  cover_url: string | null;
  followers: number;
  tracks_count: number;
};

// Comportamento médio de mercado: 1 save ativo ≈ 30 plays/mês
const PLAYS_PER_SAVE_MONTH = 30;

// Curva de distribuição teórica por posição (% do tráfego diário)
const POSITION_CURVE: { from: number; to: number; pct: number }[] = [
  { from: 1, to: 1, pct: 0.12 },
  { from: 2, to: 2, pct: 0.10 },
  { from: 3, to: 3, pct: 0.08 },
  { from: 4, to: 4, pct: 0.07 },
  { from: 5, to: 5, pct: 0.06 },
  { from: 6, to: 6, pct: 0.05 },
  { from: 7, to: 7, pct: 0.045 },
  { from: 8, to: 8, pct: 0.04 },
  { from: 9, to: 9, pct: 0.035 },
  { from: 10, to: 10, pct: 0.03 },
  { from: 11, to: 11, pct: 0.02 },
  { from: 12, to: 12, pct: 0.018 },
  { from: 13, to: 13, pct: 0.016 },
  { from: 14, to: 14, pct: 0.014 },
  { from: 15, to: 15, pct: 0.013 },
  { from: 16, to: 16, pct: 0.012 },
  { from: 17, to: 17, pct: 0.011 },
  { from: 18, to: 18, pct: 0.010 },
  { from: 19, to: 19, pct: 0.009 },
  { from: 20, to: 20, pct: 0.008 },
];
// 20+ → residual (≈0,3% por posição até esgotar)
const RESIDUAL_PCT = 0.003;

function buildDistribution(dailyTotal: number, totalTracks: number) {
  const rows: { position: number; pct: number; plays: number; band: string }[] = [];
  const max = Math.max(totalTracks, 1);
  for (let pos = 1; pos <= max; pos++) {
    const slot = POSITION_CURVE.find(c => pos >= c.from && pos <= c.to);
    const pct = slot ? slot.pct : RESIDUAL_PCT;
    const band =
      pos <= 5 ? "top" :
      pos <= 10 ? "mid" :
      pos <= 20 ? "low" : "residual";
    rows.push({ position: pos, pct, plays: Math.round(dailyTotal * pct), band });
  }
  return rows;
}

export function SimuladorEntrega() {
  const [items, setItems] = useState<SimPlaylist[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<SimMode>("playlist");

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("managed_playlists")
        .select("id, name, cover_url, followers, tracks_count, archived_at")
        .is("archived_at", null)
        .order("followers", { ascending: false });
      setItems(((data ?? []) as any[]).map(d => ({
        id: d.id,
        name: d.name,
        cover_url: d.cover_url,
        followers: d.followers ?? 0,
        tracks_count: d.tracks_count ?? 0,
      })));
      setLoading(false);
    })();
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(i => i.name?.toLowerCase().includes(q));
  }, [items, search]);

  const selected = items.find(i => i.id === selectedId) ?? null;

  if (selected) {
    return (
      <SimDetail
        playlist={selected}
        onBack={() => setSelectedId(null)}
      />
    );
  }

  return (
    <section className="space-y-4 animate-tab-in">
      <div className="nx-card flex items-start gap-3 !py-3">
        <Info className="h-4 w-4 text-primary mt-0.5 shrink-0" />
        <p className="text-xs text-muted-foreground leading-relaxed">
          <strong className="text-foreground">Simulador teórico de mercado.</strong> Estimativa baseada em
          comportamento médio de playlists Spotify (1 save ativo ≈ 30 plays/mês). Valores teóricos usados como
          termômetro operacional — não substituem dados reais de plays.
        </p>
      </div>

      <div className="relative w-full sm:max-w-xs">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar playlist..."
          className="pl-9 h-9 bg-elevated border-border rounded-full text-sm"
        />
      </div>

      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2.5">
          {Array.from({ length: 10 }).map((_, i) => (
            <Skeleton key={i} className="aspect-square rounded-2xl" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="nx-card text-sm text-muted-foreground text-center py-8">
          Nenhuma playlist encontrada.
        </div>
      ) : (
        <>
          <div className="text-[11px] text-muted-foreground tabular-nums px-1">
            {filtered.length} playlist{filtered.length !== 1 ? "s" : ""} disponível{filtered.length !== 1 ? "is" : ""} para simulação
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 2xl:grid-cols-6 gap-2.5">
            {filtered.map(p => (
              <button
                key={p.id}
                onClick={() => setSelectedId(p.id)}
                className="nx-card !p-0 overflow-hidden text-left flex flex-col group hover:border-foreground/25 transition-colors"
              >
                <div className="relative aspect-square bg-elevated overflow-hidden">
                  {p.cover_url ? (
                    <img src={p.cover_url} alt={p.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" loading="lazy" />
                  ) : (
                    <div className="w-full h-full grid place-items-center text-muted-foreground">
                      <ListMusic className="h-6 w-6" />
                    </div>
                  )}
                  <div className="absolute bottom-2 left-2 right-2">
                    <div className="inline-flex items-center gap-1 px-2 h-6 rounded-full bg-background/80 backdrop-blur border border-border text-[10px] font-medium">
                      <Calculator className="h-3 w-3 text-primary" />
                      simular
                    </div>
                  </div>
                </div>
                <div className="p-2.5 space-y-1">
                  <div className="text-xs font-medium line-clamp-1">{p.name}</div>
                  <div className="text-[10px] text-muted-foreground tabular-nums">
                    {formatNumber(p.followers)} saves · {p.tracks_count} faixas
                  </div>
                </div>
              </button>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function SimDetail({ playlist, onBack }: { playlist: SimPlaylist; onBack: () => void }) {
  const monthly = playlist.followers * PLAYS_PER_SAVE_MONTH;
  const daily = Math.round(monthly / 30);
  const tracks = Math.max(playlist.tracks_count, 20);
  const rows = useMemo(() => buildDistribution(daily, tracks), [daily, tracks]);

  return (
    <section className="space-y-4 animate-tab-in">
      <button
        onClick={onBack}
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Voltar para a lista
      </button>

      <div className="nx-card flex flex-col sm:flex-row gap-4 items-start">
        <div className="w-20 h-20 rounded-xl bg-elevated overflow-hidden border border-border shrink-0">
          {playlist.cover_url ? (
            <img src={playlist.cover_url} alt={playlist.name} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full grid place-items-center text-muted-foreground">
              <ListMusic className="h-6 w-6" />
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground font-semibold">
            Simulação teórica
          </div>
          <h2 className="text-lg font-semibold truncate">{playlist.name}</h2>
          <p className="text-xs text-muted-foreground mt-1">
            Baseado em {formatNumber(playlist.followers)} salvamentos · {playlist.tracks_count} faixas reais
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <SimKpi label="Saves da playlist" value={formatNumber(playlist.followers)} hint="dados reais" />
        <SimKpi label="Plays teóricos / mês" value={formatNumber(monthly)} hint={`${formatNumber(playlist.followers)} × 30`} />
        <SimKpi label="Plays teóricos / dia" value={formatNumber(daily)} hint="média mensal ÷ 30" />
      </div>

      <div className="nx-card space-y-3">
        <div className="flex items-center gap-2">
          <Calculator className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Distribuição teórica por posição</h3>
        </div>
        <div className="overflow-x-auto -mx-1">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-muted-foreground border-b border-border">
                <th className="py-2 px-2 w-16">Posição</th>
                <th className="py-2 px-2">Faixa</th>
                <th className="py-2 px-2 text-right">% tráfego</th>
                <th className="py-2 px-2 text-right">Plays/dia</th>
                <th className="py-2 px-2 text-right">Plays/mês</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.position} className="border-b border-border/40">
                  <td className="py-2 px-2 tabular-nums font-semibold">#{r.position}</td>
                  <td className="py-2 px-2">
                    <span className={cn(
                      "inline-flex items-center px-1.5 h-5 rounded text-[10px] font-medium border",
                      r.band === "top"      && "bg-primary/15 text-primary border-primary/40",
                      r.band === "mid"      && "bg-warning/10 text-warning border-warning/30",
                      r.band === "low"      && "bg-muted text-muted-foreground border-border",
                      r.band === "residual" && "bg-muted/50 text-muted-foreground border-border",
                    )}>
                      {r.band === "top" ? "Topo" : r.band === "mid" ? "Meio" : r.band === "low" ? "Cauda" : "Residual"}
                    </span>
                  </td>
                  <td className="py-2 px-2 tabular-nums text-right">{(r.pct * 100).toFixed(1)}%</td>
                  <td className="py-2 px-2 tabular-nums text-right font-medium">{formatNumber(r.plays)}</td>
                  <td className="py-2 px-2 tabular-nums text-right text-muted-foreground">{formatNumber(r.plays * 30)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="nx-card flex items-start gap-3 !py-3">
        <Info className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
        <p className="text-xs text-muted-foreground leading-relaxed">
          Estimativa baseada em comportamento médio de playlists Spotify. Valores teóricos usados como termômetro
          operacional — não refletem plays reais coletados pela API.
        </p>
      </div>
    </section>
  );
}

function SimKpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="nx-card space-y-1.5">
      <div className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground font-semibold">{label}</div>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="text-[10px] text-muted-foreground">{hint}</div>}
    </div>
  );
}
