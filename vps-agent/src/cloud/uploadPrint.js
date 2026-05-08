// Upload de screenshot para o bucket bot-prints (privado, signed URL longa).
import { sb } from "./supabaseClient.js";
import { makeLogger } from "../logger.js";

const log = makeLogger("upload");
const BUCKET = "bot-prints";
const SIGNED_URL_TTL = 60 * 60 * 24 * 365; // 1 ano

/** Faz upload e retorna { path, signed_url }. */
export async function uploadScreenshot(buffer, path) {
  const { error: upErr } = await sb.storage.from(BUCKET).upload(path, buffer, {
    contentType: "image/png",
    upsert: true,
    cacheControl: "31536000",
  });
  if (upErr) {
    log.error("upload falhou", { path, error: upErr.message });
    throw new Error(`upload bot-prints falhou: ${upErr.message}`);
  }
  const { data, error: signErr } = await sb.storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_TTL);
  if (signErr) {
    log.warn("signed URL falhou", { path, error: signErr.message });
    return { path, signed_url: null };
  }
  return { path, signed_url: data.signedUrl };
}
