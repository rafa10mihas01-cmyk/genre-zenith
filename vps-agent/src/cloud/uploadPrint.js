// Upload de screenshot via worker-bridge (HTTP autenticado por x-agent-token).
import { bridge } from "./bridge.js";
import { makeLogger } from "../logger.js";

const log = makeLogger("upload");

/** Faz upload e retorna { path, signed_url }. */
export async function uploadScreenshot(buffer, path) {
  try {
    return await bridge.uploadPrint(path, buffer);
  } catch (e) {
    log.error("upload falhou", { path, error: String(e?.message || e) });
    throw new Error(`upload bot-prints falhou: ${e?.message || e}`);
  }
}
