import { Sparkles } from "lucide-react";

export type GenreUsed = { name: string; score: number };

interface Props {
  genres: GenreUsed[] | null | undefined;
  className?: string;
  compact?: boolean;
}

/**
 * Mostra os gêneros vizinhos efetivamente usados pela campanha (top 3).
 * Renderiza nada se não houver vizinhos (campanha 100% no gênero principal).
 *
 * Ex.: "Gêneros: Funk · Trap (afinidade 0.85)"
 */
export function GenresUsedChip({ genres, className, compact }: Props) {
  if (!genres || genres.length === 0) return null;
  const top = genres.slice(0, 3);
  const names = top.map(g => g.name).join(" · ");
  const maxScore = top.reduce((m, g) => Math.max(m, g.score), 0);

  if (compact) {
    const tooltip = `Gêneros: ${names}${maxScore > 0 ? ` (afinidade ${maxScore.toFixed(2)})` : ""}`;
    return (
      <div
        title={tooltip}
        aria-label={tooltip}
        className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border bg-card text-muted-foreground ${className ?? ""}`}
      >
        <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
      </div>
    );
  }

  const scoreLabel = maxScore > 0 ? ` (afinidade ${maxScore.toFixed(2)})` : "";
  return (
    <div
      className={`inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs text-foreground-body ${className ?? ""}`}
    >
      <Sparkles className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
      <span>
        <span className="text-muted-foreground">Gêneros:</span>{" "}
        <span className="font-medium text-foreground">{names}</span>
        <span className="text-muted-foreground">{scoreLabel}</span>
      </span>
    </div>
  );
}
