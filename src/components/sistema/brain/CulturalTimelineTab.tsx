// CulturalTimelineTab — feed de eventos culturais do nicho.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Sparkles, Skull, TrendingUp, ListMusic, Flame, RefreshCw, ShuffleIcon, Crown, ChevronDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { WindowSelector, TimeWindow, windowToDays } from "./shared/WindowSelector";
import { timeAgo } from "@/lib/format";

const ICON: Record<string, any> = {
  term_emerging: Sparkles,
  term_dying: Skull,
  artist_rising: TrendingUp,
  playlist_growing: ListMusic,
  cluster_heating: Flame,
  editorial_shift: RefreshCw,
  drift_detected: ShuffleIcon,
  leader_rising: Crown,
  leader_falling: ChevronDown,
};

const COLOR: Record<string, string> = {
  term_emerging: "text-amber-400",
  term_dying: "text-muted-foreground",
  artist_rising: "text-emerald-400",
  playlist_growing: "text-emerald-400",
  cluster_heating: "text-rose-400",
  editorial_shift: "text-violet-400",
  drift_detected: "text-violet-400",
  leader_rising: "text-primary",
  leader_falling: "text-destructive",
};

type Event = {
  id: string;
  event_type: string;
  title: string;
  description: string | null;
  severity: string;
  subgenre_slug: string | null;
  payload: any;
  occurred_at: string;
};

export function CulturalTimelineTab() {
  const [window, setWindow] = useState<TimeWindow>("7d");
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const since = new Date(Date.now() - windowToDays(window) * 86400000).toISOString();
      const { data } = await supabase
        .from("genre_trend_events")
        .select("*")
        .gte("occurred_at", since)
        .order("occurred_at", { ascending: false })
        .limit(200);
      setEvents((data ?? []) as Event[]);
      setLoading(false);
    })();
  }, [window]);

  // agrupa por dia
  const groups = new Map<string, Event[]>();
  events.forEach((e) => {
    const day = e.occurred_at.slice(0, 10);
    const arr = groups.get(day) ?? [];
    arr.push(e); groups.set(day, arr);
  });

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Timeline cultural</h3>
          <p className="text-[12px] text-muted-foreground">o que está acontecendo no nicho</p>
        </div>
        <WindowSelector value={window} onChange={setWindow} />
      </div>

      {loading ? (
        <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
      ) : events.length === 0 ? (
        <div className="nx-card p-8 text-center text-sm text-muted-foreground">
          Nenhum evento detectado nesta janela. O detector roda diariamente — eventos aparecem após mudanças significativas.
        </div>
      ) : (
        <div className="space-y-5">
          {[...groups.entries()].map(([day, evs]) => (
            <div key={day}>
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">{day}</p>
              <div className="space-y-1.5">
                {evs.map((e) => {
                  const Icon = ICON[e.event_type] ?? Sparkles;
                  return (
                    <div key={e.id} className="nx-card p-3 flex items-start gap-3 hover:bg-elevated transition-colors">
                      <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${COLOR[e.event_type] ?? "text-muted-foreground"}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-medium truncate">{e.title}</p>
                          {e.severity !== "info" && (
                            <Badge variant="outline" className="text-[10px] h-4 px-1.5">{e.severity}</Badge>
                          )}
                          {e.subgenre_slug && (
                            <span className="text-[11px] text-muted-foreground">· {e.subgenre_slug}</span>
                          )}
                        </div>
                        {e.description && <p className="text-[12px] text-muted-foreground mt-0.5">{e.description}</p>}
                      </div>
                      <span className="text-[11px] text-muted-foreground shrink-0">{timeAgo(e.occurred_at)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
