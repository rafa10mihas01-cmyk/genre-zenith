import { useMemo } from "react";
import { RefreshCw, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageContainer } from "@/components/PageContainer";
import { PageHeader } from "@/components/PageHeader";
import { ClientesLibraryTab } from "@/components/playlist-deals/ClientesLibraryTab";
import { useCuratorDeals } from "@/hooks/useCuratorDeals";
import { useClients } from "@/hooks/useClients";
import { cn } from "@/lib/utils";

function MiniStat({ label, value, tone }: { label: string; value: string | number; tone?: "primary" | "warning" }) {
  return (
    <div className="nx-card !p-3">
      <div className="text-[10.5px] uppercase tracking-[0.12em] text-muted-foreground">{label}</div>
      <div className={cn(
        "text-xl font-bold tabular-nums mt-0.5",
        tone === "primary" && "text-primary",
        tone === "warning" && "text-warning",
      )}>
        {typeof value === "number" ? value.toLocaleString("pt-BR") : value}
      </div>
    </div>
  );
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
    <PageContainer>
      <PageHeader
        title="Clientes"
        subtitle="Gerenciar artistas e labels contratantes"
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

      <section className="space-y-4">
        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <MiniStat label="Clientes" value={kpis.total} />
          <MiniStat label="Deals ativos" value={kpis.dealsAtivos} tone="primary" />
          <MiniStat label="Músicas" value={kpis.musicas} />
          <MiniStat label="Deals totais" value={kpis.deals} />
        </div>

        <ClientesLibraryTab deals={deals} songs={songs} loading={loading} />
      </section>
    </PageContainer>
  );
}
