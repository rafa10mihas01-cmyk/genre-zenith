import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Activity, ChevronDown, Image as ImageIcon, Users, Layers, HeartPulse, BarChart3, CheckCircle2 } from "lucide-react";
import { ExecucaoView } from "./ExecucaoView";
import { PlaylistHistoryDrawer } from "./PlaylistHistoryDrawer";
import { PrintThumbs } from "@/components/playlist-deals/PrintThumbs";
import { SaudeView } from "./SaudeView";

type Props = { campaignId: string };

type BaselineTone = "success" | "warning" | "muted";

type SnapshotRun = {
  run_id: string;
  created_at: string | null;
  completed_at: string | null;
  print_urls: string[] | null;
  print_count: number | null;
};

export function MonitoramentoTab({ campaignId }: Props) {
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
      const { data } = await supabase
        .from("v_snapshot_prints" as any)
        .select("run_id, created_at, completed_at, print_urls, print_count")
        .eq("campaign_id", campaignId)
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

  return (
    <div className="space-y-4">
      <BaselineStatus
        tone={tone}
        label={label}
        capturedAt={kpis.capturedAt}
        playlists={kpis.playlists}
        runs={runs}
        runsLoading={runsLoading}
      />

      <Tabs value={subtab} onValueChange={setSubtab} className="space-y-4">
        <div className="sticky top-0 z-20 -mx-px bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/70 py-2 border-b border-border/40">
          <TabsList className="grid grid-cols-4 w-full md:w-auto md:inline-grid">
            <TabsTrigger value="visao" className="gap-1.5">
              <BarChart3 className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Visão geral</span><span className="sm:hidden">Visão</span>
            </TabsTrigger>
            <TabsTrigger value="curadores" className="gap-1.5">
              <Users className="h-3.5 w-3.5" /> Curadores
            </TabsTrigger>
            <TabsTrigger value="ecossistema" className="gap-1.5">
              <Layers className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Ecossistema</span><span className="sm:hidden">Eco</span>
            </TabsTrigger>
            <TabsTrigger value="saude" className="gap-1.5">
              <HeartPulse className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Saúde da entrega</span><span className="sm:hidden">Saúde</span>
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="visao" className="mt-0">
          <ExecucaoView campaignId={campaignId} onOpenHistory={setDrawerPlaylistId} mode="all" />
        </TabsContent>
        <TabsContent value="curadores" className="mt-0">
          <ExecucaoView campaignId={campaignId} onOpenHistory={setDrawerPlaylistId} mode="curators" />
        </TabsContent>
        <TabsContent value="ecossistema" className="mt-0">
          <ExecucaoView campaignId={campaignId} onOpenHistory={setDrawerPlaylistId} mode="ecosystem" />
        </TabsContent>
        <TabsContent value="saude" className="mt-0">
          <SaudeView campaignId={campaignId} />
        </TabsContent>
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
  tone, label, capturedAt, playlists, runs, runsLoading,
}: {
  tone: BaselineTone;
  label: string;
  capturedAt: string | null;
  playlists: number;
  runs: SnapshotRun[];
  runsLoading: boolean;
}) {
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

  return (
    <Card className="overflow-hidden !p-0">
      <details className="group/baseline [&[open]>summary_.bchev]:rotate-90">
        <summary className="cursor-pointer list-none h-[64px] px-4 flex items-center gap-4 hover:bg-muted/20 transition-colors">
          <div className="relative shrink-0">
            <span className={`block h-2 w-2 rounded-full ${TONE_DOT[tone]}`} aria-hidden />
            {tone === "warning" && (
              <span className={`absolute inset-0 rounded-full ${TONE_DOT[tone]} opacity-60 animate-ping`} aria-hidden />
            )}
          </div>

          <div className={`text-[13px] font-semibold leading-none whitespace-nowrap ${TONE_TEXT[tone]}`}>
            {label}
          </div>

          {capturedAt && (
            <div className="hidden md:flex items-center gap-3 text-[11px] text-muted-foreground tabular-nums leading-none">
              <span className="h-3 w-px bg-border/60" />
              <span>{dateLabel} {timeLabel}</span>
              <span className="h-3 w-px bg-border/60" />
              <span>{playlists} playlists</span>
              {latestTime && (
                <>
                  <span className="h-3 w-px bg-border/60" />
                  <span>Última coleta {latestTime}</span>
                </>
              )}
            </div>
          )}

          <div className="md:hidden flex items-center gap-2 text-[11px] text-muted-foreground tabular-nums">
            <span>{playlists} playlists</span>
            {latestTime && <span>· {latestTime}</span>}
          </div>

          <div className="ml-auto flex items-center gap-1.5 text-[11px] text-muted-foreground shrink-0">
            <span className="hidden sm:inline">Ver detalhes</span>
            <ChevronRight className="bchev h-3.5 w-3.5 transition-transform" />
          </div>
        </summary>

        <div className="border-t border-border/60 px-4 py-4 bg-background/40 space-y-3 max-h-[60vh] overflow-y-auto overscroll-contain">

          {runsLoading ? (
            <div className="text-[12px] text-muted-foreground">Carregando prints…</div>
          ) : runs.length === 0 ? (
            <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
              <ImageIcon className="h-3.5 w-3.5" />
              Nenhum print vinculado a esta campanha ainda.
            </div>
          ) : (
            runs.map((run) => {
              const urls = run.print_urls ?? [];
              const dt = run.created_at ? new Date(run.created_at) : null;
              const label = dt
                ? dt.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
                : "Coleta";
              return (
                <div key={run.run_id} className="rounded-lg border border-border/60 bg-card/40 p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-[12px] font-semibold tabular-nums">{label}</div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
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
