import { useEffect, useState } from "react";
import { AlertTriangle, ShieldCheck, X, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export type FraudAlert = {
  id: string;
  deal_id: string;
  playlist_id: string | null;
  alert_type: string;
  severity: "low" | "medium" | "high";
  title: string;
  description: string;
  evidence: Record<string, any>;
  status: "open" | "acknowledged" | "dismissed";
  created_at: string;
};

const SEVERITY_CLASS: Record<FraudAlert["severity"], string> = {
  low: "bg-muted/40 text-muted-foreground border border-border",
  medium: "bg-warning/15 text-warning border-0",
  high: "bg-destructive/15 text-destructive border-0",
};

const SEVERITY_LABEL: Record<FraudAlert["severity"], string> = {
  low: "Baixa",
  medium: "Média",
  high: "Alta",
};

export function FraudAlertsPanel({
  dealId,
  onReload,
}: {
  dealId: string;
  onReload?: () => void;
}) {
  const [alerts, setAlerts] = useState<FraudAlert[]>([]);
  const [loading, setLoading] = useState(false);
  const [reconciling, setReconciling] = useState(false);

  async function fetchAlerts() {
    setLoading(true);
    const { data, error } = await supabase
      .from("curator_fraud_alerts")
      .select("*")
      .eq("deal_id", dealId)
      .eq("status", "open")
      .order("severity", { ascending: false })
      .order("created_at", { ascending: false });
    setLoading(false);
    if (error) {
      console.error(error);
      return;
    }
    setAlerts((data ?? []) as FraudAlert[]);
  }

  // fetchAlerts é redefinido a cada render; intencionalmente reagimos só à mudança de dealId.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (dealId) fetchAlerts();
  }, [dealId]);

  async function reconcile() {
    setReconciling(true);
    try {
      const { data, error } = await supabase.functions.invoke(
        "detect-curator-fraud",
        { body: { deal_id: dealId } },
      );
      if (error) throw error;
      const result = data?.results?.[0];
      const alertsCreated = result?.alerts_created ?? 0;
      toast.success(
        alertsCreated > 0
          ? `Detecção ok · ${alertsCreated} novo(s) alerta(s)`
          : "Detecção concluída",
      );
      await fetchAlerts();
      onReload?.();
    } catch (err) {
      console.error(err);
      toast.error("Falha ao reconciliar");
    } finally {
      setReconciling(false);
    }
  }

  async function setStatus(id: string, status: "acknowledged" | "dismissed") {
    const { error } = await supabase
      .from("curator_fraud_alerts")
      .update({
        status,
        acknowledged_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (error) {
      toast.error("Falha ao atualizar alerta");
      return;
    }
    setAlerts((cur) => cur.filter((a) => a.id !== id));
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="text-sm font-medium text-muted-foreground">
            Anti-fraude
          </div>
          {alerts.length > 0 && (
            <Badge className="h-4 px-1.5 text-[10px] bg-destructive/15 text-destructive border-0">
              {alerts.length}
            </Badge>
          )}
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 gap-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-[hsl(var(--elevated))]"
          onClick={reconcile}
          disabled={reconciling}
        >
          {reconciling ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <ShieldCheck className="h-3.5 w-3.5" />
          )}
          Reconciliar
        </Button>
      </div>

      {loading ? (
        <div className="text-xs text-muted-foreground py-2">Carregando...</div>
      ) : alerts.length === 0 ? (
        <div className="rounded-md border border-border/60 px-3 py-3 flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-success" />
          <span className="text-xs text-muted-foreground">
            Nenhum alerta aberto
          </span>
        </div>
      ) : (
        <ul className="space-y-2">
          {alerts.map((a) => (
            <li
              key={a.id}
              className="rounded-md border border-border/60 px-3 py-2.5"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <AlertTriangle
                      className={cn(
                        "h-3.5 w-3.5 shrink-0",
                        a.severity === "high"
                          ? "text-destructive"
                          : a.severity === "medium"
                          ? "text-warning"
                          : "text-muted-foreground",
                      )}
                    />
                    <span className="text-sm text-foreground truncate">
                      {a.title}
                    </span>
                    <Badge
                      className={cn(
                        "shrink-0 text-[10px] h-4 px-1.5",
                        SEVERITY_CLASS[a.severity],
                      )}
                    >
                      {SEVERITY_LABEL[a.severity]}
                    </Badge>
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-1">
                    {a.description}
                  </div>
                </div>
                <div className="flex flex-col gap-1 shrink-0">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-[10px]"
                    onClick={() => setStatus(a.id, "acknowledged")}
                  >
                    OK
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-[10px] text-muted-foreground"
                    onClick={() => setStatus(a.id, "dismissed")}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
