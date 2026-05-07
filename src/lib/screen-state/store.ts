// Store global de estado por tela. Híbrido memória + sessionStorage.
// - Cada screenId guarda um objeto { state, scrollY, updatedAt, ttlMs }.
// - Expirado por TTL é purgado automaticamente.
// - Persistência em sessionStorage (chave única por aba).

const STORAGE_KEY = "nx:screen-state:v1";

export type ScreenEntry = {
  state: Record<string, unknown>;
  scrollY: number;
  updatedAt: number;
  ttlMs: number;
};

type Listener = (entry: ScreenEntry | undefined) => void;

const memory = new Map<string, ScreenEntry>();
const listeners = new Map<string, Set<Listener>>();
let hydrated = false;
let writeRaf = 0;

function hydrate() {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw) as Record<string, ScreenEntry>;
    const now = Date.now();
    for (const [id, entry] of Object.entries(data)) {
      if (entry.ttlMs === 0) continue;
      if (now - entry.updatedAt > entry.ttlMs) continue;
      memory.set(id, entry);
    }
  } catch {
    /* ignore */
  }
}

function flush() {
  if (writeRaf) return;
  writeRaf = requestAnimationFrame(() => {
    writeRaf = 0;
    try {
      const obj: Record<string, ScreenEntry> = {};
      memory.forEach((v, k) => {
        obj[k] = v;
      });
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
    } catch {
      /* quota / privado: ignora */
    }
  });
}

function notify(id: string) {
  const set = listeners.get(id);
  if (!set) return;
  const entry = memory.get(id);
  set.forEach((cb) => cb(entry));
}

export function getScreenEntry(id: string): ScreenEntry | undefined {
  hydrate();
  const e = memory.get(id);
  if (!e) return undefined;
  if (e.ttlMs > 0 && Date.now() - e.updatedAt > e.ttlMs) {
    memory.delete(id);
    flush();
    return undefined;
  }
  return e;
}

export function setScreenField(id: string, field: string, value: unknown, ttlMs: number) {
  hydrate();
  const cur = memory.get(id) ?? { state: {}, scrollY: 0, updatedAt: Date.now(), ttlMs };
  cur.state = { ...cur.state, [field]: value };
  cur.updatedAt = Date.now();
  cur.ttlMs = ttlMs;
  memory.set(id, cur);
  flush();
  notify(id);
}

export function setScreenScroll(id: string, y: number, ttlMs: number) {
  hydrate();
  const cur = memory.get(id) ?? { state: {}, scrollY: 0, updatedAt: Date.now(), ttlMs };
  cur.scrollY = y;
  cur.updatedAt = Date.now();
  cur.ttlMs = ttlMs;
  memory.set(id, cur);
  flush();
}

export function resetScreenState(id: string) {
  if (memory.delete(id)) {
    flush();
    notify(id);
  }
}

export function purgeExpired() {
  hydrate();
  const now = Date.now();
  let changed = false;
  memory.forEach((v, k) => {
    if (v.ttlMs > 0 && now - v.updatedAt > v.ttlMs) {
      memory.delete(k);
      changed = true;
    }
  });
  if (changed) flush();
}

export function subscribeScreen(id: string, cb: Listener): () => void {
  let set = listeners.get(id);
  if (!set) {
    set = new Set();
    listeners.set(id, set);
  }
  set.add(cb);
  return () => {
    set!.delete(cb);
    if (set!.size === 0) listeners.delete(id);
  };
}
