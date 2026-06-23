// Distribuição Natural — plano gradual por ondas.
// Usa só a infra da Fase 2 (gênero + vaga + cooldown). Sem score, ranking ou pesos.
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Play, Save, Calendar, Activity, Layers, ChevronDown } from "lucide-react";
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

  const toggleMut = useMutation({
    mutationFn: async (value: boolean) => {
      if (!flags) return;
      const { error } = await supabase.from("system_flags").update({ engine_natural_distribution_active: value }).eq("id", flags.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Configuração atualizada");
      qc.invalidateQueries({ queryKey: ["natural-distribution"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Falha"),
  });

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


      {/* Lista de planos — operacional, vem primeiro */}
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
        {/* Mobile: cards */}
        <div className="md:hidden divide-y divide-border/50">
          {plansQ.isLoading && (
            <div className="px-4 py-6 text-center text-sm text-muted-foreground">Carregando…</div>
          )}
          {!plansQ.isLoading && plans.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">Nenhum plano ainda. Ative a flag e adicione uma música no catálogo.</div>
          )}
          {plans.map((p) => (
            <div key={p.id} className="px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold truncate">{p.track_name ?? "—"}</div>
                  <div className="text-xs text-muted-foreground truncate">{p.artist_name ?? "—"}</div>
                </div>
                <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border border-border/60 text-muted-foreground tabular-nums shrink-0">
                  {p.window_days}d
                </span>
              </div>
              <div className="mt-2.5 flex items-center gap-2">
                <div className="flex-1 h-1.5 bg-border/60 rounded-full overflow-hidden">
                  <div className="h-full bg-primary transition-all" style={{ width: `${p.percent_done}%` }} />
                </div>
                <span className="text-[11px] tabular-nums text-muted-foreground w-9 text-right">{p.percent_done}%</span>
              </div>
              <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground tabular-nums">
                <span><span className="text-foreground font-medium">{p.total_distributed}</span> de {p.total_eligible}</span>
                <span>{p.total_pending} pendentes</span>
                <span>{p.next_wave_at ? new Date(p.next_wave_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—"}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Desktop: tabela */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wider text-muted-foreground">
              <tr className="border-b border-border">
                <th className="text-left px-3 py-2">Música</th>
                <th className="text-left px-3 py-2">Artista</th>
                <th className="text-center px-3 py-2 w-16">Janela</th>
                <th className="text-right px-3 py-2 w-20">Total</th>
                <th className="text-right px-3 py-2 w-24">Distribuídas</th>
                <th className="text-right px-3 py-2 w-24">Pendentes</th>
                <th className="text-left px-3 py-2 w-48">Progresso</th>
                <th className="text-left px-3 py-2 w-32">Próx. onda</th>
              </tr>
            </thead>
            <tbody>
              {plansQ.isLoading && (
                <tr><td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">Carregando…</td></tr>
              )}
              {!plansQ.isLoading && plans.length === 0 && (
                <tr><td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">Nenhum plano ainda. Ative a flag e adicione uma música no catálogo.</td></tr>
              )}
              {plans.map((p) => (
                <tr key={p.id} className="border-b border-border/50">
                  <td className="px-3 py-2 font-medium">{p.track_name ?? "—"}</td>
                  <td className="px-3 py-2 text-muted-foreground">{p.artist_name ?? "—"}</td>
                  <td className="px-3 py-2 text-center tabular-nums">{p.window_days}d</td>
                  <td className="px-3 py-2 text-right tabular-nums">{p.total_eligible}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-primary">{p.total_distributed}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{p.total_pending}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-border/60 rounded-full overflow-hidden">
                        <div className="h-full bg-primary" style={{ width: `${p.percent_done}%` }} />
                      </div>
                      <span className="text-xs tabular-nums text-muted-foreground w-10 text-right">{p.percent_done}%</span>
                    </div>
                    <div className="text-[10px] uppercase tracking-wider mt-0.5 text-muted-foreground">{p.status}</div>
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {p.next_wave_at ? new Date(p.next_wave_at).toLocaleString("pt-BR") : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Configurações (Ritmo) — colapsado por padrão pra evitar edição acidental */}
      <details className="group rounded-2xl border border-border bg-card overflow-hidden">
        <summary className="list-none cursor-pointer px-4 py-3 flex items-center justify-between gap-2 hover:bg-muted/30 transition-colors">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Calendar className="h-4 w-4 text-primary" />
            Ritmo da distribuição
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-normal ml-1">configuração avançada</span>
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
