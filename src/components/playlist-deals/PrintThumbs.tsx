import { useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export interface PrintThumbsProps {
  urls: string[];
  className?: string;
  size?: "sm" | "md";
}

export function PrintThumbs({ urls, className, size = "md" }: PrintThumbsProps) {
  const [open, setOpen] = useState<string | null>(null);

  if (!urls || urls.length === 0) return null;

  const dim = size === "sm" ? "h-10 w-10" : "h-14 w-14";

  return (
    <>
      <div className={cn("flex flex-wrap gap-1.5", className)}>
        {urls.map((u) => (
          <button
            key={u}
            type="button"
            onClick={() => setOpen(u)}
            className={cn(
              dim,
              "rounded-md overflow-hidden ring-1 ring-border bg-muted/40 hover:ring-primary/60 transition-all shrink-0",
            )}
            title="Ampliar print"
          >
            <img
              src={u}
              alt="Print"
              loading="lazy"
              className="h-full w-full object-cover"
            />
          </button>
        ))}
      </div>

      <Dialog open={open !== null} onOpenChange={(v) => { if (!v) setOpen(null); }}>
        <DialogContent className="max-w-3xl p-0 bg-black border-border overflow-hidden">
          {open && (
            <img
              src={open}
              alt="Print ampliado"
              className="w-full h-auto max-h-[85vh] object-contain"
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
