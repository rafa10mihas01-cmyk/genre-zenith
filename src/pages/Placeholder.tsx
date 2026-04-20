import { Construction } from "lucide-react";
import { PageContainer } from "@/components/cc/PageContainer";
import { PageHeader } from "@/components/cc/PageHeader";
import { HeroCard } from "@/components/cc/HeroCard";

export default function Placeholder({ title, subtitle, phase }: { title: string; subtitle?: string; phase?: string }) {
  return (
    <PageContainer size="7xl" className="space-y-6">
      <PageHeader title={title} subtitle={subtitle} />
      <HeroCard className="text-center">
        <div className="py-8 space-y-3">
          <div
            className="mx-auto h-12 w-12 rounded-xl flex items-center justify-center"
            style={{
              background: "linear-gradient(135deg, rgba(245,158,11,0.18), rgba(245,158,11,0.10))",
              border: "1px solid rgba(245,158,11,0.30)",
            }}
          >
            <Construction className="h-6 w-6" style={{ color: "rgb(245,158,11)" }} />
          </div>
          <h2 className="font-display text-lg font-semibold">Em construção</h2>
          <p className="text-sm text-muted-foreground">
            Este módulo será entregue em <strong className="text-foreground">{phase ?? "uma próxima fase"}</strong>.
          </p>
        </div>
      </HeroCard>
    </PageContainer>
  );
}
