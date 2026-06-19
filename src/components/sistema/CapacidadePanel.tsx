// CapacidadePanel — visão permanente da capacidade real do ecossistema.
// Lê managed_playlists vivas + genres + genre_affinities + snapshots e calcula
// tudo usando POSITION_PCT (fórmula oficial do planner). Zero lógica paralela.
import { useMemo } from "react";
import { Activity, BarChart3, Layers, Sparkles, TrendingUp, HeartPulse, Network } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from "recharts";
import { useEcosystemSnapshot, useEcosystemHistory } from "@/hooks/useEcosystemSnapshot";
import {
  SCENARIOS, aggregateCapacity, capacityOf, SAVE_BANDS, bandOf, concentrationTop,
} from "@/lib/ecosystemCapacity";
import { formatNumber as fmtNum } from "@/lib/format";

const MIN_SAVES_PISO = 250;

export function CapacidadePanel() {
  const { loading, error, playlists, genres, affinities } = useEcosystemSnapshot();
  const history = useEcosystemHistory(12);

  const agg = useMemo(() => aggregateCapacity(playlists), [playlists]);

  // Bloco 2 — por gênero
  const byGenre = useMemo(() => {
    const map = new Map<string | null, { name: string; pls: typeof playlists }>();
    for (const p of playlists) {
      const key = p.genre_id;
      const name = (key && genres.get(key)?.nome) || "Sem gênero";
      if (!map.has(key)) map.set(key, { name, pls: [] });
      map.get(key)!.pls.push(p);
    }
    return Array.from(map.entries()).map(([key, v]) => {
      const saves = v.pls.reduce((s, p) => s + p.followers, 0);
      const totalSaves = agg.savesTotal || 1;
      return {
        key: key ?? "_",
        name: v.name,
        count: v.pls.length,
        saves,
        conservative: capacityOf(saves, "conservative").daily,
        moderate: capacityOf(saves, "moderate").daily,
        aggressive: capacityOf(saves, "aggressive").daily,
        share: (saves / totalSaves) * 100,
      };
    }).sort((a, b) => b.saves - a.saves);
  }, [playlists, genres, agg.savesTotal]);

  // Bloco 3 — concentração
  const concentration = useMemo(() => ([
    { label: "Top 5%",  ...concentrationTop(playlists, 0.05) },
    { label: "Top 10%", ...concentrationTop(playlists, 0.10) },
    { label: "Top 20%", ...concentrationTop(playlists, 0.20) },
    { label: "Top 50%", ...concentrationTop(playlists, 0.50) },
  ]), [playlists]);

  // Bloco 4 — faixas de saves
  const bands = useMemo(() => {
    const totals = SAVE_BANDS.map(b => ({ ...b, count: 0, saves: 0 }));
    for (const p of playlists) {
      const idx = totals.findIndex(t => t.key === bandOf(p.followers));
      if (idx >= 0) {
        totals[idx].count += 1;
        totals[idx].saves += p.followers;
      }
    }
    const total = agg.savesTotal || 1;
    return totals.map(t => ({
      ...t,
      daily: capacityOf(t.saves, "moderate").daily,
      share: (t.saves / total) * 100,
    }));
  }, [playlists, agg.savesTotal]);

  // Bloco 5 — afinidades top
  const combos = useMemo(() => {
    const savesByGenre = new Map<string, number>();
    for (const p of playlists) {
      if (!p.genre_id) continue;
      savesByGenre.set(p.genre_id, (savesByGenre.get(p.genre_id) ?? 0) + p.followers);
    }
    return affinities
      .filter(a => a.genre_a && a.genre_b)
      .slice(0, 12)
      .map(a => {
        const saves = (savesByGenre.get(a.genre_a_id) ?? 0) + (savesByGenre.get(a.genre_b_id) ?? 0);
        return {
          pair: `${a.genre_a} + ${a.genre_b}`,
          score: a.score,
          saves,
          daily: capacityOf(saves, "moderate").daily,
          monthly: capacityOf(saves, "moderate").monthly,
        };
      })
      .sort((x, y) => y.daily - x.daily);
  }, [affinities, playlists]);

  // Bloco 7 — saúde
  const health = useMemo(() => {
    const ranked = [...byGenre].filter(g => g.key !== "_");
    const strongest = ranked.slice(0, 3);
    const weakest = ranked.slice(-3).reverse();
    const belowFloor = playlists.filter(p => (p.followers || 0) < MIN_SAVES_PISO).length;
    const noSaves = playlists.filter(p => !p.followers || p.followers === 0).length;
    return { strongest, weakest, belowFloor, noSaves };
  }, [byGenre, playlists]);

  // Bloco 6 — série histórica + capacidade
  const historyChart = useMemo(() => history.series.map(p => ({
    month: p.month,
    playlists: p.playlists,
    saves: p.savesTotal,
    capDia: capacityOf(p.savesTotal, "moderate").daily,
    capMes: capacityOf(p.savesTotal, "moderate").monthly,
  })), [history.series]);

  if (loading) {
    return <div className="text-sm text-muted-foreground">Carregando ecossistema…</div>;
  }
  if (error) {
    return <div className="text-sm text-destructive">Erro: {error}</div>;
  }

  return (
    <div className="space-y-8">
      {/* === BLOCO 1 — RESUMO === */}
      <Section icon={Activity} title="Resumo geral" subtitle="Estado vivo do ecossistema">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Kpi label="Playlists ativas" value={fmtNum(agg.playlistCount)} />
          <Kpi label="Saves totais" value={fmtNum(agg.savesTotal)} />
          <Kpi label={`${SCENARIOS.moderate.label} · dia`} value={fmtNum(agg.moderate.daily)} accent="primary" />
          <Kpi label={`${SCENARIOS.moderate.label} · mês`} value={fmtNum(agg.moderate.monthly)} accent="primary" />
          <Kpi label={`${SCENARIOS.conservative.label} · dia`} value={fmtNum(agg.conservative.daily)} hint={`pos #${SCENARIOS.conservative.position}`} />
          <Kpi label={`${SCENARIOS.aggressive.label} · dia`}   value={fmtNum(agg.aggressive.daily)}   hint={`pos #${SCENARIOS.aggressive.position}`} />
          <Kpi label={`${SCENARIOS.conservative.label} · mês`} value={fmtNum(agg.conservative.monthly)} />
          <Kpi label={`${SCENARIOS.aggressive.label} · mês`}   value={fmtNum(agg.aggressive.monthly)} />
        </div>
        <p className="text-[11px] text-muted-foreground mt-3">
          Fórmula: <code>saves × (mult/30) × POSITION_PCT[pos]</code> · conservador = pos #5 (6%) · médio = pos #3 (8%) · agressivo = pos #1 (12%).
        </p>
      </Section>

      {/* === BLOCO 2 — POR GÊNERO === */}
      <Section icon={Layers} title="Capacidade por gênero" subtitle="Ordenado por saves totais">
        <div className="nx-card overflow-hidden">
          <div className="max-h-[480px] overflow-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 sticky top-0 text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <Th>Gênero</Th><Th right>Playlists</Th><Th right>Saves</Th>
                  <Th right>Cons./dia</Th><Th right>Médio/dia</Th><Th right>Agr./dia</Th>
                  <Th right>%</Th>
                </tr>
              </thead>
              <tbody>
                {byGenre.map(g => (
                  <tr key={g.key} className="border-t border-border hover:bg-muted/20">
                    <Td>{g.name}</Td>
                    <Td right>{fmtNum(g.count)}</Td>
                    <Td right>{fmtNum(g.saves)}</Td>
                    <Td right>{fmtNum(g.conservative)}</Td>
                    <Td right className="text-primary font-medium">{fmtNum(g.moderate)}</Td>
                    <Td right>{fmtNum(g.aggressive)}</Td>
                    <Td right>{g.share.toFixed(1)}%</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Section>

      {/* === BLOCO 3 — CONCENTRAÇÃO === */}
      <Section icon={BarChart3} title="Concentração" subtitle="Quanto cada topo de catálogo carrega da capacidade">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {concentration.map(c => (
            <div key={c.label} className="nx-card p-4">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{c.label}</p>
              <p className="text-2xl font-semibold mt-1">{c.sharePct.toFixed(1)}%</p>
              <p className="text-[11px] text-muted-foreground mt-1">
                {fmtNum(c.countTop)} playlists · {fmtNum(c.daily)}/dia (médio)
              </p>
            </div>
          ))}
        </div>
      </Section>

      {/* === BLOCO 4 — FAIXAS === */}
      <Section icon={Layers} title="Distribuição por faixa de saves" subtitle="Onde a capacidade realmente vive">
        <div className="nx-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <Th>Faixa</Th><Th right>Playlists</Th><Th right>Saves</Th>
                <Th right>Cap./dia (médio)</Th><Th right>%</Th>
              </tr>
            </thead>
            <tbody>
              {bands.map(b => (
                <tr key={b.key} className="border-t border-border">
                  <Td>{b.label}</Td>
                  <Td right>{fmtNum(b.count)}</Td>
                  <Td right>{fmtNum(b.saves)}</Td>
                  <Td right className="text-primary font-medium">{fmtNum(b.daily)}</Td>
                  <Td right>{b.share.toFixed(1)}%</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {/* === BLOCO 5 — AFINIDADES === */}
      <Section icon={Network} title="Afinidades de gênero" subtitle="Combinações com score ≥ 0.6 — capacidade somada">
        {combos.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma afinidade ≥ 0.6 registrada ainda.</p>
        ) : (
          <div className="nx-card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <Th>Combinação</Th><Th right>Score</Th><Th right>Saves</Th>
                  <Th right>Cap./dia</Th><Th right>Cap./mês</Th>
                </tr>
              </thead>
              <tbody>
                {combos.map(c => (
                  <tr key={c.pair} className="border-t border-border">
                    <Td>{c.pair}</Td>
                    <Td right>{c.score.toFixed(2)}</Td>
                    <Td right>{fmtNum(c.saves)}</Td>
                    <Td right className="text-primary font-medium">{fmtNum(c.daily)}</Td>
                    <Td right>{fmtNum(c.monthly)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* === BLOCO 6 — EVOLUÇÃO === */}
      <Section icon={TrendingUp} title="Evolução histórica" subtitle="Crescimento mensal a partir dos snapshots">
        {historyChart.length < 2 ? (
          <p className="text-sm text-muted-foreground">
            Ainda sem histórico suficiente. A série aparece quando houver pelo menos 2 meses de snapshots.
          </p>
        ) : (
          <div className="nx-card p-4">
            <div className="h-[280px]">
              <ResponsiveContainer>
                <LineChart data={historyChart}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="month" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                  <YAxis yAxisId="L" stroke="hsl(var(--muted-foreground))" fontSize={11} tickFormatter={fmtNum} />
                  <YAxis yAxisId="R" orientation="right" stroke="hsl(var(--muted-foreground))" fontSize={11} tickFormatter={fmtNum} />
                  <Tooltip
                    contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 12 }}
                    formatter={(v: number) => fmtNum(v)}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line yAxisId="L" type="monotone" dataKey="playlists" name="Playlists" stroke="hsl(var(--muted-foreground))" dot={false} />
                  <Line yAxisId="R" type="monotone" dataKey="saves" name="Saves" stroke="hsl(var(--primary))" dot={false} strokeWidth={2} />
                  <Line yAxisId="R" type="monotone" dataKey="capMes" name="Cap. mês" stroke="hsl(258 60% 70%)" dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </Section>

      {/* === BLOCO 7 — SAÚDE === */}
      <Section icon={HeartPulse} title="Saúde do ecossistema" subtitle="Onde investir e onde tem gordura pra cortar">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="nx-card p-4">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">Gêneros mais fortes</p>
            <ul className="space-y-1 text-sm">
              {health.strongest.map(g => (
                <li key={g.key} className="flex justify-between">
                  <span>{g.name}</span>
                  <span className="text-primary tabular-nums">{fmtNum(g.moderate)}/dia</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="nx-card p-4">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">Gêneros mais fracos</p>
            <ul className="space-y-1 text-sm">
              {health.weakest.map(g => (
                <li key={g.key} className="flex justify-between">
                  <span>{g.name}</span>
                  <span className="text-muted-foreground tabular-nums">{fmtNum(g.moderate)}/dia</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="nx-card p-4">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Playlists abaixo do piso ({MIN_SAVES_PISO} saves)</p>
            <p className="text-2xl font-semibold mt-1">{fmtNum(health.belowFloor)}</p>
            <p className="text-[11px] text-muted-foreground mt-1">
              Representam &lt; 1% da capacidade — candidatas a filtro ou cleanup.
            </p>
          </div>
          <div className="nx-card p-4">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Playlists sem saves</p>
            <p className="text-2xl font-semibold mt-1">{fmtNum(health.noSaves)}</p>
            <p className="text-[11px] text-muted-foreground mt-1">Sem atividade relevante — revisar ou arquivar.</p>
          </div>
        </div>
      </Section>
    </div>
  );
}

// ───────────────────────── helpers de UI ─────────────────────────

function Section({ icon: Icon, title, subtitle, children }: {
  icon: LucideIcon; title: string; subtitle: string; children: React.ReactNode;
}) {
  return (
    <section>
      <div className="flex items-center gap-3 mb-3">
        <div className="h-8 w-8 rounded-md bg-muted/40 border border-border flex items-center justify-center">
          <Icon className="h-4 w-4 text-muted-foreground" />
        </div>
        <div>
          <h2 className="text-[15px] font-semibold leading-tight text-foreground">{title}</h2>
          <p className="text-[12px] text-muted-foreground leading-tight">{subtitle}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

function Kpi({ label, value, hint, accent }: { label: string; value: string; hint?: string; accent?: "primary" }) {
  return (
    <div className="nx-card p-4">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`text-2xl font-semibold mt-1 tabular-nums ${accent === "primary" ? "text-primary" : ""}`}>{value}</p>
      {hint && <p className="text-[11px] text-muted-foreground mt-1">{hint}</p>}
    </div>
  );
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return <th className={`px-3 py-2 ${right ? "text-right" : "text-left"} font-medium`}>{children}</th>;
}
function Td({ children, right, className }: { children: React.ReactNode; right?: boolean; className?: string }) {
  return <td className={`px-3 py-2 ${right ? "text-right tabular-nums" : ""} ${className ?? ""}`}>{children}</td>;
}
