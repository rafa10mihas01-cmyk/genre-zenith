import { Construction, Sparkles } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";

/**
 * Placeholder padrão de módulo. Usa o PageHeader global obrigatório.
 * Toda nova página criada DEVE seguir este padrão visual.
 */
export default function ModulePlaceholder({
  title,
  subtitle,
  icon: Icon = Sparkles,
  phase = "uma próxima fase",
}: {
  title: string;
  subtitle: string;
  icon?: any;
  phase?: string;
}) {
  return (
    <div className="w-full space-y-6">
      <PageHeader
        kicker="Módulo"
        icon={Icon}
        title={title}
        subtitle={subtitle}
      />

      <div className="nx-card p-8 text-center max-w-2xl mx-auto">
        <div className="h-14 w-14 rounded-full bg-elevated border border-border mx-auto flex items-center justify-center">
          <Construction className="h-6 w-6 text-warning" />
        </div>
        <h2 className="mt-4 font-bold text-lg">Em construção</h2>
        <p className="text-sm text-muted-foreground mt-1.5 max-w-md mx-auto leading-relaxed">
          Este módulo será entregue em <strong className="text-foreground">{phase}</strong>.
          Quando disponível, ele seguirá o mesmo padrão visual do Cérebro.
        </p>
      </div>
    </div>
  );
}
