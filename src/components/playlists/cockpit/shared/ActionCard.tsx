import { cn } from "@/lib/utils";
import { ACTION_META, type ActionKind } from "./actionMeta";

export function ActionCard({ kind, count, detected, hrefId }: { kind: ActionKind; count: number; detected?: number; hrefId: string }) {
  const m = ACTION_META[kind];
  const disabled = count === 0 && (detected ?? 0) === 0;
  const hasMore = detected != null && detected > count;
  return (
    <a
      href={`#${hrefId}`}
      onClick={(e) => {
        if (disabled) { e.preventDefault(); return; }
        e.preventDefault();
        document.getElementById(hrefId)?.scrollIntoView({ behavior: "smooth", block: "start" });
      }}
      className={cn(
        "rounded-2xl border p-4 transition-all",
        m.tone,
        disabled ? "opacity-40 cursor-not-allowed" : "hover:scale-[1.02] cursor-pointer",
      )}
    >
      <div className="flex items-center justify-between mb-2">
        <m.Icon className="h-4 w-4" />
        <span className="text-[10px] uppercase tracking-wider font-bold">{m.label}</span>
      </div>
      <div className="text-3xl font-bold tabular-nums leading-none">{count}</div>
      {hasMore ? (
        <div className="text-[11px] opacity-80 mt-1.5 leading-snug">
          de {detected} detectadas · limite deste ciclo
        </div>
      ) : (
        <div className="text-[11px] opacity-80 mt-1.5 leading-snug">{m.hint}</div>
      )}
    </a>
  );
}
