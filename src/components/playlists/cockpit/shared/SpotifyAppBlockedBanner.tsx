// Banner vermelho exibido no topo do cockpit quando a playlist está
// vinculada a um app Spotify atualmente bloqueado pelo circuit breaker.
// Fase 8.9 — visibilidade operacional, somente leitura.
import { Link } from "react-router-dom";
import { ShieldAlert, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSpotifyAppForPlaylist } from "@/hooks/useSpotifyAppsStatus";

function fmtUtc(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" })} ${d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" })} UTC`;
}

export function SpotifyAppBlockedBanner({ managedId }: { managedId: string }) {
  const { data } = useSpotifyAppForPlaylist(managedId);
  if (!data || data.level !== "blocked") return null;

  return (
    <div className="rounded-2xl border border-destructive/40 bg-destructive/10 text-foreground p-4 md:p-5 flex flex-col md:flex-row gap-3 md:items-center">
      <div className="flex items-start gap-3 flex-1 min-w-0">
        <div className="h-9 w-9 rounded-full bg-destructive/20 grid place-items-center shrink-0">
          <ShieldAlert className="h-4 w-4 text-destructive" />
        </div>
        <div className="min-w-0 space-y-1.5">
          <h3 className="text-sm font-semibold leading-tight">Spotify temporariamente indisponível</h3>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Esta playlist está vinculada ao app{" "}
            <span className="font-medium text-foreground">{data.app_name}</span>.{" "}
            O Spotify bloqueou temporariamente este app após excesso de requisições.
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground pt-1">
            <span>
              Desbloqueio previsto:{" "}
              <span className="font-medium text-foreground tabular-nums">{fmtUtc(data.blocked_until)}</span>
            </span>
            <span>
              Playlists afetadas:{" "}
              <span className="font-medium text-foreground tabular-nums">{data.playlists_count}</span>
            </span>
          </div>
          <ul className="text-[11px] text-muted-foreground pt-1.5 space-y-0.5">
            <li>• Rodar análise ficará indisponível</li>
            <li>• Sincronizações não serão executadas</li>
            <li>• Alterações manuais continuam funcionando</li>
          </ul>
        </div>
      </div>
      <Button asChild size="sm" variant="outline" className="border-destructive/40 text-foreground shrink-0">
        <Link to="/sistema?tab=saude#spotify-apps">
          Ver status dos apps Spotify
          <ExternalLink className="h-3.5 w-3.5 ml-1.5" />
        </Link>
      </Button>
    </div>
  );
}
