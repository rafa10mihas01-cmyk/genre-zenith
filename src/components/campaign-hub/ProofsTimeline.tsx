import { useState } from "react";
import { Camera, TrendingUp, ExternalLink } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { formatInt } from "@/lib/campaignEngine";
import { cn } from "@/lib/utils";

export type ProofEvent = {
  id: string;
  captured_at: string;
  playlist_name: string;
  playlist_cover?: string | null;
  screenshot_url: string | null;
  plays_total: number;
  delta_plays?: number | null;
  position?: number | null;
  position_prev?: number | null;
  source?: string;
  spotify_url?: string | null;
};

type Props = {
  events: ProofEvent[];
};

export function ProofsTimeline({ events }: Props) {
  const [openShot, setOpenShot] = useState<string | null>(null);

  if (events.length === 0) {
    return (
      <div className="text-sm text-muted-foreground py-12 text-center">
        Ainda não chegaram provas dessa campanha. Conforme o bot capturar prints, eles aparecem aqui.
      </div>
    );
  }

  return (
    <>
      <ol className="relative pl-6">
        <span className="absolute left-[7px] top-2 bottom-2 w-px bg-border" aria-hidden />
        {events.map((ev) => (
          <li key={ev.id} className="relative pb-8 last:pb-0">
            <span className="absolute -left-[1px] top-2 h-3 w-3 rounded-full bg-primary ring-4 ring-background" aria-hidden />
            <ProofItem event={ev} onZoom={(url) => setOpenShot(url)} />
          </li>
        ))}
      </ol>

      <Dialog open={!!openShot} onOpenChange={(o) => !o && setOpenShot(null)}>
        <DialogContent className="max-w-4xl p-2 bg-card border-border">
          {openShot && <img src={openShot} alt="" className="w-full h-auto rounded" />}
        </DialogContent>
      </Dialog>
    </>
  );
}

function ProofItem({ event, onZoom }: { event: ProofEvent; onZoom: (url: string) => void }) {
  const ago = timeAgo(event.captured_at);
  const moved = event.position != null && event.position_prev != null && event.position !== event.position_prev;

  return (
    <article className="rounded-2xl border border-border bg-card overflow-hidden">
      {/* Header */}
      <header className="px-4 pt-3 pb-2 flex items-center gap-3">
        {event.playlist_cover ? (
          <img src={event.playlist_cover} alt="" className="w-9 h-9 rounded object-cover" />
        ) : (
          <div className="w-9 h-9 rounded bg-muted" />
        )}
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold truncate">{event.playlist_name}</div>
          <div className="text-[11px] text-muted-foreground">
            {ago} · {new Date(event.captured_at).toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
            {event.source && <> · {event.source}</>}
          </div>
        </div>
        {event.spotify_url && (
          <a href={event.spotify_url} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground">
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
      </header>

      {/* Screenshot preview */}
      {event.screenshot_url ? (
        <button
          onClick={() => onZoom(event.screenshot_url!)}
          className="block w-full bg-black/40 hover:opacity-90 transition-opacity"
        >
          <img src={event.screenshot_url} alt="" className="w-full max-h-[420px] object-contain mx-auto" />
        </button>
      ) : (
        <div className="px-4 py-6 text-center text-xs text-muted-foreground bg-elevated/30 border-y border-border">
          <Camera className="h-4 w-4 inline mr-1" /> Sem screenshot — métricas via API
        </div>
      )}

      {/* Stats */}
      <footer className="px-4 py-3 flex items-center gap-4 flex-wrap text-xs">
        <Stat
          label="Plays totais"
          value={formatInt(event.plays_total)}
        />
        {event.delta_plays != null && event.delta_plays !== 0 && (
          <Stat
            label="Δ 24h"
            value={
              <span className={cn("inline-flex items-center gap-1", event.delta_plays > 0 ? "text-primary" : "text-destructive")}>
                <TrendingUp className="h-3 w-3" />
                {event.delta_plays > 0 ? "+" : ""}{formatInt(event.delta_plays)}
              </span>
            }
          />
        )}
        {event.position != null && (
          <Stat
            label="Posição"
            value={
              moved ? (
                <span className="tabular-nums">
                  #{event.position_prev} → <span className="text-primary font-semibold">#{event.position}</span>
                </span>
              ) : (
                <span className="tabular-nums">#{event.position}</span>
              )
            }
          />
        )}
      </footer>
    </article>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className="text-sm font-semibold tabular-nums mt-0.5">{value}</span>
    </div>
  );
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "agora";
  if (m < 60) return `há ${m}min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `há ${h}h`;
  return `há ${Math.floor(h / 24)}d`;
}
