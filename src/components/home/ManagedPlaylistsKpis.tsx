import { useQuery } from "@tanstack/react-query";
import { ListMusic, TrendingUp, TrendingDown, AlertCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { KpiBig } from "@/components/KpiBig";
import { formatNumber } from "@/lib/format";
import { useActiveManagedPlaylists } from "@/hooks/useActiveManagedPlaylists";

/**
 * KPIs do catálogo gerenciado.
 * Fase 4B.1: React Query + share active managed_playlists.
 * Lógica preservada 1:1 (filtra brains pelos canonical_playlist_id ativos).
 */
export function ManagedPlaylistsKpis() {
  const { data: activeMp = [] } = useActiveManagedPlaylists();
  const activeCanonicals = activeMp
    .map((r) => r.canonical_playlist_id)
    .filter(Boolean) as string[];
  const total = activeMp.length;

  const { data: k } = useQuery({
    queryKey: ["managed_playlists_kpis", activeCanonicals.length],
    staleTime: 60_000,
    queryFn: async () => {
      const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
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

      return {
        crescendo,
        encolhendo,
        semDiagnostico: staleRes.count ?? 0,
      };
    },
  });

  const loading = !k;

  return (
    <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <KpiBig
        icon={ListMusic}
        label="Minhas playlists"
        value={formatNumber(total)}
        hint="Ativas no catálogo"
        loading={loading}
      />
      <KpiBig
        icon={TrendingDown}
        label="Em queda"
        value={formatNumber(k?.encolhendo ?? 0)}
        tone={(k?.encolhendo ?? 0) > 0 ? "destructive" : "default"}
        hint="Perderam seguidores"
        loading={loading}
      />
      <KpiBig
        icon={TrendingUp}
        label="Crescendo"
        value={formatNumber(k?.crescendo ?? 0)}
        tone="primary"
        hint="Tendência positiva"
        loading={loading}
      />
      <KpiBig
        icon={AlertCircle}
        label="Sem diagnóstico"
        value={formatNumber(k?.semDiagnostico ?? 0)}
        tone={(k?.semDiagnostico ?? 0) > 0 ? "warning" : "default"}
        hint="Cérebro desatualizado 7d+"
        loading={loading}
      />
    </section>
  );
}
