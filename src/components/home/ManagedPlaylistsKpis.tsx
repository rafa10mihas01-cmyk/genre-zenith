import { useEffect, useState } from "react";
import { ListMusic, TrendingDown, TrendingUp, AlertCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { KpiBig } from "@/components/KpiBig";
import { formatNumber } from "@/lib/format";

type Kpis = {
  total: number;
  crescendo: number;
  encolhendo: number;
  semDiagnostico: number;
};

/**
 * KPIs do topo do Hoje — focado em managed_playlists (minhas playlists).
 * Substitui os KPIs antigos baseados em playlist_templates.
 */
export function ManagedPlaylistsKpis() {
  const [k, setK] = useState<Kpis | null>(null);

  useEffect(() => {
    (async () => {
      const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();

      // Busca canonical_playlist_id apenas das playlists ATIVAS pra evitar
      // que brains de playlists arquivadas inflem os KPIs de tendência.
      const { data: activeMp, count: totalCount } = await supabase
        .from("managed_playlists")
        .select("canonical_playlist_id", { count: "exact" })
        .is("archived_at", null);

      const activeCanonicals = (activeMp ?? [])
        .map((r: any) => r.canonical_playlist_id)
        .filter(Boolean) as string[];

      const [brainRes, staleRes] = await Promise.all([
        activeCanonicals.length
          ? supabase
              .from("playlist_brain")
              .select("health_trend")
              .in("playlist_id", activeCanonicals)
          : Promise.resolve({ data: [] as Array<{ health_trend: string | null }> }),
        supabase
          .from("managed_playlists")
          .select("id", { count: "exact", head: true })
          .is("archived_at", null)
          .or(`last_diagnosis_at.is.null,last_diagnosis_at.lt.${sevenDaysAgo}`),
      ]);

      const trends = ((brainRes as any).data ?? []) as Array<{ health_trend: string | null }>;
      const crescendo = trends.filter((t) => t.health_trend === "crescendo").length;
      const encolhendo = trends.filter((t) => t.health_trend === "encolhendo").length;

      setK({
        total: totalCount ?? 0,
        crescendo,
        encolhendo,
        semDiagnostico: staleRes.count ?? 0,
      });
    })();
  }, []);

  return (
    <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <KpiBig
        icon={ListMusic}
        label="Minhas playlists"
        value={formatNumber(k?.total ?? 0)}
        hint="Ativas no catálogo"
        loading={!k}
      />
      <KpiBig
        icon={TrendingDown}
        label="Em queda"
        value={formatNumber(k?.encolhendo ?? 0)}
        tone={(k?.encolhendo ?? 0) > 0 ? "destructive" : "default"}
        hint="Perderam seguidores"
        loading={!k}
      />
      <KpiBig
        icon={TrendingUp}
        label="Crescendo"
        value={formatNumber(k?.crescendo ?? 0)}
        tone="primary"
        hint="Tendência positiva"
        loading={!k}
      />
      <KpiBig
        icon={AlertCircle}
        label="Sem diagnóstico"
        value={formatNumber(k?.semDiagnostico ?? 0)}
        tone={(k?.semDiagnostico ?? 0) > 0 ? "warning" : "default"}
        hint="Cérebro desatualizado 7d+"
        loading={!k}
      />
    </section>
  );
}
