import { makeLogger } from "../logger.js";
const log = makeLogger("h:deal.collect");

/**
 * Job: spotify.deal.collect
 * Payload: { deal_id, song_id? }
 *
 * Substitui o ciclo monolítico de coleta de prints por uma execução por deal.
 * Acople aqui a função que hoje vive no spotify-artists-bot (ex.: collectDeal()).
 */
export async function spotifyDealCollect(job) {
  const { deal_id, song_id } = job.payload || {};
  if (!deal_id) {
    const err = new Error("payload.deal_id obrigatório");
    err.fatal = true;
    throw err;
  }
  log.info("processando deal.collect", { deal_id, song_id, attempts: job.attempts });

  // TODO: importar collectDeal(deal_id, song_id) do módulo do bot e executar.
  return {
    deal_id,
    song_id: song_id ?? null,
    processed_at: new Date().toISOString(),
    handler: "spotify.deal.collect",
  };
}
