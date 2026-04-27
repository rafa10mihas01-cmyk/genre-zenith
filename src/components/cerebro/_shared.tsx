/**
 * Compartilhado entre Cerebro.tsx e seus componentes de aba.
 * Mantido em arquivo isolado para evitar import circular
 * (page importa abas, abas importavam page).
 */

export type GenreOpt = { id: string; slug: string; nome: string };

export function Empty({ msg }: { msg: string }) {
  return <div className="text-xs text-muted-foreground py-8 text-center">{msg}</div>;
}

export function SkeletonGrid() {
  // Reflete o layout real da Visão Geral: 3 KPIs em cima + bloco grande
  // Top playlists ao lado do Resumo do modelo. Sem skeleton "achatado" que
  // depois pula pra o tamanho real (causava sensação de "abre pequeno e expande").
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className="nx-card p-4 h-[92px] animate-pulse" />
      <div className="nx-card p-4 h-[92px] animate-pulse" />
      <div className="nx-card p-4 h-[92px] animate-pulse" />
      <div className="nx-card p-5 lg:col-span-2 h-[440px] animate-pulse" />
      <div className="nx-card p-5 h-[440px] animate-pulse" />
    </div>
  );
}

/** Traduz códigos técnicos de attention_reason em texto humano. */
export function humanizeAttentionReason(reason: string): string {
  if (reason.startsWith("keyword_noise:")) {
    const pct = reason.match(/(\d+\.?\d*)%/)?.[1];
    return `Vocabulário com muito ruído (${pct}% de termos irrelevantes). Pode prejudicar a qualidade dos briefings.`;
  }
  if (reason.includes("low_coverage")) return "Cobertura de seguidores baixa — algumas playlists ainda não foram enriquecidas.";
  if (reason.includes("stale")) return "Dados desatualizados — recomendado rodar nova coleta.";
  return reason;
}
