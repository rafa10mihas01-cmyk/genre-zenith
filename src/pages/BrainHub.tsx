import { PageContainer } from "@/components/cc/PageContainer";
import Brain from "./Brain";

export default function BrainHub() {
  return (
    <PageContainer size="6xl" className="space-y-6">
      <div className="space-y-1">
        <div className="nx-eyebrow"><span className="nx-eyebrow-dot" /> Cérebro</div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Inteligência</h1>
        <p className="text-muted-foreground text-sm">Visão geral dos cérebros ativos por gênero.</p>
      </div>

      <Brain />
    </PageContainer>
  );
}
