// Fase 3.5 — Painel de Validação do Motor de Prioridade.
// Apenas leitura/calibração. Nenhuma decisão operacional é tomada aqui.
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Brain, Play, Save, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type Row = {
  placement_id: string;
  score: number;
  components: any;
  calculated_at: string;
  managed_playlist_id: string;
  catalog_track_id: string;
  track_name: string | null;
  artist_name: string | null;
};

const COMPONENT_KEYS = [
  "spotify_popularity",
  "campaign_boost",
  "growth",
  "release_age",
  "artist_score",
  "diversity_penalty",
  "learning_signal",
] as const;

const COMPONENT_LABELS: Record<string, string> = {
  spotify_popularity: "Popularidade Spotify",
  campaign_boost: "Boost de campanha",
  growth: "Crescimento",
  release_age: "Idade do lançamento",
  artist_score: "Força do artista",
  diversity_penalty: "Diversidade",
  learning_signal: "Aprendizado",
};

async function fetchTop(): Promise<Row[]> {
  const { data, error } = await supabase
    .from("v_placement_priority_latest")
    .select("*")
    .order("score", { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data ?? []) as Row[];
}

async function fetchLatestRun() {
  const { data, error } = await supabase
    .from("engine_priority_runs")
    .select("*")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function fetchWeights(): Promise<Record<string, number>> {
  const { data, error } = await supabase
    .from("system_flags")
    .select("engine_priority_weights")
    .order("id")
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data?.engine_priority_weights ?? {}) as Record<string, number>;
}

function bucket(score: number) {
  if (score < 20) return "0-20";
  if (score < 40) return "20-40";
  if (score < 60) return "40-60";
  if (score < 80) return "60-80";
  return "80+";
}

export function EnginePriorityTab() {
  const qc = useQueryClient();
  const topQ = useQuery({ queryKey: ["engine-priority", "top"], queryFn: fetchTop, staleTime: 30_000 });
  const runQ = useQuery({ queryKey: ["engine-priority", "run"], queryFn: fetchLatestRun, staleTime: 30_000 });
  const weightsQ = useQuery({ queryKey: ["engine-priority", "weights"], queryFn: fetchWeights });

  const [draft, setDraft] = useState<Record<string, string> | null>(null);
  const [selected, setSelected] = useState<Row | null>(null);

  const weights = weightsQ.data ?? {};
  const effectiveDraft = draft ?? Object.fromEntries(COMPONENT_KEYS.map((k) => [k, String(weights[k] ?? 1)]));

  const distribution = useMemo(() => {
    const rows = topQ.data ?? [];
    const buckets: Record<string, number> = { "0-20": 0, "20-40": 0, "40-60": 0, "60-80": 0, "80+": 0 };
    let sum = 0;
    for (const r of rows) {
      buckets[bucket(r.score)] += 1;
      sum += r.score;
    }
    return { buckets, avg: rows.length ? sum / rows.length : 0, count: rows.length };
  }, [topQ.data]);

  const runMut = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("engine_priority_compute_all", { _limit: 5000 });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Cálculo de prioridade executado");
      qc.invalidateQueries({ queryKey: ["engine-priority"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Falha ao executar"),
  });

  const saveMut = useMutation({
    mutationFn: async () => {
      const parsed: Record<string, number> = {};
      for (const k of COMPONENT_KEYS) {
        const v = Number(effectiveDraft[k]);
        if (!Number.isFinite(v)) throw new Error(`Peso inválido em ${COMPONENT_LABELS[k]}`);
        parsed[k] = v;
      }
      const { data: row, error: e1 } = await supabase.from("system_flags").select("id").order("id").limit(1).maybeSingle();
      if (e1) throw e1;
      if (!row) throw new Error("system_flags vazio");
      const { error } = await supabase.from("system_flags").update({ engine_priority_weights: parsed }).eq("id", row.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Pesos salvos. Próximo cálculo já usará a nova calibração.");
      setDraft(null);
      qc.invalidateQueries({ queryKey: ["engine-priority", "weights"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Falha ao salvar"),
  });

  const rows = topQ.data ?? [];
  const latestRun = runQ.data;

  return (
    <div className="space-y-6">
      {/* Hero KPI: Placements avaliados */}
      <section className="rounded-2xl border border-border bg-card p-5">
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Placements avaliados</div>
        <div className="text-5xl font-bold tabular-nums mt-1">{latestRun?.placements_evaluated ?? "—"}</div>
      </section>

      {/* KPIs secundários do último run */}
      <section className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Kpi label="Score médio" value={latestRun?.score_avg != null ? Number(latestRun.score_avg).toFixed(1) : "—"} />
        <Kpi label="Score p50" value={latestRun?.score_p50 != null ? Number(latestRun.score_p50).toFixed(1) : "—"} />
        <Kpi label="Score p90" value={latestRun?.score_p90 != null ? Number(latestRun.score_p90).toFixed(1) : "—"} />
        <Kpi label="Duração" value={latestRun?.duration_ms != null ? `${latestRun.duration_ms} ms` : "—"} />
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => runMut.mutate()} disabled={runMut.isPending} className="gap-1.5">
          <Play className="h-4 w-4" />
          {runMut.isPending ? "Executando…" : "Executar agora"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => qc.invalidateQueries({ queryKey: ["engine-priority"] })}
          className="gap-1.5"
        >
          <RefreshCw className="h-4 w-4" />
          Recarregar
        </Button>
        {latestRun?.started_at && (
          <span className="text-xs text-muted-foreground">
            Último run: {new Date(latestRun.started_at).toLocaleString("pt-BR")}
          </span>
        )}
      </div>

      {/* Distribuição */}
      <section className="rounded-2xl border border-border bg-card p-4">
        <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
          <Brain className="h-4 w-4 text-primary" />
          Distribuição dos scores ({distribution.count} placements no topo)
        </h3>
        <div className="grid grid-cols-5 gap-2">
          {Object.entries(distribution.buckets).map(([k, v]) => {
            const max = Math.max(1, ...Object.values(distribution.buckets));
            const pct = (v / max) * 100;
            return (
              <div key={k} className="flex flex-col items-center gap-1.5">
                <div className="w-full h-20 bg-border/40 rounded-md overflow-hidden flex items-end">
                  <div className="w-full bg-primary/70 transition-all" style={{ height: `${pct}%` }} />
                </div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{k}</div>
                <div className="text-sm font-semibold tabular-nums">{v}</div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Ranking */}
      <section className="rounded-2xl border border-border bg-card">
        <div className="px-4 py-3 border-b border-border">
          <h3 className="text-sm font-semibold">Ranking ({rows.length})</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wider text-muted-foreground">
              <tr className="border-b border-border">
                <th className="text-left px-3 py-2 w-12">#</th>
                <th className="text-left px-3 py-2">Música</th>
                <th className="text-left px-3 py-2">Artista</th>
                <th className="text-right px-3 py-2 w-20">Score</th>
                <th className="text-left px-3 py-2 w-44">Calculado em</th>
              </tr>
            </thead>
            <tbody>
              {topQ.isLoading && (
                <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">Carregando…</td></tr>
              )}
              {!topQ.isLoading && rows.length === 0 && (
                <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">Nenhum score calculado ainda. Clique em "Executar agora".</td></tr>
              )}
              {rows.map((r, i) => (
                <tr
                  key={r.placement_id}
                  className={cn(
                    "border-b border-border/50 hover:bg-muted/30 cursor-pointer",
                    selected?.placement_id === r.placement_id && "bg-muted/40",
                  )}
                  onClick={() => setSelected(r)}
                >
                  <td className="px-3 py-2 tabular-nums text-muted-foreground">{i + 1}</td>
                  <td className="px-3 py-2 font-medium">{r.track_name ?? "—"}</td>
                  <td className="px-3 py-2 text-muted-foreground">{r.artist_name ?? "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold">{Number(r.score).toFixed(1)}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{new Date(r.calculated_at).toLocaleString("pt-BR")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Pesos calibráveis */}
      <section className="rounded-2xl border border-border bg-card p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold">Calibração de pesos</h3>
          <div className="flex gap-2">
            {draft && (
              <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>
                Cancelar
              </Button>
            )}
            <Button size="sm" onClick={() => saveMut.mutate()} disabled={!draft || saveMut.isPending} className="gap-1.5">
              <Save className="h-4 w-4" />
              Salvar pesos
            </Button>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {COMPONENT_KEYS.map((k) => (
            <label key={k} className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">{COMPONENT_LABELS[k]}</span>
              <Input
                type="number"
                step="0.05"
                value={effectiveDraft[k]}
                onChange={(e) => setDraft({ ...effectiveDraft, [k]: e.target.value })}
                className="h-8 text-sm"
              />
            </label>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground mt-3">
          Cada peso multiplica o valor bruto do componente. Alterações entram em vigor no próximo cálculo (manual ou cron horário).
        </p>
      </section>

      {/* Explicabilidade */}
      {selected && (
        <section className="rounded-2xl border border-primary/30 bg-card p-4">
          <div className="flex items-start justify-between mb-3">
            <div>
              <div className="text-xs text-muted-foreground uppercase tracking-wider">Composição do score</div>
              <div className="text-base font-semibold">{selected.track_name} — {selected.artist_name}</div>
            </div>
            <div className="text-right">
              <div className="text-xs text-muted-foreground">Score final</div>
              <div className="text-2xl font-bold text-primary tabular-nums">{Number(selected.score).toFixed(1)}</div>
            </div>
          </div>
          <ComponentsBreakdown components={selected.components} />
        </section>
      )}
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: any }) {
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold tabular-nums mt-0.5">{value}</div>
    </div>
  );
}

function ComponentsBreakdown({ components }: { components: any }) {
  if (!components) return <div className="text-sm text-muted-foreground">Sem componentes.</div>;
  const raw = components.raw ?? components;
  const weighted = components.weighted ?? null;
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div>
        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Valor bruto</div>
        <div className="space-y-1">
          {Object.entries(raw).map(([k, v]) => (
            <Row k={COMPONENT_LABELS[k] ?? k} v={typeof v === "boolean" ? (v ? "sim" : "não") : String(v)} />
          ))}
        </div>
      </div>
      {weighted && (
        <div>
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Contribuição final (× peso)</div>
          <div className="space-y-1">
            {Object.entries(weighted).map(([k, v]) => {
              const num = Number(v);
              return (
                <Row
                  k={COMPONENT_LABELS[k] ?? k}
                  v={(num >= 0 ? "+" : "") + num.toFixed(2)}
                  positive={num > 0}
                  negative={num < 0}
                />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ k, v, positive, negative }: { k: string; v: string; positive?: boolean; negative?: boolean }) {
  return (
    <div className="flex items-center justify-between text-sm border-b border-border/40 py-1">
      <span className="text-muted-foreground">{k}</span>
      <span
        className={cn(
          "tabular-nums font-medium",
          positive && "text-primary",
          negative && "text-rose-400",
        )}
      >
        {v}
      </span>
    </div>
  );
}
