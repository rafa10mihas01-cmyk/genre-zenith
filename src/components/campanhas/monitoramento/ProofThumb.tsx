import { useState } from "react";
import { ImageIcon, X, ChevronLeft, ChevronRight } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type Props = {
  urls?: (string | null | undefined)[] | null;
  /** retrocompat: campo único */
  url?: string | null;
};

export function ProofThumb({ urls, url }: Props) {
  const list = (urls ?? []).filter((u): u is string => !!u);
  if (list.length === 0 && url) list.push(url);

  const [open, setOpen] = useState(false);
  const [idx, setIdx] = useState(0);

  if (list.length === 0) return <span className="text-muted-foreground text-xs">—</span>;

  const cover = list[0];
  const extra = list.length - 1;

  return (
    <>
      <button
        type="button"
        onClick={() => { setIdx(0); setOpen(true); }}
        className="inline-flex items-center gap-2 group focus:outline-none"
        title={`${list.length} print(s) da varredura`}
      >
        <span className="relative h-10 w-16 rounded-md overflow-hidden border border-border bg-muted flex items-center justify-center">
          <img src={cover} alt="print 1" className="h-full w-full object-cover group-hover:opacity-80 transition" loading="lazy" />
          {extra > 0 && (
            <span className="absolute inset-0 bg-background/70 text-foreground text-xs font-semibold flex items-center justify-center">
              +{extra}
            </span>
          )}
        </span>
        <span className="text-xs text-muted-foreground group-hover:text-primary inline-flex items-center gap-1">
          <ImageIcon className="h-3 w-3" /> {list.length}/{list.length}
        </span>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-5xl p-0 bg-background border-border">
          <div className="relative">
            <img
              src={list[idx]}
              alt={`print ${idx + 1}`}
              className="w-full h-auto max-h-[80vh] object-contain bg-black"
            />
            <button
              onClick={() => setOpen(false)}
              className="absolute top-2 right-2 h-8 w-8 rounded-full bg-background/80 hover:bg-background flex items-center justify-center"
              aria-label="Fechar"
            >
              <X className="h-4 w-4" />
            </button>
            {list.length > 1 && (
              <>
                <button
                  onClick={() => setIdx((i) => (i - 1 + list.length) % list.length)}
                  className="absolute left-2 top-1/2 -translate-y-1/2 h-9 w-9 rounded-full bg-background/80 hover:bg-background flex items-center justify-center"
                  aria-label="Anterior"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  onClick={() => setIdx((i) => (i + 1) % list.length)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 h-9 w-9 rounded-full bg-background/80 hover:bg-background flex items-center justify-center"
                  aria-label="Próximo"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
                <div className="absolute bottom-2 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-background/80 text-xs text-foreground tabular-nums">
                  {idx + 1} / {list.length}
                </div>
              </>
            )}
          </div>
          {list.length > 1 && (
            <div className="p-3 border-t border-border flex gap-2 overflow-x-auto">
              {list.map((u, i) => (
                <button
                  key={u + i}
                  onClick={() => setIdx(i)}
                  className={cn(
                    "h-14 w-20 shrink-0 rounded-md overflow-hidden border-2 transition",
                    i === idx ? "border-primary" : "border-border hover:border-foreground/40"
                  )}
                >
                  <img src={u} alt={`thumb ${i + 1}`} className="h-full w-full object-cover" loading="lazy" />
                </button>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
