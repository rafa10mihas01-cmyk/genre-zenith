// TrackActionsPanel — usado SÓ em CampanhaExecucao, depois do plano aprovado.
// Para cada managed_playlist do plano, compara a posição atual da música
// (managed_playlist_tracks) com a posição-alvo planejada e mostra a ação:
//   - "Promover de #X → #Y" (já está, mas abaixo do alvo)
//   - "Adicionar (alvo #Y)" (não está)
//   - "Manter (#X)" (já está em posição igual ou melhor que o alvo)
// O botão "Executar" dispara diagnose-managed-playlist para a playlist.
import { useMemo, useState } from "react";
import { Loader2, ArrowUp, Plus, CheckCircle2, Play, Music } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useTrackPresence } from "@/hooks/useTrackPresence";
import { cn } from "@/lib/utils";
import { getErrorMessage } from "@/lib/errors";

type Alloc = {
  id: string;
  managed_playlist_id: string;
  planned_streams: number;
  managed_playlists?: { name?: string | null; followers?: number | null } | null;
};

type Props = {
  spotifyTrackId: string | null | undefined;
  allocations: Alloc[];
  /** Posição-alvo por allocation.id (vinda do plano: ecoPositionByAllocation). */
  targetPositionsByAllocId: Map<string, number>;
  className?: string;
};

type ActionKind = "promote" | "add" | "keep";

type ActionRow = {
  allocation_id: string;
  playlist_id: string;
  playlist_name: string;
  current_position: number | null;
  target_position: number;
  kind: ActionKind;
  label: string;
};

const KIND_META: Record<ActionKind, { icon: typeof ArrowUp; chipClass: string; short: string }> = {
  promote: {
    icon: ArrowUp,
    chipClass: "text-amber-500 bg-amber-500/10 border-amber-500/30",
    short: "Promover",
  },
  add: {
    icon: Plus,
    chipClass: "text-primary bg-primary/10 border-primary/30",
    short: "Adicionar",
  },
  keep: {
    icon: CheckCircle2,
    chipClass: "text-muted-foreground bg-elevated border-border",
    short: "Manter",
  },
};

export function TrackActionsPanel({
  spotifyTrackId,
  allocations,
  targetPositionsByAllocId,
  className,
}: Props) {
  const { rows: presenceRows, loading, error } = useTrackPresence(spotifyTrackId);
  const [running, setRunning] = useState<Record<string, boolean>>({});
  const [runningAll, setRunningAll] = useState(false);

  const presenceByPlaylist = useMemo(() => {
    const m = new Map<string, number | null>();
    for (const r of presenceRows) m.set(r.playlist_id, r.position);
    return m;
  }, [presenceRows]);

  const actions = useMemo<ActionRow[]>(() => {
    return allocations.map((a) => {
      const target = targetPositionsByAllocId.get(a.id) ?? 1;
      const current = presenceByPlaylist.get(a.managed_playlist_id) ?? null;
      let kind: ActionKind;
      let label: string;
      if (current == null) {
        kind = "add";
        label = `Adicionar (alvo #${target})`;
      } else if (current > target) {
        kind = "promote";
        label = `Promover de #${current} → #${target}`;
      } else {
        kind = "keep";
        label = `Manter (#${current})`;
      }
      return {
        allocation_id: a.id,
        playlist_id: a.managed_playlist_id,
        playlist_name: a.managed_playlists?.name ?? "Playlist",
        current_position: current,
        target_position: target,
        kind,
        label,
      };
    });
  }, [allocations, targetPositionsByAllocId, presenceByPlaylist]);

  const actionable = actions.filter((a) => a.kind !== "keep");
  const counts = useMemo(() => ({
    promote: actions.filter((a) => a.kind === "promote").length,
    add: actions.filter((a) => a.kind === "add").length,
    keep: actions.filter((a) => a.kind === "keep").length,
  }), [actions]);

  async function runOne(playlist_id: string) {
    setRunning((r) => ({ ...r, [playlist_id]: true }));
    try {
      const { error: fnErr } = await supabase.functions.invoke("analysis-orchestrator", {
        body: { playlist_id, trigger_event: "manual_reanalyze" },
      });
      if (fnErr) throw fnErr;
      toast.success("Diagnóstico enfileirado", { description: "Resultado disponível em Playlists." });
    } catch (e: unknown) {
      toast.error("Falha ao executar", { description: getErrorMessage(e)  });
    } finally {
      setRunning((r) => ({ ...r, [playlist_id]: false }));
    }
  }

  async function runAll() {
    if (actionable.length === 0) return;
    setRunningAll(true);
    let ok = 0;
    let fail = 0;
    for (const a of actionable) {
      try {
        const { error: fnErr } = await supabase.functions.invoke("analysis-orchestrator", {
          body: { playlist_id: a.playlist_id, trigger_event: "manual_reanalyze" },
        });
        if (fnErr) throw fnErr;
        ok++;
      } catch {
        fail++;
      }
    }
    setRunningAll(false);
    if (fail === 0) toast.success(`${ok} playlist${ok === 1 ? "" : "s"} diagnosticada${ok === 1 ? "" : "s"}`);
    else toast.warning(`${ok} ok · ${fail} falharam`);
  }

  if (!spotifyTrackId || allocations.length === 0) return null;

  return (
    <Card className={cn("border-border", className)}>
      <CardContent className="p-0">
        <header className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2 min-w-0">
            <Music className="h-4 w-4 text-muted-foreground shrink-0" />
            <div className="min-w-0">
              <div className="text-sm font-semibold text-foreground">Ações por playlist</div>
              <div className="text-[11px] text-muted-foreground">
                {counts.promote} promover · {counts.add} adicionar · {counts.keep} manter
              </div>
            </div>
          </div>
          <Button
            size="sm"
            variant="solid"
            onClick={runAll}
            disabled={runningAll || actionable.length === 0 || loading}
          >
            {runningAll ? (
              <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
            ) : (
              <Play className="h-4 w-4 mr-1.5" />
            )}
            Executar {actionable.length > 0 ? `(${actionable.length})` : ""}
          </Button>
        </header>

        {loading ? (
          <div className="px-5 py-6 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Verificando posições atuais...
          </div>
        ) : error ? (
          <div className="px-5 py-4 text-xs text-amber-500">
            Não foi possível ler presença atual: {error}
          </div>
        ) : (
          <div className="divide-y divide-border max-h-[600px] overflow-y-auto">
            {actions.map((a) => {
              const meta = KIND_META[a.kind];
              const Icon = meta.icon;
              const isRunning = !!running[a.playlist_id];
              return (
                <div
                  key={a.allocation_id}
                  className="flex items-center gap-3 px-5 py-3 hover:bg-elevated/40 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-foreground truncate">{a.playlist_name}</div>
                    <div className="text-[11px] text-muted-foreground">{a.label}</div>
                  </div>
                  <div
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium shrink-0",
                      meta.chipClass,
                    )}
                  >
                    <Icon className="h-3 w-3" />
                    {meta.short}
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => runOne(a.playlist_id)}
                    disabled={isRunning || a.kind === "keep"}
                    className="shrink-0"
                  >
                    {isRunning ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Play className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
