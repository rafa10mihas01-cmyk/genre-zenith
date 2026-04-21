import ModulePlaceholder from "./ModulePlaceholder";
import { BarChart3 } from "lucide-react";

export default function Performance() {
  return (
    <ModulePlaceholder
      title="Performance"
      subtitle="Acompanhamento de plays, salvos e crescimento das playlists publicadas."
      icon={BarChart3}
      phase="Fase 3"
    />
  );
}
