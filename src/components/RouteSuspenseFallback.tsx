// Fallback de Suspense interno — renderizado DENTRO do AppLayout.
//
// IMPORTANTE: retorna `null` de propósito. Antes, mostrava uma barrinha
// animada que piscava em TODA troca de rota (mesmo com chunk já em cache),
// causando o "flicker horrível" na transição entre telas. Com `null`, o
// React mantém o conteúdo anterior em tela até o novo chunk resolver —
// transição limpa, sem flash. A TopProgressBar global já cobre o feedback
// de loading em carregamentos realmente longos.
export function RouteSuspenseFallback() {
  return null;
}
