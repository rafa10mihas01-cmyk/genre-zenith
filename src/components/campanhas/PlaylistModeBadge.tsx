// PlaylistModeBadge — mostra o modo de execução (API_READY / MANUAL_ONLY / DISABLED)
// de uma playlist. Informação primária pro operador entender em <3s se a inserção
// é automática (bot) ou manual.
import { Bot, Hand, Ban } from "lucide-react";
import { cn } from "@/lib/utils";

export type PlaylistExecutionMode = "API_READY" | "MANUAL_ONLY" | "DISABLED" | null | undefined;

type Props = {
  mode: PlaylistExecutionMode;
  size?: "sm" | "md";
  className?: string;
};

const TOOLTIP: Record<string, string> = {
  API_READY:
    "O bot tem acesso OAuth a esta playlist e fará a inserção/reorder automaticamente dentro da janela 08h–22h.",
  MANUAL_ONLY:
    "Esta playlist não possui acesso OAuth. A inserção da música será realizada manualmente pelo operador.",
  DISABLED:
    "Playlist desabilitada — owner removido, token inválido ou desativada manualmente. Não será incluída na distribuição.",
};

export function PlaylistModeBadge({ mode, size = "md", className }: Props) {
  const m = mode ?? "DISABLED";
  const cfg: Record<string, { label: string; icon: typeof Bot; cls: string }> = {
    API_READY: {
      label: "Execução automática",
      icon: Bot,
      cls: "bg-primary/15 text-primary border-primary/30",
    },
    MANUAL_ONLY: {
      label: "Execução manual",
      icon: Hand,
      cls: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    },
    DISABLED: {
      label: "Desabilitada",
      icon: Ban,
      cls: "bg-muted text-muted-foreground border-border",
    },
  };
  const c = cfg[m] ?? cfg.DISABLED;
  const Icon = c.icon;
  const sizeCls =
    size === "sm"
      ? "px-1.5 py-0.5 text-[10px] gap-1"
      : "px-2 py-0.5 text-[11px] gap-1.5";
  const iconSize = size === "sm" ? "h-2.5 w-2.5" : "h-3 w-3";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded border font-medium uppercase tracking-wider",
        sizeCls,
        c.cls,
        className,
      )}
      title={TOOLTIP[m]}
    >
      <Icon className={iconSize} />
      {c.label}
    </span>
  );
}
