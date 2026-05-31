// Piso mínimo de saves pra uma playlist entrar no planner de campanha.
// Justificativa (medida no inventário real do ecossistema):
//   - Playlists < 250 saves carregam < 0.7% da capacidade total.
//   - Em pos #3 (médio), 250 saves ≈ 20 plays/dia → primeiro patamar útil.
//   - Abaixo disso a contribuição vira ruído estatístico e polui o plano.
// Painel "Capacidade" em /sistema continua mostrando o catálogo inteiro;
// só o PLANNER ignora playlists abaixo deste piso.
export const MIN_PLAYLIST_SAVES_FOR_CAMPAIGN = 250;
