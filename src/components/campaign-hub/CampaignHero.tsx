import { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Music, Lock, Share2, ArrowLeft, ExternalLink, Clock, Copy, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { formatInt } from "@/lib/campaignEngine";
import { toast } from "@/hooks/use-toast";
import { PUBLIC_DOMAIN } from "@/lib/curatorPublicUrl";
import type { CampaignHubCampaign, CampaignHubMode } from "./types";

type Props = {
  camp: CampaignHubCampaign;
  mode: CampaignHubMode;
  delivered?: number;
  goal?: number;
  daysElapsed?: number;
  daysTotal?: number;
  lastUpdateAt?: string | null;
  extraActions?: ReactNode;
  hideProgress?: boolean;
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

export function CampaignHero({ camp, mode, delivered = 0, goal = 0, daysElapsed = 0, daysTotal = 0, lastUpdateAt, extraActions, hideProgress = false }: Props) {
  const pct = goal > 0 ? Math.min(100, Math.round((delivered / goal) * 100)) : 0;
  const daysLeft = Math.max(0, daysTotal - daysElapsed);
  const statusKey = camp.status ?? "draft";

  const clientUrl = camp.public_plan_token
    ? `${PUBLIC_DOMAIN}/p/plano/${camp.public_plan_token}`
    : "";

  async function copyClientLink() {
    if (!clientUrl) return;
    try {
      await navigator.clipboard.writeText(clientUrl);
      toast({ title: "Link copiado", description: "Cole no WhatsApp ou e-mail pro cliente." });
    } catch {
      toast({ title: "Não consegui copiar", description: clientUrl, variant: "destructive" });
    }
  }

  function shareWhatsApp() {
    if (!clientUrl) return;
    const text = `Acompanhe a campanha de ${camp.track_name}${camp.artist ? ` — ${camp.artist}` : ""}: ${clientUrl}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
  }

  return (
    <div className={cn(
      "sticky top-0 z-40 shrink-0 border-b border-border bg-background px-4 md:px-6",
    )}>

      <div className="py-3 md:py-4 flex flex-row items-center gap-2 md:gap-4">
        {/* Linha 1 mobile / esquerda desktop: capa + texto */}
        <div className="flex items-center gap-3 min-w-0 flex-1">
          {camp.cover_url ? (
            <img src={camp.cover_url} alt="" className="w-12 h-12 md:w-14 md:h-14 rounded-lg object-cover shadow-sm shrink-0" />
          ) : (
            <div className="w-12 h-12 md:w-14 md:h-14 rounded-lg bg-muted grid place-items-center shrink-0">
              <Music className="h-5 w-5 md:h-6 md:w-6 text-muted-foreground" />
            </div>
          )}

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 min-w-0">
              <h1 className="text-base md:text-xl font-semibold leading-tight truncate min-w-0">
                {camp.track_name}
              </h1>
              <span className={cn(
                "inline-flex items-center px-1.5 h-[18px] rounded text-[10px] font-medium shrink-0",
                STATUS_TONE[statusKey],
              )}>
                {STATUS_LABEL[statusKey] ?? statusKey}
              </span>
            </div>
            <div className="text-[11px] md:text-xs text-muted-foreground truncate mt-0.5">
              {camp.artist ?? "—"}
              {daysTotal > 0 && (
                <>
                  {" · "}D{daysElapsed}/{daysTotal}
                  <span className="hidden md:inline"> · faltam {daysLeft}d</span>
                </>
              )}
              {lastUpdateAt && (
                <span className="hidden md:inline">
                  {" · "}
                  <Clock className="inline h-3 w-3 -mt-0.5" /> {timeAgo(lastUpdateAt)}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Ações */}
        <div className="flex items-center gap-1.5 lg:gap-2 flex-nowrap justify-end shrink-0 w-full md:w-auto overflow-x-auto -mx-1 px-1 md:mx-0 md:px-0">
          {mode === "internal" && (
            <>
              {/* Botão "Campanhas" só no desktop — no mobile o topbar global já tem o < */}
              <Link to="/campanhas" className="hidden lg:inline-flex">
                <Button variant="ghost" size="sm">
                  <ArrowLeft className="h-4 w-4 mr-1.5" /> Campanhas
                </Button>
              </Link>
              {camp.public_plan_token && (
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="px-2 lg:px-3"
                      aria-label="Compartilhar"
                      title="Compartilhar"
                    >
                      <Share2 className="h-4 w-4 lg:mr-1.5" />
                      <span className="hidden lg:inline">Compartilhar</span>
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-[300px] sm:w-[360px] p-4 space-y-3">
                    <div>
                      <div className="text-sm font-semibold">Link do cliente</div>
                      <div className="text-[11px] text-muted-foreground">
                        Mesmo link de antes — agora mostra a campanha ao vivo.
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Input
                        readOnly
                        value={clientUrl}
                        onFocus={(e) => e.currentTarget.select()}
                        className="font-mono text-[11px] h-9"
                      />
                      <Button variant="outline" size="icon" className="h-9 w-9 shrink-0" onClick={copyClientLink} title="Copiar">
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <Button variant="default" size="sm" onClick={shareWhatsApp}>
                        <MessageCircle className="h-3.5 w-3.5 mr-1.5" /> WhatsApp
                      </Button>
                      <a href={clientUrl} target="_blank" rel="noreferrer">
                        <Button variant="outline" size="sm" className="w-full">
                          <ExternalLink className="h-3.5 w-3.5 mr-1.5" /> Abrir portal
                        </Button>
                      </a>
                    </div>
                  </PopoverContent>
                </Popover>
              )}
              {extraActions}
            </>
          )}
          {mode === "client" && camp.spotify_track_url && (
            <a href={camp.spotify_track_url} target="_blank" rel="noreferrer" className="shrink-0">
              <Button variant="outline" size="sm" className="shrink-0">
                <ExternalLink className="h-4 w-4 mr-1.5" /> Ouvir
              </Button>
            </a>
          )}
        </div>
      </div>

      {/* Barra de progresso */}
      {!hideProgress && goal > 0 && (
        <div className="pb-3">
          <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-1.5 gap-2">
            <span className="shrink-0">Progresso</span>
            <span className="tabular-nums font-medium text-foreground truncate text-right">
              {formatInt(delivered)}
              <span className="text-muted-foreground"> / {formatInt(goal)} · {pct}%</span>
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
            <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}

      {!hideProgress && mode === "internal" && camp.snapshot_locked_at && (
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
