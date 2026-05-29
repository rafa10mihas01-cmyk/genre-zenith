import { FileSpreadsheet, Music2 } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  collectionMode: "bot" | "spreadsheet" | string | null | undefined;
  size?: "sm" | "md";
  className?: string;
};

/**
 * Mostra a fonte de coleta da campanha — lê `campaigns.collection_mode`
 * (fonte de verdade no banco):
 *   - "bot" → Coleta Spotify (bot lê managed playlists)
 *   - "spreadsheet" → Coleta Excel (cliente sobe planilha no portal)
 */
export function CollectionSourceBadge({ collectionMode, size = "sm", className }: Props) {
  const mode = (collectionMode ?? "").toLowerCase();

  const base = cn(
    "inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-muted-foreground",
    size === "sm" ? "text-[10px] uppercase tracking-wider" : "text-xs",
    className,
  );

  if (mode === "spreadsheet") {
    return (
      <span className={base} title="Coleta via planilha enviada pelo cliente">
        <FileSpreadsheet className="h-3 w-3 text-domain-campaigns" />
        Coleta Excel
      </span>
    );
  }

  if (mode === "bot") {
    return (
      <span className={base} title="Coleta automática via Spotify (managed playlists)">
        <Music2 className="h-3 w-3 text-primary" />
        Coleta Spotify
      </span>
    );
  }

  return null;
}
