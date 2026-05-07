// /comunidade/pontos — Histórico de pontos por participação.
import { useEffect, useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { ComunidadeShell } from "@/components/comunidade/ComunidadeShell";

type Row = {
  id: string;
  status: string;
  points_awarded: number;
  points_offered: number;
  created_at: string;
};

const STATUS_LABEL: Record<string, string> = {
  accepted: "Aceita",
  submitted: "Enviada",
  approved: "Aprovada",
  rejected: "Recusada",
  expired: "Expirada",
  passed: "Passou",
};

export default function Pontos() {
  const { user } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    supabase
      .from("community_participations")
      .select("id,status,points_awarded,points_offered,created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50)
      .then(({ data }) => {
        setRows((data as Row[]) ?? []);
        setLoading(false);
      });
  }, [user]);

  return (
    <ComunidadeShell>
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">Histórico</h1>
        {loading ? (
          <div className="text-sm text-muted-foreground">Carregando…</div>
        ) : rows.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-center text-sm text-muted-foreground">
              Nenhuma atividade ainda.
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-0">
              <ul className="divide-y divide-border">
                {rows.map((r) => {
                  const value = r.points_awarded || r.points_offered;
                  const positive = r.status === "approved";
                  return (
                    <li key={r.id} className="flex items-center justify-between gap-3 px-5 py-3">
                      <div className="min-w-0">
                        <div className="text-sm font-medium">{STATUS_LABEL[r.status] ?? r.status}</div>
                        <div className="text-xs text-muted-foreground">
                          {format(new Date(r.created_at), "dd MMM", { locale: ptBR })}
                        </div>
                      </div>
                      <div
                        className={`text-sm font-semibold ${
                          positive ? "text-primary" : "text-muted-foreground"
                        }`}
                      >
                        {positive ? "+" : ""}
                        {value}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>
    </ComunidadeShell>
  );
}
