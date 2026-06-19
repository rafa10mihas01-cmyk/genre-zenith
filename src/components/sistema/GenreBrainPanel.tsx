// GenreBrainPanel — visão consolidada da Fase 6.
// Mostra cada subgênero com knowledge_score (0–1) e os 4 pilares:
// SEO lexicon · estética visual · leadership · confidence média.
// Permite recomputar tudo (admin) e ver tokens fortes + cores dominantes.

import { useEffect, useMemo, useState } from "react";
import { Brain, Sparkles, Palette, Crown, Gauge, RefreshCw, AlertTriangle } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { timeAgo } from "@/lib/format";

type BrainRow = {
  id: string;
  genre_id: string;
  slug: string;
  display_name: string;
  top_tokens: Array<{ token: string; strength: number; status: string }>;
  tokens_total: number;
  tokens_strong: number;
  lexicon_updated_at: string | null;
  dominant_colors: string[] | Array<{ hex?: string }>;
  style_tags: string[];
  aggressiveness_score: number | null;
  has_face_pct: number | null;
  contrast_avg: number | null;
  aesthetics_updated_at: string | null;
  playlists_total: number;
  playlists_with_genre: number;
  active_leaders: number;
  avg_leadership_score: number | null;
  leadership_updated_at: string | null;
  avg_confidence: number | null;
  recent_drifts_7d: number;
  recent_reclassifications_7d: number;
  knowledge_score: number | null;
  last_recomputed_at: string;
};

function asColors(raw: BrainRow["dominant_colors"]): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((c) => (typeof c === "string" ? c : c?.hex))
    .filter((x): x is string => typeof x === "string" && x.startsWith("#"));
}

function scoreColor(s: number | null): string {
  if (s == null) return "text-muted-foreground";
  if (s >= 0.6) return "text-success";
  if (s >= 0.3) return "text-warning";
  return "text-destructive";
}

export function GenreBrainPanel() {
  const [rows, setRows] = useState<BrainRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("genre_brain")
      .select("*")
      .order("knowledge_score", { ascending: false, nullsFirst: false });
    if (error) {
      toast({ title: "Erro ao carregar", description: error.message, variant: "destructive" });
    } else {
      setRows((data ?? []) as unknown as BrainRow[]);
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function recompute() {
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("recompute-genre-brain", { body: {} });
      if (error) throw error;
      toast({ title: "Recomputado", description: `${data?.processed ?? 0} subgêneros atualizados.` });
      await load();
    } catch (e) {
      toast({ title: "Falhou", description: String((e as Error).message), variant: "destructive" });
    } finally { setBusy(false); }
  }

  const summary = useMemo(() => {
    if (!rows.length) return null;
    const avg = rows.reduce((s, r) => s + (Number(r.knowledge_score) || 0), 0) / rows.length;
    const mature = rows.filter(r => (r.knowledge_score ?? 0) >= 0.5).length;
    const drifts = rows.reduce((s, r) => s + (r.recent_drifts_7d ?? 0), 0);
    return { avg, mature, drifts };
  }, [rows]);

  const sel = rows.find(r => r.genre_id === selected) ?? null;

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Brain className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-[15px] font-semibold">Genre Brain</h2>
          <span className="text-xs text-muted-foreground">conhecimento consolidado por subgênero</span>
        </div>
        <Button size="sm" variant="outline" onClick={recompute} disabled={busy}>
          <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5", busy && "animate-spin")} />
          Recomputar tudo
        </Button>
      </div>

      {/* Summary KPIs */}
      {summary && (
        <div className="grid grid-cols-3 gap-3">
          <KpiTile label="Conhecimento médio" value={summary.avg.toFixed(2)} hint={`${rows.length} subgêneros`} />
          <KpiTile label="Subgêneros maduros" value={String(summary.mature)} hint="knowledge_score ≥ 0.5" />
          <KpiTile label="Drifts (7d)" value={String(summary.drifts)} hint="reclassificações pendentes" warn={summary.drifts > 0} />
        </div>
      )}

      {/* Grid */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-32" />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {rows.map(r => (
            <BrainCard key={r.id} row={r} selected={selected === r.genre_id} onClick={() => setSelected(s => s === r.genre_id ? null : r.genre_id)} />
          ))}
          {!rows.length && (
            <div className="col-span-full nx-card p-8 text-center text-sm text-muted-foreground">
              Genre Brain vazio. Clique em "Recomputar tudo" para gerar.
            </div>
          )}
        </div>
      )}

      {/* Detail drawer */}
      {sel && <BrainDetail row={sel} onClose={() => setSelected(null)} />}
    </section>
  );
}

function KpiTile({ label, value, hint, warn }: { label: string; value: string; hint?: string; warn?: boolean }) {
  return (
    <div className="nx-card p-4">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn("text-2xl font-semibold mt-1", warn && "text-warning")}>{value}</p>
      {hint && <p className="text-[11px] text-muted-foreground mt-0.5">{hint}</p>}
    </div>
  );
}

function BrainCard({ row, selected, onClick }: { row: BrainRow; selected: boolean; onClick: () => void }) {
  const colors = asColors(row.dominant_colors);
  const pct = Math.round((Number(row.knowledge_score) || 0) * 100);
  return (
    <button
      onClick={onClick}
      className={cn(
        "nx-card p-4 text-left hover:bg-elevated transition-colors",
        selected && "border-primary/40",
      )}
    >
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold truncate">{row.display_name}</h3>
          <p className="text-[11px] text-muted-foreground">{row.playlists_with_genre} playlists · {row.active_leaders} leaders</p>
        </div>
        <div className="text-right shrink-0">
          <p className={cn("text-2xl font-bold leading-none", scoreColor(row.knowledge_score))}>{pct}<span className="text-xs text-muted-foreground">%</span></p>
          <p className="text-[10px] uppercase text-muted-foreground mt-0.5">knowledge</p>
        </div>
      </div>

      {/* progress */}
      <div className="h-1 rounded-full bg-muted/40 overflow-hidden mb-3">
        <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
      </div>

      {/* 4 pillars compact */}
      <div className="grid grid-cols-4 gap-2 text-[11px]">
        <Pillar icon={Sparkles} label="SEO" value={`${row.tokens_strong}/${row.tokens_total}`} />
        <Pillar icon={Palette} label="Estética" value={row.aesthetics_updated_at ? "✓" : "—"} muted={!row.aesthetics_updated_at} />
        <Pillar icon={Crown} label="Liderança" value={String(row.active_leaders)} />
        <Pillar icon={Gauge} label="Conf." value={row.avg_confidence != null ? row.avg_confidence.toFixed(2) : "—"} />
      </div>

      {/* color swatches */}
      {colors.length > 0 && (
        <div className="flex gap-1 mt-3">
          {colors.slice(0, 6).map((c, i) => (
            <span key={i} className="h-3 w-3 rounded-sm border border-border/50" style={{ backgroundColor: c }} title={c} />
          ))}
          {row.style_tags?.slice(0, 2).map((t, i) => (
            <Badge key={`t-${i}`} variant="outline" className="text-[10px] h-4 px-1.5 ml-1">{t}</Badge>
          ))}
        </div>
      )}

      {row.recent_drifts_7d > 0 && (
        <div className="flex items-center gap-1 mt-2 text-[11px] text-warning">
          <AlertTriangle className="h-3 w-3" /> {row.recent_drifts_7d} drifts 7d
        </div>
      )}
    </button>
  );
}

function Pillar({ icon: Icon, label, value, muted }: { icon: LucideIcon; label: string; value: string; muted?: boolean }) {
  return (
    <div className={cn("flex flex-col items-start", muted && "opacity-50")}>
      <Icon className="h-3 w-3 text-muted-foreground mb-0.5" />
      <span className="text-[10px] uppercase text-muted-foreground leading-none">{label}</span>
      <span className="text-xs font-medium leading-tight">{value}</span>
    </div>
  );
}

function BrainDetail({ row, onClose }: { row: BrainRow; onClose: () => void }) {
  const colors = asColors(row.dominant_colors);
  return (
    <div className="nx-card p-5 border-primary/30">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-semibold">{row.display_name}</h3>
          <p className="text-[11px] text-muted-foreground">
            atualizado {timeAgo(row.last_recomputed_at)} · slug <code>{row.slug}</code>
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={onClose}>Fechar</Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Tokens */}
        <div>
          <h4 className="text-xs uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1.5">
            <Sparkles className="h-3 w-3" /> Top tokens SEO
          </h4>
          {row.top_tokens?.length ? (
            <div className="flex flex-wrap gap-1.5">
              {row.top_tokens.map((t, i) => (
                <Badge
                  key={`${t.token}-${i}`}
                  variant={t.status === "forte" ? "default" : "outline"}
                  className="text-[11px]"
                >
                  {t.token} <span className="opacity-60 ml-1">{(t.strength * 100).toFixed(0)}</span>
                </Badge>
              ))}
            </div>
          ) : <p className="text-sm text-muted-foreground">Nenhum token aprendido ainda.</p>}
        </div>

        {/* Aesthetic */}
        <div>
          <h4 className="text-xs uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1.5">
            <Palette className="h-3 w-3" /> Estética visual
          </h4>
          {row.aesthetics_updated_at ? (
            <>
              <div className="flex gap-1.5 mb-2">
                {colors.map((c, i) => (
                  <div key={i} className="h-8 w-8 rounded-md border border-border" style={{ backgroundColor: c }} title={c} />
                ))}
              </div>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {row.style_tags?.map((t, i) => (
                  <Badge key={i} variant="outline" className="text-[11px]">{t}</Badge>
                ))}
              </div>
              <div className="grid grid-cols-3 gap-2 text-[11px] text-muted-foreground">
                <div>agressividade <span className="text-foreground font-medium">{row.aggressiveness_score?.toFixed(2) ?? "—"}</span></div>
                <div>face % <span className="text-foreground font-medium">{row.has_face_pct != null ? Math.round(row.has_face_pct * 100) + "%" : "—"}</span></div>
                <div>contraste <span className="text-foreground font-medium">{row.contrast_avg?.toFixed(2) ?? "—"}</span></div>
              </div>
            </>
          ) : <p className="text-sm text-muted-foreground">Sem assinatura visual ainda. Rode <code>learn-genre-aesthetics</code>.</p>}
        </div>

        {/* Leadership */}
        <div>
          <h4 className="text-xs uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1.5">
            <Crown className="h-3 w-3" /> Liderança
          </h4>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <Metric label="Leaders ativos" value={String(row.active_leaders)} />
            <Metric label="Score médio" value={row.avg_leadership_score?.toFixed(2) ?? "—"} />
            <Metric label="Playlists total" value={String(row.playlists_total)} />
            <Metric label="Com gênero" value={String(row.playlists_with_genre)} />
          </div>
        </div>

        {/* Health */}
        <div>
          <h4 className="text-xs uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1.5">
            <Gauge className="h-3 w-3" /> Saúde do aprendizado
          </h4>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <Metric label="Confidence média" value={row.avg_confidence?.toFixed(2) ?? "—"} />
            <Metric label="Drifts (7d)" value={String(row.recent_drifts_7d)} warn={row.recent_drifts_7d > 0} />
            <Metric label="Reclass. (7d)" value={String(row.recent_reclassifications_7d)} />
            <Metric label="Knowledge" value={((row.knowledge_score ?? 0) * 100).toFixed(0) + "%"} />
          </div>
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="px-3 py-2 rounded-md bg-elevated">
      <p className="text-[10px] uppercase text-muted-foreground">{label}</p>
      <p className={cn("text-sm font-semibold", warn && "text-warning")}>{value}</p>
    </div>
  );
}
