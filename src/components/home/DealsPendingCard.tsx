import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Handshake, ArrowRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type DealRow = {
  id: string;
  curator_name: string;
  song_name: string;
  state: string;
};

const STATE_LABEL: Record<string, string> = {
  awaiting_playlists: "aguardando playlists",
  awaiting_review: "aguardando revisão",
  pending: "pendente",
};

/**
 * DealsPendingCard — deals de curadores aguardando ação.
 * Mostra contagem total + lista dos mais recentes pendentes.
 */
export function DealsPendingCard() {
  const [rows, setRows] = useState<DealRow[] | null>(null);
  const [total, setTotal] = useState<number>(0);

  useEffect(() => {
    (async () => {
      const states = ["awaiting_playlists", "awaiting_review", "pending"];

      const [{ count }, { data }] = await Promise.all([
        supabase
          .from("curator_deals")
          .select("id", { count: "exact", head: true })
          .in("state", states),
        supabase
          .from("curator_deals")
          .select("id, curator_name, song_name, state, created_at")
          .in("state", states)
          .order("created_at", { ascending: false })
          .limit(5),
      ]);

      setTotal(count ?? 0);
      setRows((data ?? []) as DealRow[]);
    })();
  }, []);

  return (
    <div className="nx-card-hover p-5 flex flex-col gap-3 h-full">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Handshake className="h-4 w-4 text-primary" />
          <span className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground font-semibold">
            Deals pendentes
          </span>
        </div>
        <Link
          to="/playlist-deals"
          className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1"
        >
          ver tudo <ArrowRight className="h-3 w-3" />
        </Link>
      </div>

      <div className="flex items-baseline gap-2">
        <span className="text-3xl font-bold tabular-nums leading-none">{total}</span>
        <span className="text-[11px] text-muted-foreground">
          {total > 0 ? "aguardando sua ação" : "tudo em dia"}
        </span>
      </div>

      {rows === null ? (
        <div className="h-32 rounded-md bg-muted/40 animate-pulse" />
      ) : rows.length === 0 ? (
        <div className="text-xs text-muted-foreground py-6 text-center">
          Nenhum deal pendente no momento.
        </div>
      ) : (
        <ul className="divide-y divide-border/50">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold truncate">{r.curator_name}</div>
                <div className="text-[11px] text-muted-foreground truncate">
                  {r.song_name}
                </div>
              </div>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground shrink-0">
                {STATE_LABEL[r.state] ?? r.state}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
