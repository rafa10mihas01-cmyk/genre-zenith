// ExecucaoPanel — fila de execução de adições automáticas em playlist.
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RefreshCw, RotateCcw, XCircle } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

type Job = {
  id: string;
  job_type: string;
  status: "pending" | "claimed" | "done" | "failed" | "cancelled";
  spotify_playlist_id: string;
  spotify_track_id: string;
  campaign_id: string | null;
  playlist_id: string | null;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  scheduled_for: string;
  claimed_at: string | null;
  completed_at: string | null;
  created_at: string;
};

const STATUS_BADGE: Record<Job["status"], { label: string; className: string }> = {
  pending:   { label: "Pendente",  className: "bg-muted text-foreground border-border" },
  claimed:   { label: "Executando", className: "bg-primary/15 text-primary border-primary/30" },
  done:      { label: "Concluído", className: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" },
  failed:    { label: "Falhou",    className: "bg-destructive/15 text-destructive border-destructive/30" },
  cancelled: { label: "Cancelado", className: "bg-muted text-muted-foreground border-border" },
};

export function ExecucaoPanel() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    const { data, error } = await supabase
      .from("playlist_execution_jobs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) {
      toast({ title: "Erro ao carregar fila", description: error.message, variant: "destructive" });
    } else {
      setJobs((data ?? []) as Job[]);
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
    const ch = supabase
      .channel("playlist_execution_jobs_panel")
      .on("postgres_changes", { event: "*", schema: "public", table: "playlist_execution_jobs" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const kpis = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    return {
      pending: jobs.filter(j => j.status === "pending").length,
      claimed: jobs.filter(j => j.status === "claimed").length,
      doneToday: jobs.filter(j => j.status === "done" && j.completed_at && new Date(j.completed_at) >= today).length,
      failed: jobs.filter(j => j.status === "failed").length,
    };
  }, [jobs]);

  async function retry(id: string) {
    const { error } = await supabase
      .from("playlist_execution_jobs")
      .update({ status: "pending", attempts: 0, last_error: null, scheduled_for: new Date().toISOString(), claimed_by: null, claimed_at: null, lease_expires_at: null })
      .eq("id", id);
    if (error) toast({ title: "Erro", description: error.message, variant: "destructive" });
    else toast({ title: "Reenfileirado" });
  }

  async function cancel(id: string) {
    const { error } = await supabase
      .from("playlist_execution_jobs")
      .update({ status: "cancelled", completed_at: new Date().toISOString() })
      .eq("id", id);
    if (error) toast({ title: "Erro", description: error.message, variant: "destructive" });
    else toast({ title: "Cancelado" });
  }

  return (
    <div className="space-y-8 py-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard label="Pendentes" value={kpis.pending} />
        <KpiCard label="Executando" value={kpis.claimed} highlight />
        <KpiCard label="Concluídos hoje" value={kpis.doneToday} />
        <KpiCard label="Falhas" value={kpis.failed} danger={kpis.failed > 0} />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base font-semibold">Fila de execução</CardTitle>
          <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[120px]">Status</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead className="min-w-[180px]">Playlist</TableHead>
                  <TableHead className="min-w-[180px]">Faixa</TableHead>
                  <TableHead className="text-right">Tentativas</TableHead>
                  <TableHead className="min-w-[140px]">Atualizado</TableHead>
                  <TableHead className="min-w-[200px]">Erro</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobs.length === 0 && !loading && (
                  <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">Sem tarefas na fila.</TableCell></TableRow>
                )}
                {jobs.map(j => {
                  const meta = STATUS_BADGE[j.status];
                  const ts = j.completed_at ?? j.claimed_at ?? j.created_at;
                  return (
                    <TableRow key={j.id}>
                      <TableCell><Badge variant="outline" className={meta.className}>{meta.label}</Badge></TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{j.job_type.replace("playlist.track.", "")}</TableCell>
                      <TableCell className="font-mono text-xs truncate max-w-[200px]">{j.spotify_playlist_id}</TableCell>
                      <TableCell className="font-mono text-xs truncate max-w-[200px]">{j.spotify_track_id}</TableCell>
                      <TableCell className="text-right text-xs">{j.attempts}/{j.max_attempts}</TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {formatDistanceToNow(new Date(ts), { addSuffix: true, locale: ptBR })}
                      </TableCell>
                      <TableCell className="text-xs text-destructive truncate max-w-[260px]">{j.last_error ?? "—"}</TableCell>
                      <TableCell className="text-right">
                        <div className="inline-flex gap-1">
                          {(j.status === "failed" || j.status === "cancelled") && (
                            <Button variant="ghost" size="icon" onClick={() => retry(j.id)} title="Reenfileirar">
                              <RotateCcw className="h-4 w-4" />
                            </Button>
                          )}
                          {(j.status === "pending" || j.status === "failed") && (
                            <Button variant="ghost" size="icon" onClick={() => cancel(j.id)} title="Cancelar">
                              <XCircle className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function KpiCard({ label, value, highlight, danger }: { label: string; value: number; highlight?: boolean; danger?: boolean }) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="text-xs text-muted-foreground mb-1">{label}</div>
        <div className={`text-2xl font-semibold ${danger ? "text-destructive" : highlight ? "text-primary" : "text-foreground"}`}>{value}</div>
      </CardContent>
    </Card>
  );
}
