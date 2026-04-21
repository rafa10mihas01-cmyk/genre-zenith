import ModulePlaceholder from "./ModulePlaceholder";
import { Sparkles } from "lucide-react";

export default function Criacao() {
  return (
    <ModulePlaceholder
      title="Criação"
      subtitle="Gerar capas, nomes e descrições de playlists a partir dos briefings produzidos pelo Cérebro."
      icon={Sparkles}
      phase="Fase 2"
    />
  );
}
