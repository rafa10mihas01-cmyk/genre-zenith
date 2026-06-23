// Distribuição Natural — plano gradual por ondas.
// Consolidação: usa só dados já existentes (v_catalog_distribution_plans + system_flags).
// Nenhuma nova fonte, RPC, métrica ou cálculo de negócio.
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Play, Save, Activity, Layers, ChevronDown, Settings2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type Plan = {
  id: string;
  catalog_track_id: string;
  track_name: string | null;
  artist_name: string | null;
  status: string;
  window_days: number;
  total_eligible: number;
  total_distributed: number;
  total_skipped: number;
  total_pending: number;
  percent_done: number;
  started_at: string;
  expected_end_at: string | null;
  completed_at: string | null;
  next_wave_at: string | null;
};

type Flags = {
  id: string;
  engine_natural_distribution_active: boolean;
  engine_natural_distribution_window_days: number;
  engine_natural_distribution_wave_size: number;
  engine_natural_distribution_max_per_track_per_day: number;
  engine_natural_distribution_max_per_wave_per_track: number;
  engine_natural_distribution_tier_delay_days: number;
};

type DerivedStatus = "distribuindo" | "aguardando_onda" | "aguardando_vaga" | "erro" | "finalizada";

function derivePlanStatus(p: Plan): DerivedStatus {
  const s = (p.status ?? "").toLowerCase();
  if (s === "completed" || p.completed_at) return "finalizada";
  if (s === "error" || s === "failed" || s === "paused") return "erro";
  const now = Date.now();
  const nextMs = p.next_wave_at ? new Date(p.next_wave_at).getTime() : null;
  if (p.total_pending <= 0) return "aguardando_vaga";
  if (nextMs && nextMs > now) return "aguardando_onda";
  return "distribuindo";
}

const STATUS_META: Record<DerivedStatus, { dot: string; label: string; chip: string }> = {
  distribuindo:     { dot: "bg-emerald-500",  label: "Distribuindo",           chip: "border-emerald-500/40 text-emerald-300 bg-emerald-500/10" },
  aguardando_vaga:  { dot: "bg-yellow-400",   label: "Aguardando vaga",        chip: "border-yellow-400/40 text-yellow-200 bg-yellow-400/10" },
  aguardando_onda:  { dot: "bg-orange-400",   label: "Aguardando próxima onda",chip: "border-orange-400/40 text-orange-200 bg-orange-400/10" },
  erro:             { dot: "bg-red-500",      label: "Com erro",               chip: "border-red-500/40 text-red-300 bg-red-500/10" },
  finalizada:       { dot: "bg-muted-foreground",label: "Finalizada",          chip: "border-border text-muted-foreground bg-muted/20" },
};

function fmtDateTime(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function fmtTime(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const diff = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(diff)) return null;
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

async function fetchFlags(): Promise<Flags | null> {
  const { data, error } = await supabase
    .from("system_flags")
    .select("id, engine_natural_distribution_active, engine_natural_distribution_window_days, engine_natural_distribution_wave_size, engine_natural_distribution_max_per_track_per_day, engine_natural_distribution_max_per_wave_per_track, engine_natural_distribution_tier_delay_days")
    .order("id")
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data as any;
}

async function fetchPlans(filter: "active" | "all"): Promise<Plan[]> {
  let q = supabase
    .from("v_catalog_distribution_plans" as any)
    .select("*")
    .order("started_at", { ascending: false })
    .limit(100);
  if (filter === "active") q = q.eq("status", "active");
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as unknown as Plan[];
}

export function DistribuicaoTab() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<"active" | "all">("active");
  const [draftDays, setDraftDays] = useState<string | null>(null);
  const [draftWave, setDraftWave] = useState<string | null>(null);
  const [draftDaily, setDraftDaily] = useState<string | null>(null);
  const [draftPerWave, setDraftPerWave] = useState<string | null>(null);
  const [draftTierDelay, setDraftTierDelay] = useState<string | null>(null);

  const flagsQ = useQuery({ queryKey: ["natural-distribution", "flags"], queryFn: fetchFlags });
  const plansQ = useQuery({ queryKey: ["natural-distribution", "plans", filter], queryFn: () => fetchPlans(filter), staleTime: 15_000 });

  const flags = flagsQ.data;
  const plans = plansQ.data ?? [];

  // Derivações puramente em cima dos campos existentes.
  const decorated = useMemo(
    () => plans.map((p) => ({ ...p, _status: derivePlanStatus(p), _etaDays: daysUntil(p.expected_end_at) })),
    [plans],
  );

  const summary = useMemo(() => {
    const counts = { distribuindo: 0, aguardando_vaga: 0, aguardando_onda: 0, erro: 0, finalizada: 0 } as Record<DerivedStatus, number>;
    let nextWave: number | null = null;
    const etas: number[] = [];
    for (const p of decorated) {
      counts[p._status] += 1;
      if (p._status !== "finalizada" && p.next_wave_at) {
        const ms = new Date(p.next_wave_at).getTime();
        if (ms > Date.now() && (nextWave == null || ms < nextWave)) nextWave = ms;
      }
      if (p._status !== "finalizada" && p._etaDays != null) etas.push(p._etaDays);
    }
    const etaAvg = etas.length ? Math.round(etas.reduce((a, b) => a + b, 0) / etas.length) : null;
    const aguardandoTotal = counts.aguardando_vaga + counts.aguardando_onda;
    return {
      counts,
      aguardandoTotal,
      nextWaveLabel: nextWave ? fmtTime(new Date(nextWave).toISOString()) : null,
      etaAvg,
    };
  }, [decorated]);

  const saveSettingsMut = useMutation({
    mutationFn: async () => {
      if (!flags) return;
      const payload: any = {};
      if (draftDays != null) {
        const n = Number(draftDays);
        if (!Number.isFinite(n) || n < 1 || n > 30) throw new Error("Janela deve estar entre 1 e 30 dias");
        payload.engine_natural_distribution_window_days = n;
      }
      if (draftWave != null) {
        const n = Number(draftWave);
        if (!Number.isFinite(n) || n < 1 || n > 1000) throw new Error("Onda deve estar entre 1 e 1000");
        payload.engine_natural_distribution_wave_size = n;
      }
      if (draftDaily != null) {
        const n = Number(draftDaily);
        if (!Number.isFinite(n) || n < 1 || n > 500) throw new Error("Limite diário deve estar entre 1 e 500");
        payload.engine_natural_distribution_max_per_track_per_day = n;
      }
      if (draftPerWave != null) {
        const n = Number(draftPerWave);
        if (!Number.isFinite(n) || n < 1 || n > 50) throw new Error("Playlists por onda/música deve estar entre 1 e 50");
        payload.engine_natural_distribution_max_per_wave_per_track = n;
      }
      if (draftTierDelay != null) {
        const n = Number(draftTierDelay);
        if (!Number.isFinite(n) || n < 1 || n > 30) throw new Error("Atraso entre camadas deve estar entre 1 e 30 dias");
        payload.engine_natural_distribution_tier_delay_days = n;
      }
      if (Object.keys(payload).length === 0) return;
      const { error } = await supabase.from("system_flags").update(payload).eq("id", flags.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Configurações salvas");
      setDraftDays(null);
      setDraftWave(null);
      setDraftDaily(null);
      setDraftPerWave(null);
      setDraftTierDelay(null);
      qc.invalidateQueries({ queryKey: ["natural-distribution", "flags"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Falha ao salvar"),
  });

  const runWaveMut = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("engine_run_distribution_wave", { _limit: null as any });
      if (error) throw error;
      return data as any;
    },
    onSuccess: (data: any) => {
      const row = Array.isArray(data) ? data[0] : data;
      if (row?.distributed != null) {
        toast.success(`Onda executada: ${row.distributed} distribuídas, ${row.skipped} puladas, ${row.remaining} restantes`);
      } else {
        toast.success("Onda executada");
      }
      qc.invalidateQueries({ queryKey: ["natural-distribution"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Falha"),
  });

  const isActive = !!flags?.engine_natural_distribution_active;

  return (
    <div className="space-y-6">
      {/* Resumo operacional — compacto no mobile, frase no desktop */}
      <section className="rounded-2xl border border-border bg-card overflow-hidden">
        {/* Mobile: 3 colunas grandes, bate o olho */}
        <div className="sm:hidden">
          <div className="flex items-center justify-between px-4 pt-3">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Estado agora</div>
            <span
              className={cn(
                "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[10px] uppercase tracking-wider",
                isActive ? "border-emerald-500/40 text-emerald-300 bg-emerald-500/10" : "border-border text-muted-foreground",
              )}
            >
              <span className={cn("h-1.5 w-1.5 rounded-full", isActive ? "bg-emerald-400" : "bg-muted-foreground")} />
              {isActive ? "Ativa" : "Pausada"}
            </span>
          </div>
          <div className="mt-3 grid grid-cols-3 divide-x divide-border">
            <div className="px-2 py-3 flex flex-col items-center gap-0.5">
              <span className="text-xl font-semibold tabular-nums text-emerald-300">{summary.counts.distribuindo}</span>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Distribuindo</span>
            </div>
            <div className="px-2 py-3 flex flex-col items-center gap-0.5">
              <span className="text-xl font-semibold tabular-nums text-foreground">{summary.counts.finalizada}</span>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Finalizadas</span>
            </div>
            <div className="px-2 py-3 flex flex-col items-center gap-0.5">
              <span className={cn("text-xl font-semibold tabular-nums", summary.counts.erro > 0 ? "text-red-300" : "text-yellow-200")}>
                {summary.counts.erro > 0 ? summary.counts.erro : summary.aguardandoTotal}
              </span>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                {summary.counts.erro > 0 ? "Com erro" : "Aguardando"}
              </span>
            </div>
          </div>
          <div className="px-4 py-2.5 border-t border-border flex items-center justify-between gap-3 text-[11px] text-muted-foreground tabular-nums">
            <span>
              {summary.nextWaveLabel ? <>Próx. <span className="text-foreground">{summary.nextWaveLabel}</span></> : <>Sem próx. onda</>}
            </span>
            <span>
              ETA {summary.etaAvg != null ? <span className="text-foreground">{summary.etaAvg}d</span> : "—"}
            </span>
          </div>
        </div>

        {/* Desktop: frase humana original */}
        <div className="hidden sm:flex items-start justify-between gap-3 px-5 py-5">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Estado agora</div>
            <p className="mt-1 text-[15px] leading-relaxed text-foreground">
              <span className="font-semibold text-emerald-300 tabular-nums">{summary.counts.distribuindo}</span>{" "}
              distribuindo ·{" "}
              <span className="font-semibold text-foreground tabular-nums">{summary.counts.finalizada}</span>{" "}
              finalizadas ·{" "}
              <span className="font-semibold text-yellow-200 tabular-nums">{summary.aguardandoTotal}</span>{" "}
              aguardando
              {summary.counts.erro > 0 && (
                <>
                  {" "}·{" "}
                  <span className="font-semibold text-red-300 tabular-nums">{summary.counts.erro}</span>{" "}
                  com erro
                </>
              )}
              .
            </p>
            <p className="mt-1.5 text-sm text-muted-foreground">
              {summary.nextWaveLabel
                ? <>Próxima onda às <span className="text-foreground tabular-nums">{summary.nextWaveLabel}</span>. </>
                : <>Sem próxima onda agendada. </>}
              {summary.etaAvg != null
                ? <>ETA médio: <span className="text-foreground tabular-nums">{summary.etaAvg}</span> {summary.etaAvg === 1 ? "dia" : "dias"}.</>
                : <>ETA médio indisponível.</>}
            </p>
          </div>
          <span
            className={cn(
              "shrink-0 inline-flex items-center gap-1.5 px-2 py-1 rounded-full border text-[10px] uppercase tracking-wider",
              isActive ? "border-emerald-500/40 text-emerald-300 bg-emerald-500/10" : "border-border text-muted-foreground",
            )}
          >
            <span className={cn("h-1.5 w-1.5 rounded-full", isActive ? "bg-emerald-400" : "bg-muted-foreground")} />
            Engine {isActive ? "ativa" : "pausada"}
          </span>
        </div>
      </section>

      {/* Lista de planos — elemento principal */}
      <section className="rounded-2xl border border-border bg-card">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" />
            Planos de distribuição
          </h3>
          <div className="flex gap-1">
            {(["active", "all"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={cn(
                  "px-2.5 py-1 text-xs rounded-full border transition-colors",
                  filter === f ? "border-primary text-foreground bg-primary/10" : "border-border text-muted-foreground hover:text-foreground",
                )}
              >
                {f === "active" ? "Ativos" : "Todos"}
              </button>
            ))}
          </div>
        </div>

        {/* Mobile: cards com separação clara */}
        <div className="md:hidden p-3 space-y-3 bg-background/40">
          {plansQ.isLoading && (
            <div className="px-4 py-6 text-center text-sm text-muted-foreground">Carregando…</div>
          )}
          {!plansQ.isLoading && decorated.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">Nenhum plano ainda. Ative a engine e adicione uma música no catálogo.</div>
          )}
          {decorated.map((p) => {
            const meta = STATUS_META[p._status];
            return (
              <div key={p.id} className="rounded-xl border border-border bg-card px-3.5 py-3 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className={cn("h-2 w-2 rounded-full shrink-0", meta.dot)} />
                      <div className="text-sm font-semibold truncate">{p.track_name ?? "—"}</div>
                    </div>
                    <div className="text-xs text-muted-foreground truncate mt-0.5 pl-4">{p.artist_name ?? "—"}</div>
                  </div>
                  <span className={cn("text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border tabular-nums shrink-0", meta.chip)}>
                    {meta.label}
                  </span>
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <div className="flex-1 h-1.5 bg-border/60 rounded-full overflow-hidden">
                    <div className="h-full bg-primary transition-all" style={{ width: `${p.percent_done}%` }} />
                  </div>
                  <span className="text-[11px] tabular-nums text-muted-foreground w-9 text-right">{p.percent_done}%</span>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-[11px] text-muted-foreground tabular-nums">
                  <div>
                    <div className="text-[9px] uppercase tracking-wider">Distribuídas</div>
                    <div className="text-foreground font-medium">{p.total_distributed}/{p.total_eligible}</div>
                  </div>
                  <div>
                    <div className="text-[9px] uppercase tracking-wider">Pendentes</div>
                    <div className="text-foreground">{p.total_pending}</div>
                  </div>
                  <div>
                    <div className="text-[9px] uppercase tracking-wider">ETA</div>
                    <div className="text-foreground">{p._etaDays != null ? `${p._etaDays}d` : "—"}</div>
                  </div>
                </div>
                <div className="mt-2.5 pt-2.5 border-t border-border/60 text-[11px] text-muted-foreground tabular-nums">
                  Próx. onda: <span className="text-foreground">{fmtDateTime(p.next_wave_at)}</span>
                </div>
              </div>
            );
          })}
        </div>


        {/* Desktop: tabela */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wider text-muted-foreground">
              <tr className="border-b border-border">
                <th className="text-left px-3 py-2 w-48">Status</th>
                <th className="text-left px-3 py-2">Música</th>
                <th className="text-left px-3 py-2">Artista</th>
                <th className="text-left px-3 py-2 w-56">Progresso</th>
                <th className="text-right px-3 py-2 w-24">Pendentes</th>
                <th className="text-left px-3 py-2 w-32">Próx. onda</th>
                <th className="text-right px-3 py-2 w-20">ETA</th>
              </tr>
            </thead>
            <tbody>
              {plansQ.isLoading && (
                <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">Carregando…</td></tr>
              )}
              {!plansQ.isLoading && decorated.length === 0 && (
                <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">Nenhum plano ainda. Ative a engine e adicione uma música no catálogo.</td></tr>
              )}
              {decorated.map((p) => {
                const meta = STATUS_META[p._status];
                return (
                  <tr key={p.id} className="border-b border-border/50">
                    <td className="px-3 py-2">
                      <span className={cn("inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[10px] uppercase tracking-wider", meta.chip)}>
                        <span className={cn("h-1.5 w-1.5 rounded-full", meta.dot)} />
                        {meta.label}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-medium">{p.track_name ?? "—"}</td>
                    <td className="px-3 py-2 text-muted-foreground">{p.artist_name ?? "—"}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-1.5 bg-border/60 rounded-full overflow-hidden">
                          <div className="h-full bg-primary" style={{ width: `${p.percent_done}%` }} />
                        </div>
                        <span className="text-xs tabular-nums text-muted-foreground w-10 text-right">{p.percent_done}%</span>
                      </div>
                      <div className="text-[10px] mt-0.5 text-muted-foreground tabular-nums">
                        {p.total_distributed} de {p.total_eligible} · janela {p.window_days}d
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{p.total_pending}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground tabular-nums">{fmtDateTime(p.next_wave_at)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-xs">{p._etaDays != null ? `${p._etaDays}d` : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Configuração da Engine — colapsada por padrão */}
      <details className="group rounded-2xl border border-border bg-card overflow-hidden">
        <summary className="list-none cursor-pointer px-4 py-3 flex items-center justify-between gap-2 hover:bg-muted/30 transition-colors">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Settings2 className="h-4 w-4 text-muted-foreground" />
            Configuração da Engine
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-normal ml-1">avançado</span>
          </h3>
          <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
        </summary>
        <div className="p-4 border-t border-border">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">Janela padrão (dias)</span>
              <Input
                type="number"
                min={1}
                max={30}
                value={draftDays ?? flags?.engine_natural_distribution_window_days ?? 5}
                onChange={(e) => setDraftDays(e.target.value)}
                className="h-8 text-sm"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">Tamanho da onda (global)</span>
              <Input
                type="number"
                min={1}
                max={1000}
                value={draftWave ?? flags?.engine_natural_distribution_wave_size ?? 50}
                onChange={(e) => setDraftWave(e.target.value)}
                className="h-8 text-sm"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">Máx. playlists / música / dia</span>
              <Input
                type="number"
                min={1}
                max={500}
                value={draftDaily ?? flags?.engine_natural_distribution_max_per_track_per_day ?? 20}
                onChange={(e) => setDraftDaily(e.target.value)}
                className="h-8 text-sm"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">Playlists por onda (por música)</span>
              <Input
                type="number"
                min={1}
                max={50}
                value={draftPerWave ?? flags?.engine_natural_distribution_max_per_wave_per_track ?? 1}
                onChange={(e) => setDraftPerWave(e.target.value)}
                className="h-8 text-sm"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">Atraso entre camadas (dias)</span>
              <Input
                type="number"
                min={1}
                max={30}
                value={draftTierDelay ?? flags?.engine_natural_distribution_tier_delay_days ?? 2}
                onChange={(e) => setDraftTierDelay(e.target.value)}
                className="h-8 text-sm"
              />
            </label>
          </div>
          <div className="flex items-center gap-2 mt-3">
            <Button
              size="sm"
              onClick={() => saveSettingsMut.mutate()}
              disabled={(draftDays == null && draftWave == null && draftDaily == null && draftPerWave == null && draftTierDelay == null) || saveSettingsMut.isPending}
              className="gap-1.5"
            >
              <Save className="h-4 w-4" />
              Salvar
            </Button>
            <Button size="sm" variant="outline" onClick={() => runWaveMut.mutate()} disabled={!isActive || runWaveMut.isPending} className="gap-1.5">
              <Play className="h-4 w-4" />
              {runWaveMut.isPending ? "Executando…" : "Rodar onda agora"}
            </Button>
          </div>
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-2">
            {[
              { n: 1, title: "Camada 1", when: "Dia 0", desc: "Playlists mais robustas — ciclo de vida, estado curatorial e seguidores." },
              { n: 2, title: "Camada 2", when: `Dia +${flags?.engine_natural_distribution_tier_delay_days ?? 2}`, desc: "Segunda onda libera após o atraso configurado." },
              { n: 3, title: "Camada 3", when: `Dia +${(flags?.engine_natural_distribution_tier_delay_days ?? 2) * 2}`, desc: "Cauda longa, abre após o dobro do atraso." },
            ].map((c) => (
              <div key={c.n} className="rounded-xl border border-border/60 bg-background/40 p-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="h-6 w-6 rounded-md bg-primary/10 text-primary flex items-center justify-center text-[11px] font-semibold tabular-nums">
                      {c.n}
                    </div>
                    <span className="text-xs font-semibold">{c.title}</span>
                  </div>
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground tabular-nums">{c.when}</span>
                </div>
                <p className="text-[11px] text-muted-foreground mt-2 leading-snug">{c.desc}</p>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground mt-3 flex items-center gap-1.5">
            <Layers className="h-3 w-3" />
            Toda camada respeita vaga, cooldown, gênero, limite diário e diversificação entre músicas.
          </p>
        </div>
      </details>
    </div>
  );
}
