import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Handshake, ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";

/**
 * DealsPendingCard — deals de curadores aguardando ação.
 * Mostra contagem por estado relevante; deep-link para Playlist Deals.
 */
export function DealsPendingCard() {
  const [count, setCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      // Estados que exigem ação humana
      const { count: c } = await supabase
        .from("curator_deals")
        .select("id", { count: "exact", head: true })
        .in("state", ["awaiting_playlists", "awaiting_review", "pending"]);
      setCount(c ?? 0);
      setLoading(false);
    })();
  }, []);

  return (
    <Link to="/playlist-deals" className="block group">
      <Card className="p-4 md:p-5 hover:bg-muted/30 transition-colors h-full">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Handshake className="h-4 w-4 text-primary" />
            <span className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground font-semibold">
              Deals pendentes
            </span>
          </div>
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>

        {loading ? (
          <div className="h-12 rounded bg-muted/40 animate-pulse" />
        ) : (
          <>
            <div className="text-3xl font-bold tabular-nums leading-none">
              {count ?? 0}
            </div>
            <div className="text-[11px] text-muted-foreground mt-2">
              {count && count > 0 ? "aguardando sua ação" : "tudo em dia"}
            </div>
          </>
        )}
      </Card>
    </Link>
  );
}
