import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Beaker, AlertTriangle } from "lucide-react";

// =============================================================================
// /campaign-inventory — Painel EXPERIMENTAL (Fase 3)
// =============================================================================
// READ-ONLY. Não substitui Monitoramento. Não altera nenhuma view existente.
// Lê apenas campaign_playlist_inventory_v1 + vw_inventory_vs_monitor_diff.
// =============================================================================

type Campaign = { id: string; track_name: string; artist: string | null; status: string };
type InvRow = {
  campaign_id: string;
  playlist_id: string;
  source: "ecosystem" | "curator" | "orphan";
  state: "planned" | "pending_match" | "matched" | "orphan_collected" | "baseline_conflict";
  curator_id: string | null;
  managed_playlist_id: string | null;
  playlist_name: string | null;
  planned_at: string | null;
  last_collected_at: string | null;
  visible_in_monitor: boolean;
  divergence: "aligned" | "invisible_planned" | "invisible_matched" | "invisible_orphan";
};

const SOURCE_LABEL: Record<InvRow["source"], string> = {
  ecosystem: "Ecossistema",
  curator: "Curador",
  orphan: "Órfã",
};

const STATE_LABEL: Record<InvRow["state"], string> = {
  planned: "Planejada",
  pending_match: "Pendente match",
  matched: "Coletada",
  orphan_collected: "Órfã coletada",
  baseline_conflict: "Conflito baseline",
};

export default function CampaignInventory() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignId, setCampaignId] = useState<string>("");
  const [rows, setRows] = useState<InvRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [stateFilter, setStateFilter] = useState<string>("all");
  const [onlyDivergent, setOnlyDivergent] = useState(false);

  // Carrega lista de campanhas
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("campaigns")
        .select("id, track_name, artist, status")
        .order("started_at", { ascending: false })
        .limit(200);
      const list = (data ?? []) as Campaign[];
      setCampaigns(list);
      if (list.length && !campaignId) setCampaignId(list[0].id);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Carrega inventário + diff da campanha
  useEffect(() => {
    if (!campaignId) return;
    setLoading(true);
    (async () => {
      const { data, error } = await supabase
        .from("vw_inventory_vs_monitor_diff" as any)
        .select("*")
        .eq("campaign_id", campaignId)
        .limit(5000);
      if (error) {
        console.error("[CampaignInventory] diff error", error);
        setRows([]);
      } else {
        setRows((data ?? []) as unknown as InvRow[]);
      }
      setLoading(false);
    })();
  }, [campaignId]);

  // KPIs agregados
  const kpis = useMemo(() => {
    const total = rows.length;
    const planned = rows.filter((r) => r.state === "planned" || r.state === "pending_match").length;
    const matched = rows.filter((r) => r.state === "matched").length;
    const orphans = rows.filter((r) => r.state === "orphan_collected").length;
    const conflicts = rows.filter((r) => r.state === "baseline_conflict").length;
    const invisible = rows.filter((r) => !r.visible_in_monitor).length;
    const eco = rows.filter((r) => r.source === "ecosystem").length;
    const cur = rows.filter((r) => r.source === "curator").length;
    return { total, planned, matched, orphans, conflicts, invisible, eco, cur };
  }, [rows]);

  // Aplica filtros à tabela
  const visibleRows = useMemo(() => {
    return rows.filter((r) => {
      if (sourceFilter !== "all" && r.source !== sourceFilter) return false;
      if (stateFilter !== "all" && r.state !== stateFilter) return false;
      if (onlyDivergent && r.visible_in_monitor) return false;
      return true;
    });
  }, [rows, sourceFilter, stateFilter, onlyDivergent]);

  return (
    <div className="space-y-6">
      <PageHeader
        kicker="Experimental"
        title="Inventário da Campanha"
        subtitle="Validar a consolidação read-only de ecossistema, curadores e coletas — sem alterar o monitoramento atual."
        icon={Beaker}
        domain="campaigns"
      />

      {/* Aviso de modo experimental */}
      <Card className="p-4 border-warning/40 bg-warning/5">
        <div className="flex items-start gap-3">
          <AlertTriangle className="h-4 w-4 text-warning mt-0.5 shrink-0" />
          <div className="text-[12px] text-foreground-body leading-relaxed">
            <strong className="text-warning">Modo somente leitura.</strong>{" "}
            Esta página consome <code className="text-[11px] px-1 rounded bg-card">campaign_playlist_inventory_v1</code> e{" "}
            <code className="text-[11px] px-1 rounded bg-card">vw_inventory_vs_monitor_diff</code>.
            Nenhum dado é gravado e o Monitoramento oficial não é afetado.
          </div>
        </div>
      </Card>

      {/* Seletor de campanha */}
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
            Campanha
          </label>
          <Select value={campaignId} onValueChange={setCampaignId}>
            <SelectTrigger className="w-[420px] max-w-full">
              <SelectValue placeholder="Selecione uma campanha" />
            </SelectTrigger>
            <SelectContent>
              {campaigns.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.track_name}{c.artist ? ` — ${c.artist}` : ""} · {c.status}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </Card>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
        <KpiCell label="Total" value={kpis.total} />
        <KpiCell label="Planejadas / Pendentes" value={kpis.planned} tone="warning" />
        <KpiCell label="Coletadas" value={kpis.matched} tone="success" />
        <KpiCell label="Conflito baseline" value={kpis.conflicts} tone="danger" />
        <KpiCell label="Órfãs" value={kpis.orphans} tone="muted" />
        <KpiCell label="Ecossistema" value={kpis.eco} />
        <KpiCell label="Curadores" value={kpis.cur} />
        <KpiCell label="Invisíveis no monitor" value={kpis.invisible} tone="danger" />
      </div>

      {/* Filtros */}
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">Origem</span>
            <ToggleGroup type="single" value={sourceFilter} onValueChange={(v) => setSourceFilter(v || "all")}>
              <ToggleGroupItem value="all" size="sm">Todas</ToggleGroupItem>
              <ToggleGroupItem value="ecosystem" size="sm">Ecossistema</ToggleGroupItem>
              <ToggleGroupItem value="curator" size="sm">Curador</ToggleGroupItem>
              <ToggleGroupItem value="orphan" size="sm">Órfã</ToggleGroupItem>
            </ToggleGroup>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">Estado</span>
            <ToggleGroup type="single" value={stateFilter} onValueChange={(v) => setStateFilter(v || "all")}>
              <ToggleGroupItem value="all" size="sm">Todos</ToggleGroupItem>
              <ToggleGroupItem value="planned" size="sm">Planejada</ToggleGroupItem>
              <ToggleGroupItem value="pending_match" size="sm">Pendente</ToggleGroupItem>
              <ToggleGroupItem value="matched" size="sm">Coletada</ToggleGroupItem>
              <ToggleGroupItem value="orphan_collected" size="sm">Órfã</ToggleGroupItem>
            </ToggleGroup>
          </div>
          <label className="flex items-center gap-2 text-[12px] cursor-pointer">
            <input
              type="checkbox"
              checked={onlyDivergent}
              onChange={(e) => setOnlyDivergent(e.target.checked)}
              className="accent-primary"
            />
            Somente invisíveis no monitor
          </label>
        </div>
      </Card>

      {/* Tabela */}
      <Card className="overflow-hidden">
        <div className="px-4 py-3 border-b border-border/60 flex items-center justify-between">
          <div className="text-[12px] text-muted-foreground">
            {loading ? "Carregando…" : `${visibleRows.length} de ${rows.length} linhas`}
          </div>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Playlist</TableHead>
              <TableHead>Origem</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead>Monitor</TableHead>
              <TableHead>Planejada em</TableHead>
              <TableHead>Última coleta</TableHead>
              <TableHead>Playlist ID</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleRows.slice(0, 500).map((r) => (
              <TableRow key={`${r.source}-${r.playlist_id}-${r.curator_id ?? r.managed_playlist_id ?? "x"}`}>
                <TableCell className="max-w-[280px] truncate text-[13px]">
                  {r.playlist_name || <span className="text-subtle-foreground">—</span>}
                </TableCell>
                <TableCell><SourcePill source={r.source} /></TableCell>
                <TableCell><StatePill state={r.state} /></TableCell>
                <TableCell>
                  {r.visible_in_monitor ? (
                    <Badge variant="outline" className="text-success border-success/40">visível</Badge>
                  ) : (
                    <Badge variant="outline" className="text-warning border-warning/40">invisível</Badge>
                  )}
                </TableCell>
                <TableCell className="text-[12px] text-muted-foreground tabular-nums">
                  {r.planned_at ? new Date(r.planned_at).toLocaleDateString("pt-BR") : "—"}
                </TableCell>
                <TableCell className="text-[12px] text-muted-foreground tabular-nums">
                  {r.last_collected_at ? new Date(r.last_collected_at).toLocaleDateString("pt-BR") : "—"}
                </TableCell>
                <TableCell className="font-mono text-[10px] text-subtle-foreground max-w-[180px] truncate">
                  {r.playlist_id || "—"}
                </TableCell>
              </TableRow>
            ))}
            {!loading && visibleRows.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground py-12 text-[13px]">
                  Sem linhas para os filtros selecionados.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        {visibleRows.length > 500 && (
          <div className="px-4 py-2 text-[11px] text-muted-foreground border-t border-border/60">
            Mostrando primeiras 500 linhas — refine os filtros para ver o resto.
          </div>
        )}
      </Card>
    </div>
  );
}

function KpiCell({ label, value, tone }: { label: string; value: number; tone?: "success" | "warning" | "danger" | "muted" }) {
  const toneClass =
    tone === "success" ? "text-success"
    : tone === "warning" ? "text-warning"
    : tone === "danger" ? "text-destructive"
    : tone === "muted" ? "text-muted-foreground"
    : "text-foreground";
  return (
    <Card className="p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold leading-tight">
        {label}
      </div>
      <div className={`text-2xl font-bold tabular-nums mt-1 ${toneClass}`}>{value.toLocaleString("pt-BR")}</div>
    </Card>
  );
}

function SourcePill({ source }: { source: InvRow["source"] }) {
  const cls =
    source === "ecosystem" ? "text-domain-deals border-domain-deals/40"
    : source === "curator" ? "text-domain-curators border-domain-curators/40"
    : "text-muted-foreground border-border";
  return <Badge variant="outline" className={cls}>{SOURCE_LABEL[source]}</Badge>;
}

function StatePill({ state }: { state: InvRow["state"] }) {
  const cls =
    state === "matched" ? "text-success border-success/40"
    : state === "planned" ? "text-warning border-warning/40"
    : state === "pending_match" ? "text-warning border-warning/40"
    : "text-muted-foreground border-border";
  return <Badge variant="outline" className={cls}>{STATE_LABEL[state]}</Badge>;
}
