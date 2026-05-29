import { FileSpreadsheet, Music2 } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  campaignType: "ecosystem" | "external" | "hybrid" | string | null | undefined;
  size?: "sm" | "md";
  className?: string;
};

/**
 * Mostra a fonte de coleta da campanha:
 * - ecosystem → "Coleta Spotify" (bot lê managed playlists)
 * - external → "Coleta Excel" (cliente sobe planilha no portal)
 * - hybrid → ambos
 *
 * Deriva direto de campaign_type — sem query extra.
 */
export function CollectionSourceBadge({ campaignType, size = "sm", className }: Props) {
  const t = (campaignType ?? "").toLowerCase();
  const hasSpotify = t === "ecosystem" || t === "hybrid";
  const hasExcel = t === "external" || t === "hybrid";

  if (!hasSpotify && !hasExcel) return null;

  const base = cn(
    "inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-muted-foreground",
    size === "sm" ? "text-[10px] uppercase tracking-wider" : "text-xs",
    className,
  );

  return (
    <span className="inline-flex items-center gap-1">
      {hasSpotify && (
        <span className={base} title="Coleta automática via Spotify (managed playlists)">
          <Music2 className="h-3 w-3 text-primary" />
          Coleta Spotify
        </span>
      )}
      {hasExcel && (
        <span className={base} title="Coleta via planilha enviada pelo cliente">
          <FileSpreadsheet className="h-3 w-3 text-domain-campaigns" />
          Coleta Excel
        </span>
      )}
    </span>
  );
}
