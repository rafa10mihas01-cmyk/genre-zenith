// SemanticEvolutionTab — termos nascendo / dominantes / morrendo.
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Crown, Skull } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type Row = { slug: string; term: string; weight: number | null; status: string | null; captured_at: string };

export function SemanticEvolutionTab() {
  const [rows, setRows] = useState<Row[]>([]);
  const [subgenres, setSubgenres] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("genre_lexicon_history")
        .select("slug, term, weight, status, captured_at")
        .order("captured_at", { ascending: false })
        .limit(2000);
      const list = (data ?? []) as Row[];
      setRows(list);
      const slugs = [...new Set(list.map(r => r.slug).filter(Boolean))];
      setSubgenres(slugs);
      setSelected(slugs[0] ?? null);
      setLoading(false);
    })();
  }, []);

  const filtered = useMemo(() => rows.filter(r => !selected || r.slug === selected), [rows, selected]);
  const latestDate = filtered[0]?.captured_at;
  const latest = filtered.filter(r => r.captured_at === latestDate);

  const emerging = latest.filter(r => r.status === "emerging").sort((a, b) => (Number(b.weight) || 0) - (Number(a.weight) || 0)).slice(0, 20);
  const dominant = latest.filter(r => r.status === "stable").sort((a, b) => (Number(b.weight) || 0) - (Number(a.weight) || 0)).slice(0, 20);
  const dying = latest.filter(r => r.status === "declining" || r.status === "dead").slice(0, 20);

  return (
    <section className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold">Evolução semântica</h3>
        <p className="text-[12px] text-muted-foreground">SEO vivo · termos nascendo, dominando e morrendo</p>
      </div>

      {loading ? <Skeleton className="h-64" /> : rows.length === 0 ? (
        <div className="nx-card p-8 text-center text-sm text-muted-foreground">
          Sem snapshots de léxico ainda. A captura roda semanalmente.
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5">
            {subgenres.slice(0, 30).map((s) => (
              <button
                key={s}
                onClick={() => setSelected(s)}
                className={cn(
                  "px-2.5 py-1 text-[11px] rounded-md border transition-colors",
                  selected === s ? "bg-card border-primary/40 text-foreground" : "border-border text-muted-foreground hover:bg-elevated",
                )}
              >
                {s}
              </button>
            ))}
          </div>

          <div className="grid md:grid-cols-3 gap-3">
            <Column
              icon={Sparkles}
              iconClass="text-amber-400"
              title="Nascendo"
              terms={emerging}
              variant="emerging"
              empty="Nenhum termo emergente."
            />
            <Column
              icon={Crown}
              iconClass="text-primary"
              title="Dominantes"
              terms={dominant}
              variant="stable"
              empty="Nenhum termo dominante consolidado."
            />
            <Column
              icon={Skull}
              iconClass="text-muted-foreground"
              title="Morrendo"
              terms={dying}
              variant="dying"
              empty="Nenhum termo em declínio."
            />
          </div>
        </>
      )}
    </section>
  );
}

function Column({ icon: Icon, iconClass, title, terms, variant, empty }: { icon: LucideIcon; iconClass: string; title: string; terms: Row[]; variant: string; empty: string }) {
  return (
    <div className="nx-card p-4">
      <div className="flex items-center gap-2 mb-3">
        <Icon className={cn("h-4 w-4", iconClass)} />
        <h4 className="text-sm font-semibold">{title}</h4>
        <span className="text-[11px] text-muted-foreground">({terms.length})</span>
      </div>
      {terms.length === 0 ? (
        <p className="text-[12px] text-muted-foreground">{empty}</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {terms.map((t, i) => (
            <Badge
              key={`${t.term}-${i}`}
              variant={variant === "stable" ? "default" : "outline"}
              className={cn(
                "text-[11px]",
                variant === "emerging" && "border-amber-500/40 text-amber-300",
                variant === "dying" && "opacity-50 line-through",
              )}
            >
              {t.term}
              {t.weight != null && <span className="opacity-60 ml-1">{Math.round((Number(t.weight) || 0) * 100)}</span>}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
