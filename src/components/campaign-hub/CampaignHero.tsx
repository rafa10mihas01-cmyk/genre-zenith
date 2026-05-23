import { Link } from "react-router-dom";
import { Music, Lock, Share2, ArrowLeft, ExternalLink, Clock, Copy, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { formatInt } from "@/lib/campaignEngine";
import { toast } from "@/hooks/use-toast";
import type { CampaignHubCampaign, CampaignHubMode } from "./types";

type Props = {
  camp: CampaignHubCampaign;
  mode: CampaignHubMode;
  delivered?: number;
  goal?: number;
  daysElapsed?: number;
  daysTotal?: number;
  lastUpdateAt?: string | null;
};

const STATUS_LABEL: Record<string, string> = {
  draft: "Rascunho",
  active: "No ar",
  paused: "Pausada",
  completed: "Concluída",
  cancelled: "Cancelada",
};

const STATUS_TONE: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  active: "bg-primary/15 text-primary border border-primary/30",
  paused: "bg-warning/15 text-warning border border-warning/30",
  completed: "bg-primary/10 text-primary border border-primary/20",
  cancelled: "bg-muted text-muted-foreground",
};

export function CampaignHero({ camp, mode, delivered = 0, goal = 0, daysElapsed = 0, daysTotal = 0, lastUpdateAt }: Props) {
  const pct = goal > 0 ? Math.min(100, Math.round((delivered / goal) * 100)) : 0;
  const daysLeft = Math.max(0, daysTotal - daysElapsed);
  const statusKey = camp.status ?? "draft";

  async function copyClientLink() {
    const token = camp.public_plan_token;
    if (!token) return;
    const url = `${window.location.origin}/p/plano/${token}`;
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: "Link copiado", description: "Cole no WhatsApp ou e-mail pro cliente." });
    } catch {
      toast({ title: "Não consegui copiar", description: url, variant: "destructive" });
    }
  }

  return (
    <div className={cn(
      "sticky top-0 z-30 -mx-4 md:-mx-6 px-4 md:px-6",
      "border-b border-border bg-background/85 backdrop-blur-xl supports-[backdrop-filter]:bg-background/70",
    )}>
      <div className="py-4 flex items-center gap-4 flex-wrap">
        {/* Capa */}
        {camp.cover_url ? (
          <img src={camp.cover_url} alt="" className="w-14 h-14 rounded-lg object-cover shadow-sm shrink-0" />
        ) : (
          <div className="w-14 h-14 rounded-lg bg-muted grid place-items-center shrink-0">
            <Music className="h-6 w-6 text-muted-foreground" />
          </div>
        )}

        {/* Texto */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-lg md:text-xl font-semibold leading-tight truncate">{camp.track_name}</h1>
            <span className={cn("inline-flex items-center px-2 h-5 rounded text-[10px] font-medium", STATUS_TONE[statusKey])}>
              {STATUS_LABEL[statusKey] ?? statusKey}
            </span>
          </div>
          <div className="text-xs text-muted-foreground truncate mt-0.5">
            {camp.artist ?? "—"}
            {daysTotal > 0 && (
              <>
                {" · "}D{daysElapsed} de {daysTotal}
                {" · "}faltam {daysLeft}d
              </>
            )}
            {lastUpdateAt && (
              <>
                {" · "}
                <Clock className="inline h-3 w-3 -mt-0.5" /> atualizado {timeAgo(lastUpdateAt)}
              </>
            )}
          </div>
        </div>

        {/* Ações */}
        <div className="flex items-center gap-2">
          {mode === "internal" && (
            <>
              <Link to="/campanhas">
                <Button variant="ghost" size="sm">
                  <ArrowLeft className="h-4 w-4 mr-1.5" /> Campanhas
                </Button>
              </Link>
              {camp.public_plan_token && (
                <Button variant="outline" size="sm" onClick={copyClientLink}>
                  <Share2 className="h-4 w-4 mr-1.5" /> Compartilhar
                </Button>
              )}
              {camp.public_plan_token && (
                <a href={`/p/plano/${camp.public_plan_token}`} target="_blank" rel="noreferrer">
                  <Button variant="ghost" size="sm">
                    <ExternalLink className="h-4 w-4 mr-1.5" /> Portal
                  </Button>
                </a>
              )}
            </>
          )}
          {mode === "client" && camp.spotify_track_url && (
            <a href={camp.spotify_track_url} target="_blank" rel="noreferrer">
              <Button variant="outline" size="sm">
                <ExternalLink className="h-4 w-4 mr-1.5" /> Ouvir
              </Button>
            </a>
          )}
        </div>
      </div>

      {/* Barra de progresso */}
      {goal > 0 && (
        <div className="pb-3">
          <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-1.5">
            <span>Progresso da entrega</span>
            <span className="tabular-nums font-medium text-foreground">
              {formatInt(delivered)} <span className="text-muted-foreground">/ {formatInt(goal)} streams · {pct}%</span>
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
            <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}

      {mode === "internal" && camp.snapshot_locked_at && (
        <div className="pb-2 text-[10px] text-primary inline-flex items-center gap-1">
          <Lock className="h-3 w-3" /> Plano congelado em {new Date(camp.snapshot_locked_at).toLocaleDateString("pt-BR")}
        </div>
      )}
    </div>
  );
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "agora";
  if (m < 60) return `há ${m}min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `há ${h}h`;
  const d = Math.floor(h / 24);
  return `há ${d}d`;
}
