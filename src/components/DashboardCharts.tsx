import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";

const ACCENT = "hsl(var(--primary))";
const SUCCESS = "hsl(var(--success))";
const DESTRUCTIVE = "hsl(var(--destructive))";
const MUTED = "hsl(var(--muted-foreground))";

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function fmtDayShort(s: string): string {
  const d = new Date(s + "T00:00:00");
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

interface DailyPoint { day: string; sucesso: number; erro: number }
interface GenrePoint { nome: string; playlists: number }
interface StatusPoint { name: string; value: number; color: string }

export default function DashboardCharts() {
  const [daily, setDaily] = useState<DailyPoint[]>([]);
  const [topGenres, setTopGenres] = useState<GenrePoint[]>([]);
  const [statusBreakdown, setStatusBreakdown] = useState<StatusPoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const since = new Date();
      since.setDate(since.getDate() - 13);
      since.setHours(0, 0, 0, 0);

      const [{ data: logs }, { data: genres }] = await Promise.all([
        supabase
          .from("collection_logs")
          .select("status,created_at,acao")
          .gte("created_at", since.toISOString())
          .limit(5000),
        supabase
          .from("genres")
          .select("nome,total_playlists,status")
          .order("total_playlists", { ascending: false, nullsFirst: false })
          .limit(50),
      ]);
      if (!mounted) return;

      // Daily
      const byDay = new Map<string, { sucesso: number; erro: number }>();
      for (let i = 0; i < 14; i++) {
        const d = new Date(since); d.setDate(since.getDate() + i);
        byDay.set(dayKey(d), { sucesso: 0, erro: 0 });
      }
      for (const l of logs ?? []) {
        if (!l.created_at) continue;
        if (l.acao !== "run-search") continue;
        const k = dayKey(new Date(l.created_at));
        const slot = byDay.get(k);
        if (!slot) continue;
        if (l.status === "sucesso") slot.sucesso++;
        else if (l.status === "erro") slot.erro++;
      }
      setDaily(Array.from(byDay.entries()).map(([day, v]) => ({ day, ...v })));

      // Top genres
      setTopGenres(
        (genres ?? [])
          .filter(g => (g.total_playlists ?? 0) > 0)
          .slice(0, 5)
          .map(g => ({ nome: g.nome, playlists: g.total_playlists ?? 0 })),
      );

      // Status breakdown
      const counts = { pendente: 0, coletando: 0, analisado: 0, erro: 0 };
      for (const g of genres ?? []) {
        const s = (g.status ?? "pendente") as keyof typeof counts;
        if (s in counts) counts[s]++;
      }
      setStatusBreakdown([
        { name: "Analisados", value: counts.analisado, color: SUCCESS },
        { name: "Coletando", value: counts.coletando, color: ACCENT },
        { name: "Pendentes", value: counts.pendente, color: MUTED },
        { name: "Com erro", value: counts.erro, color: DESTRUCTIVE },
      ].filter(p => p.value > 0));

      setLoading(false);
    })();
    return () => { mounted = false; };
  }, []);

  const totalSucesso = useMemo(() => daily.reduce((s, d) => s + d.sucesso, 0), [daily]);
  const totalErro = useMemo(() => daily.reduce((s, d) => s + d.erro, 0), [daily]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {/* Daily area chart - 2 cols */}
      <div className="nx-card p-5 lg:col-span-2">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div>
            <h2 className="font-semibold">Coletas (últimos 14 dias)</h2>
            <p className="text-xs text-muted-foreground">Buscas executadas por dia</p>
          </div>
          <div className="flex gap-3 text-xs">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ background: SUCCESS }} />
              {totalSucesso} sucesso
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ background: DESTRUCTIVE }} />
              {totalErro} erro
            </span>
          </div>
        </div>
        <div className="h-56">
          {loading ? (
            <div className="h-full grid place-items-center text-xs text-muted-foreground">Carregando…</div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={daily} margin={{ top: 5, right: 8, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="grad-success" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={SUCCESS} stopOpacity={0.6} />
                    <stop offset="100%" stopColor={SUCCESS} stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="grad-error" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={DESTRUCTIVE} stopOpacity={0.5} />
                    <stop offset="100%" stopColor={DESTRUCTIVE} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="day" tickFormatter={fmtDayShort} stroke={MUTED} fontSize={11} />
                <YAxis allowDecimals={false} stroke={MUTED} fontSize={11} />
                <Tooltip
                  contentStyle={{
                    background: "hsl(var(--card))", border: "1px solid hsl(var(--border))",
                    borderRadius: 8, fontSize: 12,
                  }}
                  labelFormatter={fmtDayShort}
                />
                <Area type="monotone" dataKey="sucesso" stroke={SUCCESS} fill="url(#grad-success)" strokeWidth={2} />
                <Area type="monotone" dataKey="erro" stroke={DESTRUCTIVE} fill="url(#grad-error)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Status pie - 1 col */}
      <div className="nx-card p-5">
        <h2 className="font-semibold">Status dos gêneros</h2>
        <p className="text-xs text-muted-foreground">Distribuição atual</p>
        <div className="h-56">
          {loading ? (
            <div className="h-full grid place-items-center text-xs text-muted-foreground">Carregando…</div>
          ) : statusBreakdown.length === 0 ? (
            <div className="h-full grid place-items-center text-xs text-muted-foreground">Sem dados</div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={statusBreakdown} dataKey="value" nameKey="name" innerRadius={45} outerRadius={75} paddingAngle={2}>
                  {statusBreakdown.map((s, i) => <Cell key={i} fill={s.color} />)}
                </Pie>
                <Tooltip
                  contentStyle={{
                    background: "hsl(var(--card))", border: "1px solid hsl(var(--border))",
                    borderRadius: 8, fontSize: 12,
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Top genres bar - full width */}
      <div className="nx-card p-5 lg:col-span-3">
        <h2 className="font-semibold">Top 5 gêneros por playlists coletadas</h2>
        <p className="text-xs text-muted-foreground">Onde o motor está mais ativo</p>
        <div className="h-56 mt-2">
          {loading ? (
            <div className="h-full grid place-items-center text-xs text-muted-foreground">Carregando…</div>
          ) : topGenres.length === 0 ? (
            <div className="h-full grid place-items-center text-xs text-muted-foreground">Nenhuma coleta ainda</div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={topGenres} layout="vertical" margin={{ top: 5, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                <XAxis type="number" stroke={MUTED} fontSize={11} allowDecimals={false} />
                <YAxis type="category" dataKey="nome" stroke={MUTED} fontSize={11} width={100} />
                <Tooltip
                  contentStyle={{
                    background: "hsl(var(--card))", border: "1px solid hsl(var(--border))",
                    borderRadius: 8, fontSize: 12,
                  }}
                  cursor={{ fill: "hsl(var(--muted) / 0.3)" }}
                />
                <Bar dataKey="playlists" fill={ACCENT} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
}
