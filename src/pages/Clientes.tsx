import { useEffect, useMemo, useState } from "react";
import { RefreshCw, Plus, Users, Activity, Music2, Handshake } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageContainer } from "@/components/PageContainer";
import { PageHeader } from "@/components/PageHeader";
import { KpiBig } from "@/components/KpiBig";
import { ClientesLibraryTab, type ClientFinanceMap } from "@/components/playlist-deals/ClientesLibraryTab";
import { useCuratorDeals } from "@/hooks/useCuratorDeals";
import { useClients } from "@/hooks/useClients";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

function formatNumber(n: number) {
  return n.toLocaleString("pt-BR");
}

export default function Clientes() {
  const { user } = useAuth();
  const { deals, songs, loading, reload } = useCuratorDeals();
  const { clients } = useClients();
  const [financeByClient, setFinanceByClient] = useState<ClientFinanceMap>(new Map());

  // Busca financeiro agregado por cliente a partir de campaigns
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("campaigns")
        .select("client_id, valor_cobrado, valor_recebido")
        .not("client_id", "is", null);
      if (cancelled || error || !data) return;
      const m: ClientFinanceMap = new Map();
      for (const c of data as Array<{ client_id: string; valor_cobrado: number | null; valor_recebido: number | null }>) {
        const id = c.client_id;
        const prev = m.get(id) ?? { cobrado: 0, recebido: 0, pendente: 0, count: 0 };
        const cobrado = Number(c.valor_cobrado) || 0;
        const recebido = Number(c.valor_recebido) || 0;
        prev.cobrado += cobrado;
        prev.recebido += recebido;
        prev.pendente += Math.max(0, cobrado - recebido);
        prev.count += 1;
        m.set(id, prev);
      }
      setFinanceByClient(m);
    })();
    return () => {
      cancelled = true;
    };
    // intencionalmente reagimos a user.id (resolvido) e ao tamanho de deals/songs; user completo causaria re-fetches espúrios.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, deals.length, songs.length]);

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
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
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


        <ClientesLibraryTab deals={deals} songs={songs} loading={loading} financeByClient={financeByClient} />
      </PageContainer>
    </>
  );
}
