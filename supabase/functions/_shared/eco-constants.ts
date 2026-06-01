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
