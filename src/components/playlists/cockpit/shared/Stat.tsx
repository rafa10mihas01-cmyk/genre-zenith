import { cn } from "@/lib/utils";

export function Stat({ label, value, accent, muted }: { label: string; value: string; accent?: boolean; muted?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className={cn(
        "font-semibold tabular-nums",
        accent && "text-primary text-lg",
        muted && "text-xs text-muted-foreground font-normal",
        !accent && !muted && "text-base",
      )}>{value}</span>
    </div>
  );
}
