import { Check, Lock, Rocket, Loader2, CheckCircle2, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type GateState = "done" | "current" | "locked";

type GateProps = {
  index: number;
  title: string;
  hint: string;
  state: GateState;
  meta?: string | null;
};

function GateNode({ index, title, hint, state, meta }: GateProps) {
  return (
    <div className="flex items-start gap-3 min-w-0 flex-1">
      <div
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-sm font-semibold",
          state === "done" && "bg-primary/15 border-primary/40 text-primary",
          state === "current" && "bg-primary text-primary-foreground border-primary",
          state === "locked" && "bg-muted/40 border-border text-muted-foreground",
        )}
      >
        {state === "done" ? <Check className="h-4 w-4" /> : state === "locked" ? <Lock className="h-3.5 w-3.5" /> : index}
      </div>
      <div className="min-w-0">
        <div className="text-sm font-medium text-foreground truncate">{title}</div>
        <div className="text-xs text-muted-foreground truncate">{meta ?? hint}</div>
      </div>
    </div>
  );
}

function Connector({ filled }: { filled: boolean }) {
  return (
    <div className="hidden md:block flex-1 mx-2">
      <div className={cn("h-px w-full", filled ? "bg-primary/50" : "bg-border")} />
    </div>
  );
}

export type CampaignGatesCardProps = {
  clientApprovedAt: string | null;
  planApprovedAt: string | null;
  ecoDispatchedAt: string | null;
  onApprovePlan: () => void;
  onDispatch: () => void;
  approvingPlan: boolean;
  dispatching: boolean;
};

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

export function CampaignGatesCard({
  clientApprovedAt,
  planApprovedAt,
  ecoDispatchedAt,
  onApprovePlan,
  onDispatch,
  approvingPlan,
  dispatching,
}: CampaignGatesCardProps) {
  const clientDone = !!clientApprovedAt;
  const planDone = !!planApprovedAt;
  const dispatchDone = !!ecoDispatchedAt;

  const state1: GateState = clientDone ? "done" : "current";
  const state2: GateState = planDone ? "done" : clientDone ? "current" : "locked";
  const state3: GateState = dispatchDone ? "done" : planDone ? "current" : "locked";

  const nextAction: "plan" | "dispatch" | null = dispatchDone
    ? null
    : planDone
      ? "dispatch"
      : clientDone
        ? "plan"
        : null;

  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div>
          <div className="text-sm font-semibold text-foreground">Portões da campanha</div>
          <div className="text-xs text-muted-foreground">
            {dispatchDone
              ? "Campanha no ar — bot inserindo nas playlists."
              : nextAction === "dispatch"
                ? "Tudo pronto. Falta apenas o gatilho final."
                : nextAction === "plan"
                  ? "Cliente já aprovou. Confirme o plano internamente para liberar a distribuição."
                  : "Aguardando o cliente aprovar o plano público."}
          </div>
        </div>
        {dispatchDone && (
          <div className="hidden sm:flex items-center gap-1.5 text-xs text-primary">
            <CheckCircle2 className="h-3.5 w-3.5" /> Distribuída
          </div>
        )}
      </div>

      <div className="flex flex-col md:flex-row md:items-center gap-4 md:gap-0">
        <GateNode
          index={1}
          state={state1}
          title="Cliente aprovou"
          hint="Aprovação no portal público"
          meta={clientApprovedAt ? `há ${relTime(clientApprovedAt)} — ${fmt(clientApprovedAt)}` : "Aguardando"}
        />
        <Connector filled={clientDone} />
        <GateNode
          index={2}
          state={state2}
          title="Plano interno aprovado"
          hint="Cria o deal e trava o plano"
          meta={planApprovedAt ? `há ${relTime(planApprovedAt)} — ${fmt(planApprovedAt)}` : clientDone ? "Pronto pra você aprovar" : "Bloqueado"}
        />
        <Connector filled={planDone} />
        <GateNode
          index={3}
          state={state3}
          title="Distribuição iniciada"
          hint="Bot começa a inserir nas playlists"
          meta={ecoDispatchedAt ? `há ${relTime(ecoDispatchedAt)} — ${fmt(ecoDispatchedAt)}` : planDone ? "Pronto pra iniciar" : "Bloqueado"}
        />
      </div>

      {nextAction && (
        <div className="mt-5 pt-4 border-t border-border flex items-center justify-between gap-3 flex-wrap">
          <div className="text-xs text-muted-foreground flex items-center gap-1.5 min-w-0">
            <Clock className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">
              {nextAction === "dispatch"
                ? "O bot começa a inserir no próximo ciclo (~1min)."
                : "Aprovar plano cria o deal do curador e libera o passo 3."}
            </span>
          </div>
          {nextAction === "plan" ? (
            <Button
              size="sm"
              onClick={onApprovePlan}
              disabled={approvingPlan}
              className="h-9 gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {approvingPlan ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Aprovar plano interno
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={onDispatch}
              disabled={dispatching}
              className="h-9 gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {dispatching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
              Iniciar distribuição
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60000);
  if (m < 60) return `${m}min`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h`;
  const d = Math.round(h / 24);
  return `${d}d`;
}
