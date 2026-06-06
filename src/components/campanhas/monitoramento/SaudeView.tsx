import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, CheckCircle2, Clock, XCircle, ListChecks, Activity } from "lucide-react";

type Validation = {
  id: string;
  spotify_playlist_id: string;
  spotify_track_id: string;
  expected_position: number | null;
  actual_position: number | null;
  status: string;
  error: string | null;
  checked_at: string;
};

type Job = {
  id: string;
  job_type: string;
  spotify_playlist_id: string;
  spotify_track_id: string;
  status: string;
  attempts: number;
  max_attempts: number;
  scheduled_for: string;
  last_error: string | null;
  last_validation_status: string | null;
  last_validation_position: number | null;
  to_position: number | null;
  updated_at: string;
};

const STATUS_TONE: Record<string, { tone: string; label: string; Icon: any }> = {
  present:      { tone: "text-success",   label: "Presente",       Icon: CheckCircle2 },
  missing:      { tone: "text-destructive", label: "Ausente",      Icon: XCircle },
  out_of_place: { tone: "text-warning",   label: "Posição errada", Icon: AlertTriangle },
  pending:      { tone: "text-muted-foreground", label: "Pendente", Icon: Clock },
  error:        { tone: "text-destructive", label: "Erro",          Icon: XCircle },
  failed:       { tone: "text-destructive", label: "Falhou",        Icon: XCircle },
  succeeded:    { tone: "text-success",   label: "OK",             Icon: CheckCircle2 },
  running:      { tone: "text-warning",   label: "Executando",     Icon: Activity },
};

function StatusBadge({ status }: { status: string | null }) {
  const meta = STATUS_TONE[status ?? ""] ?? { tone: "text-muted-foreground", label: status ?? "—", Icon: Clock };
  const Icon = meta.Icon;
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] ${meta.tone}`}>
      <Icon className="h-3 w-3" />
      {meta.label}
    </span>
  );
}

export function SaudeView({ campaignId }: { campaignId: string }) {
  const [validations, setValidations] = useState<Validation[] | null>(null);
  const [jobs, setJobs] = useState<Job[] | null>(null);

  useEffect(() => {
    if (!campaignId) return;
    (async () => {
      const [{ data: v }, { data: j }] = await Promise.all([
        supabase
          .from("playlist_delivery_validations")
          .select("id, spotify_playlist_id, spotify_track_id, expected_position, actual_position, status, error, checked_at")
          .eq("campaign_id", campaignId)
          .order("checked_at", { ascending: false })
          .limit(200),
        supabase
          .from("playlist_execution_jobs")
          .select("id, job_type, spotify_playlist_id, spotify_track_id, status, attempts, max_attempts, scheduled_for, last_error, last_validation_status, last_validation_position, to_position, updated_at")
          .eq("campaign_id", campaignId)
          .order("updated_at", { ascending: false })
          .limit(200),
      ]);
      setValidations(((v ?? []) as unknown) as Validation[]);
      setJobs(((j ?? []) as unknown) as Job[]);
    })();
  }, [campaignId]);

  const loading = validations === null || jobs === null;

  const vCounts = (validations ?? []).reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, {});
  const jCounts = (jobs ?? []).reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, {});

  const problemValidations = (validations ?? []).filter(
    (v) => v.status !== "present" && v.status !== "succeeded"
  );
  const problemJobs = (jobs ?? []).filter(
    (j) => j.status === "failed" || (j.status === "pending" && j.attempts >= j.max_attempts)
  );

  return (
    <div className="space-y-4">
      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiMini icon={CheckCircle2} tone="text-success"     label="Presentes"      value={vCounts["present"] ?? 0} />
        <KpiMini icon={XCircle}      tone="text-destructive" label="Ausentes"       value={vCounts["missing"] ?? 0} />
        <KpiMini icon={AlertTriangle} tone="text-warning"    label="Pos. errada"    value={vCounts["out_of_place"] ?? 0} />
        <KpiMini icon={XCircle}      tone="text-destructive" label="Jobs falharam" value={jCounts["failed"] ?? 0} />
      </div>

      {/* Validações com problema */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center gap-2">
            <ListChecks className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">Validações com divergência</h3>
            <Badge variant="outline" className="ml-auto text-[10px]">
              {loading ? "…" : problemValidations.length}
            </Badge>
          </div>
          {loading ? (
            <Skeleton className="h-24 w-full" />
          ) : problemValidations.length === 0 ? (
            <div className="text-[12px] text-muted-foreground">Nenhuma divergência detectada nas últimas validações.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  <tr className="border-b border-border/60">
                    <th className="text-left py-2 pr-3">Playlist</th>
                    <th className="text-left py-2 pr-3">Track</th>
                    <th className="text-right py-2 pr-3">Esperada</th>
                    <th className="text-right py-2 pr-3">Real</th>
                    <th className="text-left py-2 pr-3">Status</th>
                    <th className="text-left py-2">Quando</th>
                  </tr>
                </thead>
                <tbody>
                  {problemValidations.slice(0, 50).map((v) => (
                    <tr key={v.id} className="border-b border-border/30">
                      <td className="py-2 pr-3 font-mono text-[11px] truncate max-w-[160px]">{v.spotify_playlist_id}</td>
                      <td className="py-2 pr-3 font-mono text-[11px] truncate max-w-[160px]">{v.spotify_track_id}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{v.expected_position ?? "—"}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{v.actual_position ?? "—"}</td>
                      <td className="py-2 pr-3"><StatusBadge status={v.status} /></td>
                      <td className="py-2 text-muted-foreground tabular-nums">
                        {new Date(v.checked_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Jobs com problema */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">Jobs de execução com problema</h3>
            <Badge variant="outline" className="ml-auto text-[10px]">
              {loading ? "…" : problemJobs.length}
            </Badge>
          </div>
          {loading ? (
            <Skeleton className="h-24 w-full" />
          ) : problemJobs.length === 0 ? (
            <div className="text-[12px] text-muted-foreground">Nenhum job falho ou esgotado.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  <tr className="border-b border-border/60">
                    <th className="text-left py-2 pr-3">Tipo</th>
                    <th className="text-left py-2 pr-3">Playlist</th>
                    <th className="text-left py-2 pr-3">Track</th>
                    <th className="text-left py-2 pr-3">Status</th>
                    <th className="text-right py-2 pr-3">Tentativas</th>
                    <th className="text-left py-2 pr-3">Erro</th>
                    <th className="text-left py-2">Atualizado</th>
                  </tr>
                </thead>
                <tbody>
                  {problemJobs.slice(0, 50).map((j) => (
                    <tr key={j.id} className="border-b border-border/30 align-top">
                      <td className="py-2 pr-3 font-mono text-[11px]">{j.job_type}</td>
                      <td className="py-2 pr-3 font-mono text-[11px] truncate max-w-[160px]">{j.spotify_playlist_id}</td>
                      <td className="py-2 pr-3 font-mono text-[11px] truncate max-w-[160px]">{j.spotify_track_id}</td>
                      <td className="py-2 pr-3"><StatusBadge status={j.status} /></td>
                      <td className="py-2 pr-3 text-right tabular-nums">{j.attempts}/{j.max_attempts}</td>
                      <td className="py-2 pr-3 text-destructive/80 truncate max-w-[240px]">{j.last_error ?? "—"}</td>
                      <td className="py-2 text-muted-foreground tabular-nums">
                        {new Date(j.updated_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function KpiMini({ icon: Icon, tone, label, value }: { icon: any; tone: string; label: string; value: number }) {
  return (
    <Card>
      <CardContent className="p-3 flex items-center gap-3">
        <Icon className={`h-4 w-4 ${tone}`} />
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
          <div className="text-lg font-bold tabular-nums leading-tight">{value}</div>
        </div>
      </CardContent>
    </Card>
  );
}
