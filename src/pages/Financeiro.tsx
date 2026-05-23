// Financeiro — uma tela só, organizada em seções:
// 1) Resultado do mês  2) Detalhe por campanha  3) Custos de curadoria  4) Configurações
import { useState } from "react";
import { Wallet, ChevronDown, ChevronRight, Settings as SettingsIcon } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { PageContainer } from "@/components/PageContainer";
import { FinanceiroTab } from "@/components/playlist-deals/FinanceiroTab";
import { FinancialOverview } from "@/components/financeiro/FinancialOverview";
import { PricingSettingsPanel } from "@/components/financeiro/PricingSettingsPanel";
import { useCuratorDeals } from "@/hooks/useCuratorDeals";

function SectionHeader({ kicker, title, hint }: { kicker: string; title: string; hint?: string }) {
  return (
    <header className="space-y-1">
      <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground font-semibold">
        {kicker}
      </div>
      <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
    </header>
  );
}

export default function Financeiro() {
  const { deals } = useCuratorDeals();
  const [pricingOpen, setPricingOpen] = useState(false);

  return (
    <>
      <PageHeader
        kicker="Operação"
        icon={Wallet}
        title="Financeiro"
        subtitle="Receita, custo e margem em um só lugar"
        domain="deals"
        manualKey="financeiro"
      />
      <PageContainer>
        <div className="space-y-10">
          {/* ===== 1. RESULTADO DO MÊS + ALERTAS + RECEITA POR CAMPANHA ===== */}
          <section className="space-y-4">
            <SectionHeader
              kicker="§ 1"
              title="Resultado financeiro"
              hint="Quanto entrou, quanto saiu e quanto sobrou por campanha"
            />
            <FinancialOverview />
          </section>

          {/* ===== 2. CUSTOS DE CURADORIA ===== */}
          <section className="space-y-4">
            <SectionHeader
              kicker="§ 2"
              title="Custos de curadoria"
              hint="Para onde tá indo o dinheiro pago a curadores — eficiência (CPP), pódio e histórico"
            />
            <FinanceiroTab deals={deals} hideHero />
          </section>

          {/* ===== 3. CONFIGURAÇÕES (colapsável) ===== */}
          <section className="space-y-4">
            <button
              type="button"
              onClick={() => setPricingOpen((v) => !v)}
              className="w-full flex items-center justify-between gap-3 rounded-2xl border border-border bg-card hover:bg-elevated/40 transition-colors px-5 py-4 text-left"
            >
              <div className="flex items-center gap-3">
                <span className="h-8 w-8 rounded-md bg-elevated/60 flex items-center justify-center text-muted-foreground">
                  <SettingsIcon className="h-4 w-4" />
                </span>
                <div>
                  <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground font-semibold">
                    § 3
                  </div>
                  <div className="text-base font-semibold text-foreground">
                    Configurações de pricing
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    Custos operacionais, valor de mercado e preço de venda — vale só pra campanhas novas
                  </div>
                </div>
              </div>
              {pricingOpen ? (
                <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
              ) : (
                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
              )}
            </button>
            {pricingOpen && <PricingSettingsPanel />}
          </section>
        </div>
      </PageContainer>
    </>
  );
}
