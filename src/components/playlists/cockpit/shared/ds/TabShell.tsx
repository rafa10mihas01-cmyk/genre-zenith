// TabShell — wrapper padrão de toda aba do Cockpit (Fase 7D / D1).
// Aplica espaçamento vertical fixo de 24px entre slots.
// NÃO contém lógica — apenas estrutura.
import { ReactNode } from "react";

export function TabShell({
  banner,
  kpis,
  primary,
  secondary,
}: {
  banner?: ReactNode;
  kpis?: ReactNode;
  primary: ReactNode;
  secondary?: ReactNode;
}) {
  return (
    <div className="space-y-6">
      {banner && <div>{banner}</div>}
      {kpis && <div>{kpis}</div>}
      <div>{primary}</div>
      {secondary && <div className="space-y-2">{secondary}</div>}
    </div>
  );
}
