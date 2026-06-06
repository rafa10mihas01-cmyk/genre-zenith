// TabKpiStrip — grid uniforme de KPIs (Fase 7D / D1).
// Sempre 2 colunas no mobile, 4 no desktop. Gap fixo.
import { ReactNode } from "react";

export function TabKpiStrip({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {children}
    </div>
  );
}
