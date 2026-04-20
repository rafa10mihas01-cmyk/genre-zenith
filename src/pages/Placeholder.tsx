import { Construction } from "lucide-react";

export default function Placeholder({ title, subtitle, phase }: { title: string; subtitle?: string; phase?: string }) {
  return (
    <div className="max-w-[1400px] mx-auto">
      <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
      {subtitle && <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>}
      <div className="nx-card p-12 mt-6 text-center">
        <div className="h-12 w-12 rounded-lg bg-warning/15 border border-warning/30 mx-auto flex items-center justify-center">
          <Construction className="h-6 w-6 text-warning" />
        </div>
        <h2 className="mt-4 font-semibold">Em construção</h2>
        <p className="text-sm text-muted-foreground mt-1.5">
          Este módulo será entregue em <strong className="text-foreground">{phase ?? "uma próxima fase"}</strong>.
        </p>
      </div>
    </div>
  );
}
