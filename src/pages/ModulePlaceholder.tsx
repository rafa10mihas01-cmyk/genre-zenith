import { Construction, Sparkles, BarChart3 } from "lucide-react";

/**
 * Placeholder padrão de módulo. Usa o MESMO layout/spacing/cards do resto do sistema.
 * Toda nova página criada DEVE seguir esse padrão visual.
 */
export default function ModulePlaceholder({
  title,
  subtitle,
  icon: Icon = Sparkles,
  phase = "uma próxima fase",
}: {
  title: string;
  subtitle?: string;
  icon?: any;
  phase?: string;
}) {
  return (
    <div className="space-y-6 max-w-[1600px] mx-auto">
      <header className="space-y-1">
        <div className="inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-muted-foreground font-bold">
          <Icon className="h-3 w-3 text-primary" /> Módulo
        </div>
        <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
      </header>

      <div className="nx-card p-12 text-center max-w-2xl mx-auto">
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
