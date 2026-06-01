// SpotifyPilotPanel — dashboard temporário de validação da Fase 1.5 da
// camada Spotify. Mostra agregações sobre `spotify_call_log` e avalia
// automaticamente os critérios de aprovação para liberar a Fase 2.
//
// Critérios de aprovação (todos precisam estar ✅):
//   1. ≥ 100 chamadas registradas nos últimos 7 dias
//   2. ≥ 3 funções distintas logando (as 3 piloto)
//   3. ≥ 3 endpoints distintos
//   4. function_name preenchido em 100% das linhas
//   5. duration_ms > 0 em ≥ 99% das linhas
//   6. taxa de erro (status != 'ok') < 5%
//   7. nenhuma linha com status = 'exception' (falha de logging/cliente)
//
// Quando todos passarem, a Fase 1.5 está validada e o painel mostra
// "PRONTO PARA FASE 2".
import { useEffect, useState } from "react";
import { CheckCircle2, XCircle, AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

type Row = {
  function_name: string | null;
  endpoint: string;
  status: string;
  duration_ms: number | null;
  http_status: number | null;
  app_id: string | null;
  created_at: string;
};

type Agg = {
  total: number;
  totalOk: number;
  totalErr: number;
  totalException: number;
  withFn: number;
  withDuration: number;
  byFn: Map<string, number>;
  byEndpoint: Map<string, { count: number; avg: number; p95: number; errors: number }>;
  byStatus: Map<string, number>;
  byApp: Map<string, number>;
  firstAt: string | null;
  lastAt: string | null;
  avgMs: number;
  p95Ms: number;
};

const MIN_CALLS = 100;
const MIN_FUNCTIONS = 3;
const MIN_ENDPOINTS = 3;
const MAX_ERROR_RATE = 0.05;

function pct95(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
  return sorted[idx] ?? 0;
}

function aggregate(rows: Row[]): Agg {
  const byFn = new Map<string, number>();
  const byEndpoint = new Map<string, { count: number; sum: number; durations: number[]; errors: number }>();
  const byStatus = new Map<string, number>();
  const byApp = new Map<string, number>();
  let totalOk = 0, totalErr = 0, totalException = 0, withFn = 0, withDuration = 0;
  const allDurations: number[] = [];
  let firstAt: string | null = null;
  let lastAt: string | null = null;

  for (const r of rows) {
    if (r.function_name) {
      withFn++;
      byFn.set(r.function_name, (byFn.get(r.function_name) ?? 0) + 1);
    }
    const ep = byEndpoint.get(r.endpoint) ?? { count: 0, sum: 0, durations: [], errors: 0 };
    ep.count++;
    if (r.duration_ms != null && r.duration_ms > 0) {
      ep.sum += r.duration_ms;
      ep.durations.push(r.duration_ms);
      allDurations.push(r.duration_ms);
      withDuration++;
    }
    if (r.status !== "ok") ep.errors++;
    byEndpoint.set(r.endpoint, ep);

    byStatus.set(r.status, (byStatus.get(r.status) ?? 0) + 1);
    byApp.set(r.app_id ?? "(null)", (byApp.get(r.app_id ?? "(null)") ?? 0) + 1);

    if (r.status === "ok") totalOk++;
    else totalErr++;
    if (r.status === "exception") totalException++;

    if (!firstAt || r.created_at < firstAt) firstAt = r.created_at;
    if (!lastAt || r.created_at > lastAt) lastAt = r.created_at;
  }

  const endpointAgg = new Map<string, { count: number; avg: number; p95: number; errors: number }>();
  for (const [k, v] of byEndpoint.entries()) {
    endpointAgg.set(k, {
      count: v.count,
      avg: v.durations.length > 0 ? Math.round(v.sum / v.durations.length) : 0,
      p95: Math.round(pct95(v.durations)),
      errors: v.errors,
    });
  }

  return {
    total: rows.length,
    totalOk, totalErr, totalException,
    withFn, withDuration,
    byFn, byEndpoint: endpointAgg, byStatus, byApp,
    firstAt, lastAt,
    avgMs: allDurations.length > 0 ? Math.round(allDurations.reduce((a, b) => a + b, 0) / allDurations.length) : 0,
    p95Ms: Math.round(pct95(allDurations)),
  };
}

type Check = { label: string; ok: boolean; detail: string };

function buildChecks(a: Agg): Check[] {
  const errRate = a.total > 0 ? a.totalErr / a.total : 0;
  const fnCoverage = a.total > 0 ? a.withFn / a.total : 0;
  const durCoverage = a.total > 0 ? a.withDuration / a.total : 0;
  return [
    {
      label: `≥ ${MIN_CALLS} chamadas registradas (7d)`,
      ok: a.total >= MIN_CALLS,
      detail: `${a.total} chamadas`,
    },
    {
      label: `≥ ${MIN_FUNCTIONS} funções distintas logando`,
      ok: a.byFn.size >= MIN_FUNCTIONS,
      detail: `${a.byFn.size} funções: ${[...a.byFn.keys()].slice(0, 5).join(", ") || "—"}`,
    },
    {
      label: `≥ ${MIN_ENDPOINTS} endpoints distintos`,
      ok: a.byEndpoint.size >= MIN_ENDPOINTS,
      detail: `${a.byEndpoint.size} endpoints`,
    },
    {
      label: `function_name preenchido em 100%`,
      ok: a.total > 0 && fnCoverage >= 0.999,
      detail: `${(fnCoverage * 100).toFixed(1)}%`,
    },
    {
      label: `duration_ms > 0 em ≥ 99%`,
      ok: a.total > 0 && durCoverage >= 0.99,
      detail: `${(durCoverage * 100).toFixed(1)}% · avg ${a.avgMs}ms · p95 ${a.p95Ms}ms`,
    },
    {
      label: `taxa de erro < ${(MAX_ERROR_RATE * 100).toFixed(0)}%`,
      ok: a.total > 0 && errRate < MAX_ERROR_RATE,
      detail: `${(errRate * 100).toFixed(2)}% (${a.totalErr}/${a.total})`,
    },
    {
      label: `nenhuma linha com status='exception'`,
      ok: a.totalException === 0,
      detail: `${a.totalException} exceções`,
    },
  ];
}

export function SpotifyPilotPanel() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const { data, error: err } = await supabase
        .from("spotify_call_log")
        .select("function_name,endpoint,status,duration_ms,http_status,app_id,created_at")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(10000);
      if (cancelled) return;
      if (err) setError(err.message);
      else setRows((data ?? []) as Row[]);
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [refreshKey]);

  const agg = rows ? aggregate(rows) : null;
  const checks = agg ? buildChecks(agg) : [];
  const allOk = checks.length > 0 && checks.every((c) => c.ok);

  return (
    <div className="space-y-6">
      <div className="nx-card p-5">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">Spotify · Piloto Fase 1.5</h2>
            <p className="text-xs text-muted-foreground mt-1">
              Validação automática da instrumentação. Janela: últimos 7 dias.
              {agg?.lastAt && <> · Última chamada: {new Date(agg.lastAt).toLocaleString("pt-BR")}</>}
            </p>
          </div>
          <button
            onClick={() => setRefreshKey((k) => k + 1)}
            disabled={loading}
            className="inline-flex items-center gap-2 px-3 h-8 rounded-md border border-border text-xs font-medium hover:bg-muted/40 disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Atualizar
          </button>
        </div>

        {error && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 text-destructive text-xs px-3 py-2 mb-3">
            Erro ao carregar: {error}
          </div>
        )}

        {agg && (
          <>
            <div
              className={cn(
                "rounded-lg border px-4 py-3 mb-4 flex items-center gap-3",
                allOk
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-warning/40 bg-warning/10 text-warning",
              )}
            >
              {allOk ? <CheckCircle2 className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />}
              <div>
                <div className="text-sm font-semibold">
                  {allOk ? "✅ FASE 1.5 VALIDADA — pronto para Fase 2" : "⏳ Aguardando dados suficientes"}
                </div>
                <div className="text-[11px] opacity-80">
                  {allOk
                    ? "Todos os critérios objetivos foram atingidos. Pode avançar para distribuição multi-app."
                    : `${checks.filter((c) => c.ok).length}/${checks.length} critérios atingidos`}
                </div>
              </div>
            </div>

            <ul className="space-y-2">
              {checks.map((c) => (
                <li key={c.label} className="flex items-start gap-3 text-sm">
                  {c.ok ? (
                    <CheckCircle2 className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                  ) : (
                    <XCircle className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className={cn("font-medium", c.ok ? "text-foreground" : "text-muted-foreground")}>
                      {c.label}
                    </div>
                    <div className="text-[11px] text-muted-foreground truncate">{c.detail}</div>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}

        {!agg && !loading && !error && (
          <div className="text-xs text-muted-foreground">Sem dados.</div>
        )}
      </div>

      {agg && agg.total > 0 && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <StatCard label="Total (7d)" value={agg.total.toLocaleString("pt-BR")} hint={`OK: ${agg.totalOk} · Erro: ${agg.totalErr}`} />
            <StatCard label="Latência média" value={`${agg.avgMs} ms`} hint={`p95: ${agg.p95Ms} ms`} />
            <StatCard label="Funções ativas" value={String(agg.byFn.size)} hint={`${agg.byEndpoint.size} endpoints`} />
          </div>

          <Section title="Por função">
            <BreakdownTable
              rows={[...agg.byFn.entries()]
                .sort((a, b) => b[1] - a[1])
                .map(([k, v]) => ({ key: k, count: v }))}
              total={agg.total}
            />
          </Section>

          <Section title="Por endpoint">
            <div className="nx-card overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-muted/30 text-muted-foreground">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">Endpoint</th>
                    <th className="text-right px-3 py-2 font-medium">Chamadas</th>
                    <th className="text-right px-3 py-2 font-medium">Erros</th>
                    <th className="text-right px-3 py-2 font-medium">avg ms</th>
                    <th className="text-right px-3 py-2 font-medium">p95 ms</th>
                  </tr>
                </thead>
                <tbody>
                  {[...agg.byEndpoint.entries()]
                    .sort((a, b) => b[1].count - a[1].count)
                    .map(([ep, v]) => (
                      <tr key={ep} className="border-t border-border">
                        <td className="px-3 py-2 font-mono text-[11px] text-foreground truncate max-w-[280px]">{ep}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{v.count}</td>
                        <td className={cn("px-3 py-2 text-right tabular-nums", v.errors > 0 && "text-destructive")}>{v.errors}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{v.avg}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{v.p95}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </Section>

          <Section title="Por status">
            <BreakdownTable
              rows={[...agg.byStatus.entries()]
                .sort((a, b) => b[1] - a[1])
                .map(([k, v]) => ({ key: k, count: v }))}
              total={agg.total}
            />
          </Section>

          <Section title="Por app (Fase 2 vai preencher)">
            <BreakdownTable
              rows={[...agg.byApp.entries()]
                .sort((a, b) => b[1] - a[1])
                .map(([k, v]) => ({ key: k, count: v }))}
              total={agg.total}
            />
          </Section>
        </>
      )}
    </div>
  );
}

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="nx-card p-4">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold text-foreground mt-1 tabular-nums">{value}</div>
      {hint && <div className="text-[11px] text-muted-foreground mt-1">{hint}</div>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="text-sm font-semibold text-foreground mb-2">{title}</h3>
      {children}
    </section>
  );
}

function BreakdownTable({ rows, total }: { rows: { key: string; count: number }[]; total: number }) {
  if (rows.length === 0) return <div className="text-xs text-muted-foreground">—</div>;
  return (
    <div className="nx-card overflow-hidden">
      <table className="w-full text-xs">
        <tbody>
          {rows.map((r) => {
            const pct = total > 0 ? (r.count / total) * 100 : 0;
            return (
              <tr key={r.key} className="border-t border-border first:border-t-0">
                <td className="px-3 py-2 font-mono text-[11px] text-foreground truncate max-w-[280px]">{r.key}</td>
                <td className="px-3 py-2 text-right tabular-nums w-20">{r.count}</td>
                <td className="px-3 py-2 text-right text-muted-foreground tabular-nums w-16">{pct.toFixed(1)}%</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
