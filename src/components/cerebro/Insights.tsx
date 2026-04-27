import { useState } from "react";
import {
  Sparkles, TrendingUp, Hash, Lightbulb, Wand2, FileText,
  ChevronDown, ChevronRight,
} from "lucide-react";
import { timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Empty, SkeletonGrid } from "@/components/cerebro/_shared";

export function Insights({ model, loading }: any) {
  if (loading) return <SkeletonGrid />;
  if (!model) return <Empty msg="Sem insights." />;

  const ai = model.insights?.ai;
  const kws: { value: string; count: number }[] = model.palavras_chave ?? [];
  const padroes: { value: string; count: number }[] = model.padroes_nome ?? [];
  const tendencias: string[] = ai?.tendencias ?? [];
  const oportunidades: string[] = ai?.oportunidades_seo ?? ai?.oportunidades ?? [];
  const sugestoesNomes: string[] = ai?.sugestoes_nomes ?? ai?.sugestoes ?? [];

  const topKws = [...kws].sort((a, b) => b.count - a.count).slice(0, 24);
  const maxKw = topKws[0]?.count ?? 1;
  const topPadroes = [...padroes].sort((a, b) => b.count - a.count).slice(0, 12);

  return (
    <div className="space-y-6">
      {/* FASE 1 — RESUMO */}
      {ai?.resumo && (
        <Section
          step="1"
          icon={Wand2}
          title="O que a IA aprendeu"
          subtitle={ai.generated_at ? `Atualizado ${timeAgo(ai.generated_at)}` : undefined}
        >
          <p className="text-[15px] leading-relaxed text-foreground/90">{ai.resumo}</p>
        </Section>
      )}

      {/* FASE 2 — TENDÊNCIAS + OPORTUNIDADES (lado a lado) */}
      {(tendencias.length > 0 || oportunidades.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {tendencias.length > 0 && (
            <Section step="2" icon={TrendingUp} title="Tendências" subtitle={`${tendencias.length} sinais`}>
              <BulletList items={tendencias} tone="primary" />
            </Section>
          )}
          {oportunidades.length > 0 && (
            <Section step="3" icon={Lightbulb} title="Oportunidades" subtitle={`${oportunidades.length} ideias`}>
              <BulletList items={oportunidades} tone="warning" />
            </Section>
          )}
        </div>
      )}

      {/* FASE 3 — VOCABULÁRIO (palavras-chave com barras) */}
      {topKws.length > 0 && (
        <Section
          step="4"
          icon={Hash}
          title="Vocabulário do gênero"
          subtitle={`${kws.length} palavras • mostrando top ${topKws.length}`}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-5 gap-y-1.5">
            {topKws.map(k => (
              <KeywordBar key={k.value} label={k.value} count={k.count} max={maxKw} />
            ))}
          </div>
        </Section>
      )}

      {/* FASE 4 — PADRÕES + SUGESTÕES DE NOMES */}
      {(topPadroes.length > 0 || sugestoesNomes.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {topPadroes.length > 0 && (
            <Section step="5" icon={Sparkles} title="Padrões de nome" subtitle="Combinações mais usadas">
              <ul className="divide-y divide-border -mx-1">
                {topPadroes.map((p, i) => (
                  <li key={p.value} className="flex items-center justify-between py-2 px-1">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-[10px] text-muted-foreground tabular-nums w-5">{i + 1}</span>
                      <span className="text-sm font-medium truncate">{p.value}</span>
                    </div>
                    <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">{p.count}×</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}
          {sugestoesNomes.length > 0 && (
            <Section
              step="6"
              icon={FileText}
              title="Nomes sugeridos pela IA"
              subtitle={`${sugestoesNomes.length} ideias prontas`}
            >
              <ul className="space-y-1.5">
                {sugestoesNomes.map((n, i) => (
                  <li
                    key={i}
                    className="text-sm px-3 py-2 rounded-lg bg-elevated/50 border border-border/60 text-foreground/90"
                  >
                    {n}
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------- subcomponentes da aba Insights ---------- */

export function Section({
  step, icon: Icon, title, subtitle, children,
}: any /* keep loose for brevity */) {
  return (
    <section className="nx-card p-5">
      <header className="flex items-center gap-3 mb-4">
        <div className="h-9 w-9 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {step && (
              <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground font-bold">
                Fase {step}
              </span>
            )}
          </div>
          <h3 className="text-base font-bold leading-tight">{title}</h3>
          {subtitle && <p className="text-[11px] text-muted-foreground mt-0.5">{subtitle}</p>}
        </div>
      </header>
      {children}
    </section>
  );
}

/**
 * Mesma anatomia do Section, mas colapsado por padrão. Reduz ruído visual em
 * conteúdo secundário (atalhos, histórico) sem esconder funcionalidade.
 */
export function CollapsibleSection({
  icon: Icon, title, subtitle, defaultOpen = false, children,
}: {
  icon: any; title: string; subtitle?: string; defaultOpen?: boolean; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="nx-card overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 p-4 hover:bg-elevated/40 transition-colors text-left"
      >
        <div className="h-8 w-8 rounded-full bg-muted/30 text-muted-foreground flex items-center justify-center shrink-0">
          <Icon className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-bold leading-tight">{title}</h3>
          {subtitle && <p className="text-[11px] text-muted-foreground mt-0.5">{subtitle}</p>}
        </div>
        {open ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
      </button>
      {open && <div className="px-5 pb-5 border-t border-border pt-4">{children}</div>}
    </section>
  );
}


export function BulletList({ items, tone = "primary" }: { items: string[]; tone?: "primary" | "warning" }) {
  const dot = tone === "warning" ? "bg-warning" : "bg-primary";
  return (
    <ul className="space-y-2.5">
      {items.map((s, i) => (
        <li key={i} className="flex items-start gap-2.5 text-sm leading-relaxed text-foreground/90">
          <span className={cn("mt-[7px] h-1.5 w-1.5 rounded-full shrink-0", dot)} />
          <span>{s}</span>
        </li>
      ))}
    </ul>
  );
}

export function KeywordBar({ label, count, max }: { label: string; count: number; max: number }) {
  const pct = Math.max(8, Math.round((count / max) * 100));
  return (
    <div className="flex items-center gap-2 py-1">
      <span className="text-sm font-medium truncate flex-1">{label}</span>
      <div className="w-24 h-1.5 rounded-full bg-elevated overflow-hidden shrink-0">
        <div className="h-full bg-primary/70 rounded-full" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[11px] text-muted-foreground tabular-nums w-7 text-right shrink-0">{count}</span>
    </div>
  );
}
