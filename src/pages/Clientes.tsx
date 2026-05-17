import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageContainer } from "@/components/PageContainer";
import { PageHeader } from "@/components/PageHeader";
import { ClientesLibraryTab } from "@/components/playlist-deals/ClientesLibraryTab";
import { useCuratorDeals } from "@/hooks/useCuratorDeals";

export default function Clientes() {
  const { deals, songs, loading, reload } = useCuratorDeals();

  return (
    <PageContainer>
      <PageHeader
        title="Clientes"
        subtitle="Gerenciar artistas e labels contratantes"
        actions={
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
        }
      />

      <section className="space-y-6">
        <ClientesLibraryTab deals={deals} songs={songs} loading={loading} />
      </section>
    </PageContainer>
  );
}
