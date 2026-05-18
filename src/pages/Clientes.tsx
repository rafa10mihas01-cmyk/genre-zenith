import { useMemo } from "react";
import { RefreshCw, Plus, Users, Activity, Music2, Handshake } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageContainer } from "@/components/PageContainer";
import { PageHeader } from "@/components/PageHeader";
import { KpiBig } from "@/components/KpiBig";
import { ClientesLibraryTab } from "@/components/playlist-deals/ClientesLibraryTab";
import { useCuratorDeals } from "@/hooks/useCuratorDeals";
import { useClients } from "@/hooks/useClients";

function formatNumber(n: number) {
  return n.toLocaleString("pt-BR");
}

export default function Clientes() {
  const { deals, songs, loading, reload } = useCuratorDeals();
  const { clients } = useClients();

  const kpis = useMemo(() => {
    const ativos = clients.filter((c) => !c.archived_at);
    const clientIds = new Set(ativos.map((c) => c.id));
    const clientSongs = songs.filter((s) => s.client_id && clientIds.has(s.client_id));
    const clientDealIds = new Set(clientSongs.map((s) => s.deal_id));
    const dealsAtivos = deals.filter((d) => clientDealIds.has(d.id) && !d.closed_at).length;
    return {
      total: ativos.length,
      dealsAtivos,
      musicas: clientSongs.length,
      deals: clientDealIds.size,
    };
  }, [clients, songs, deals]);

  const openNewClient = () => {
    window.dispatchEvent(new Event("playlistdeals:new-client"));
  };

  return (
    <>
      <PageHeader
        title="Clientes"
        subtitle="Gerenciar artistas e labels contratantes"
        domain="clients"
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

      {/* KPIs — padrão Comunidade/Operação */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiBig
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
          icon={Handshake}
          label="Deals totais"
          value={formatNumber(kpis.deals)}
          hint="Histórico completo"
          domain="deals"
          loading={loading}
        />
      </section>

        <ClientesLibraryTab deals={deals} songs={songs} loading={loading} />
      </PageContainer>
    </>
  );
}
