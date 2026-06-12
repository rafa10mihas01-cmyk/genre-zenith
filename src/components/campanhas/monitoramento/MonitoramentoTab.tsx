import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Activity, ChevronDown, Image as ImageIcon, Users, Layers, HeartPulse, BarChart3, CheckCircle2, FileSpreadsheet, Download, Loader2 } from "lucide-react";
import { ExecucaoView } from "./ExecucaoView";
import { PlaylistHistoryDrawer } from "./PlaylistHistoryDrawer";
import { PrintThumbs } from "@/components/playlist-deals/PrintThumbs";
import { SaudeView } from "./SaudeView";
import { useUserRole } from "@/hooks/useUserRole";
import { toast } from "sonner";

export type MonitoramentoSpreadsheetUpload = {
  id: string;
  created_at: string;
  rows_imported: number;
  total_streams: number;
  file_name: string | null;
  file_path?: string | null;
  is_baseline?: boolean | null;
  reference_date?: string | null;
};

type Props = {
  campaignId: string;
  headerSlot?: React.ReactNode;
  /** Quando passado (modo planilha), lista de uploads aparece dentro do expand da Baseline. */
  spreadsheetUploads?: MonitoramentoSpreadsheetUpload[];
};


type BaselineTone = "success" | "warning" | "muted";

type SnapshotRun = {
  run_id: string;
  created_at: string | null;
  completed_at: string | null;
  print_urls: string[] | null;
  print_count: number | null;
};

export function MonitoramentoTab({ campaignId, headerSlot, spreadsheetUploads }: Props) {
  const [kpis, setKpis] = useState<{ status: string | null; capturedAt: string | null; playlists: number }>({
    status: null,
    capturedAt: null,
    playlists: 0,
  });
  const [drawerPlaylistId, setDrawerPlaylistId] = useState<string | null>(null);
  const [runs, setRuns] = useState<SnapshotRun[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);

  useEffect(() => {
    if (!campaignId) return;
    (async () => {
      const [{ data: c }, { count }] = await Promise.all([
        supabase.from("campaigns").select("baseline_status, baseline_captured_at").eq("id", campaignId).maybeSingle(),
        supabase
          .from("campaign_playlist_collections")
          .select("playlist_id", { count: "exact", head: true })
          .eq("campaign_id", campaignId)
          .eq("is_baseline", true),
      ]);
      setKpis({
        status: (c as any)?.baseline_status ?? null,
        capturedAt: (c as any)?.baseline_captured_at ?? null,
        playlists: count ?? 0,
      });
    })();
  }, [campaignId]);

  useEffect(() => {
    if (!campaignId) return;
    setRunsLoading(true);
    (async () => {
      const { data: campaign } = await supabase
        .from("campaigns")
        .select("deal_id")
        .eq("id", campaignId)
        .maybeSingle();
      const officialDealId = (campaign as { deal_id?: string | null } | null)?.deal_id ?? null;
      if (!officialDealId) {
        setRuns([]);
        setRunsLoading(false);
        return;
      }
      const { data } = await supabase
        .from("v_snapshot_prints" as any)
        .select("run_id, created_at, completed_at, print_urls, print_count")
        .eq("campaign_id", campaignId)
        .eq("deal_id", officialDealId)
        .order("created_at", { ascending: false })
        .limit(50);
      setRuns(((data ?? []) as unknown as SnapshotRun[]).filter((r) => (r.print_urls?.length ?? 0) > 0));
      setRunsLoading(false);
    })();
  }, [campaignId]);

  const tone: BaselineTone =
    kpis.status === "captured" ? "success" : kpis.status === "pending" ? "warning" : "muted";
  const label =
    kpis.status === "captured" ? "Baseline capturada"
    : kpis.status === "pending" ? "Baseline pendente"
    : "Sem baseline";

  const [params, setParams] = useSearchParams();
  const subtab = (params.get("subtab") as "visao" | "curadores" | "ecossistema" | "saude") || "visao";
  const setSubtab = (v: string) => {
    const next = new URLSearchParams(params);
    if (v === "visao") next.delete("subtab"); else next.set("subtab", v);
    setParams(next, { replace: true });
  };

  // Ecossistema saiu como subtab principal — agora aparece como pílula dentro de Curadores.
  // A rota subtab=ecossistema continua válida (pílula navega pra cá), só não tem trigger no menu.
  const tabsDef = [
    { v: "visao", label: "Visão geral", Icon: BarChart3 },
    { v: "curadores", label: "Curadores", Icon: Users },
    { v: "saude", label: "Saúde", Icon: HeartPulse },
  ];

  const tabsList = (
    <>
      {/* Mobile: grid de cards quadrados (mesmo padrão do CampaignHub) */}
      <div className="sm:hidden">
        <TabsList className="grid grid-cols-3 gap-1.5 h-auto bg-transparent p-0 rounded-none w-full">
          {tabsDef.map(({ v, label, Icon }) => (
            <TabsTrigger
              key={v}
              value={v}
              aria-label={label}
              className="flex flex-col items-center justify-center gap-1 rounded-xl border px-1 py-2 h-auto leading-none border-border bg-card text-muted-foreground hover:text-foreground data-[state=active]:border-primary data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-none"
            >
              <Icon className="h-4 w-4" />
              <span className="text-[10px] font-medium leading-none truncate max-w-full">{label}</span>
            </TabsTrigger>
          ))}
        </TabsList>
      </div>

      {/* Desktop: underline tabs */}
      <div className="hidden sm:block -mx-px border-b border-border/40">
        <TabsList className="bg-transparent rounded-none p-0 h-auto gap-1 w-auto justify-start">
          {tabsDef.map(({ v, label, Icon }) => (
            <TabsTrigger
              key={v}
              value={v}
              className="gap-1.5 rounded-none bg-transparent px-4 py-2.5 text-muted-foreground border-b-2 border-transparent data-[state=active]:bg-transparent data-[state=active]:text-primary data-[state=active]:border-primary data-[state=active]:shadow-none -mb-px"
            >
              <Icon className="h-3.5 w-3.5" /> {label}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
    </>
  );


  return (
    <div className="space-y-4">
      <BaselineStatus
        tone={tone}
        label={label}
        capturedAt={kpis.capturedAt}
        playlists={kpis.playlists}
        runs={runs}
        runsLoading={runsLoading}
        spreadsheetUploads={spreadsheetUploads}
      />
      {headerSlot}

      {/* Mantemos UMA instância de cada view montada e alternamos com display:none.
          Isso elimina o flicker/remount ao trocar de subtab — o estado interno,
          cache e DOM permanecem; só a visibilidade muda. */}
      <Tabs value={subtab} onValueChange={setSubtab} className="space-y-4">
        <div className={subtab === "visao" ? "" : "hidden"}>
          <ExecucaoView campaignId={campaignId} onOpenHistory={setDrawerPlaylistId} mode="all" tabsSlot={tabsList} />
        </div>
        <div className={subtab === "curadores" ? "" : "hidden"}>
          <ExecucaoView campaignId={campaignId} onOpenHistory={setDrawerPlaylistId} mode="curators" tabsSlot={tabsList} />
        </div>
        <div className={subtab === "ecossistema" ? "" : "hidden"}>
          <ExecucaoView campaignId={campaignId} onOpenHistory={setDrawerPlaylistId} mode="ecosystem" tabsSlot={tabsList} />
        </div>
        <div className={subtab === "saude" ? "space-y-4" : "hidden space-y-4"}>
          {tabsList}
          <SaudeView campaignId={campaignId} />
        </div>
      </Tabs>


      <PlaylistHistoryDrawer
        campaignId={campaignId}
        playlistId={drawerPlaylistId}
        open={!!drawerPlaylistId}
        onOpenChange={(o) => { if (!o) setDrawerPlaylistId(null); }}
      />
    </div>
  );
}

const TONE_DOT: Record<BaselineTone, string> = {
  success: "bg-success",
  warning: "bg-warning",
  muted:   "bg-muted-foreground",
};
const TONE_TEXT: Record<BaselineTone, string> = {
  success: "text-success",
  warning: "text-warning",
  muted:   "text-muted-foreground",
};

function BaselineStatus({
  tone, label, capturedAt, playlists, runs, runsLoading, spreadsheetUploads,
}: {
  tone: BaselineTone;
  label: string;
  capturedAt: string | null;
  playlists: number;
  runs: SnapshotRun[];
  runsLoading: boolean;
  spreadsheetUploads?: MonitoramentoSpreadsheetUpload[];
}) {
  const { isAdmin } = useUserRole();
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const handleDownloadUpload = async (u: MonitoramentoSpreadsheetUpload) => {
    if (!u.file_path) {
      toast.error("Arquivo original não disponível pra esse upload");
      return;
    }
    setDownloadingId(u.id);
    try {
      const { data, error } = await supabase.storage
        .from("label-spreadsheets")
        .createSignedUrl(u.file_path, 60);
      if (error || !data?.signedUrl) throw error ?? new Error("Falha ao gerar link");
      const a = document.createElement("a");
      a.href = data.signedUrl;
      a.download = u.file_name ?? "planilha.xlsx";
      a.target = "_blank";
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao baixar planilha");
    } finally {
      setDownloadingId(null);
    }
  };

  const totalPrints = runs.reduce((acc, r) => acc + (r.print_urls?.length ?? 0), 0);
  const latestRunAt = runs[0]?.created_at ?? null;

  const dateLabel = capturedAt
    ? new Date(capturedAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" })
    : null;
  const timeLabel = capturedAt
    ? new Date(capturedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
    : null;
  const latestTime = latestRunAt
    ? new Date(latestRunAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
    : null;

  const toneIconClass =
    tone === "success" ? "text-success" : tone === "warning" ? "text-warning" : "text-muted-foreground";

  return (
    <Card className="overflow-hidden !p-0">
      <details className="group/baseline [&[open]>summary_.bchev]:rotate-180">
        <summary className="cursor-pointer list-none min-h-[56px] px-4 py-2.5 flex items-center gap-3 hover:bg-muted/15 transition-colors">
          <div className="relative shrink-0">
            <CheckCircle2 className={`h-4 w-4 ${toneIconClass}`} aria-hidden />
            {tone === "warning" && (
              <span className="absolute inset-0 rounded-full bg-warning opacity-30 animate-ping" aria-hidden />
            )}
          </div>

          <div className={`text-[13px] font-medium leading-none whitespace-nowrap ${TONE_TEXT[tone]}`}>
            {label}
          </div>

          {capturedAt && (
            <>
              <span className="h-3.5 w-px bg-border/50 shrink-0" aria-hidden />
              <div className="text-[12px] text-muted-foreground tabular-nums leading-none whitespace-nowrap">
                {dateLabel}, {timeLabel}
              </div>
              <span className="h-3.5 w-px bg-border/50 shrink-0" aria-hidden />
              <div className="text-[12px] text-muted-foreground tabular-nums leading-none whitespace-nowrap">
                {playlists} playlists
              </div>
            </>
          )}

          <div className="ml-auto flex items-center gap-3 shrink-0">
            {latestTime && (
              <div className="hidden sm:flex flex-col items-end leading-tight gap-0.5">
                <span className="text-[9px] uppercase tracking-[0.14em] text-muted-foreground font-medium">Última coleta</span>
                <span className="text-[12px] font-semibold tabular-nums text-foreground leading-none">{latestTime}</span>
              </div>
            )}
            <span className="hidden sm:block h-7 w-px bg-border/50" aria-hidden />
            <div className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-border/60 bg-card/40 hover:bg-muted/20 transition-colors text-[12px] text-foreground/90">
              <ImageIcon className="h-3.5 w-3.5 text-muted-foreground" />
              <span>Ver prints</span>
              <ChevronDown className="bchev h-3 w-3 transition-transform text-muted-foreground" />
            </div>
          </div>
        </summary>



        <div className="border-t border-border/60 px-4 py-4 bg-background/40 space-y-4 max-h-[60vh] overflow-y-auto overscroll-contain">

          {/* Planilhas enviadas (só aparece no modo manual/planilha — automático não passa essa prop). */}
          {spreadsheetUploads && spreadsheetUploads.length > 0 && (
            <div className="rounded-lg border border-border/60 bg-card/40 p-3 space-y-2">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="h-3.5 w-3.5 text-domain-campaigns" />
                <div className="text-[12px] font-semibold text-foreground">Planilhas enviadas</div>
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground ml-auto">
                  {spreadsheetUploads.length} {spreadsheetUploads.length === 1 ? "envio" : "envios"}
                </span>
              </div>
              {/* ~5 visíveis (cada item ~32px) — resto com scroll. */}
              <ul className="space-y-1 max-h-[180px] overflow-y-auto overscroll-contain pr-1">
                {spreadsheetUploads.map((u) => {
                  const dt = new Date(u.created_at);
                  return (
                    <li
                      key={u.id}
                      className="flex items-center gap-2 text-[12px] text-muted-foreground rounded-md px-2 py-1.5 hover:bg-muted/20"
                    >
                      <span className="tabular-nums shrink-0 w-[120px] text-foreground/80">
                        {dt.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                      </span>
                      {u.is_baseline && (
                        <span className="text-[9.5px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded border border-primary/40 text-primary leading-none shrink-0">
                          baseline
                        </span>
                      )}
                      <span className="flex-1 text-right tabular-nums truncate">
                        {u.rows_imported} playlists · {new Intl.NumberFormat("pt-BR").format(Math.round(u.total_streams))} streams
                      </span>
                      {isAdmin && u.file_path && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground shrink-0"
                          onClick={() => handleDownloadUpload(u)}
                          disabled={downloadingId === u.id}
                          title={u.file_name ?? "Baixar planilha original"}
                        >
                          {downloadingId === u.id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Download className="h-3 w-3" />
                          )}
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}



          {runsLoading ? (
            <div className="text-[12px] text-muted-foreground">Carregando prints…</div>
          ) : runs.length === 0 ? (
            <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
              <ImageIcon className="h-3.5 w-3.5" />
              Nenhum print vinculado a esta campanha ainda.
            </div>
          ) : (
            runs.map((run, idx) => {
              const urls = run.print_urls ?? [];
              const dt = run.created_at ? new Date(run.created_at) : null;
              const label = dt
                ? dt.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
                : "Coleta";
              // A baseline é a coleta mais antiga (runs vêm em DESC, então é a última).
              const isBaseline = idx === runs.length - 1 && !!capturedAt;
              return (
                <div
                  key={run.run_id}
                  className={`rounded-lg border p-3 ${
                    isBaseline ? "border-primary/40 bg-primary/5" : "border-border/60 bg-card/40"
                  }`}
                >
                  <div className="flex items-center justify-between mb-2 gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="text-[12px] font-semibold tabular-nums truncate">{label}</div>
                      {isBaseline && (
                        <span className="text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded border border-primary/50 text-primary leading-none shrink-0">
                          baseline
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground shrink-0">
                      {urls.length} {urls.length === 1 ? "print" : "prints"}
                    </div>
                  </div>
                  <PrintThumbs urls={urls} size="md" />
                </div>
              );
            })
          )}
        </div>
      </details>
    </Card>
  );
}
