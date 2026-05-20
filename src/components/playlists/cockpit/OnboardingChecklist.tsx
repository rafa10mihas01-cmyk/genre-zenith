import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check, X, Loader2, RotateCcw, Sparkles } from "lucide-react";
import { usePlaylistOnboarding, useRecheckOnboarding } from "@/hooks/usePlaylistOnboarding";

type Props = { managedId: string };

const LABELS: Record<string, string> = {
  name_ok: "Nome com identidade",
  description_ok: "Descrição editorial",
  min_tracks_ok: "Tamanho mínimo de faixas",
  cover_ok: "Capa definida",
  niche_alignment_ok: "Alinhada ao nicho",
};

const HINTS: Record<string, string> = {
  name_too_short: "Aumente o nome para no mínimo 6 caracteres com palavra-chave do nicho.",
  description_empty_or_short: "Escreva uma descrição editorial (mínimo 30 caracteres).",
  cover_missing: "Defina uma capa antes de vincular a deals.",
};

export function OnboardingChecklist({ managedId }: Props) {
  const { data, isLoading } = usePlaylistOnboarding(managedId);
  const recheck = useRecheckOnboarding();

  if (isLoading || !data) return null;
  // Só renderiza em onboarding — playlists maduras passam direto.
  if (data.lifecycle_stage !== "onboarding") return null;

  const chk = data.onboarding_checklist;
  const blockingIssues = Array.isArray(chk?.blocking_issues) ? chk.blocking_issues : [];

  return (
    <Card className="p-4 border-primary/30 bg-primary/5 space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold">Onboarding da playlist</h3>
            <Badge variant="outline" className="text-[10px] h-5 border-primary/40 text-primary">
              {chk?.ready_for_deals ? `pronto · ${data.onboarding_ready_streak}/3` : "em padronização"}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            Antes de receber deals, a playlist precisa estar no padrão do nicho. Após 3 checagens consecutivas saudáveis ela é promovida automaticamente.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-8 gap-1.5"
          disabled={recheck.isPending}
          onClick={() => recheck.mutate(managedId)}
        >
          {recheck.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
          Reavaliar
        </Button>
      </div>

      {!chk ? (
        <p className="text-xs text-muted-foreground">Sem checagem ainda — clique em <strong>Reavaliar</strong>.</p>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {(["name_ok", "description_ok", "min_tracks_ok", "cover_ok", "niche_alignment_ok"] as const).map((k) => {
              const ok = chk[k];
              return (
                <div key={k} className="flex items-center gap-2 text-xs">
                  {ok ? (
                    <Check className="h-3.5 w-3.5 text-primary shrink-0" />
                  ) : (
                    <X className="h-3.5 w-3.5 text-destructive shrink-0" />
                  )}
                  <span className={ok ? "text-foreground" : "text-muted-foreground"}>{LABELS[k]}</span>
                </div>
              );
            })}
          </div>

          {blockingIssues.length > 0 && (
            <div className="border-t border-border/60 pt-2 space-y-1">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                Para liberar deals
              </div>
              <ul className="text-xs text-muted-foreground space-y-0.5 list-disc list-inside">
                {blockingIssues.map((b) => (
                  <li key={b}>{HINTS[b] ?? b}</li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
