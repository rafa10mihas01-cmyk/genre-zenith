// Mini JWT (HS256) pro portal do curador.
// Mesmo padrão de campaign-access-jwt: assina com PORTAL_JWT_SECRET (dedicado),
// com fallback temporário pro service role key durante a transição.
const SECRET = Deno.env.get("PORTAL_JWT_SECRET") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function b64urlEncode(bytes: Uint8Array): string {
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlEncodeStr(s: string): string {
  return b64urlEncode(new TextEncoder().encode(s));
}
function b64urlDecodeStr(s: string): string {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return atob(s);
}

async function hmacKey() {
  return await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export interface CuratorAccessPayload {
  deal_id: string;
  email: string;
  token: string;
  iat: number;
  exp: number;
}

export async function signCuratorAccessJwt(
  payload: Omit<CuratorAccessPayload, "iat" | "exp">,
  ttlSeconds = 86400,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const full: CuratorAccessPayload = { ...payload, iat: now, exp: now + ttlSeconds };
  const header = b64urlEncodeStr(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64urlEncodeStr(JSON.stringify(full));
  const data = `${header}.${body}`;
  const key = await hmacKey();
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data)));
  return `${data}.${b64urlEncode(sig)}`;
}

export async function verifyCuratorAccessJwt(token: string): Promise<CuratorAccessPayload | null> {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [h, b, s] = parts;
    const key = await hmacKey();
    const sigStr = b64urlDecodeStr(s);
    const sigBytes = Uint8Array.from(sigStr, c => c.charCodeAt(0));
    const ok = await crypto.subtle.verify(
      "HMAC",
      key,
      sigBytes,
      new TextEncoder().encode(`${h}.${b}`),
    );
    if (!ok) return null;
    const payload = JSON.parse(b64urlDecodeStr(b)) as CuratorAccessPayload;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}
