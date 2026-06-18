// RegrasVsExecucao — camada de validação de regras de distribuição por gênero.
// Mostra: meta vs resultado, pipeline por gênero, diagnóstico de desvio,
// configuração ativa da run e alertas automáticos.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import {
  Target,
  TrendingUp,
  TrendingDown,
  Minus,
  AlertTriangle,
  CheckCircle2,
  Settings2,
  GitBranch,
  Loader2,
  ArrowRight,
  Filter as FilterIcon,
  Zap,
  Lightbulb,
  ListChecks,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

// ============= Tipos =============
type GenreTarget = {
  genre_id: string;
  nome: string;
  // metas
  min_daily: number;
  base_daily: number;
  max_daily: number;
  target_today: number;
  performance_tier: string;
  briefing_mode: string | null;
  min_followers: number | null;
  max_playlists_cap: number | null; // cap configurado em genre_filters
  // pipeline
  termos: number;
  playlists_validas: number;
  templates_today: number; // gerados hoje
  templates_pending: number;
  templates_approved: number;
  templates_created: number; // publicados no Spotify
  templates_archived: number;
  // execução real (último run do gênero)
  last_run_id: string | null;
  last_run_status: string | null;
  last_run_started_at: string | null;
  last_run_summary: string | null;
  last_run_steps: any[];
  last_run_cache: Record<string, boolean>;
  // diagnóstico
  delta: number; // created today - target_today
  diff_class: "ok" | "abaixo" | "acima";
};

// ============= Componente =============
export function RegrasVsExecucao() {
  const [rows, setRows] = useState<GenreTarget[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    // 1) gêneros ativos
    const { data: genres } = await supabase
      .from("genres")
      .select("id, nome, total_termos")
      .eq("ativo", true)
      .order("nome");
    if (!genres) {
      setLoading(false);
      return;
    }

    // 2) filtros (regras)
    const { data: filters } = await supabase
      .from("genre_filters")
      .select("genre_id, min_daily, base_daily, max_daily, briefing_mode, min_followers, max_playlists");
    const filterMap = new Map((filters ?? []).map((f) => [f.genre_id, f]));

    // 3) playlists válidas (search_results.is_valid)
    const { data: validPl } = await supabase
      .from("search_results")
      .select("genre_id")
      .eq("is_valid", true);
    const validMap = new Map<string, number>();
    (validPl ?? []).forEach((r) => {
      validMap.set(r.genre_id, (validMap.get(r.genre_id) ?? 0) + 1);
    });

    // 4) templates por gênero (status + hoje)
    const { data: templates } = await supabase
      .from("playlist_templates")
      .select("genre_id, status, created_at");
    const tplMap = new Map<string, { today: number; pending: number; approved: number; created: number; archived: number }>();
    const todayBR = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
    (templates ?? []).forEach((t) => {
      const key = t.genre_id;
      const cur = tplMap.get(key) ?? { today: 0, pending: 0, approved: 0, created: 0, archived: 0 };
      const dayBR = new Date(t.created_at).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
      if (dayBR === todayBR) cur.today += 1;
      if (t.status === "pending") cur.pending += 1;
      if (t.status === "approved") cur.approved += 1;
      if (t.status === "created") cur.created += 1;
      if (t.status === "archived") cur.archived += 1;
      tplMap.set(key, cur);
    });

    // 5) último run por gênero
    const lastRunMap = new Map<string, any>();
    for (const g of genres) {
      const { data: r } = await supabase
        .from("autopilot_runs")
        .select("id, status, started_at, summary, steps_completed, cache_hits, current_step")
        .eq("genre_id", g.id)
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (r) lastRunMap.set(g.id, r);
    }

    // 6) target oficial via RPC (fonte de verdade)
    const out: GenreTarget[] = [];
    for (const g of genres) {
      const { data: tgt } = await supabase.rpc("get_genre_daily_target_v2", { p_genre_id: g.id });
      const t = Array.isArray(tgt) ? tgt[0] : tgt;
      const f: any = filterMap.get(g.id) ?? {};
      const tpl = tplMap.get(g.id) ?? { today: 0, pending: 0, approved: 0, created: 0, archived: 0 };
      const lastRun = lastRunMap.get(g.id);
      const target = Number(t?.target_today ?? f?.base_daily ?? 4);
      const delta = tpl.created - target;
      const diff_class: "ok" | "abaixo" | "acima" =
        Math.abs(delta) <= 0 ? "ok" : delta < 0 ? "abaixo" : "acima";

      out.push({
        genre_id: g.id,
        nome: g.nome,
        min_daily: Number(t?.min_daily ?? f?.min_daily ?? 2),
        base_daily: Number(t?.base_daily ?? f?.base_daily ?? 4),
        max_daily: Number(t?.max_daily ?? f?.max_daily ?? 8),
        target_today: target,
        performance_tier: String(t?.performance_tier ?? "sem_historico"),
        briefing_mode: f?.briefing_mode ?? null,
        min_followers: f?.min_followers ?? null,
        max_playlists_cap: f?.max_playlists ?? null,
        termos: Number(g.total_termos ?? 0),
        playlists_validas: validMap.get(g.id) ?? 0,
        templates_today: tpl.today,
        templates_pending: tpl.pending,
        templates_approved: tpl.approved,
        templates_created: tpl.created,
        templates_archived: tpl.archived,
        last_run_id: lastRun?.id ?? null,
        last_run_status: lastRun?.status ?? null,
        last_run_started_at: lastRun?.started_at ?? null,
        last_run_summary: lastRun?.summary ?? null,
        last_run_steps: Array.isArray(lastRun?.steps_completed) ? lastRun.steps_completed : [],
        last_run_cache: (lastRun?.cache_hits ?? {}) as Record<string, boolean>,
        delta,
        diff_class,
      });
    }
    setRows(out);
    setLoading(false);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel("sistema-rules")
      .on("postgres_changes", { event: "*", schema: "public", table: "autopilot_runs" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "playlist_templates" }, () => load())
      .subscribe();
    const t = setInterval(load, 30_000);
    return () => {
      supabase.removeChannel(ch);
      clearInterval(t);
    };
  }, []);

  if (loading) {
    return (
      <div className="nx-card p-8 flex items-center justify-center text-sm text-muted-foreground gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando regras vs execução…
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="nx-card p-8 text-sm text-muted-foreground text-center">
        Nenhum gênero ativo encontrado.
      </div>
    );
  }

  const totalAlertas = rows.filter((r) => r.diff_class === "abaixo").length;

  return (
    <div className="space-y-4">
      {/* ============ HEADER ============ */}
      <div className="flex items-center gap-2">
        <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center">
          <Target className="h-4 w-4 text-primary" />
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-bold text-foreground">Regras vs Execução</h3>
          <p className="text-[11px] text-muted-foreground">
            Validação da estratégia de distribuição por gênero
          </p>
        </div>
        {totalAlertas > 0 && (
          <Badge variant="outline" className="border-warning/40 text-warning bg-warning/10 gap-1.5">
            <AlertTriangle className="h-3 w-3" />
            {totalAlertas} {totalAlertas === 1 ? "gênero abaixo da meta" : "gêneros abaixo da meta"}
          </Badge>
        )}
      </div>

      {/* ============ CARDS POR GÊNERO ============ */}
      <div className="space-y-3">
        {rows.map((r) => (
          <GenreCard key={r.genre_id} r={r} />
        ))}
      </div>
    </div>
  );
}

// ============= GenreCard =============
function GenreCard({ r }: { r: GenreTarget }) {
  const colorByDiff =
    r.diff_class === "ok"
      ? "border-success/30"
      : r.diff_class === "abaixo"
      ? "border-warning/40"
      : "border-primary/40";

  // Diagnóstico textual
  const diagnostico = buildDiagnostico(r);
  // Regras ativas detectadas
  const activeRules = buildActiveRules(r);

  return (
    <div
      className={cn(
        "rounded-xl border-2 p-4 sm:p-5 space-y-4",
        "bg-gradient-to-br from-card via-card to-elevated/30",
        colorByDiff,
      )}
    >
      {/* Cabeçalho do gênero */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <h4 className="text-base font-bold text-foreground capitalize">{r.nome}</h4>
            <PerfBadge tier={r.performance_tier} />
          </div>
          <p className="text-[11px] text-muted-foreground">
            Meta diária: {r.min_daily}–{r.max_daily} (base {r.base_daily}) ·{" "}
            <span className="font-semibold text-foreground/80">alvo de hoje: {r.target_today}</span>
          </p>
        </div>
        <DeltaBadge delta={r.delta} target={r.target_today} actual={r.templates_created} />
      </div>

      {/* ====== Bloco 1: Regras vs Execução ====== */}
      <div className="grid grid-cols-3 gap-2">
        <Cell label="Meta hoje" value={r.target_today} hint={`min ${r.min_daily} · max ${r.max_daily}`} />
        <Cell
          label="Publicadas hoje"
          value={r.templates_today}
          hint={`${r.templates_created} no Spotify`}
        />
        <Cell
          label="Diferença"
          value={(r.delta >= 0 ? "+" : "") + r.delta}
          tone={r.diff_class === "abaixo" ? "warning" : r.diff_class === "acima" ? "primary" : "success"}
        />
      </div>

      {/* ====== Bloco 2: Pipeline por gênero ====== */}
      <div>
        <div className="flex items-center gap-1.5 mb-2">
          <GitBranch className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">
            Pipeline do gênero
          </span>
        </div>
        <div className="flex items-center gap-1 overflow-x-auto pb-1">
          <PipelineStep label="Termos" value={r.termos} />
          <PipelineArrow />
          <PipelineStep label="Playlists" value={r.playlists_validas} />
          <PipelineArrow />
          <PipelineStep label="Templates" value={r.templates_today} hint="hoje" />
          <PipelineArrow />
          <PipelineStep label="Aprovados" value={r.templates_approved} tone="success" />
          <PipelineArrow />
          <PipelineStep label="Publicados" value={r.templates_created} tone="primary" />
        </div>
      </div>

      {/* ====== Bloco 3: Diagnóstico de desvio ====== */}
      {diagnostico.length > 0 && (
        <div className="rounded-lg border border-border/60 bg-elevated/40 p-3">
          <div className="flex items-center gap-1.5 mb-2">
            <Lightbulb className="h-3.5 w-3.5 text-warning" />
            <span className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">
              Diagnóstico de desvio
            </span>
          </div>
          <ul className="space-y-1.5">
            {diagnostico.map((d, i) => (
              <li key={i} className="flex items-start gap-2 text-[12px] text-foreground/85">
                <span
                  className={cn(
                    "mt-1 h-1.5 w-1.5 rounded-full shrink-0",
                    d.level === "warning" && "bg-warning",
                    d.level === "error" && "bg-destructive",
                    d.level === "info" && "bg-primary",
                    d.level === "ok" && "bg-success",
                  )}
                />
                <div className="min-w-0">
                  <span className="font-medium">{d.title}</span>
                  {d.detail && <span className="text-muted-foreground"> — {d.detail}</span>}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ====== Bloco 4: Configuração ativa da run ====== */}
      <div className="rounded-lg border border-border/60 bg-elevated/40 p-3">
        <div className="flex items-center gap-1.5 mb-2">
          <Settings2 className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">
            Configuração ativa na execução
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {activeRules.map((rule, i) => (
            <span
              key={i}
              className={cn(
                "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px]",
                rule.fromDefault
                  ? "border-warning/40 text-warning bg-warning/5"
                  : "border-border bg-card text-foreground/80",
              )}
              title={rule.fromDefault ? "Valor não configurado — usando default" : "Valor explícito de genre_filters"}
            >
              <FilterIcon className="h-3 w-3 opacity-60" />
              <span className="font-semibold">{rule.label}:</span>
              <span className="tabular-nums">{rule.value}</span>
              {rule.fromDefault && <span className="opacity-70">(default)</span>}
            </span>
          ))}
        </div>
        {r.last_run_summary && (
          <p className="mt-2 text-[11px] text-muted-foreground italic">
            Último run: {r.last_run_summary}
          </p>
        )}
      </div>

      {/* ====== Bloco 5: Alerta automático ====== */}
      {r.diff_class === "abaixo" && (
        <AlertaAutomatico r={r} />
      )}
    </div>
  );
}

// ============= Subcomponentes =============
function Cell({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: "default" | "success" | "warning" | "primary";
}) {
  const toneCls =
    tone === "success"
      ? "text-success"
      : tone === "warning"
      ? "text-warning"
      : tone === "primary"
      ? "text-primary"
      : "text-foreground";
  return (
    <div className="rounded-lg border border-border/60 bg-elevated/30 p-2.5">
      <p className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">{label}</p>
      <p className={cn("text-xl font-bold tabular-nums leading-tight mt-0.5", toneCls)}>{value}</p>
      {hint && <p className="text-[10px] text-muted-foreground/70 mt-0.5 truncate">{hint}</p>}
    </div>
  );
}

function PipelineStep({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: number;
  hint?: string;
  tone?: "default" | "success" | "primary";
}) {
  const toneCls =
    tone === "success" ? "text-success" : tone === "primary" ? "text-primary" : "text-foreground";
  return (
    <div className="shrink-0 rounded-md border border-border/60 bg-card px-2.5 py-1.5 min-w-[80px] text-center">
      <p className={cn("text-base font-bold tabular-nums leading-none", toneCls)}>{value}</p>
      <p className="text-[9px] uppercase tracking-wider text-muted-foreground font-bold mt-0.5">{label}</p>
      {hint && <p className="text-[9px] text-muted-foreground/60">{hint}</p>}
    </div>
  );
}

function PipelineArrow() {
  return <ArrowRight className="h-3 w-3 text-muted-foreground/40 shrink-0" />;
}

function DeltaBadge({ delta, target, actual }: { delta: number; target: number; actual: number }) {
  if (target === 0 && actual === 0) {
    return (
      <Badge variant="outline" className="border-border text-muted-foreground gap-1">
        <Minus className="h-3 w-3" />
        sem meta
      </Badge>
    );
  }
  if (delta === 0) {
    return (
      <Badge variant="outline" className="border-success/40 text-success bg-success/10 gap-1">
        <CheckCircle2 className="h-3 w-3" />
        meta batida
      </Badge>
    );
  }
  if (delta < 0) {
    return (
      <Badge variant="outline" className="border-warning/40 text-warning bg-warning/10 gap-1">
        <TrendingDown className="h-3 w-3" />
        {delta} vs meta
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="border-primary/40 text-primary bg-primary/10 gap-1">
      <TrendingUp className="h-3 w-3" />+{delta} acima
    </Badge>
  );
}

function PerfBadge({ tier }: { tier: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    alta: { label: "perf alta", cls: "border-success/40 text-success bg-success/10" },
    media: { label: "perf média", cls: "border-primary/40 text-primary bg-primary/10" },
    baixa: { label: "perf baixa", cls: "border-warning/40 text-warning bg-warning/10" },
    sem_historico: { label: "sem histórico", cls: "border-border text-muted-foreground bg-muted/40" },
  };
  const cfg = map[tier] ?? map.sem_historico;
  return (
    <span className={cn("text-[10px] uppercase tracking-wider font-bold border rounded px-1.5 py-0.5", cfg.cls)}>
      {cfg.label}
    </span>
  );
}

function AlertaAutomatico({ r }: { r: GenreTarget }) {
  const { causa, acao } = inferCauseAndAction(r);
  return (
    <div className="rounded-lg border-2 border-warning/40 bg-warning/5 p-3">
      <div className="flex items-start gap-2">
        <AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold text-warning uppercase tracking-wider">
            Meta não atingida em <span className="capitalize">{r.nome}</span>
          </p>
          <p className="text-[12px] text-foreground/85 mt-1">
            <span className="font-semibold">Causa provável:</span> {causa}
          </p>
          <p className="text-[12px] text-foreground/85 mt-0.5">
            <span className="font-semibold">Ação sugerida:</span> {acao}
          </p>
        </div>
      </div>
    </div>
  );
}

// ============= Lógica de diagnóstico =============
type Diag = { level: "ok" | "info" | "warning" | "error"; title: string; detail?: string };

function buildDiagnostico(r: GenreTarget): Diag[] {
  const out: Diag[] = [];

  // Termos
  if (r.termos < 10) {
    out.push({
      level: "warning",
      title: `Apenas ${r.termos} termos cadastrados`,
      detail: "ideal: 20+ para variedade de coleta",
    });
  }
  // Playlists válidas
  if (r.playlists_validas < 30) {
    out.push({
      level: "warning",
      title: `Pouca matéria-prima: ${r.playlists_validas} playlists válidas`,
      detail: "filtros podem estar muito restritivos",
    });
  }
  // Templates aprovados x gerados
  if (r.templates_today > 0 && r.templates_approved === 0) {
    out.push({
      level: "warning",
      title: "Nenhum template foi aprovado hoje",
      detail: "score mínimo pode estar acima do que a IA está gerando",
    });
  }
  // Publicação x aprovação
  if (r.templates_approved > 0 && r.templates_created < r.templates_approved) {
    out.push({
      level: "info",
      title: `${r.templates_approved - r.templates_created} aprovados ainda não publicados no Spotify`,
      detail: "etapa de criação pode estar travada (token / capacidade da conta)",
    });
  }
  // Cache pesado pode mascarar regeneração
  const cacheHits = Object.values(r.last_run_cache ?? {}).filter(Boolean).length;
  if (cacheHits >= 3 && r.delta < 0) {
    out.push({
      level: "info",
      title: "Run usou cache em todas as etapas de IA",
      detail: "rode com 'sem cache' para forçar nova análise e novos blueprints",
    });
  }
  // Briefing strict + poucos aprovados
  if (r.briefing_mode === "strict" && r.templates_approved < r.target_today) {
    out.push({
      level: "warning",
      title: "Briefing está em modo 'strict'",
      detail: "filtro restritivo pode estar pulando candidatos — considere 'expansao'",
    });
  }
  // Tudo certo
  if (out.length === 0 && r.diff_class === "ok") {
    out.push({
      level: "ok",
      title: "Distribuição alinhada com a estratégia definida",
    });
  }
  return out;
}

function inferCauseAndAction(r: GenreTarget): { causa: string; acao: string } {
  if (r.templates_today === 0) {
    return {
      causa: "Nenhum template foi gerado hoje — provável falha na execução do autopilot",
      acao: "Verifique o último run nos logs e use 'Rodar de novo' na barra superior",
    };
  }
  if (r.templates_today > 0 && r.templates_approved === 0) {
    return {
      causa: "Templates foram gerados mas nenhum atingiu o score mínimo de aprovação",
      acao: "Reduza o score mínimo ou rode 'sem cache' para forçar novos blueprints",
    };
  }
  if (r.templates_approved > r.templates_created) {
    return {
      causa: `${r.templates_approved - r.templates_created} aprovado(s) não chegaram ao Spotify`,
      acao: "Verifique token Spotify e capacidade das contas (max_playlists)",
    };
  }
  if (r.playlists_validas < 30) {
    return {
      causa: `Apenas ${r.playlists_validas} playlists válidas como matéria-prima`,
      acao: "Adicione mais termos de busca ou afrouxe os filtros (min_followers)",
    };
  }
  if (r.briefing_mode === "strict") {
    return {
      causa: "Briefing em modo 'strict' está priorizando precisão sobre volume",
      acao: "Mude para 'expansao' nas regras do gênero para gerar mais variações",
    };
  }
  return {
    causa: "Volume real ficou abaixo do alvo diário definido",
    acao: "Rode novamente o autopilot para este gênero ou ajuste base_daily nas regras",
  };
}

// ============= Regras ativas =============
type ActiveRule = { label: string; value: string; fromDefault: boolean };

function buildActiveRules(r: GenreTarget): ActiveRule[] {
  const rules: ActiveRule[] = [];
  rules.push({
    label: "min/base/max diário",
    value: `${r.min_daily}/${r.base_daily}/${r.max_daily}`,
    fromDefault: false, // RPC sempre retorna; ok
  });
  rules.push({
    label: "alvo dinâmico",
    value: String(r.target_today),
    fromDefault: false,
  });
  rules.push({
    label: "tier de performance",
    value: r.performance_tier,
    fromDefault: r.performance_tier === "sem_historico",
  });
  rules.push({
    label: "briefing",
    value: r.briefing_mode ?? "strict",
    fromDefault: r.briefing_mode === null,
  });
  rules.push({
    label: "min seguidores",
    value: r.min_followers != null ? r.min_followers.toLocaleString("pt-BR") : "sem mínimo",
    fromDefault: r.min_followers == null,
  });
  rules.push({
    label: "cap playlists",
    value: r.max_playlists_cap != null ? String(r.max_playlists_cap) : "150",
    fromDefault: r.max_playlists_cap == null,
  });
  return rules;
}
