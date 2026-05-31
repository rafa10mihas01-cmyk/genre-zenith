import { ExternalLink, Music2 } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  playlistId: string;
  name: string | null;
  url?: string | null;
  coverUrl?: string | null;
  followers?: number | null;
  subtle?: boolean;
  size?: "sm" | "md";
};

export function PlaylistCell({ playlistId, name, url, coverUrl, followers, subtle, size = "md" }: Props) {
  const px = size === "sm" ? "h-9 w-9" : "h-11 w-11";
  return (
    <div className="flex items-center gap-3 min-w-0">
      <div
        className={cn(
          px,
          "shrink-0 rounded-md overflow-hidden bg-muted border border-border flex items-center justify-center"
        )}
      >
        {coverUrl ? (
          <img src={coverUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <Music2 className="h-4 w-4 text-muted-foreground" />
        )}
      </div>
      <div className="min-w-0">
        <div className={cn("font-medium truncate", subtle ? "text-foreground/90" : "text-foreground")}>
          {name ?? "—"}
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="font-mono truncate max-w-[140px]">{playlistId}</span>
          {url && (
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-0.5 hover:text-primary"
            >
              abrir <ExternalLink className="h-3 w-3" />
            </a>
          )}
          {followers != null && (
            <span className="tabular-nums">· {Intl.NumberFormat("pt-BR").format(followers)} seguidores</span>
          )}
        </div>
      </div>
    </div>
  );
}
