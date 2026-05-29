import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

type Version = {
  id: string;
  version: number;
  snapshot: any;
  goal_plays: number | null;
  total_allocated: number | null;
  valor_cobrado: number | null;
  requested_message: string | null;
  requested_by: string | null;
  created_at: string;
};

type Props = {
  campaignId?: string;
  publicToken?: string;
};

export function PlanHistoryTab({ campaignId, publicToken }: Props) {
  const [versions, setVersions] = useState<Version[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        if (publicToken) {
          const { data } = await supabase.rpc("list_campaign_plan_versions_by_token", { p_token: publicToken });
          if (!cancelled) setVersions((data ?? []) as Version[]);
        } else if (campaignId) {
          const { data } = await supabase
            .from("campaign_plan_versions")
            .select("*")
            .eq("campaign_id", campaignId)
            .order("version", { ascending: false });
          if (!cancelled) setVersions((data ?? []) as Version[]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [campaignId, publicToken]);

  if (loading) {
    return <div className="text-sm text-muted-foreground">Carregando histórico…</div>;
  }
  if (!versions.length) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          Nenhuma versão anterior. O plano atual é a primeira versão.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {versions.map((v) => {
        const allocs = Array.isArray(v.snapshot?.allocations) ? v.snapshot.allocations : [];
        return (
          <Card key={v.id}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-base flex items-center gap-2">
                  Versão {v.version}
                  <Badge variant="outline" className="text-xs">arquivada</Badge>
                </CardTitle>
                <span className="text-xs text-muted-foreground">
                  {formatDistanceToNow(new Date(v.created_at), { addSuffix: true, locale: ptBR })}
                </span>
              </div>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                <div>
                  <div className="text-muted-foreground">Meta</div>
                  <div className="font-medium">{v.goal_plays?.toLocaleString("pt-BR") ?? "—"}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Alocado</div>
                  <div className="font-medium">{v.total_allocated?.toLocaleString("pt-BR") ?? "—"}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Valor</div>
                  <div className="font-medium">
                    {v.valor_cobrado != null
                      ? new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(v.valor_cobrado))
                      : "—"}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground">Playlists</div>
                  <div className="font-medium">{allocs.length}</div>
                </div>
              </div>
              {v.requested_message && (
                <div className="rounded-md bg-muted/30 p-3 text-xs">
                  <div className="text-muted-foreground mb-1">
                    Motivo do ajuste{v.requested_by ? ` · ${v.requested_by}` : ""}
                  </div>
                  <div className="whitespace-pre-wrap">{v.requested_message}</div>
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
