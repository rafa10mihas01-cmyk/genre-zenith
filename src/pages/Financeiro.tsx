// Financeiro — página dedicada com o dashboard de custos da curadoria.
// Extraído da aba dentro de /playlist-deals para ganhar destaque no sidebar.
import { Wallet } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { PageContainer } from "@/components/PageContainer";
import { FinanceiroTab } from "@/components/playlist-deals/FinanceiroTab";
import { useCuratorDeals } from "@/hooks/useCuratorDeals";

export default function Financeiro() {
  const { deals } = useCuratorDeals();

  return (
    <>
      <PageHeader
        kicker="Operação"
        icon={Wallet}
        title="Financeiro"
        subtitle="Custos, CPP e ranking de curadores"
        domain="deals"
        manualKey="financeiro"
      />
      <PageContainer>
        <FinanceiroTab deals={deals} />
      </PageContainer>
    </>
  );
}
