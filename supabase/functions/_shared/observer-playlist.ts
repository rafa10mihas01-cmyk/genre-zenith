// _shared/observer-playlist.ts
// =====================================================================
// Cliente HTTP único para o Observer (VPS).
//
// Fase 17-C: toda leitura de playlist pública de terceiros nas Edge
// Functions DEVE passar por aqui. Substitui chamadas diretas a
// https://api.spotify.com/v1/playlists/... que antes iam via Gateway CC
// ou OAuth do dono.
//
// Contrato implementado pela VPS: docs/ops/phase-17c-observer-http-contract.md
// Secrets requeridos: OBSERVER_BASE_URL, OBSERVER_TOKEN
//
// Shape de retorno espelha a Spotify Web API + bloco extra `observer`
// (captured_at, source). Workers que já parseavam Web API continuam
// funcionando sem mudar lógica.
// =====================================================================

export class ObserverNotConfiguredError extends Error {
  constructor() {
    super("OBSERVER_BASE_URL / OBSERVER_TOKEN não configurados. Migração Fase 17-C bloqueada até a VPS expor o endpoint.");
    this.name = "ObserverNotConfiguredError";
  }
}

export class ObserverApiError extends Error {
  status: number;
  body: string;
  retryAfter: number | null;
  constructor(status: number, body: string, retryAfter: number | null) {
    super(`Observer ${status}: ${body.slice(0, 400)}`);
    this.name = "ObserverApiError";
    this.status = status;
    this.body = body;
    this.retryAfter = retryAfter;
  }
}

type ObserverMeta = {
  captured_at: string;
  source: "cache" | "fresh_scrape";
  ttl_seconds?: number;
};

export type ObserverPlaylist = {
  id: string;
  name: string;
  description: string | null;
  snapshot_id: string | null;
  owner: { id: string; display_name: string | null; type: string };
  followers: { total: number };
  images: Array<{ url: string; width?: number; height?: number }>;
  public: boolean | null;
  collaborative: boolean;
  tracks: { total: number };
  observer: ObserverMeta;
};

export type ObserverTrackItem = {
  added_at: string | null;
  added_by: { id?: string } | null;
  is_local: boolean;
  position: number;
  track: {
    id: string;
    uri: string;
    name: string;
    duration_ms: number;
    artists: Array<{ id: string; name: string }>;
    album: { id: string; name: string; images: Array<{ url: string }> };
  } | null;
};

export type ObserverItemsPage = {
  href: string;
  limit: number;
  offset: number;
  total: number;
  next: string | null;
  previous: string | null;
  items: ObserverTrackItem[];
  observer: ObserverMeta;
};

type FreshnessOpts = { fresh?: boolean; maxAgeSeconds?: number };

function getConfig() {
  const baseUrlRaw = Deno.env.get("OBSERVER_BASE_URL");
  const tokenRaw = Deno.env.get("OBSERVER_TOKEN");
  if (!baseUrlRaw || !tokenRaw) throw new ObserverNotConfiguredError();
  // trim invisíveis (newline/CR/espaço) que quebram fetch com "not a valid ByteString"
  const baseUrl = baseUrlRaw.trim().replace(/\/+$/, "");
  const token = tokenRaw.replace(/[^\x21-\x7e]/g, "");
  return { baseUrl, token };
}

function buildUrl(path: string, params: Record<string, string | number | undefined> = {}) {
  const { baseUrl } = getConfig();
  const url = new URL(`${baseUrl}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }
  return url.toString();
}

async function observerFetch<T>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
  const { token } = getConfig();
  const url = buildUrl(path, params);
  const r = await fetch(url, {
    method: "GET",
    headers: { "X-Observer-Token": token, "Accept": "application/json" },
  });
  if (!r.ok) {
    const body = await r.text();
    const ra = Number(r.headers.get("Retry-After") ?? "");
    const retryAfter = Number.isFinite(ra) && ra > 0 ? ra : null;
    throw new ObserverApiError(r.status, body, retryAfter);
  }
  const text = await r.text();
  if (!text) return {} as T;
  return JSON.parse(text) as T;
}

function freshnessParams(opts: FreshnessOpts = {}) {
  return {
    fresh: opts.fresh ? "1" : undefined,
    max_age: opts.maxAgeSeconds,
  };
}

/** Indica se o Observer está configurado neste ambiente. Use para gating
 *  durante a migração (worker decide se chama Observer ou cai no caminho antigo). */
export function isObserverConfigured(): boolean {
  return !!Deno.env.get("OBSERVER_BASE_URL") && !!Deno.env.get("OBSERVER_TOKEN");
}

/** GET /playlists/:id — metadados (owner, followers, name, images, snapshot_id). */
export async function observerGetPlaylist(id: string, opts: FreshnessOpts = {}): Promise<ObserverPlaylist> {
  return observerFetch<ObserverPlaylist>(`/playlists/${encodeURIComponent(id)}`, freshnessParams(opts));
}

/** GET /playlists/:id/items — uma página de tracks. */
export async function observerListPlaylistItems(
  id: string,
  opts: FreshnessOpts & { offset?: number; limit?: number } = {},
): Promise<ObserverItemsPage> {
  return observerFetch<ObserverItemsPage>(`/playlists/${encodeURIComponent(id)}/items`, {
    offset: opts.offset ?? 0,
    limit: Math.min(opts.limit ?? 100, 100),
    ...freshnessParams(opts),
  });
}

/** Pagina todas as tracks da playlist (até `maxItems`, default 10k). */
export async function observerListAllPlaylistItems(
  id: string,
  opts: FreshnessOpts & { maxItems?: number } = {},
): Promise<ObserverTrackItem[]> {
  const max = opts.maxItems ?? 10_000;
  const out: ObserverTrackItem[] = [];
  let offset = 0;
  while (out.length < max) {
    const page = await observerListPlaylistItems(id, { offset, limit: 100, fresh: opts.fresh, maxAgeSeconds: opts.maxAgeSeconds });
    out.push(...page.items);
    if (!page.next || page.items.length === 0 || out.length >= page.total) break;
    offset += page.items.length;
  }
  return out.slice(0, max);
}

/** GET /playlists/:id/followers — atalho sem baixar tracks. */
export async function observerGetFollowers(id: string, opts: FreshnessOpts = {}): Promise<number> {
  const r = await observerFetch<{ followers: { total: number } }>(
    `/playlists/${encodeURIComponent(id)}/followers`,
    freshnessParams(opts),
  );
  return r.followers?.total ?? 0;
}

/** GET /playlists/:id/owner. */
export async function observerGetOwner(
  id: string,
  opts: FreshnessOpts = {},
): Promise<{ id: string; display_name: string | null; type: string }> {
  const r = await observerFetch<{ owner: { id: string; display_name: string | null; type: string } }>(
    `/playlists/${encodeURIComponent(id)}/owner`,
    freshnessParams(opts),
  );
  return r.owner;
}

/** GET /health — usar em diagnose/ops. */
export async function observerHealth(): Promise<{ ok: boolean; version?: string; uptime_seconds?: number; queue_depth?: number }> {
  return observerFetch(`/health`);
}
