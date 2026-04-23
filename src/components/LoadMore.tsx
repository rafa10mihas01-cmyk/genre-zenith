import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { ChevronDown, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Hook reutilizável para paginação "Carregar mais".
 *
 * Mantém quanto está visível, reseta automaticamente quando o array muda
 * (ex: filtro trocou) e expõe `visibleItems`, contador e setter de página.
 *
 * Uso:
 *   const { visibleItems, hasMore, loadMore, total, visible, reset } =
 *     usePagination(filteredArray, 20);
 */
export function usePagination<T>(items: T[], pageSize = 20) {
  const [page, setPage] = useState(1);
  const len = items.length;

  // Reseta quando o tamanho do array muda (ex: filtro novo).
  useEffect(() => { setPage(1); }, [len]);

  const visible = Math.min(page * pageSize, items.length);
  const visibleItems = items.slice(0, visible);
  const hasMore = visible < items.length;

  const loadMore = useCallback(() => setPage(p => p + 1), []);
  const reset = useCallback(() => setPage(1), []);

  return { visibleItems, hasMore, loadMore, total: items.length, visible, reset };
}

/**
 * Botão padrão "Carregar mais" + contador "mostrando X de Y".
 *
 * Renderiza nada se `total === 0`. Quando não há mais itens, mostra só o contador.
 */
export function LoadMore({
  visible,
  total,
  hasMore,
  onLoadMore,
  loading = false,
  label = "Carregar mais",
  itemLabel = "itens",
  className,
}: {
  visible: number;
  total: number;
  hasMore: boolean;
  onLoadMore: () => void;
  loading?: boolean;
  label?: string;
  itemLabel?: string;
  className?: string;
}) {
  if (total === 0) return null;
  return (
    <div className={cn("flex items-center justify-between gap-3 pt-2", className)}>
      <p className="text-[11px] text-muted-foreground tabular-nums">
        Mostrando <span className="text-foreground font-medium">{visible}</span> de{" "}
        <span className="text-foreground font-medium">{total}</span> {itemLabel}
      </p>
      {hasMore && (
        <Button
          variant="outline"
          size="sm"
          onClick={onLoadMore}
          disabled={loading}
          className="h-8 text-xs gap-1.5"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ChevronDown className="h-3.5 w-3.5" />}
          {label}
        </Button>
      )}
    </div>
  );
}
