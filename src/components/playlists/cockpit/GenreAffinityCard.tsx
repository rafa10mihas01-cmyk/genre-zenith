import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Network } from "lucide-react";
import { useGenreNeighborsByPlaylist } from "@/hooks/useGenreNeighbors";
import { getGenreColor } from "@/lib/genreColors";

type Props = {
  managedId: string;
};

const METHOD_LABEL: Record<string, string> = {
  manual: "curado",
  lexicon: "tokens",
  hybrid: "híbrido",
};

/**
 * Mostra os gêneros vizinhos desta playlist (via afinidade) e quantas
 * playlists gerenciadas existem em cada vizinho. Usado para visualizar
 * o "universo expansível" sem aplicar nada.
 */
export function GenreAffinityCard({ managedId }: Props) {
  const { data, isLoading } = useGenreNeighborsByPlaylist(managedId);

  if (isLoading) return null;
  if (!data?.neighbors?.length) return null;

  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 mb-2">
        <Network className="h-3.5 w-3.5 text-muted-foreground" />
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
          Gêneros vizinhos
        </div>
      </div>
      <p className="text-xs text-muted-foreground mb-3 leading-snug">
        Se faltar capacidade, o sistema pode expandir pra estes gêneros.
      </p>
      <div className="flex flex-col gap-1.5">
        {data.neighbors.slice(0, 6).map((n) => {
          const color = getGenreColor(n.nome);
          return (
            <div
              key={n.genre_id}
              className="flex items-center justify-between gap-3 px-3 py-2 rounded-md border bg-elevated/40"
              style={{
                borderColor: `hsl(${color.hsl} / 0.35)`,
                borderLeftWidth: 2,
                borderLeftColor: `hsl(${color.hsl})`,
              }}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className="h-2 w-2 rounded-full shrink-0"
                  style={{ backgroundColor: `hsl(${color.hsl})` }}
                  aria-hidden
                />
                <span className="text-sm text-foreground capitalize truncate">{n.nome}</span>
                <Badge variant="outline" className="text-[10px] border-border text-muted-foreground shrink-0">
                  {METHOD_LABEL[n.method] ?? n.method}
                </Badge>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className="text-[11px] text-muted-foreground tabular-nums">
                  {n.managed_count} playlist{n.managed_count === 1 ? "" : "s"}
                </span>
                <span
                  className="text-xs font-medium tabular-nums"
                  style={{ color: `hsl(${color.hsl})` }}
                >
                  {Math.round(n.score * 100)}%
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
