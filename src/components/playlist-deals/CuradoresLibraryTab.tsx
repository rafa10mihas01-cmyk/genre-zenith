import { useMemo, useState } from "react";
import { Search, Users, ListMusic, ExternalLink, ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { CuratorLibrarySheet } from "@/components/curators/CuratorLibrarySheet";
import { cn } from "@/lib/utils";
import type { Curator, CuratorBalance } from "@/hooks/useCuratorDeals";
import type { CuratorDeal } from "@/lib/curatorDealsUtils";

function formatPlays(n: number | null | undefined): string {
  if (!n || !Number.isFinite(n)) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return Math.round(n).toLocaleString("pt-BR");
}

interface Props {
  curators: Curator[];
  balances: CuratorBalance[];
  deals: CuratorDeal[];
  loading: boolean;
}

export function CuradoresLibraryTab({ curators, balances, deals, loading }: Props) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Curator | null>(null);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return curators
      .filter((c) => !c.archived_at)
      .filter((c) => !q || c.name.toLowerCase().includes(q) || (c.contact ?? "").toLowerCase().includes(q))
      .map((c) => {
        const balance = balances.find((b) => b.curator_id === c.id);
        const dealsCount = deals.filter((d) => d.curator_id === c.id).length;
        return { curator: c, balance, dealsCount };
      });
  }, [curators, balances, deals, query]);

  return (
    <div className="space-y-4">
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar curador…"
          className="pl-9"
        />
      </div>

      {loading ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">Carregando curadores…</Card>
      ) : rows.length === 0 ? (
        <Card className="p-12 text-center">
          <Users className="mx-auto size-10 text-muted-foreground/40 mb-3" />
          <p className="text-sm text-muted-foreground">
            {query ? "Nenhum curador encontrado." : "Nenhum curador cadastrado ainda."}
          </p>
        </Card>
      ) : (
        <div className="grid gap-3 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
          {rows.map(({ curator, balance, dealsCount }) => {
            const remaining = balance?.remaining_plays ?? 0;
            const purchased = balance?.purchased_plays ?? 0;
            const overbooked = (balance?.overbooked_plays ?? 0) > 0;
            return (
              <button
                key={curator.id}
                onClick={() => setSelected(curator)}
                className={cn(
                  "group relative text-left rounded-2xl bg-card border border-border/40 p-5 transition-all",
                  "hover:border-border hover:bg-[hsl(var(--card-hover,var(--card)))]",
                )}
              >
                <div className="flex items-start justify-between gap-3 mb-4">
                  <div className="min-w-0 flex-1">
                    <h3 className="font-semibold text-base truncate">{curator.name}</h3>
                    {curator.contact && (
                      <p className="text-xs text-muted-foreground truncate mt-0.5">{curator.contact}</p>
                    )}
                  </div>
                  <ChevronRight className="size-4 text-muted-foreground/60 group-hover:text-foreground transition-colors flex-shrink-0" />
                </div>

                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Comprado</div>
                    <div className="text-sm font-semibold">{formatPlays(purchased)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Restante</div>
                    <div className={cn("text-sm font-semibold", overbooked && "text-destructive")}>
                      {overbooked ? "Estourado" : formatPlays(remaining)}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 pt-3 border-t border-border/30">
                  <Badge variant="secondary" className="gap-1 font-normal">
                    <ListMusic className="size-3" />
                    {dealsCount} {dealsCount === 1 ? "deal" : "deals"}
                  </Badge>
                  {curator.spotify_owner_url && (
                    <a
                      href={curator.spotify_owner_url}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                    >
                      Spotify <ExternalLink className="size-3" />
                    </a>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}

      <CuratorLibrarySheet
        curator={selected}
        deals={deals.filter((d) => d.curator_id === selected?.id)}
        onClose={() => setSelected(null)}
      />
    </div>
  );
}
