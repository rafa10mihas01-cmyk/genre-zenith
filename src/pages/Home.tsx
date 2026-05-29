import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { PageContainer } from "@/components/PageContainer";
import { useSetSidebarKpis } from "@/contexts/SidebarContext";
import { ActionNowHero } from "@/components/home/ActionNowHero";
import { CuradoriaBlock } from "@/components/home/CuradoriaBlock";
import { CatalogHealthCard } from "@/components/home/CatalogHealthCard";
import { AlertsBlock } from "@/components/home/AlertsBlock";
import { OperationalAlertsCard } from "@/components/home/OperationalAlertsCard";

/**
 * HOJE — Cockpit. 4 blocos: Ação agora · Curadoria · Catálogo · Alertas.
 * Saúde do sistema, motor editorial e atividade recente vivem em /sistema.
 */
export default function Home() {
  const [kpis, setKpis] = useState<{ playlists: number; deals: number; notif: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [mp, deals, notif] = await Promise.all([
        supabase.from("managed_playlists").select("id", { count: "exact", head: true }).is("archived_at", null),
        supabase.from("curator_deals").select("id", { count: "exact", head: true }).is("closed_at", null),
        supabase.from("notifications").select("id", { count: "exact", head: true }).eq("read", false),
      ]);
      if (!cancelled) {
        setKpis({
          playlists: mp.count ?? 0,
          deals: deals.count ?? 0,
          notif: notif.count ?? 0,
        });
      }
    }
    load();
    const i = setInterval(load, 60000);
    return () => { cancelled = true; clearInterval(i); };
  }, []);

  useSetSidebarKpis(
    kpis
      ? [
          { label: "Playlists", value: kpis.playlists, intent: "default" },
          { label: "Deals ativos", value: kpis.deals, intent: "default" },
          { label: "Notificações", value: kpis.notif, intent: kpis.notif > 0 ? "warning" : "default" },
        ]
      : [],
  );

  return (
    <>
      <PageHeader title="Hoje" subtitle="Cockpit" manualKey="cockpit" />
      <PageContainer className="space-y-4 lg:space-y-6">
        {/* 1 — AÇÃO AGORA (hero) */}
        <ActionNowHero />

        {/* 2 — CURADORIA — bloco já traz seu próprio título internamente */}
        <CuradoriaBlock />

        {/* 3 — CATÁLOGO — label de seção só no desktop; mobile usa o kicker do próprio card */}
        <section className="space-y-3">
          <h2 className="hidden lg:block text-[10px] uppercase tracking-[0.15em] text-muted-foreground font-semibold px-1">
            Catálogo
          </h2>
          <CatalogHealthCard />
        </section>

        {/* 4 — ALERTAS — idem catálogo */}
        <section className="space-y-3">
          <h2 className="hidden lg:block text-[10px] uppercase tracking-[0.15em] text-muted-foreground font-semibold px-1">
            Alertas
          </h2>
          <OperationalAlertsCard />
          <AlertsBlock />
        </section>
      </PageContainer>
    </>
  );
}
