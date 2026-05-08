/**
 * Registro de handlers por job_type.
 * Cada handler recebe (job, ctx) e retorna um objeto serializável (result).
 * Lance Error para falhas com retry. Use err.fatal = true para marcar dead-letter.
 */
import { spotifyArtistFetch } from "./spotifyArtistFetch.js";
import { spotifyDealCollect } from "./spotifyDealCollect.js";

export const handlers = {
  "spotify.artist.fetch": spotifyArtistFetch,
  "spotify.deal.collect": spotifyDealCollect,
};

export const supportedJobTypes = Object.keys(handlers);
