import { Activity, TrendingUp, Gauge, Sparkles } from "lucide-react";
import { KpiBig } from "@/components/KpiBig";
import type { DatasetRow } from "./types";

export function PerformanceKpis({ dataset }: { dataset: DatasetRow[] }) {
  const total = dataset.length;
  const totalGrowth = dataset.reduce((s, r) => s + (r.crescimento_absoluto || 0), 0);

  // velocidade média (seguidores por dia) — só conta playlists com idade > 0
  const withSpeed = dataset.filter(r => (r.tempo_horas ?? 0) > 0);
  const avgSpeed = withSpeed.length
    ? withSpeed.reduce((s, r) => s + ((r.crescimento_absoluto || 0) / ((r.tempo_horas || 1) / 24)), 0) / withSpeed.length
    : 0;

  // taxa de playlists crescendo
  const growing = dataset.filter(r => (r.crescimento_absoluto || 0) > 0).length;
  const growthRate = total > 0 ? (growing / total) * 100 : 0;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      <KpiBig
        label="Playlists publicadas"
        value={total}
        icon={Activity}
        hint={total > 0 ? `${growing} crescendo` : "Nenhuma publicada ainda"}
      />
      <KpiBig
        label="Seguidores ganhos"
        value={totalGrowth.toLocaleString("pt-BR")}
        icon={TrendingUp}
        tone={totalGrowth > 0 ? "success" : "default"}
        hint="Soma de todas as playlists"
      />
      <KpiBig
        label="Velocidade média"
        value={`${avgSpeed.toFixed(1)}/dia`}
        icon={Gauge}
        tone="primary"
        hint="Seguidores por dia (média)"
      />
      <KpiBig
        label="Taxa de sucesso"
        value={`${growthRate.toFixed(0)}%`}
        icon={Sparkles}
        tone={growthRate >= 60 ? "success" : growthRate >= 30 ? "warning" : "destructive"}
        hint="Playlists com crescimento positivo"
      />
    </div>
  );
}
