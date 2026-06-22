import { useEffect, useMemo, useState } from "react";
import { RefreshCw, Plus, Users, Activity, Music2, Handshake } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageContainer } from "@/components/PageContainer";
import { PageHeader } from "@/components/PageHeader";
import { KpiBig } from "@/components/KpiBig";
import { ClientesLibraryTab, type ClientCampaignsMap, type ClientCampaignRow } from "@/components/playlist-deals/ClientesLibraryTab";
import { useCuratorDeals } from "@/hooks/useCuratorDeals";
import { useClients } from "@/hooks/useClients";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

function formatNumber(n: number) {
  return n.toLocaleString("pt-BR");
}

const CLOSED_STATUSES = new Set(["completed", "cancelled", "canceled", "archived", "closed"]);
const isCampaignClosed = (c: ClientCampaignRow) =>
  !!c.closed_at || CLOSED_STATUSES.has((c.status ?? "").toLowerCase());

export default function Clientes() {
  const { user } = useAuth();
  const { deals, songs, loading, reload } = useCuratorDeals();
  const { clients } = useClients();
  const [campaignsByClient, setCampaignsByClient] = useState<ClientCampaignsMap>(new Map());

  // Busca TODAS as campanhas vinculadas a clientes (1:N) para consolidar contadores.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("campaigns")
        .select("id, client_id, status, closed_at, created_at, updated_at, track_name, deal_id")
        .not("client_id", "is", null);
      if (cancelled || error || !data) return;
      const m: ClientCampaignsMap = new Map();
      for (const c of data as ClientCampaignRow[]) {
        if (!c.client_id) continue;
        const arr = m.get(c.client_id) ?? [];
        arr.push(c);
        m.set(c.client_id, arr);
      }
      setCampaignsByClient(m);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, deals.length, songs.length]);

  const kpis = useMemo(() => {
    const ativos = clients.filter((c) => !c.archived_at);
    const clientIds = new Set(ativos.map((c) => c.id));
    let activeCampaigns = 0;
    let totalCampaigns = 0;
    let musicas = 0;
    for (const cid of clientIds) {
      const cs = campaignsByClient.get(cid) ?? [];
      totalCampaigns += cs.length;
      activeCampaigns += cs.filter((c) => !isCampaignClosed(c)).length;
      musicas += cs.length; // cada campanha = 1 faixa promovida
    }
    return {
      total: ativos.length,
      dealsAtivos: activeCampaigns,
      musicas,
      deals: totalCampaigns,
    };
  }, [clients, campaignsByClient]);

  const openNewClient = () => {
    window.dispatchEvent(new Event("playlistdeals:new-client"));
  };

  return (
    <>
      <PageHeader
        title="Clientes"
        subtitle="Artistas e labels"
        domain="clients"
        manualKey="clientes"

        actions={
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              className="h-9 gap-1.5 rounded-full"
              onClick={openNewClient}
            >
              <Plus className="h-4 w-4" /> Novo cliente
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="rounded-full h-9 w-9"
              onClick={reload}
              disabled={loading}
              aria-label="Recarregar"
              title="Recarregar"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </Button>
          </div>
        }
      />

      <PageContainer>

      {/* KPIs — hierarquia cockpit: hero (Clientes) + secundários + quiet (histórico) */}
      <KpiCompactStrip
        loading={loading}
        rows={[{
          items: [
            { label: "Clientes", value: formatNumber(kpis.total) },
            { label: "Deals ativos", value: formatNumber(kpis.dealsAtivos) },
            { label: "Músicas", value: formatNumber(kpis.musicas) },
            { label: "Deals totais", value: formatNumber(kpis.deals) },
          ],
        }]}
      />
      <section className="hidden lg:grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiBig
          tier="hero"
          icon={Users}
          label="Clientes"
          value={formatNumber(kpis.total)}
          hint="Total ativo na biblioteca"
          domain="clients"
          loading={loading}
        />
        <KpiBig
          icon={Activity}
          label="Deals ativos"
          value={formatNumber(kpis.dealsAtivos)}
          hint="Campanhas em andamento"
          domain="campaigns"
          loading={loading}
        />
        <KpiBig
          icon={Music2}
          label="Músicas"
          value={formatNumber(kpis.musicas)}
          hint="Faixas vinculadas a clientes"
          domain="playlists"
          loading={loading}
        />
        <KpiBig
          tier="quiet"
          icon={Handshake}
          label="Deals totais"
          value={formatNumber(kpis.deals)}
          hint="Histórico completo"
          domain="deals"
          loading={loading}
        />
      </section>


        <ClientesLibraryTab deals={deals} songs={songs} loading={loading} campaignsByClient={campaignsByClient} />
      </PageContainer>
    </>
  );
}

