// /comunidade/pontos — Timeline de participações com pontos pendentes/aprovados.
import { useEffect, useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ComunidadeShell } from "@/components/comunidade/ComunidadeShell";

type Row = {
  id: string;
  status: string;
  title: string | null;
  song_name: string | null;
  song_artist: string | null;
  points_offered: number;
  points_awarded: number;
  created_at: string;
  proof_submitted_at: string | null;
  reviewed_at: string | null;
  expires_at: string | null;
  review_note: string | null;
};

const STATUS: Record<string, { label: string; tone: string }> = {
  accepted:  { label: "Aceita",      tone: "border-primary/30 text-primary" },
  submitted: { label: "Em análise",  tone: "border-yellow-500/30 text-yellow-400" },
  approved:  { label: "Aprovada",    tone: "border-primary/30 text-primary" },
  rejected:  { label: "Recusada",    tone: "border-destructive/30 text-destructive" },
  expired:   { label: "Expirada",    tone: "border-border text-muted-foreground" },
};

export default function Pontos() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.rpc("community_my_participations" as never).then(({ data }) => {
      setRows((data as Row[]) ?? []);
      setLoading(false);
    });
  }, []);

  return (
    <ComunidadeShell>
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">Histórico</h1>
        {loading ? (
          <div className="text-sm text-muted-foreground">Carregando…</div>
        ) : rows.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-center text-sm text-muted-foreground">
              Sem atividade.
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-0">
              <ul className="divide-y divide-border">
                {rows.map((r) => {
                  const meta = STATUS[r.status] ?? { label: r.status, tone: "border-border text-muted-foreground" };
                  const positive = r.status === "approved";
                  const value = positive ? r.points_awarded : r.points_offered;
                  return (
                    <li key={r.id} className="px-5 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm font-medium truncate">
                            {r.title ?? r.song_name ?? "Campanha"}
                          </div>
                          <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                            <Badge variant="outline" className={`text-[10px] ${meta.tone}`}>{meta.label}</Badge>
                            <span>{format(new Date(r.created_at), "dd MMM", { locale: ptBR })}</span>
                          </div>
                        </div>
                        <div className={`text-sm font-semibold ${positive ? "text-primary" : "text-muted-foreground"}`}>
                          {positive ? "+" : ""}{value}
                        </div>
                      </div>
                      {r.review_note && (
                        <p className="mt-2 text-xs text-muted-foreground">{r.review_note}</p>
                      )}
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
