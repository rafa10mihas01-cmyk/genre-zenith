// Helper canônico para % de entrega de campanha.
// Fonte única — não recriar Math.round((delivered/goal)*100) em componentes.
// Garante clamp em [0, 100] e tratamento de divisão por zero.

export function deliveryPct(delivered: number | null | undefined, goal: number | null | undefined): number {
  const d = Number(delivered ?? 0);
  const g = Number(goal ?? 0);
  if (g <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((d / g) * 100)));
}
