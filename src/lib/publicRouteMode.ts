const PUBLIC_CURATOR_MODE_KEY = "nexengine_public_curator_mode";
const PUBLIC_CURATOR_PATH_KEY = "nexengine_public_curator_path";

function canUseSessionStorage() {
  return typeof window !== "undefined" && typeof window.sessionStorage !== "undefined";
}

export function markCuratorPublicMode(token?: string | null) {
  if (!canUseSessionStorage()) return;
  window.sessionStorage.setItem(PUBLIC_CURATOR_MODE_KEY, "curator");
  if (token) {
    window.sessionStorage.setItem(PUBLIC_CURATOR_PATH_KEY, `/curador/${encodeURIComponent(token)}`);
  }
}

export function isCuratorPublicMode() {
  if (!canUseSessionStorage()) return false;
  return window.sessionStorage.getItem(PUBLIC_CURATOR_MODE_KEY) === "curator";
}

export function getCuratorPublicPath() {
  if (!canUseSessionStorage()) return "/";
  return window.sessionStorage.getItem(PUBLIC_CURATOR_PATH_KEY) || "/";
}