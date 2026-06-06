// EditorTab — refatorado Fase 7D / D4.
// Aplica TabShell: Banner (warning) → Primary (editor).
import { AlertTriangle } from "lucide-react";
import { PlaylistEditorTab } from "@/components/playlists/PlaylistEditorTab";
import { TabShell } from "../shared/ds/TabShell";
import { TabContextBanner } from "../shared/ds/TabContextBanner";
import { useCockpit } from "../context/CockpitContext";

export function EditorTab() {
  const { managedId } = useCockpit();
  return (
    <TabShell
      banner={
        <TabContextBanner
          tone="warning"
          title="Editor manual"
          subtitle="Edite as faixas diretamente sem passar pelo Plano. Use apenas para ajustes pontuais."
          status={
            <div className="flex items-center gap-1.5 text-warning">
              <AlertTriangle className="h-3.5 w-3.5" />
              <span className="text-[11px] font-medium uppercase tracking-wider">
                Alterações aqui não passam pelo Brain
              </span>
            </div>
          }
        />
      }
      primary={<PlaylistEditorTab playlistId={managedId} />}
    />
  );
}
