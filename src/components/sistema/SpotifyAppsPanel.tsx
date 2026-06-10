// Painel operacional: estado dos apps Spotify (Fase 8.9 — visibilidade).
// Mostra status agregado por app: nível, playlists vinculadas, circuit breaker.
import { ShieldAlert, ShieldCheck, ShieldQuestion, RefreshCw, Loader2, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useSpotifyAppsStatus, type AppLevel, type SpotifyAppStatusRow } from "@/hooks/useSpotifyAppsStatus";
import { cn } from "@/lib/utils";


const LEVEL_META: Record<AppLevel, { label: string; icon: typeof ShieldAlert; cls: string; dot: string; helper: string }> = {
  blocked:   { label: "Aguardando liberação", icon: ShieldAlert,    cls: "text-destructive border-destructive/40 bg-destructive/10", dot: "bg-destructive", helper: "Spotify bloqueou temporariamente. Liberação automática." },
  attention: { label: "Em observação",        icon: ShieldQuestion, cls: "text-warning border-warning/40 bg-warning/10",             dot: "bg-warning",     helper: "Algumas falhas recentes — monitorando." },
  healthy:   { label: "Tudo certo",           icon: ShieldCheck,    cls: "text-primary border-primary/30 bg-primary/5",              dot: "bg-primary",     helper: "Operando normalmente." },
};

function LevelBadge({ level }: { level: AppLevel }) {
  const m = LEVEL_META[level];
  const Icon = m.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 px-2 h-6 rounded-full border text-[11px] font-medium", m.cls)}>
      <Icon className="h-3 w-3" />
      {m.label}
    </span>
  );
}

function fmtLocal(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function Row({ row }: { row: SpotifyAppStatusRow }) {
  const m = LEVEL_META[row.level];
  return (
    <div className="grid grid-cols-[1fr_auto_auto_auto] gap-3 items-center px-4 py-3 border-b border-border last:border-0 hover:bg-elevated/40">
      <div className="min-w-0 flex items-center gap-2.5">
        <span className={cn("h-2 w-2 rounded-full shrink-0", m.dot)} />
        <div className="min-w-0">
          <div className="text-sm font-medium truncate">{row.app_name}</div>
          <div className="text-[11px] text-muted-foreground">
            {m.helper}
          </div>
        </div>
      </div>
      <LevelBadge level={row.level} />
      <div className="text-right text-xs tabular-nums">
        <div className="text-foreground font-semibold">{row.playlists_count}</div>
        <div className="text-[10px] text-muted-foreground">playlists</div>
      </div>
      <div className="text-right text-xs tabular-nums min-w-[140px]">
        {row.blocked_until ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="text-destructive font-medium cursor-help">
                Liberação {fmtLocal(row.blocked_until)}
              </div>
            </TooltipTrigger>
            <TooltipContent side="left" className="text-xs max-w-[260px]">
              <div>Spotify bloqueou novas chamadas temporariamente para proteger a conta.</div>
              <div className="text-muted-foreground mt-1">A liberação acontece automaticamente.</div>
            </TooltipContent>
          </Tooltip>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </div>
    </div>
  );
}

export function SpotifyAppsPanel() {
  const { data, isLoading, refetch, isFetching } = useSpotifyAppsStatus();
  const rows = data ?? [];
  const blocked = rows.filter((r) => r.level === "blocked").length;
  const attention = rows.filter((r) => r.level === "attention").length;

  return (
    <TooltipProvider delayDuration={150}>
      <Card id="spotify-apps" className="overflow-hidden scroll-mt-20">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">Apps Spotify</h3>
            {blocked > 0 && (
              <Badge variant="outline" className="border-destructive/40 text-destructive text-[10px]">
                {blocked} aguardando liberação
              </Badge>
            )}
            {attention > 0 && (
              <Badge variant="outline" className="border-warning/40 text-warning text-[10px]">
                {attention} em observação
              </Badge>
            )}
          </div>
          <Button variant="ghost" size="sm" onClick={() => refetch()} disabled={isFetching}>
            {isFetching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          </Button>
        </div>

        <div className="grid grid-cols-[1fr_auto_auto_auto] gap-3 items-center px-4 py-2 border-b border-border bg-elevated/40 text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
          <div>App</div>
          <div>Estado</div>
          <div className="text-right">Playlists</div>
          <div className="text-right min-w-[140px]">Próxima liberação</div>
        </div>

        {isLoading ? (
          <div className="p-8 grid place-items-center">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <div className="p-8 text-center text-xs text-muted-foreground">
            Nenhum app em produção encontrado.
          </div>
        ) : (
          rows.map((r) => <Row key={r.app_id} row={r} />)
        )}
      </Card>
    </TooltipProvider>
  );
}
