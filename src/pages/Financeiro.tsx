// Financeiro — receita do cliente, custo do curador e margem por campanha,
// além do dashboard de CPP/ranking de curadoria (FinanceiroTab).
import { Wallet } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { PageContainer } from "@/components/PageContainer";
import { FinanceiroTab } from "@/components/playlist-deals/FinanceiroTab";
import { FinancialOverview } from "@/components/financeiro/FinancialOverview";
import { PricingSettingsPanel } from "@/components/financeiro/PricingSettingsPanel";
import { useCuratorDeals } from "@/hooks/useCuratorDeals";

export default function Financeiro() {
  const { deals } = useCuratorDeals();

  return (
    <>
      <PageHeader
        kicker="Operação"
        icon={Wallet}
        title="Financeiro"
        subtitle="Receita do cliente, custo do curador e margem"
        domain="deals"
        manualKey="financeiro"
      />
      <PageContainer>
        <div className="space-y-8">
          <FinancialOverview />
          <PricingSettingsPanel />
          <FinanceiroTab deals={deals} />
        </div>
      </PageContainer>
    </>
  );
}

