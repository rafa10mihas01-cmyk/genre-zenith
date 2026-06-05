// BaselineConflictFinancialAlert — banner financeiro que sinaliza, por curador,
// quantas playlists ficaram em "baseline_conflict" (música já existia antes da
// campanha) e portanto NÃO devem ser consideradas entrega válida para fins de
// cobrança. Apenas alerta — não bloqueia nem desconta automaticamente.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type Row = {
  curator_id: string | null;
  campaign_id: string | null;
  status: string;
};

type CuratorAgg = {
  curator_id: string;
  curator_name: string;
  conflicts: number;
  campaigns: Set<string>;
};

export function BaselineConflictFinancialAlert() {
  const [aggs, setAggs] = useState<CuratorAgg[] | null>(null);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("curator_campaign_playlists")
        .select("curator_id, campaign_id, status")
        .eq("status", "baseline_conflict")
        .limit(5000);
      if (error || !data) {
        setAggs([]);
        return;
      }
      const rows = (data ?? []) as Row[];
      const curatorIds = Array.from(
        new Set(rows.map((r) => r.curator_id).filter(Boolean) as string[]),
      );
      if (curatorIds.length === 0) {
        setAggs([]);
        return;
      }
      const { data: cur } = await supabase
        .from("curators")
        .select("id, name")
        .in("id", curatorIds);
      const nameById = new Map<string, string>();
      for (const c of (cur ?? []) as Array<{ id: string; name: string | null }>) {
        nameById.set(c.id, c.name ?? "Curador");
      }
      const byCur = new Map<string, CuratorAgg>();
      for (const r of rows) {
        if (!r.curator_id) continue;
        const agg = byCur.get(r.curator_id) ?? {
          curator_id: r.curator_id,
          curator_name: nameById.get(r.curator_id) ?? "Curador",
          conflicts: 0,
          campaigns: new Set<string>(),
        };
        agg.conflicts += 1;
        if (r.campaign_id) agg.campaigns.add(r.campaign_id);
        byCur.set(r.curator_id, agg);
      }
      setAggs(Array.from(byCur.values()).sort((a, b) => b.conflicts - a.conflicts));
    })();
  }, []);

  if (!aggs || aggs.length === 0) return null;

  const totalConflicts = aggs.reduce((s, a) => s + a.conflicts, 0);
  const totalCurators = aggs.length;

  return (
    <Card className="border-destructive/40 bg-destructive/5">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start gap-3">
          <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-semibold text-destructive leading-tight">
              {totalConflicts} playlist(s) em conflito de baseline — {totalCurators} curador(es) afetado(s)
            </div>
            <div className="text-[12px] text-foreground-body leading-relaxed mt-1">
              Essas playlists já continham a música antes do início da campanha. <strong>Não devem ser cobradas como entrega nova.</strong>{" "}
              Pode existir ganho de posição, mas não há entrega válida. Reveja cobranças e CPP antes de fechar o ciclo financeiro.
            </div>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {aggs.slice(0, 12).map((a) => (
            <Link
              key={a.curator_id}
              to={`/curadores/${a.curator_id}`}
              className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-destructive/20 bg-card hover:bg-elevated/50 transition-colors"
            >
              <div className="min-w-0">
                <div className="text-[13px] font-medium text-foreground truncate">{a.curator_name}</div>
                <div className="text-[11px] text-muted-foreground">
                  {a.campaigns.size} campanha(s)
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Badge variant="outline" className="border-destructive/40 text-destructive tabular-nums">
                  {a.conflicts}
                </Badge>
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
              </div>
            </Link>
          ))}
        </div>
        {aggs.length > 12 && (
          <div className="text-[11px] text-muted-foreground">
            + {aggs.length - 12} curador(es) adicional(is) com conflitos.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
