// /mapa/:token — Mapa de Entrega público (link-only, sem login).
//
// Isolamento explícito:
//   - Esta página NÃO importa nada de `@/components/client-portal/*`
//     (gate de OTP, upload de planilha, prints, aprovações). Importar
//     qualquer um desses arquivos aqui é considerado bug de segurança.
//   - Só consome a edge `get-campaign-roadmap-public`, que devolve um
//     payload já sanitizado (sem cliente, sem financeiro, sem aprovação).
//   - Token vem da URL (roadmap_token), e é completamente diferente do
//     `public_plan_token` usado pelo Portal do Cliente.
//
// Pra revogar um link compartilhado, basta rotacionar `campaigns.roadmap_token`
// via botão "Regerar link" em /campanhas/:id — não impacta o portal protegido.

import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { CampaignFullPlanCard } from "@/components/campanhas/CampaignFullPlanCard";
import type { CampaignSnapshot } from "@/lib/campaignSnapshot";
import { NexEngineLogo } from "@/components/NexEngineLogo";

// Força tema escuro — igual ao portal, sem depender da preferência salva.
function useForceDarkTheme() {
  useEffect(() => {
    const root = document.documentElement;
    const hadLight = root.classList.contains("light");
    const prevColorScheme = root.style.colorScheme;
    root.classList.remove("light");
    root.classList.add("dark");
    root.style.colorScheme = "dark";
    return () => {
      if (hadLight) {
        root.classList.remove("dark");
        root.classList.add("light");
      }
      root.style.colorScheme = prevColorScheme;
    };
  }, []);
}

// Página pública — evitamos indexação por buscadores. Token tem 144 bits de
// entropia, mas indexar seria um vetor desnecessário de exposição.
function useNoIndex() {
  useEffect(() => {
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex, nofollow, noarchive";
    document.head.appendChild(meta);
    return () => { document.head.removeChild(meta); };
  }, []);
}

type Camp = {
  id: string;
  track_name: string;
  artist: string | null;
  cover_url: string | null;
  spotify_track_url: string | null;
  goal_plays: number;
  status: string;
  started_at: string;
  deadline: string | null;
  total_delivered: number | null;
  engagement_multiplier: number | null;
  simulation_snapshot: CampaignSnapshot | null;
};

type Alloc = {
  id: string;
  managed_playlist_id: string;
  planned_streams: number;
  start_day: number | null;
  position: number | null;
  genre_source: string | null;
  genre_affinity_score: number | null;
  managed_playlists: {
    name: string;
    cover_url: string | null;
    followers: number | null;
    spotify_url: string | null;
    genre_id: string | null;
  } | null;
};

type Payload = {
  campaign?: Camp;
  allocations?: Alloc[];
  organic_summary?: { total_plays?: number } | null;
  error?: string;
};

export default function MapaCampanhaPublico() {
  useForceDarkTheme();
  useNoIndex();
  const { token } = useParams<{ token: string }>();
  const [camp, setCamp] = useState<Camp | null>(null);
  const [allocs, setAllocs] = useState<Alloc[]>([]);
  const [radioCollectedTotal, setRadioCollectedTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase.functions.invoke("get-campaign-roadmap-public", {
        body: { roadmap_token: token },
      });
      if (cancelled) return;
      const payload = data as Payload | null;
      if (error || payload?.error) {
        setErr(payload?.error ?? error?.message ?? "erro");
        setCamp(null);
        setAllocs([]);
        setRadioCollectedTotal(null);
      } else {
        setCamp(payload?.campaign ?? null);
        setAllocs(payload?.allocations ?? []);
        const collected = Number(payload?.organic_summary?.total_plays ?? 0);
        setRadioCollectedTotal(collected > 0 ? collected : null);
        setErr(null);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [token]);

  const snapshot = camp?.simulation_snapshot ?? null;

  const radioGoal = useMemo(() => {
    if (!snapshot) return 0;
    const split = (snapshot as { splitOrganicPct?: number }).splitOrganicPct ?? 15;
    return Math.round(snapshot.meta * (split / 100));
  }, [snapshot]);

  if (!token) return null;

  if (loading) {
    return (
      <div className="min-h-screen bg-background p-6 max-w-7xl mx-auto">
        <Skeleton className="h-8 w-64 mb-4" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (err || !camp || !snapshot) {
    const isClosed = err === "campaign_closed";
    const isNotFound = err === "not_found" || err === "invalid_token";
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="text-center space-y-2 max-w-md">
          <NexEngineLogo variant="dark" className="h-7 w-auto mx-auto mb-4" />
          <p className="text-foreground font-medium">
            {isClosed ? "Campanha encerrada" : isNotFound ? "Link inválido" : "Mapa indisponível"}
          </p>
          <p className="text-sm text-muted-foreground">
            {isClosed
              ? "Este link expirou porque a campanha foi finalizada."
              : isNotFound
                ? "Verifique se você copiou o link completo."
                : "Tente abrir novamente em alguns instantes."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto p-4 md:p-6">
        <div className="flex items-center justify-between mb-4 print:hidden">
          <NexEngineLogo variant="dark" className="h-7 w-auto" />
          <span className="text-[11px] text-muted-foreground">
            Mapa de Entrega · somente leitura
          </span>
        </div>
        <CampaignFullPlanCard
          snapshot={snapshot}
          startedAt={camp.started_at}
          allocations={allocs as unknown as Parameters<typeof CampaignFullPlanCard>[0]["allocations"]}
          engagementMultiplier={camp.engagement_multiplier ?? 35}
          shareToken={null}
          showShare={false}
          radioGoal={radioGoal}
          radioCollectedTotal={radioCollectedTotal}
          track={{
            name: camp.track_name,
            artist: camp.artist,
            coverUrl: camp.cover_url,
            spotifyUrl: camp.spotify_track_url ?? null,
          }}
        />
      </div>
    </div>
  );
}
