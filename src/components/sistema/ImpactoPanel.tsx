// Wave 3 — Painel de Impacto
// Mede o que aconteceu com as sugestões: o que virou ação, o que o curador adotou
// e qual o delta de streams 28 dias depois. Tudo determinístico, sem ML.
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, Play } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { Kpi } from "@/components/ui/kpi";

type FitRow = {
  id: string;
  spotify_track_id: string;
  spotify_playlist_id: string;
  recommendation_kind: "adicionar" | "remover" | "manter";
  fit_score: number;
  confidence: number;
  evidence: any;
  calculated_at: string;
};
type FeedbackRow = {
  fit_id: string;
  action: string;
  deal_id: string | null;
  created_at: string;
};
type OutcomeRow = {
  fit_id: string;
  outcome_kind: string;
  detected_at: string | null;
  impact_delta_pct: number | null;
  verdict: "acertou" | "errou" | "inconclusivo" | null;
};
type DealRow = { id: string; curator_id: string | null; curator_name: string | null };

const VERDICT_COLORS: Record<string, string> = {
  acertou: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  errou: "bg-rose-500/15 text-rose-400 border-rose-500/30",
  inconclusivo: "bg-zinc-500/15 text-zinc-300 border-zinc-500/30",
};
const KIND_COLORS: Record<string, string> = {
  adicionar: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  remover: "bg-rose-500/15 text-rose-400 border-rose-500/30",
  manter: "bg-zinc-500/15 text-zinc-300 border-zinc-500/30",
};

function fmtPct(n: number | null | undefined): string {
  if (n == null) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${Number(n).toFixed(1)}%`;
}

export function ImpactoPanel() {
  const [fits, setFits] = useState<FitRow[]>([]);
  const [feedbacks, setFeedbacks] = useState<FeedbackRow[]>([]);
  const [outcomes, setOutcomes] = useState<OutcomeRow[]>([]);
  const [deals, setDeals] = useState<DealRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const { toast } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: fb }, { data: outc }] = await Promise.all([
      supabase.from("recommendation_feedback").select("fit_id, action, deal_id, created_at").limit(5000),
      supabase.from("recommendation_outcome").select("fit_id, outcome_kind, detected_at, impact_delta_pct, verdict").limit(5000),
    ]);
    const fbRows = (fb ?? []) as FeedbackRow[];
    const outcRows = (outc ?? []) as OutcomeRow[];
    setFeedbacks(fbRows);
    setOutcomes(outcRows);

    const fitIds = Array.from(new Set([
      ...fbRows.map((r) => r.fit_id),
      ...outcRows.map((r) => r.fit_id),
    ]));
    const dealIds = Array.from(new Set(fbRows.map((r) => r.deal_id).filter(Boolean) as string[]));

    const [fitsRes, dealsRes] = await Promise.all([
      fitIds.length
        ? supabase.from("track_playlist_fit")
            .select("id, spotify_track_id, spotify_playlist_id, recommendation_kind, fit_score, confidence, evidence, calculated_at")
            .in("id", fitIds)
        : Promise.resolve({ data: [] as any[] }),
      dealIds.length
        ? supabase.from("curator_deals").select("id, curator_id, curator_name").in("id", dealIds)
        : Promise.resolve({ data: [] as any[] }),
    ]);
    setFits((fitsRes.data ?? []) as FitRow[]);
    setDeals((dealsRes.data ?? []) as DealRow[]);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const runDetection = async () => {
    setRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke("detect-recommendation-outcomes", { body: {} });
      if (error) throw error;
      toast({
        title: "Detecção concluída",
        description: `${data?.processed ?? 0} fits processados · ${data?.detected ?? 0} detecções · ${data?.verdicts ?? 0} vereditos`,
      });
      await load();
    } catch (e) {
      toast({ title: "Erro", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setRunning(false);
    }
  };

  const fitById = useMemo(() => new Map(fits.map((f) => [f.id, f])), [fits]);
  const outcomeByFit = useMemo(() => new Map(outcomes.map((o) => [o.fit_id, o])), [outcomes]);
  const dealById = useMemo(() => new Map(deals.map((d) => [d.id, d])), [deals]);

  // KPIs
  const kpis = useMemo(() => {
    const total = fits.length;
    const adopted = feedbacks.filter((f) => f.action === "converted_to_deal" || f.action === "removal_requested").length;
    const detected = outcomes.filter((o) => o.outcome_kind === "added" || o.outcome_kind === "removed").length;
    const acertos = outcomes.filter((o) => o.verdict === "acertou").length;
    const erros = outcomes.filter((o) => o.verdict === "errou").length;
    const inconc = outcomes.filter((o) => o.verdict === "inconclusivo").length;
    const pending = outcomes.filter((o) => !o.verdict).length;
    const judged = acertos + erros + inconc;
    const accuracy = (acertos + erros) > 0 ? Math.round((acertos / (acertos + erros)) * 100) : null;
    return { total, adopted, detected, acertos, erros, inconc, pending, judged, accuracy };
  }, [fits, feedbacks, outcomes]);

  // Acerto por tipo (adicionar / remover / manter)
  const accuracyByKind = useMemo(() => {
    const out: Record<string, { acertos: number; erros: number; inconc: number; total: number }> = {};
    for (const o of outcomes) {
      const f = fitById.get(o.fit_id);
      if (!f) continue;
      const k = f.recommendation_kind;
      out[k] = out[k] ?? { acertos: 0, erros: 0, inconc: 0, total: 0 };
      out[k].total++;
      if (o.verdict === "acertou") out[k].acertos++;
      else if (o.verdict === "errou") out[k].erros++;
      else if (o.verdict === "inconclusivo") out[k].inconc++;
    }
    return out;
  }, [outcomes, fitById]);

  // Top curadores por conversão (via deals criados a partir de sugestões)
  const topCurators = useMemo(() => {
    const map = new Map<string, { name: string; adopted: number; acertos: number; erros: number }>();
    for (const f of feedbacks) {
      if (!f.deal_id) continue;
      const d = dealById.get(f.deal_id);
      if (!d) continue;
      const key = d.curator_id ?? d.curator_name ?? "—";
      const name = d.curator_name ?? "Curador";
      const row = map.get(key) ?? { name, adopted: 0, acertos: 0, erros: 0 };
      row.adopted++;
      const o = outcomeByFit.get(f.fit_id);
      if (o?.verdict === "acertou") row.acertos++;
      else if (o?.verdict === "errou") row.erros++;
      map.set(key, row);
    }
    return Array.from(map.values())
      .sort((a, b) => b.adopted - a.adopted)
      .slice(0, 10);
  }, [feedbacks, dealById, outcomeByFit]);

  // Últimas 20 sugestões com veredito
  const lastJudged = useMemo(() => {
    return outcomes
      .filter((o) => o.verdict)
      .sort((a, b) => (b.detected_at ?? "").localeCompare(a.detected_at ?? ""))
      .slice(0, 20)
      .map((o) => ({ outcome: o, fit: fitById.get(o.fit_id) }))
      .filter((r) => r.fit);
  }, [outcomes, fitById]);

  return (
    <div className="space-y-4 pt-4">
      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm text-muted-foreground">Impacto das recomendações</div>
            <div className="text-xs text-muted-foreground/80 mt-0.5">
              Mede adoção pelo curador e delta de streams 28d após detecção. Sem inferências, só observação.
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              <RefreshCw className={cn("h-3.5 w-3.5 mr-2", loading && "animate-spin")} />
              Atualizar
            </Button>
            <Button size="sm" onClick={runDetection} disabled={running}>
              <Play className={cn("h-3.5 w-3.5 mr-2", running && "animate-pulse")} />
              {running ? "Detectando…" : "Rodar detecção agora"}
            </Button>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Sugestões geradas" value={kpis.total} />
        <Kpi label="Adotadas (deal/remoção)" value={kpis.adopted} />
        <Kpi label="Confirmadas no Spotify" value={kpis.detected} />
        <Kpi
          label="Precisão"
          value={kpis.accuracy != null ? `${kpis.accuracy}%` : "—"}
          hint={`${kpis.acertos} acertou · ${kpis.erros} errou · ${kpis.inconc} inconclusivo`}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Card className="p-5">
          <div className="text-sm font-medium mb-3">Acerto por tipo de sugestão</div>
          {Object.keys(accuracyByKind).length === 0 ? (
            <div className="text-xs text-muted-foreground py-6 text-center">
              Ainda sem vereditos. Rode a detecção quando tiver histórico de 28 dias.
            </div>
          ) : (
            <div className="space-y-3">
              {Object.entries(accuracyByKind).map(([kind, s]) => {
                const total = s.acertos + s.erros + s.inconc;
                const acertoPct = total > 0 ? Math.round((s.acertos / total) * 100) : 0;
                const erroPct = total > 0 ? Math.round((s.erros / total) * 100) : 0;
                const inconcPct = Math.max(0, 100 - acertoPct - erroPct);
                return (
                  <div key={kind}>
                    <div className="flex items-center justify-between mb-1.5 text-xs">
                      <Badge variant="outline" className={cn("text-[10px] uppercase tracking-wider", KIND_COLORS[kind])}>
                        {kind}
                      </Badge>
                      <span className="text-muted-foreground tabular-nums">
                        {s.acertos}/{total} acertou · {s.erros} errou · {s.inconc} inconclusivo
                      </span>
                    </div>
                    <div className="flex h-2 rounded-full overflow-hidden bg-muted">
                      <div className="bg-emerald-500" style={{ width: `${acertoPct}%` }} title={`acertou ${acertoPct}%`} />
                      <div className="bg-rose-500" style={{ width: `${erroPct}%` }} title={`errou ${erroPct}%`} />
                      <div className="bg-zinc-600" style={{ width: `${inconcPct}%` }} title={`inconclusivo ${inconcPct}%`} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <Card className="p-5">
          <div className="text-sm font-medium mb-3">Curadores com mais sugestões adotadas</div>
          {topCurators.length === 0 ? (
            <div className="text-xs text-muted-foreground py-6 text-center">
              Ainda não há sugestões convertidas em deal. Use “Criar deal” no painel de Recomendações.
            </div>
          ) : (
            <div className="space-y-2">
              {topCurators.map((c) => {
                const judged = c.acertos + c.erros;
                const pct = judged > 0 ? Math.round((c.acertos / judged) * 100) : null;
                return (
                  <div key={c.name} className="flex items-center justify-between text-sm">
                    <span className="truncate text-foreground">{c.name}</span>
                    <span className="flex items-center gap-3 text-xs text-muted-foreground tabular-nums">
                      <span>{c.adopted} adotadas</span>
                      <span className="text-foreground">{pct != null ? `${pct}% acerto` : "—"}</span>
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      <Card className="p-5">
        <div className="text-sm font-medium mb-3">Últimas 20 sugestões julgadas</div>
        {lastJudged.length === 0 ? (
          <div className="text-xs text-muted-foreground py-6 text-center">
            Sem vereditos ainda. Eles aparecem 28 dias após a sugestão ser detectada como adotada.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-[11px] uppercase tracking-wider text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="text-left py-2 px-2 font-medium">Faixa</th>
                  <th className="text-left py-2 px-2 font-medium">Playlist · Curador</th>
                  <th className="text-left py-2 px-2 font-medium">Tipo</th>
                  <th className="text-right py-2 px-2 font-medium">Δ 28d</th>
                  <th className="text-left py-2 px-2 font-medium">Veredito</th>
                </tr>
              </thead>
              <tbody>
                {lastJudged.map(({ outcome, fit }) => {
                  const ev = fit!.evidence ?? {};
                  return (
                    <tr key={outcome.fit_id} className="border-b border-border/40 hover:bg-muted/30">
                      <td className="py-2 px-2">
                        <div className="font-medium truncate max-w-[200px]">{ev?.track?.name ?? fit!.spotify_track_id}</div>
                        <div className="text-xs text-muted-foreground truncate max-w-[200px]">{ev?.track?.artist ?? "—"}</div>
                      </td>
                      <td className="py-2 px-2">
                        <div className="truncate max-w-[260px]">{ev?.playlist?.name ?? fit!.spotify_playlist_id}</div>
                        <div className="text-xs text-muted-foreground truncate max-w-[260px]">{ev?.playlist?.curator ?? "—"}</div>
                      </td>
                      <td className="py-2 px-2">
                        <Badge variant="outline" className={cn("text-[10px] uppercase tracking-wider", KIND_COLORS[fit!.recommendation_kind])}>
                          {fit!.recommendation_kind}
                        </Badge>
                      </td>
                      <td className="py-2 px-2 text-right tabular-nums">
                        <span className={cn(
                          outcome.impact_delta_pct != null && outcome.impact_delta_pct > 5 && "text-emerald-400",
                          outcome.impact_delta_pct != null && outcome.impact_delta_pct < -5 && "text-rose-400",
                        )}>
                          {fmtPct(outcome.impact_delta_pct)}
                        </span>
                      </td>
                      <td className="py-2 px-2">
                        <Badge variant="outline" className={cn("text-[10px] uppercase tracking-wider", VERDICT_COLORS[outcome.verdict ?? ""])}>
                          {outcome.verdict}
                        </Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function Kpi({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <Card className="p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold mt-1 tabular-nums">{value}</div>
      {hint && <div className="text-[11px] text-muted-foreground mt-1">{hint}</div>}
    </Card>
  );
}
