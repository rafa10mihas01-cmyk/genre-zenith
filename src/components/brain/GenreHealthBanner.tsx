import { AlertTriangle, Clock, XOctagon, HelpCircle } from "lucide-react";
import type { GenreHealth } from "@/hooks/useBrainModel";

type Props = {
  status: GenreHealth | null | undefined;
  lastSeenAt?: string | null;
  hoursSince?: number | null;
};

const VARIANTS: Record<
  Exclude<GenreHealth, "healthy">,
  {
    title: string;
    desc: (lastSeen: string) => string;
    icon: typeof AlertTriangle;
    accent: string; // border + icon color
    bg: string;
  }
> = {
  stale: {
    title: "Dados desatualizados",
    desc: (s) => `Última coleta válida em ${s}. O pipeline está rodando sobre dataset envelhecido.`,
    icon: AlertTriangle,
    accent: "border-amber-500/40 text-amber-400",
    bg: "bg-amber-500/5",
  },
  dead: {
    title: "Gênero parado",
    desc: (s) => `Sem novas playlists há mais de 14 dias (última: ${s}). Autopilot vai abortar até nova coleta.`,
    icon: XOctagon,
    accent: "border-red-500/40 text-red-400",
    bg: "bg-red-500/5",
  },
  unknown: {
    title: "Sem histórico de coleta",
    desc: () => "Este gênero ainda não tem playlists válidas registradas. Rode coleta manual em /sistema.",
    icon: HelpCircle,
    accent: "border-zinc-500/40 text-zinc-400",
    bg: "bg-zinc-500/5",
  },
};

function formatLastSeen(iso: string | null | undefined, hours: number | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const dateStr = date.toISOString().slice(0, 10);
  if (hours == null) return dateStr;
  if (hours < 48) return `${dateStr} (${Math.round(hours)}h atrás)`;
  const days = Math.round(hours / 24);
  return `${dateStr} (${days}d atrás)`;
}

export function GenreHealthBanner({ status, lastSeenAt, hoursSince }: Props) {
  if (!status || status === "healthy") return null;
  const variant = VARIANTS[status];
  if (!variant) return null;
  const Icon = variant.icon;
  const lastSeen = formatLastSeen(lastSeenAt, hoursSince);

  return (
    <div
      role="alert"
      className={`flex items-start gap-3 rounded-2xl border ${variant.accent} ${variant.bg} px-4 py-3`}
    >
      <Icon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold leading-tight text-foreground">{variant.title}</p>
        <p className="mt-1 text-xs text-muted-foreground leading-snug">{variant.desc(lastSeen)}</p>
      </div>
      {hoursSince != null && (
        <div className="flex items-center gap-1 text-[11px] text-muted-foreground/70 shrink-0">
          <Clock className="h-3 w-3" aria-hidden />
          {hoursSince < 48 ? `${Math.round(hoursSince)}h` : `${Math.round(hoursSince / 24)}d`}
        </div>
      )}
    </div>
  );
}
