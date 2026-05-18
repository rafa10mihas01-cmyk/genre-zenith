import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { PageContainer } from "@/components/PageContainer";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatBRL, formatInt } from "@/lib/campaignEngine";
import type { CampaignSnapshot } from "@/lib/campaignSnapshot";
import { ExternalPackageEditor } from "@/components/campanhas/ExternalPackageEditor";
import { CampaignMonitoring } from "@/components/campanhas/CampaignMonitoring";
import { ArrowLeft, Lock, Music, ListMusic, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";

type EcoAllocRow = {
  id: string;
  managed_playlist_id: string;
  planned_streams: number;
  start_day: number;
  status: string;
  dispatched_at: string | null;
  managed_playlists?: { name: string; cover_url: string | null; followers: number } | null;
};

type CampaignRow = {
  started_at: string;
  id: string;
  track_name: string;
  artist: string | null;
  cover_url: string | null;
  status: string;
  deadline: string | null;
  simulation_snapshot: CampaignSnapshot | null;
  snapshot_locked_at: string | null;
  eco_dispatched_at: string | null;
};

const STATUS_LABEL: Record<string, string> = {
  pending: "Aguardando",
  dispatched: "Enviada ao bot",
  active: "No ar",
  done: "Concluída",
  failed: "Falhou",
  cancelled: "Cancelada",
};

const STATUS_TONE: Record<string, string> = {
  pending: "bg-muted text-muted-foreground border-border",
  dispatched: "bg-warning/10 text-warning border-warning/30",
  active: "bg-primary/15 text-primary border-primary/40",
  done: "bg-primary/10 text-primary border-primary/30",
  failed: "bg-destructive/10 text-destructive border-destructive/30",
  cancelled: "bg-muted text-muted-foreground border-border",
};

export default function CampanhaExecucao() {
  const { id } = useParams<{ id: string }>();
  const [camp, setCamp] = useState<CampaignRow | null>(null);
  const [allocs, setAllocs] = useState<EcoAllocRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    (async () => {
      setLoading(true);
      const [{ data: c }, { data: a }] = await Promise.all([
        supabase
          .from("campaigns")
          .select("id, track_name, artist, cover_url, status, deadline, simulation_snapshot, snapshot_locked_at, eco_dispatched_at")
          .eq("id", id)
          .maybeSingle(),
        supabase
          .from("campaign_eco_allocations")
          .select("id, managed_playlist_id, planned_streams, start_day, status, dispatched_at, managed_playlists(name, cover_url, followers)")
          .eq("campaign_id", id)
          .order("planned_streams", { ascending: false }),
      ]);
      setCamp(c as any);
      setAllocs((a ?? []) as any);
      setLoading(false);
    })();
  }, [id]);

  const snapshot = camp?.simulation_snapshot ?? null;

  const ecoTotals = useMemo(() => {
    const planned = allocs.reduce((s, a) => s + a.planned_streams, 0);
    return { planned, count: allocs.length };
  }, [allocs]);

  if (loading) {
    return (
      <PageContainer>
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-6">
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </div>
      </PageContainer>
    );
  }

  if (!camp || !snapshot) {
    return (
      <PageContainer>
        <PageHeader title="Execução" subtitle="Campanha não encontrada ou sem snapshot" />
        <Link to="/campanhas" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mt-4">
          <ArrowLeft className="h-4 w-4" /> Voltar para campanhas
        </Link>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <PageHeader title={camp.track_name} subtitle="Executar campanha conforme o mapa congelado" />
        <Link to="/campanhas">
          <Button variant="outline" size="sm">
            <ArrowLeft className="h-4 w-4 mr-1.5" /> Campanhas
          </Button>
        </Link>
      </div>

      {/* Cabeçalho do snapshot */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-6">
        <Card>
          <CardHeader className="flex-row items-center gap-2 space-y-0">
            <Music className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-sm">Música</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-3">
              {camp.cover_url ? (
                <img src={camp.cover_url} alt="" className="w-14 h-14 rounded-md object-cover" />
              ) : (
                <div className="w-14 h-14 rounded-md bg-muted grid place-items-center">
                  <Music className="h-5 w-5 text-muted-foreground" />
                </div>
              )}
              <div className="min-w-0">
                <div className="font-semibold truncate">{camp.track_name}</div>
                <div className="text-xs text-muted-foreground truncate">{camp.artist ?? "—"}</div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center gap-2 space-y-0">
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-sm">Meta congelada</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            <div className="text-2xl font-semibold tabular-nums">{formatInt(snapshot.meta)} streams</div>
            <div className="text-xs text-muted-foreground">
              {snapshot.days}d · pico {formatInt(snapshot.picoPorDia)}/dia · {formatBRL(snapshot.custoTotal)}
            </div>
            <div className="text-xs text-muted-foreground">
              {snapshot.splitEcoPct}% próprio · {100 - snapshot.splitEcoPct}% externo
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center gap-2 space-y-0">
            <Lock className="h-4 w-4 text-primary" />
            <CardTitle className="text-sm">Snapshot</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            <div className="text-xs text-muted-foreground">Congelado em</div>
            <div className="text-sm font-medium tabular-nums">
              {camp.snapshot_locked_at ? new Date(camp.snapshot_locked_at).toLocaleString("pt-BR") : "—"}
            </div>
            <div className="text-[11px] text-muted-foreground">
              Imutável. Reabrir calculadora cria nova versão.
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Mapa diário */}
      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="text-sm">Mapa de entrega (curva planejada)</CardTitle>
        </CardHeader>
        <CardContent>
          <MiniCurva curva={snapshot.curva} />
        </CardContent>
      </Card>

      {/* Bloco Eco */}
      <Card className="mt-4">
        <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
          <div>
            <CardTitle className="text-sm flex items-center gap-2">
              <ListMusic className="h-4 w-4 text-primary" /> Ecossistema próprio
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Distribuição automática nas playlists próprias. Total planejado: <strong className="text-foreground tabular-nums">{formatInt(ecoTotals.planned)}</strong> streams em {ecoTotals.count} playlists.
            </p>
          </div>
          <Button variant="default" size="sm" disabled title="Disponível na próxima entrega">
            Disparar Eco
          </Button>
        </CardHeader>
        <CardContent>
          {allocs.length === 0 ? (
            <div className="text-sm text-muted-foreground py-6 text-center">
              Nenhuma alocação Eco gerada.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-separate border-spacing-0">
                <thead className="text-muted-foreground">
                  <tr>
                    <th className="text-left font-medium py-2 px-3 border-b border-border">Playlist</th>
                    <th className="text-right font-medium py-2 px-3 border-b border-border w-32">Planejado</th>
                    <th className="text-right font-medium py-2 px-3 border-b border-border w-24">Início</th>
                    <th className="text-right font-medium py-2 px-3 border-b border-border w-36">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {allocs.map((a, i) => (
                    <tr key={a.id} className={cn("hover:bg-elevated/60", i % 2 === 1 && "bg-elevated/30")}>
                      <td className="py-2.5 px-3 border-b border-border/30">
                        <div className="flex items-center gap-2">
                          {a.managed_playlists?.cover_url ? (
                            <img src={a.managed_playlists.cover_url} alt="" className="w-8 h-8 rounded object-cover" />
                          ) : (
                            <div className="w-8 h-8 rounded bg-muted" />
                          )}
                          <div className="min-w-0">
                            <div className="font-medium truncate">{a.managed_playlists?.name ?? "—"}</div>
                            <div className="text-[10px] text-muted-foreground tabular-nums">
                              {formatInt(a.managed_playlists?.followers ?? 0)} saves
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-right tabular-nums font-semibold border-b border-border/30">
                        {formatInt(a.planned_streams)}
                      </td>
                      <td className="py-2.5 px-3 text-right tabular-nums text-muted-foreground border-b border-border/30">
                        D{a.start_day}
                      </td>
                      <td className="py-2.5 px-3 text-right border-b border-border/30">
                        <span className={cn("inline-flex items-center px-2 h-5 rounded text-[10px] font-medium border", STATUS_TONE[a.status] ?? STATUS_TONE.pending)}>
                          {STATUS_LABEL[a.status] ?? a.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Bloco Externo */}
      <div className="mt-4">
        <ExternalPackageEditor campaignId={camp.id} snapshot={snapshot} />
      </div>
    </PageContainer>
  );
}

function MiniCurva({ curva }: { curva: CampaignSnapshot["curva"] }) {
  if (curva.length === 0) return null;
  const w = 720, h = 140, pad = 12;
  const maxS = Math.max(...curva.map(p => p.streamsDay), 1);
  const maxC = curva[curva.length - 1].cumulative;
  const xs = (i: number) => pad + (i / Math.max(curva.length - 1, 1)) * (w - pad * 2);
  const ysBar = (v: number) => h - pad - (v / maxS) * (h - pad * 2);
  const lineCum = curva
    .map((p, i) => `${i === 0 ? "M" : "L"} ${xs(i)} ${h - pad - (p.cumulative / maxC) * (h - pad * 2)}`)
    .join(" ");

  const barW = Math.max(1, (w - pad * 2) / curva.length - 1);

  return (
    <div className="w-full overflow-x-auto">
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-32" preserveAspectRatio="none">
        {curva.map((p, i) => (
          <rect
            key={p.day}
            x={xs(i) - barW / 2}
            y={ysBar(p.streamsDay)}
            width={barW}
            height={h - pad - ysBar(p.streamsDay)}
            fill="hsl(var(--primary))"
            opacity={0.35}
          />
        ))}
        <path d={lineCum} fill="none" stroke="hsl(var(--primary))" strokeWidth={1.5} />
      </svg>
      <div className="flex justify-between text-[10px] text-muted-foreground mt-1 tabular-nums">
        <span>D1</span>
        <span>D{Math.round(curva.length / 2)}</span>
        <span>D{curva.length}</span>
      </div>
    </div>
  );
}
