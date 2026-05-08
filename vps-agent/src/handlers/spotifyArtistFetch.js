import { makeLogger } from "../logger.js";
const log = makeLogger("h:artist.fetch");

/**
 * Job: spotify.artist.fetch
 * Payload: { artist_id }
 *
 * NOTA: este handler é o ponto de integração real com a coleta atual do
 * spotify-artists-bot. Hoje ele apenas valida payload e retorna metadata —
 * para acoplar a coleta verdadeira, importe o módulo de scraping/Playwright
 * existente do bot e chame-o aqui dentro do try.
 */
export async function spotifyArtistFetch(job) {
  const { artist_id } = job.payload || {};
  if (!artist_id) {
    const err = new Error("payload.artist_id obrigatório");
    err.fatal = true;
    throw err;
  }
  log.info("processando artist.fetch", { artist_id, attempts: job.attempts });

  // TODO: chamar módulo real de coleta. Até lá, devolvemos eco controlado para
  // permitir validar end-to-end fila→worker→complete sem mock fake de dados.
  return {
    artist_id,
    processed_at: new Date().toISOString(),
    handler: "spotify.artist.fetch",
  };
}
