import { Music2 } from "lucide-react";
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
  const px = size === "sm" ? "h-10 w-10" : "h-12 w-12";
  const href = url || `https://open.spotify.com/playlist/${playlistId}`;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => e.stopPropagation()}
      className="flex items-center gap-3 min-w-0 group"
    >
      <div
        className={cn(
          px,
          "shrink-0 rounded-md overflow-hidden bg-muted border border-border flex items-center justify-center transition-transform group-hover:scale-[1.03]"
        )}
      >
        {coverUrl ? (
          <img src={coverUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <Music2 className="h-4 w-4 text-muted-foreground" />
        )}
      </div>
      <div className="min-w-0">
        <div className={cn("font-medium truncate group-hover:text-primary transition-colors", subtle ? "text-foreground/90" : "text-foreground")}>
          {name ?? "—"}
        </div>
        {followers != null && (
          <div className="text-xs text-muted-foreground tabular-nums">
            {Intl.NumberFormat("pt-BR").format(followers)} seguidores
          </div>
        )}
      </div>
    </a>
  );
}
