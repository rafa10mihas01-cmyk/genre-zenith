import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatBRL, formatInt } from "@/lib/campaignEngine";
import type { CampaignSnapshot } from "@/lib/campaignSnapshot";
import {
  ensureExternalPackageDraft,
  confirmExternalPackage,
  updatePackageItem,
  removePackageItem,
} from "@/lib/externalPackage";
import { Link } from "react-router-dom";
import { toast } from "@/hooks/use-toast";
import { Loader2, Trash2, Users, AlertTriangle, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

type PackageRow = {
  id: string;
  status: string;
  target_streams: number;
  target_cost: number;
  confirmed_at: string | null;
};

type ItemRow = {
  id: string;
  curator_id: string;
  assigned_streams: number;
  assigned_cost: number;
  cost_per_stream: number;
  curator_deal_id: string | null;
  curators: { name: string; contact: string | null } | null;
};

export function ExternalPackageEditor({
  campaignId,
  snapshot,
  onChanged,
}: {
  campaignId: string;
  snapshot: CampaignSnapshot;
  onChanged?: () => void;
}) {
  const [pkg, setPkg] = useState<PackageRow | null>(null);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const { packageId } = await ensureExternalPackageDraft(campaignId, snapshot);
      const [{ data: p }, { data: its }] = await Promise.all([
        supabase
          .from("campaign_external_packages")
          .select("id, status, target_streams, target_cost, confirmed_at")
          .eq("id", packageId)
          .single(),
        supabase
          .from("campaign_external_package_items")
          .select("id, curator_id, assigned_streams, assigned_cost, cost_per_stream, curator_deal_id, curators(name, contact)")
          .eq("package_id", packageId)
          .order("assigned_streams", { ascending: false }),
      ]);
      setPkg(p as any);
      setItems((its ?? []) as any);
      onChanged?.();
    } catch (e: any) {
      toast({ title: "Erro ao carregar pacote", description: e.message ?? String(e), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [campaignId]);

  async function handleStreamsChange(item: ItemRow, value: number) {
    setItems(prev => prev.map(i => i.id === item.id
      ? { ...i, assigned_streams: value, assigned_cost: +(value * i.cost_per_stream).toFixed(2) }
      : i));
    try {
      await updatePackageItem(item.id, { assigned_streams: value, cost_per_stream: item.cost_per_stream });
      onChanged?.();
    } catch (e: any) {
      toast({ title: "Erro ao atualizar", description: e.message, variant: "destructive" });
    }
  }

  async function handleRemove(item: ItemRow) {
    setItems(prev => prev.filter(i => i.id !== item.id));
    try { await removePackageItem(item.id); onChanged?.(); }
    catch (e: any) { toast({ title: "Erro ao remover", description: e.message, variant: "destructive" }); load(); }
  }

  async function handleConfirm() {
    if (!pkg) return;
    setConfirming(true);
    try {
      const { dealsCreated } = await confirmExternalPackage({ packageId: pkg.id, campaignId, snapshot });
      toast({ title: "Pacote confirmado", description: `${dealsCreated} deals criados em status proposto.` });
      load();
      onChanged?.();
    } catch (e: any) {
      toast({ title: "Erro ao confirmar", description: e.message ?? String(e), variant: "destructive" });
    } finally {
      setConfirming(false);
    }
  }

  if (loading) {
    return <Skeleton className="h-64" />;
  }

  const totalStreams = items.reduce((s, i) => s + i.assigned_streams, 0);
  const totalCost = items.reduce((s, i) => s + i.assigned_cost, 0);
  const deltaStreams = totalStreams - snapshot.streamsExt;
  const deltaCost = totalCost - snapshot.custoExt;
  const coverage = snapshot.streamsExt > 0 ? (totalStreams / snapshot.streamsExt) * 100 : 0;
  const isDispatched = pkg?.status !== "draft";
  const noCapacity = items.length === 0;
  const underCovered = coverage < 95;

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="text-sm flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" /> Ecossistema externo
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Alvo do snapshot: <strong className="text-foreground tabular-nums">{formatInt(snapshot.streamsExt)}</strong> streams · <strong className="text-foreground">{formatBRL(snapshot.custoExt)}</strong>.
            {isDispatched
              ? <> Pacote já confirmado em {pkg?.confirmed_at ? new Date(pkg.confirmed_at).toLocaleString("pt-BR") : "—"}.</>
              : <> Ajuste os curadores sugeridos e confirme pra gerar os deals.</>}
          </p>
        </div>
        {!isDispatched && (
          <Button size="sm" variant="solid" onClick={handleConfirm} disabled={confirming || items.length === 0}>
            {confirming ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-1.5" />}
            Confirmar pacote
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
          <KPI label="Streams" value={formatInt(totalStreams)} delta={deltaStreams} unit="" />
          <KPI label="Custo" value={formatBRL(totalCost)} delta={deltaCost} unit=" R$" isCurrency />
          <KPI label="Cobertura" value={`${coverage.toFixed(0)}%`} />
          <KPI label="Curadores" value={String(items.length)} />
        </div>

        {noCapacity && (
          <div className="flex items-start gap-2 rounded-md bg-warning/10 border border-warning/30 p-3">
            <AlertTriangle className="h-4 w-4 text-warning mt-0.5 shrink-0" />
            <div className="text-xs">
              <div className="font-medium text-warning">Sem curadores ativos disponíveis</div>
              <p className="text-muted-foreground mt-0.5">
                Adicione curadores em <Link to="/curadores" className="underline">/curadores</Link> ou prospecte novos
                em <Link to="/curadores?tab=prospeccao" className="underline">CRM</Link>.
              </p>
            </div>
          </div>
        )}

        {!noCapacity && underCovered && !isDispatched && (
          <div className="flex items-start gap-2 rounded-md bg-warning/10 border border-warning/30 p-3">
            <AlertTriangle className="h-4 w-4 text-warning mt-0.5 shrink-0" />
            <div className="text-xs">
              <div className="font-medium text-warning">Capacidade abaixo do alvo</div>
              <p className="text-muted-foreground mt-0.5">
                Sua biblioteca cobre {coverage.toFixed(0)}% dos {formatInt(snapshot.streamsExt)} streams previstos.
                Aumente o volume por curador ou abra prospecção em <Link to="/curadores?tab=prospeccao" className="underline">CRM</Link>.
              </p>
            </div>
          </div>
        )}

        {items.length > 0 && (
          <>
            <div className="text-[11px] text-muted-foreground">
              Distribuição calculada sobre <strong className="text-foreground">{snapshot.days} dias</strong> de campanha.
              Use essas metas para combinar a entrega com cada curador.
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-separate border-spacing-0">
                <thead className="text-muted-foreground">
                  <tr>
                    <th className="text-left font-medium py-2 px-3 border-b border-border">Curador</th>
                    <th className="text-right font-medium py-2 px-3 border-b border-border w-32">Total streams</th>
                    <th className="text-right font-medium py-2 px-3 border-b border-border w-24">Por dia</th>
                    <th className="text-right font-medium py-2 px-3 border-b border-border w-24">Por mês</th>
                    <th className="text-right font-medium py-2 px-3 border-b border-border w-20">R$/stream</th>
                    <th className="text-right font-medium py-2 px-3 border-b border-border w-28">Custo total</th>
                    <th className="text-right font-medium py-2 px-3 border-b border-border w-28">Status</th>
                    {!isDispatched && <th className="w-10 border-b border-border" />}
                  </tr>
                </thead>
                <tbody>
                  {items.map((it, i) => {
                    const days = Math.max(1, snapshot.days || 1);
                    const perDay = Math.round(it.assigned_streams / days);
                    const perMonth = Math.round(perDay * 30);
                    return (
                      <tr key={it.id} className={cn("hover:bg-elevated/60", i % 2 === 1 && "bg-elevated/30")}>
                        <td className="py-2.5 px-3 border-b border-border/30">
                          <div className="font-medium">{it.curators?.name ?? "—"}</div>
                          {it.curators?.contact && <div className="text-[10px] text-muted-foreground">{it.curators.contact}</div>}
                        </td>
                        <td className="py-2.5 px-3 text-right border-b border-border/30">
                          {isDispatched ? (
                            <span className="tabular-nums font-semibold">{formatInt(it.assigned_streams)}</span>
                          ) : (
                            <Input
                              type="number"
                              value={it.assigned_streams}
                              onChange={(e) => handleStreamsChange(it, Math.max(0, parseInt(e.target.value || "0", 10)))}
                              className="h-7 text-right tabular-nums w-28 ml-auto"
                            />
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-right tabular-nums border-b border-border/30">
                          <span className="font-medium">{formatInt(perDay)}</span>
                          <span className="text-[10px] text-muted-foreground ml-1">/dia</span>
                        </td>
                        <td className="py-2.5 px-3 text-right tabular-nums border-b border-border/30">
                          <span className="font-medium">{formatInt(perMonth)}</span>
                          <span className="text-[10px] text-muted-foreground ml-1">/mês</span>
                        </td>
                        <td className="py-2.5 px-3 text-right tabular-nums text-muted-foreground border-b border-border/30">
                          {it.cost_per_stream.toFixed(3)}
                        </td>
                        <td className="py-2.5 px-3 text-right tabular-nums font-semibold border-b border-border/30">
                          {formatBRL(it.assigned_cost)}
                        </td>
                        <td className="py-2.5 px-3 text-right border-b border-border/30">
                          {it.curator_deal_id ? (
                            <Link to={`/playlist-deals/${it.curator_deal_id}`} className="text-primary text-[10px] underline">
                              Deal aberto
                            </Link>
                          ) : (
                            <span className="text-[10px] text-muted-foreground">Rascunho</span>
                          )}
                        </td>
                        {!isDispatched && (
                          <td className="py-2.5 px-2 text-right border-b border-border/30">
                            <button onClick={() => handleRemove(it)} className="text-muted-foreground hover:text-destructive">
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="text-muted-foreground">
                  <tr>
                    <td className="py-2 px-3 text-[10px] uppercase tracking-wider">Total externo</td>
                    <td className="py-2 px-3 text-right tabular-nums font-semibold text-foreground">{formatInt(totalStreams)}</td>
                    <td className="py-2 px-3 text-right tabular-nums font-semibold text-foreground">
                      {formatInt(Math.round(totalStreams / Math.max(1, snapshot.days || 1)))}
                      <span className="text-[10px] text-muted-foreground ml-1">/dia</span>
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums font-semibold text-foreground">
                      {formatInt(Math.round((totalStreams / Math.max(1, snapshot.days || 1)) * 30))}
                      <span className="text-[10px] text-muted-foreground ml-1">/mês</span>
                    </td>
                    <td className="py-2 px-3" />
                    <td className="py-2 px-3 text-right tabular-nums font-semibold text-foreground">{formatBRL(totalCost)}</td>
                    <td className="py-2 px-3" />
                    {!isDispatched && <td />}
                  </tr>
                </tfoot>
              </table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function KPI({ label, value, delta, unit, isCurrency }: { label: string; value: string; delta?: number; unit?: string; isCurrency?: boolean }) {
  const showDelta = delta != null && Math.abs(delta) > (isCurrency ? 0.5 : 1);
  return (
    <div className="rounded-lg border border-border bg-elevated/30 p-2.5">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-base font-semibold tabular-nums mt-0.5">{value}</div>
      {showDelta && (
        <div className={cn("text-[10px] tabular-nums mt-0.5", delta! > 0 ? "text-warning" : "text-primary")}>
          {delta! > 0 ? "+" : ""}{isCurrency ? formatBRL(delta!) : formatInt(delta!)}{unit} vs snapshot
        </div>
      )}
    </div>
  );
}
