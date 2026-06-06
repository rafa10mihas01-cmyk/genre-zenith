import React from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { ACTION_META, type ActionKind } from "./actionMeta";

export function BucketShell({
  id, kind, count, headerRight, children,
}: { id: string; kind: ActionKind; count: number; headerRight?: React.ReactNode; children: React.ReactNode }) {
  const m = ACTION_META[kind];
  if (count === 0) return null;
  return (
    <Card id={id} className="overflow-hidden scroll-mt-20">
      <div className={cn("flex items-center justify-between gap-2 px-3 py-2.5 border-b min-w-0", m.tone, "bg-opacity-40")}>
        <div className="flex items-center gap-1.5 min-w-0">
          <m.Icon className="h-3.5 w-3.5 shrink-0" />
          <span className="text-[11px] font-bold uppercase tracking-wider truncate">{m.label}</span>
          <span className="text-[11px] opacity-70 tabular-nums shrink-0">· {count}</span>
        </div>
        <div className="shrink-0">{headerRight}</div>
      </div>
      <div className="divide-y divide-border/40 max-h-[440px] overflow-y-auto">{children}</div>
    </Card>
  );
}
