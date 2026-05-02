import { useMemo, useState } from "react";
import { Bell, Trophy, Flame, CheckCircle2, AlertTriangle, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * CuratorNotificationsBell — sino do portal público do curador.
 *
 * Recebe os stats já calculados pela página e deriva 4 notificações:
 *   1. 🏆 Meta total atingida   (earned >= target)         → success
 *   2. 🔥 Quase lá              (pct >= 80% e não bateu)   → primary
 *   3. ✅ Ritmo do dia ok       (todayPlays >= dailyGoal)  → info
 *   4. ⚠️ Atrasado / sem ritmo (isOverdue OU sem progresso 3+ dias) → warning
 *
 * Sem backend, sem persistência: o sino sempre reflete o estado atual.
 */

export type CuratorNotifInput = {
  target: number;
  dailyGoal: number;
  earned: number;
  pct: number;
  todayPlays: number;
  todayPct: number;
  hasBaseline: boolean;
  isOverdue: boolean;
  vel: number | null;
  eta: number | null;
  daysRunning: number;
  lastImportAt: Date | null;
};

type Severity = "success" | "primary" | "info" | "warning";

type Notif = {
  id: string;
  severity: Severity;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
};

function buildNotifications(s: CuratorNotifInput): Notif[] {
  const out: Notif[] = [];

  // Antes do baseline ainda, não tem nada útil pra dizer
  if (!s.hasBaseline) {
    out.push({
      id: "waiting-baseline",
      severity: "info",
      icon: Sparkles,
      title: "Aguardando primeira coleta",
      description:
        "Assim que o primeiro print for processado, suas notificações de meta começam a aparecer aqui.",
    });
    return out;
  }

  const isDone = s.target > 0 && s.earned >= s.target;

  // 1. META TOTAL ATINGIDA
  if (isDone) {
    out.push({
      id: "goal-hit",
      severity: "success",
      icon: Trophy,
      title: "Meta total atingida",
      description: `Você entregou ${s.earned.toLocaleString("pt-BR")} de ${s.target.toLocaleString("pt-BR")} plays. Trabalho concluído.`,
    });
  } else if (s.target > 0 && s.pct >= 80) {
    // 2. QUASE LÁ (>=80% mas não bateu)
    const remaining = Math.max(0, s.target - s.earned);
    out.push({
      id: "almost-there",
      severity: "primary",
      icon: Flame,
      title: `${s.pct}% da meta — falta pouco`,
      description: `Restam ${remaining.toLocaleString("pt-BR")} plays para concluir. Mantenha o ritmo.`,
    });
  }

  // 3. RITMO DO DIA OK
  if (!isDone && s.dailyGoal > 0 && s.todayPlays >= s.dailyGoal) {
    out.push({
      id: "today-ok",
      severity: "info",
      icon: CheckCircle2,
      title: "Meta diária batida hoje",
      description: `${s.todayPlays.toLocaleString("pt-BR")} plays hoje (combinado: ${s.dailyGoal.toLocaleString("pt-BR")}/dia).`,
    });
  }

  // 4. ATRASADO
  // - Overdue do ciclo (passou de seg 17h sem print) OU
  // - Mais de 3 dias sem nenhum import desde o último
  const daysSinceLast = s.lastImportAt
    ? Math.floor((Date.now() - s.lastImportAt.getTime()) / (1000 * 60 * 60 * 24))
    : Infinity;
  const stale = s.lastImportAt !== null && daysSinceLast >= 3;

  if (!isDone && (s.isOverdue || stale)) {
    const reason = s.isOverdue
      ? "O ciclo semanal virou e nenhum print novo foi processado."
      : `Último envio há ${daysSinceLast} dias — atualize com um print recente.`;
    out.push({
      id: "overdue",
      severity: "warning",
      icon: AlertTriangle,
      title: "Atualização pendente",
      description: reason,
    });
  }

  // Fallback positivo se nada disparou — mostra status saudável
  if (out.length === 0) {
    out.push({
      id: "on-track",
      severity: "info",
      icon: Sparkles,
      title: "Tudo no ritmo",
      description:
        s.pct > 0
          ? `${s.pct}% concluído. Continue enviando os prints nos prazos do ciclo.`
          : "Aguardando o próximo print pra atualizar o progresso.",
    });
  }

  return out;
}

const SEVERITY_STYLES: Record<Severity, { dot: string; iconWrap: string; iconColor: string; ring: string }> = {
  success: {
    dot: "bg-success",
    iconWrap: "bg-success/10 border-success/30",
    iconColor: "text-success",
    ring: "ring-success/40",
  },
  primary: {
    dot: "bg-primary",
    iconWrap: "bg-primary/10 border-primary/30",
    iconColor: "text-primary",
    ring: "ring-primary/40",
  },
  info: {
    dot: "bg-blue-400",
    iconWrap: "bg-blue-500/10 border-blue-500/30",
    iconColor: "text-blue-400",
    ring: "ring-blue-500/40",
  },
  warning: {
    dot: "bg-warning",
    iconWrap: "bg-warning/10 border-warning/30",
    iconColor: "text-warning",
    ring: "ring-warning/40",
  },
};

export function CuratorNotificationsBell({ stats }: { stats: CuratorNotifInput }) {
  const [open, setOpen] = useState(false);
  const notifications = useMemo(() => buildNotifications(stats), [stats]);

  // Conta só notificações "acionáveis" (success / primary / warning) no badge
  const actionable = notifications.filter(
    (n) => n.severity === "success" || n.severity === "primary" || n.severity === "warning",
  ).length;
  const hasAlert = notifications.some((n) => n.severity === "warning");

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative h-9 w-9 rounded-md text-muted-foreground hover:text-foreground hover:bg-elevated/60"
          aria-label="Notificações"
        >
          <Bell className="h-[18px] w-[18px]" />
          {actionable > 0 && (
            <span
              className={cn(
                "absolute top-1.5 right-1.5 min-w-[16px] h-[16px] px-1 rounded-full text-[9px] font-bold leading-none flex items-center justify-center text-white",
                hasAlert ? "bg-warning" : "bg-primary",
              )}
            >
              {actionable}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-[340px] p-0 bg-card border-border"
      >
        <div className="px-4 py-3 border-b border-border">
          <h3 className="text-sm font-semibold text-foreground">Acompanhamento</h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Status atual do seu progresso na campanha
          </p>
        </div>

        <ul className="max-h-[420px] overflow-y-auto divide-y divide-border">
          {notifications.map((n) => {
            const Icon = n.icon;
            const styles = SEVERITY_STYLES[n.severity];
            return (
              <li key={n.id} className="px-4 py-3 flex items-start gap-3 hover:bg-elevated/40 transition-colors">
                <div
                  className={cn(
                    "h-9 w-9 rounded-full border flex items-center justify-center shrink-0",
                    styles.iconWrap,
                  )}
                >
                  <Icon className={cn("h-4 w-4", styles.iconColor)} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", styles.dot)} />
                    <p className="text-[13px] font-semibold text-foreground leading-tight">
                      {n.title}
                    </p>
                  </div>
                  <p className="text-[11.5px] text-muted-foreground leading-snug mt-1">
                    {n.description}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>

        <div className="px-4 py-2.5 border-t border-border bg-elevated/30">
          <p className="text-[10px] text-muted-foreground text-center">
            Atualizado em tempo real conforme você envia os prints
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
}
