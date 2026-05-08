// Registro de handlers por job_type.
// Lance Error para retry; err.fatal=true força dead-letter.
import { spotifyArtistFetch } from "./spotifyArtistFetch.js";
import { spotifyDealCollect } from "./spotifyDealCollect.js";
import { spotifyPrintBatch }  from "./spotifyPrintBatch.js";

export const handlers = {
  "spotify.artist.fetch": spotifyArtistFetch,
  "spotify.deal.collect": spotifyDealCollect,
  "spotify.print_batch": spotifyPrintBatch,
};

export const supportedJobTypes = Object.keys(handlers);
