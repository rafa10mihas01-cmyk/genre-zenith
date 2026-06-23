import { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Music, Lock, Share2, ArrowLeft, ExternalLink, Copy, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { formatInt } from "@/lib/campaignEngine";
import { toast } from "@/hooks/use-toast";
import { PUBLIC_DOMAIN } from "@/lib/curatorPublicUrl";
import { openAdminPortal } from "@/lib/openAdminPortal";
import type { CampaignHubCampaign, CampaignHubMode } from "./types";
import { deliveryPct } from "@/lib/campaignPct";

type Props = {
  camp: CampaignHubCampaign;
  mode: CampaignHubMode;
  delivered?: number;
  deliveryBreakdown?: { curators: number; ecosystem: number; organic: number } | null;
  goal?: number;
  daysElapsed?: number;
  daysTotal?: number;
  lastUpdateAt?: string | null;
  extraActions?: ReactNode;
  extraActionsAfter?: ReactNode;
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

export function CampaignHero({ camp, mode, delivered = 0, deliveryBreakdown, goal = 0, daysElapsed = 0, daysTotal = 0, lastUpdateAt, extraActions, extraActionsAfter, hideProgress = false }: Props) {
  const pct = deliveryPct(delivered, goal);
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

  const subtitleParts = [
    camp.artist ?? "—",
    daysTotal > 0 ? `D${daysElapsed}/${daysTotal} · faltam ${daysLeft}d` : null,
    lastUpdateAt ? `atualizado ${timeAgo(lastUpdateAt)}` : null,
  ].filter(Boolean);

  return (
    <div className={cn(
      "sticky top-0 z-40 shrink-0 border-b border-border bg-background px-4 md:px-6",
    )}>
      <div className="py-3 md:py-4 flex flex-row items-center gap-3 md:gap-4">
        {/* Capa pequena (acento) + título/subtítulo no padrão PageHeader */}
        <div className="flex items-center gap-3 min-w-0 flex-1">
          {camp.cover_url ? (
            <img src={camp.cover_url} alt="" className="w-10 h-10 md:w-12 md:h-12 rounded-lg object-cover shadow-sm shrink-0" />
          ) : (
            <div className="w-10 h-10 md:w-12 md:h-12 rounded-lg bg-muted grid place-items-center shrink-0">
              <Music className="h-5 w-5 text-muted-foreground" />
            </div>
          )}

          <div className="min-w-0 flex-1 space-y-0.5">
            <div className="flex items-center gap-2 min-w-0">
              <h1 className="text-[19px] sm:text-2xl lg:text-3xl font-semibold tracking-tight leading-tight truncate min-w-0">
                {camp.track_name}
              </h1>
              <span className={cn(
                "inline-flex items-center px-1.5 h-[18px] rounded text-[10px] font-medium shrink-0",
                STATUS_TONE[statusKey],
              )}>
                {STATUS_LABEL[statusKey] ?? statusKey}
              </span>
            </div>
            <p className="text-[12px] lg:text-sm text-muted-foreground truncate">
              {subtitleParts.join(" · ")}
            </p>
          </div>
        </div>

        {/* Ações — mesma régua do PageHeader (h-9, px-3) */}
        <div
          className={cn(
            "flex items-center justify-end gap-2 shrink-0 min-w-0 max-w-[58%] overflow-x-auto overflow-y-hidden scrollbar-none",
            "lg:max-w-none lg:overflow-visible lg:flex-nowrap",
            "[&_button]:h-9 [&_button]:px-3 [&_button]:text-[13px] sm:[&_button]:px-4 sm:[&_button]:text-sm [&_button]:shrink-0",
          )}
        >
          {mode === "internal" && (
            <>
              <Link to="/campanhas" className="hidden lg:inline-flex">
                <Button variant="ghost" size="sm">
                  <ArrowLeft className="h-4 w-4 mr-1.5" /> Campanhas
                </Button>
              </Link>
              {extraActions}
              {camp.public_plan_token && (
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
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
                      <Button variant="outline" size="sm" className="w-full" onClick={() => openAdminPortal(camp.public_plan_token!)}>
                        <ExternalLink className="h-3.5 w-3.5 mr-1.5" /> Abrir portal
                      </Button>
                    </div>
                  </PopoverContent>
                </Popover>
              )}
              {extraActionsAfter}
            </>
          )}
          {mode === "client" && camp.spotify_track_url && (
            <a href={camp.spotify_track_url} target="_blank" rel="noreferrer" className="shrink-0">
              <Button variant="outline" size="sm">
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
          {deliveryBreakdown && (deliveryBreakdown.curators + deliveryBreakdown.ecosystem + deliveryBreakdown.organic) > 0 && (
            <div className="mt-1.5 flex items-center flex-wrap gap-x-3 gap-y-0.5 text-[10.5px] tabular-nums text-muted-foreground">
              <span>Curadores <span className="text-foreground">{formatInt(deliveryBreakdown.curators)}</span></span>
              <span className="opacity-40">·</span>
              <span>Ecossistema <span className="text-foreground">{formatInt(deliveryBreakdown.ecosystem)}</span></span>
              {deliveryBreakdown.organic > 0 && (
                <>
                  <span className="opacity-40">·</span>
                  <span title="Crescimento em playlists sem dono detectado pelo bot. Não entra no KPI principal.">
                    Orgânico detectado <span className="text-foreground/80">{formatInt(deliveryBreakdown.organic)}</span>
                  </span>
                </>
              )}
            </div>
          )}
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
