import { useMemo, useState } from "react";
import { Camera, TrendingUp, ExternalLink, ScrollText, ListMusic, Users } from "lucide-react";
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

type Filter = "all" | "eco" | "ext";

type Props = {
  events: ProofEvent[];
  campaignStartedAt?: string | null;
};

function kindOf(ev: ProofEvent): "eco" | "ext" {
  return ev.id.startsWith("es-") ? "eco" : "ext";
}

export function ProofsTimeline({ events, campaignStartedAt }: Props) {
  const [openShot, setOpenShot] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");

  const counts = useMemo(() => {
    let eco = 0, ext = 0;
    for (const e of events) { if (kindOf(e) === "eco") eco++; else ext++; }
    return { all: events.length, eco, ext };
  }, [events]);

  const filtered = useMemo(
    () => (filter === "all" ? events : events.filter((e) => kindOf(e) === filter)),
    [events, filter],
  );

  const grouped = useMemo(() => groupByDay(filtered), [filtered]);
  const last = events[0]?.captured_at ?? null;

  if (events.length === 0) {
    return <EmptyState campaignStartedAt={campaignStartedAt} />;
  }

  return (
    <section className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <ScrollText className="h-4 w-4 text-primary shrink-0" />
          <div className="min-w-0">
            <h3 className="text-sm font-semibold">Provas de entrega</h3>
            <p className="text-[11px] text-muted-foreground tabular-nums">
              {counts.all} {counts.all === 1 ? "captura" : "capturas"}
              {last && <> · última {timeAgo(last)}</>}
            </p>
          </div>
        </div>
        <FilterToggle filter={filter} setFilter={setFilter} counts={counts} />
      </div>

      {/* Grupos por dia */}
      <div className="space-y-6">
        {grouped.map((g) => (
          <div key={g.key} className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                {g.label}
              </span>
              <span className="h-px flex-1 bg-border" aria-hidden />
              <span className="text-[10px] text-subtle-foreground tabular-nums">
                {g.items.length} {g.items.length === 1 ? "captura" : "capturas"}
              </span>
            </div>
            <ol className="relative pl-6">
              <span className="absolute left-[7px] top-2 bottom-2 w-px bg-border" aria-hidden />
              {g.items.map((ev) => (
                <li key={ev.id} className="relative pb-4 last:pb-0">
                  <span
                    className={cn(
                      "absolute -left-[1px] top-2 h-3 w-3 rounded-full ring-4 ring-background",
                      kindOf(ev) === "eco" ? "bg-primary" : "bg-curators",
                    )}
                    aria-hidden
                  />
                  <ProofItem event={ev} onZoom={(url) => setOpenShot(url)} />
                </li>
              ))}
            </ol>
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="text-xs text-muted-foreground text-center py-6 border border-dashed border-border rounded-lg">
            Nenhuma captura nesse filtro.
          </div>
        )}
      </div>

      <Dialog open={!!openShot} onOpenChange={(o) => !o && setOpenShot(null)}>
        <DialogContent className="max-w-4xl p-2 bg-card border-border">
          {openShot && <img src={openShot} alt="" className="w-full h-auto rounded" />}
        </DialogContent>
      </Dialog>
    </section>
  );
}

function FilterToggle({
  filter, setFilter, counts,
}: { filter: Filter; setFilter: (f: Filter) => void; counts: { all: number; eco: number; ext: number } }) {
  const opts: Array<{ id: Filter; label: string; count: number }> = [
    { id: "all", label: "Todos", count: counts.all },
    { id: "eco", label: "Eco", count: counts.eco },
    { id: "ext", label: "Externo", count: counts.ext },
  ];
  return (
    <div className="inline-flex rounded-md border border-border bg-elevated/30 p-0.5">
      {opts.map((o) => {
        const active = filter === o.id;
        return (
          <button
            key={o.id}
            onClick={() => setFilter(o.id)}
            className={cn(
              "px-2.5 py-1 text-[11px] font-medium rounded-sm transition-colors tabular-nums",
              active
                ? "bg-foreground/10 text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {o.label} <span className="text-subtle-foreground">· {o.count}</span>
          </button>
        );
      })}
    </div>
  );
}

function EmptyState({ campaignStartedAt }: { campaignStartedAt?: string | null }) {
  const nextLabel = useMemo(() => {
    const base = campaignStartedAt ? new Date(campaignStartedAt).getTime() : Date.now();
    let next = base + 2 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    while (next < now) next += 2 * 24 * 60 * 60 * 1000;
    return new Date(next).toLocaleString("pt-BR", {
      day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
    });
  }, [campaignStartedAt]);

  return (
    <div className="flex items-center gap-2 px-3 py-2.5 rounded-md border border-dashed border-border bg-elevated/20 text-xs text-muted-foreground">
      <Camera className="h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0 truncate">
        Aguardando coleta · prevista <strong className="text-foreground">{nextLabel}</strong>
      </span>
    </div>
  );
}

function ProofItem({ event, onZoom }: { event: ProofEvent; onZoom: (url: string) => void }) {
  const ago = timeAgo(event.captured_at);
  const moved = event.position != null && event.position_prev != null && event.position !== event.position_prev;
  const isEco = kindOf(event) === "eco";
  const hasShot = !!event.screenshot_url;
  const timeLabel = new Date(event.captured_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

  // Card compacto pra Eco sem screenshot: capa maior + métricas em destaque, sem área vazia
  if (isEco && !hasShot) {
    return (
      <article className="rounded-xl border border-border bg-card p-3 flex items-center gap-3">
        {event.playlist_cover ? (
          <img src={event.playlist_cover} alt="" className="w-12 h-12 rounded object-cover shrink-0" />
        ) : (
          <div className="w-12 h-12 rounded bg-muted shrink-0 flex items-center justify-center">
            <ListMusic className="h-5 w-5 text-muted-foreground" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-sm font-medium truncate">{event.playlist_name}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20 shrink-0">eco</span>
          </div>
          <div className="text-[11px] text-muted-foreground tabular-nums">
            {ago} · {timeLabel}{event.source && <> · {event.source}</>}
          </div>
        </div>
        <div className="flex items-center gap-4 shrink-0">
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Plays</div>
            <div className="text-sm font-semibold tabular-nums">{formatInt(event.plays_total)}</div>
          </div>
          {event.delta_plays != null && event.delta_plays !== 0 && (
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Δ 24h</div>
              <div className={cn("text-sm font-semibold tabular-nums inline-flex items-center gap-1", event.delta_plays > 0 ? "text-primary" : "text-destructive")}>
                <TrendingUp className="h-3 w-3" />
                {event.delta_plays > 0 ? "+" : ""}{formatInt(event.delta_plays)}
              </div>
            </div>
          )}
          {event.spotify_url && (
            <a href={event.spotify_url} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground">
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
        </div>
      </article>
    );
  }

  // Card completo (curador externo com screenshot)
  return (
    <article className="rounded-2xl border border-border bg-card overflow-hidden">
      <header className="px-4 pt-3 pb-2 flex items-center gap-3">
        {event.playlist_cover ? (
          <img src={event.playlist_cover} alt="" className="w-9 h-9 rounded object-cover" />
        ) : (
          <div className="w-9 h-9 rounded bg-muted flex items-center justify-center">
            <Users className="h-4 w-4 text-muted-foreground" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-sm font-semibold truncate">{event.playlist_name}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-curators/10 text-curators border border-curators/20 shrink-0">externo</span>
          </div>
          <div className="text-[11px] text-muted-foreground">
            {ago} · {timeLabel}
            {event.source && <> · {event.source}</>}
          </div>
        </div>
        {event.spotify_url && (
          <a href={event.spotify_url} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground">
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
      </header>

      {hasShot ? (
        <button
          onClick={() => onZoom(event.screenshot_url!)}
          className="block w-full bg-black/40 hover:opacity-90 transition-opacity"
        >
          <img src={event.screenshot_url!} alt="" className="w-full max-h-[420px] object-contain mx-auto" />
        </button>
      ) : (
        <div className="px-4 py-3 text-[11px] text-muted-foreground bg-elevated/20 border-y border-border flex items-center gap-2">
          <Camera className="h-3.5 w-3.5" /> Sem screenshot — métricas via API
        </div>
      )}

      <footer className="px-4 py-3 flex items-center gap-4 flex-wrap text-xs">
        <Stat label="Plays totais" value={formatInt(event.plays_total)} />
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

function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(); yesterday.setDate(today.getDate() - 1);
  if (dayKey(iso) === dayKey(today.toISOString())) return "Hoje";
  if (dayKey(iso) === dayKey(yesterday.toISOString())) return "Ontem";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: d.getFullYear() !== today.getFullYear() ? "numeric" : undefined });
}

function groupByDay(events: ProofEvent[]) {
  const map = new Map<string, { key: string; label: string; items: ProofEvent[] }>();
  for (const ev of events) {
    const k = dayKey(ev.captured_at);
    if (!map.has(k)) map.set(k, { key: k, label: dayLabel(ev.captured_at), items: [] });
    map.get(k)!.items.push(ev);
  }
  return Array.from(map.values());
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
