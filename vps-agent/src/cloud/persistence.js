// Re-exports finos sobre a bridge HTTP (sem service_role na VPS).
import { bridge } from "./bridge.js";

export const insertBotEvent     = (p) => bridge.insertBotEvent(p);
export const insertDealSnapshot = (p) => bridge.insertDealSnapshot(p);
export const bumpDealSong       = (a) => bridge.bumpDealSong(a);
export const markDealSongError  = (a) => bridge.markDealSongError(a);
export const getDealSong        = (id) => bridge.getDealSong(id);
export const getPrintBatch      = (id) => bridge.getPrintBatch(id);
export const updatePrintBatch   = (id, patch) => bridge.updatePrintBatch(id, patch);
