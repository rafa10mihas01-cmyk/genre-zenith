// EditorTab — extraído 1:1 do PlaylistCockpit.tsx (Fase 2 / Commit 4).
import { Card } from "@/components/ui/card";
import { PlaylistEditorTab } from "@/components/playlists/PlaylistEditorTab";
import { useCockpit } from "../context/CockpitContext";

export function EditorTab() {
  const { managedId } = useCockpit();
  return (
    <>
      <Card className="p-3 border-warning/30 bg-warning/5">
        <div className="text-xs text-foreground/80">
          Use esta aba para editar as faixas diretamente, sem seguir o Plano.
        </div>
      </Card>
      <PlaylistEditorTab playlistId={managedId} />
    </>
  );
}
