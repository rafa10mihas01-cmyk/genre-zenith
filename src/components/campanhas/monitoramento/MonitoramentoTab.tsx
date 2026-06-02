import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Activity } from "lucide-react";
import { ExecucaoView } from "./ExecucaoView";
import { PlaylistHistoryDrawer } from "./PlaylistHistoryDrawer";

type Props = { campaignId: string };

type BaselineTone = "success" | "warning" | "muted";

export function MonitoramentoTab({ campaignId }: Props) {
  const [kpis, setKpis] = useState<{ status: string | null; capturedAt: string | null; playlists: number }>({
    status: null,
    capturedAt: null,
    playlists: 0,
  });
  const [drawerPlaylistId, setDrawerPlaylistId] = useState<string | null>(null);

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

  const tone: BaselineTone =
    kpis.status === "captured" ? "success" : kpis.status === "pending" ? "warning" : "muted";
  const label =
    kpis.status === "captured" ? "Baseline capturada"
    : kpis.status === "pending" ? "Baseline pendente"
    : "Sem baseline";

  return (
    <div className="space-y-4">
      <BaselineStatus tone={tone} label={label} capturedAt={kpis.capturedAt} playlists={kpis.playlists} />

      <ExecucaoView campaignId={campaignId} onOpenHistory={setDrawerPlaylistId} />

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
  tone, label, capturedAt, playlists,
}: { tone: BaselineTone; label: string; capturedAt: string | null; playlists: number }) {
  return (
    <Card className="p-3 md:p-4 flex items-center gap-3 md:gap-4">
      <div className="relative shrink-0">
        <span className={`block h-2.5 w-2.5 rounded-full ${TONE_DOT[tone]}`} aria-hidden />
        {tone === "warning" && (
          <span className={`absolute inset-0 rounded-full ${TONE_DOT[tone]} opacity-60 animate-ping`} aria-hidden />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Activity className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground font-bold">
            Monitoramento
          </span>
        </div>
        <div className={`text-sm md:text-base font-semibold leading-tight mt-0.5 ${TONE_TEXT[tone]}`}>
          {label}
        </div>
        {capturedAt && (
          <div className="text-[10px] text-muted-foreground mt-0.5 tabular-nums">
            Capturada em: {new Date(capturedAt).toLocaleString("pt-BR")}
          </div>
        )}
      </div>
      <div className="hidden sm:flex flex-col items-end shrink-0">
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">
          Playlists
        </span>
        <span className="text-base md:text-lg font-bold tabular-nums leading-tight">
          {playlists}
        </span>
      </div>
    </Card>
  );
}
