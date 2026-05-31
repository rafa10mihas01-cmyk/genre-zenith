import { ImageIcon } from "lucide-react";

export function ProofThumb({ url }: { url: string | null | undefined }) {
  if (!url) return <span className="text-muted-foreground text-xs">—</span>;
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-2 group"
      title="Ver print original"
    >
      <span className="h-10 w-16 rounded-md overflow-hidden border border-border bg-muted flex items-center justify-center">
        <img
          src={url}
          alt="print"
          className="h-full w-full object-cover group-hover:opacity-80 transition"
          loading="lazy"
        />
      </span>
      <ImageIcon className="h-3 w-3 text-muted-foreground group-hover:text-primary" />
    </a>
  );
}
