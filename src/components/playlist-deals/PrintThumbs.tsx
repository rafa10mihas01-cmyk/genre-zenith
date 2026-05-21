import { useState } from "react";
import { FileText } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { NexEngineLogo } from "@/components/NexEngineLogo";
import { cn } from "@/lib/utils";

export interface PrintThumbsProps {
  urls: string[];
  className?: string;
  size?: "sm" | "md";
}

function isPdf(url: string): boolean {
  return /\.pdf(\?|$)/i.test(url);
}

function fileNameFromUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname.split("/").pop() ?? url;
  } catch {
    return url.split("/").pop() ?? url;
  }
}

export function PrintThumbs({ urls, className, size = "md" }: PrintThumbsProps) {
  const [open, setOpen] = useState<string | null>(null);

  if (!urls || urls.length === 0) return null;

  // Ordena por nome de arquivo (timestamp embutido) pra exibir do mais antigo
  // pro mais novo — cabeçalho/baseline primeiro, depois prints em sequência.
  const ordered = [...urls].sort((a, b) =>
    fileNameFromUrl(a).localeCompare(fileNameFromUrl(b), undefined, { numeric: true, sensitivity: "base" }),
  );

  const dim = size === "sm" ? "h-10 w-10" : "h-14 w-14";

  return (
    <>
      <div className={cn("flex flex-wrap gap-1.5", className)}>
        {urls.map((u) => {
          const pdf = isPdf(u);
          return (
            <a
              key={u}
              href={pdf ? u : undefined}
              target={pdf ? "_blank" : undefined}
              rel={pdf ? "noreferrer" : undefined}
              onClick={(e) => {
                if (!pdf) {
                  e.preventDefault();
                  setOpen(u);
                }
              }}
              className={cn(
                dim,
                "rounded-md overflow-hidden ring-1 ring-border bg-muted/40 hover:ring-primary/60 transition-all shrink-0 inline-flex items-center justify-center cursor-pointer",
              )}
              title={pdf ? "Abrir PDF" : "Ampliar print"}
            >
              {pdf ? (
                <div className="flex flex-col items-center justify-center text-primary">
                  <FileText className="h-4 w-4" />
                  <span className="text-[8px] font-semibold mt-0.5">PDF</span>
                </div>
              ) : (
                <img
                  src={u}
                  alt="Print"
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
              )}
            </a>
          );
        })}
      </div>

      <Dialog open={open !== null} onOpenChange={(v) => { if (!v) setOpen(null); }}>
        <DialogContent className="max-w-3xl p-0 bg-card border-border overflow-hidden">
          {open && (
            <div className="flex flex-col">
              <div className="flex items-center justify-between gap-3 px-5 py-3 pr-12 border-b border-border bg-[hsl(var(--elevated))]">
                <NexEngineLogo variant="auto" className="h-6 w-auto shrink-0" />
                <div className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground truncate">
                  Print direto do Spotify for Artists
                </div>
              </div>
              <div className="bg-card flex items-center justify-center p-2">
                <img
                  src={open}
                  alt="Print ampliado"
                  className="w-full h-auto max-h-[78vh] object-contain rounded-md"
                />
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
