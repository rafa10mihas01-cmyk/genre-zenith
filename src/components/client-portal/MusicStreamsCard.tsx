// Card "Streams da música" — leitura direta de raw_chart_daily filtrada
// por spotify_track_id. NÃO altera nenhum cálculo de campanha, forecast,
// snapshot ou financeiro. É apenas leitura visual: ajuda o cliente a ver
// como a música está performando organicamente no Top 200 BR.
//
// 4 colunas:
//   Hoje · Início da campanha · Pico desde o início · Variação %
//
// "Início da campanha" = streams_day no chart_date mais próximo (>=) de
// startedAt. Se a campanha começou antes do primeiro registro, usa o
// primeiro registro disponível.
import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Music2, TrendingDown, TrendingUp, Minus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type Props = {
  spotifyTrackId?: string | null;
  startedAt?: string | null;
};

type Row = { chart_date: string; streams_day: number };

function fmt(n: number): string {
  return new Intl.NumberFormat("pt-BR").format(Math.round(n));
}

export function MusicStreamsCard({ spotifyTrackId, startedAt }: Props) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    if (!spotifyTrackId) { setRows([]); setLoading(false); return; }
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("raw_chart_daily")
        .select("chart_date,streams_day")
        .eq("spotify_track_id", spotifyTrackId)
        .eq("chart_name", "top200_br")
        .order("chart_date", { ascending: true });
      if (cancelled) return;
      setRows((data as Row[]) ?? []);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [spotifyTrackId]);

  if (!spotifyTrackId) return null;
  if (loading) return null;
  if (!rows || rows.length === 0) return null;

  const today = rows[rows.length - 1].streams_day;

  let startVal = rows[0].streams_day;
  if (startedAt) {
    const startDate = startedAt.slice(0, 10);
    const found = rows.find(r => r.chart_date >= startDate);
    if (found) startVal = found.streams_day;
  }

  // Pico desde o início da campanha
  const fromIdx = startedAt
    ? Math.max(0, rows.findIndex(r => r.chart_date >= startedAt.slice(0, 10)))
    : 0;
  const since = rows.slice(fromIdx === -1 ? 0 : fromIdx);
  const peak = since.length > 0
    ? Math.max(...since.map(r => r.streams_day))
    : Math.max(...rows.map(r => r.streams_day));

  const variation = startVal > 0 ? ((today - startVal) / startVal) * 100 : 0;
  const VarIcon = variation > 1 ? TrendingUp : variation < -1 ? TrendingDown : Minus;
  const varColor =
    variation > 1 ? "text-primary"
    : variation < -1 ? "text-destructive"
    : "text-muted-foreground";

  const Stat = ({ label, value, accent }: { label: string; value: React.ReactNode; accent?: boolean }) => (
    <div className="min-w-0">
      <div className="text-[10.5px] uppercase tracking-[0.08em] text-muted-foreground font-medium truncate">
        {label}
      </div>
      <div className={`mt-1 tabular-nums font-semibold leading-tight ${accent ? "text-[18px]" : "text-[16px]"} text-foreground`}>
        {value}
      </div>
    </div>
  );

  return (
    <Card>
      <CardContent className="space-y-3">
        <div className="min-w-0">
          <h2 className="text-[13px] font-semibold inline-flex items-center gap-1.5 tracking-tight">
            <Music2 className="h-3.5 w-3.5 text-muted-foreground" />
            Streams da música
          </h2>
          <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
            Desempenho orgânico no Top 200 BR (não altera a campanha)
          </p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 sm:gap-6">
          <Stat label="Hoje" value={fmt(today)} accent />
          <Stat label="Início da campanha" value={fmt(startVal)} />
          <Stat label="Pico desde o início" value={fmt(peak)} />
          <div className="min-w-0">
            <div className="text-[10.5px] uppercase tracking-[0.08em] text-muted-foreground font-medium truncate">
              Variação
            </div>
            <div className={`mt-1 inline-flex items-center gap-1 tabular-nums font-semibold leading-tight text-[18px] ${varColor}`}>
              <VarIcon className="h-4 w-4" />
              {variation >= 0 ? "+" : ""}{variation.toFixed(1)}%
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
