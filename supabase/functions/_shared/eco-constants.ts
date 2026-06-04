// Piso mínimo de saves pra uma playlist entrar no planner de campanha.
// Justificativa (medida no inventário real do ecossistema):
//   - Playlists < 250 saves carregam < 0.7% da capacidade total.
//   - Em pos #3 (médio), 250 saves ≈ 20 plays/dia → primeiro patamar útil.
//   - Abaixo disso a contribuição vira ruído estatístico e polui o plano.
// Painel "Capacidade" em /sistema continua mostrando o catálogo inteiro;
// só o PLANNER ignora playlists abaixo deste piso.
export const MIN_PLAYLIST_SAVES_FOR_CAMPAIGN = 250;

// Fator de compensação da curva de entrega.
// A simulação dia-a-dia (rampa de entrada ECO_RAMP + tail de saída com
// rebaixamento de posição) consome ~12% do total teórico. Pra GARANTIR a
// entrega da meta contratada, o planner mira capacidade teórica = meta × este
// fator. Assim, depois da curva, a entrega real bate na meta.
//
// Empírico: 1 / (1 - 0.12) ≈ 1.136 → arredondamos pra 1.15 (3% de margem).
export const ECO_CURVE_LOSS_COMPENSATION = 1.15;

// Piso de entrega POR PLAYLIST POR DIA ATIVO.
// Toda playlist que participa de uma campanha deve entregar ≥ este número
// em todo dia ativo (incluindo rampa de entrada e tail de saída).
// Aplicação:
//  - SELEÇÃO: playlists cuja capacidade @ pos #1 < piso são EXPULSAS.
//  - PROMOÇÃO: playlists cuja cap @ posição planejada < piso são promovidas
//    automaticamente pra posição mais profunda que ainda atende o piso.
//  - CURVA: todo dia ativo é elevado pra max(daily_calculado, piso). O excesso
//    é compensado retirando dos dias mais fortes DA MESMA PLAYLIST, preservando
//    total_streams = planned_streams. Meta total da campanha intacta.
export const MIN_PLAYLIST_DAILY_STREAMS = 500;

/**
 * Posição MAIS PROFUNDA (número mais alto) cuja capacidade ainda é ≥ floor.
 * Retorna null se nem na posição #1 a playlist atende o piso (deve ser expulsa).
 * Fórmula: cap = followers × (mult/30) × POSITION_PCT[pos].
 */
export function deepestPositionMeetingFloor(
  followers: number,
  mult: number,
  positionPct: number[],
  floor: number = MIN_PLAYLIST_DAILY_STREAMS,
): number | null {
  if (followers <= 0) return null;
  const traffic = followers * (Math.max(1, mult) / 30);
  let deepest: number | null = null;
  for (let i = 0; i < positionPct.length; i++) {
    const cap = traffic * positionPct[i];
    if (cap >= floor) deepest = i + 1;
  }
  return deepest;
}

/**
 * Aplica o piso à curva diária de UMA playlist, preservando o total exato.
 * 1) Eleva todo dia ativo (>0) pra max(d, floor).
 * 2) Calcula excesso = soma_pos_floor - soma_original.
 * 3) Retira excesso dos dias mais fortes (acima do floor), proporcional ao
 *    quanto excedem. Repete até zerar o excesso ou esgotar margem.
 * Se planned_streams < floor × active_days, o piso "ganha" e total sobe
 * (caso raro — caller deve evitar via promoção/expulsão prévia).
 */
export function applyPlaylistDailyFloor(
  daily: number[],
  floor: number = MIN_PLAYLIST_DAILY_STREAMS,
): number[] {
  if (!daily.length) return daily;
  const originalTotal = daily.reduce((s, v) => s + v, 0);
  const out = daily.slice();
  // Passo 1: piso nos dias ativos.
  for (let i = 0; i < out.length; i++) {
    if (out[i] > 0 && out[i] < floor) out[i] = floor;
  }
  // Passo 2: compensar retirando dos dias acima do floor.
  let excess = out.reduce((s, v) => s + v, 0) - originalTotal;
  if (excess <= 0) return out;
  let guard = out.length * 100;
  while (excess > 0 && guard-- > 0) {
    // Capacidade total acima do floor neste passo.
    let headroom = 0;
    for (const v of out) if (v > floor) headroom += v - floor;
    if (headroom <= 0) break;
    let removed = 0;
    for (let i = 0; i < out.length; i++) {
      if (out[i] <= floor) continue;
      const share = (out[i] - floor) / headroom;
      const take = Math.min(out[i] - floor, Math.max(1, Math.round(excess * share)));
      out[i] -= take;
      removed += take;
      if (removed >= excess) break;
    }
    if (removed === 0) break;
    excess -= removed;
  }
  return out;
}
