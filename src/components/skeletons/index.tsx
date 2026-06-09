// Skeletons posicionais — ocupam o mesmo espaço do conteúdo final.
// Evitam layout shift e tela branca. Use em vez de spinner full-page.
import { Skeleton } from "@/components/ui/skeleton";

export function KpiRowSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 pt-4 mb-6">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="h-[90px] rounded-2xl" />
      ))}
    </div>
  );
}

export function TableRowsSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="border border-border rounded-2xl overflow-hidden bg-card">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-12 rounded-none border-b border-border/40 last:border-b-0 bg-transparent" />
      ))}
    </div>
  );
}

export function HeroCardSkeleton({ height = 220 }: { height?: number }) {
  return <Skeleton className="rounded-2xl w-full" style={{ height }} />;
}

export function ChartSkeleton({ height = 200 }: { height?: number }) {
  return <Skeleton className="rounded-2xl w-full" style={{ height }} />;
}
