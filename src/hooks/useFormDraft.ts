import { useEffect, useRef, useState } from "react";

/**
 * Persiste um rascunho de formulário em localStorage com debounce.
 *
 * Como usar:
 * ```ts
 * const { hasDraft, restoreDraft, clearDraft, lastSavedAt } = useFormDraft(
 *   "new-deal",                          // chave única do form
 *   { open, isEditMode },                // só salva quando essas condições baterem
 *   () => ({ name, email, songs }),      // snapshot dos campos
 *   { name: setName, email: setEmail, songs: setSongs }, // setters pra restaurar
 * );
 * ```
 *
 * Comportamento:
 * - Salva automaticamente (debounce 500ms) sempre que o snapshot mudar.
 * - Ao abrir o form, se houver rascunho compatível, oferece restaurar.
 * - `clearDraft()` deve ser chamado após salvar/submeter com sucesso.
 */

const DRAFT_PREFIX = "nexengine:draft:";
const DRAFT_VERSION = 1;
const SAVE_DEBOUNCE_MS = 500;
// Rascunhos com mais de 7 dias são descartados automaticamente
const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type DraftEnvelope<T> = {
  v: number;
  savedAt: number;
  data: T;
};

function safeGetItem(key: string): string | null {
  try {
    return typeof window !== "undefined" ? window.localStorage.getItem(key) : null;
  } catch {
    return null;
  }
}
function safeSetItem(key: string, value: string) {
  try {
    if (typeof window !== "undefined") window.localStorage.setItem(key, value);
  } catch {
    // ignore quota / private mode
  }
}
function safeRemoveItem(key: string) {
  try {
    if (typeof window !== "undefined") window.localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

export interface UseFormDraftOptions {
  /** Quando false, o autosave fica suspenso (ex: dialog fechado, modo edição). */
  enabled: boolean;
  /** Considera rascunho "vazio" — não salva e não oferece restaurar. */
  isEmpty?: boolean;
  /** Tempo (ms) sem mudanças antes de gravar. Default 500. */
  debounceMs?: number;
}

export interface UseFormDraftResult<T> {
  /** Existe rascunho persistido compatível e ainda não restaurado/descartado. */
  hasDraft: boolean;
  /** Aplica o rascunho aos campos (chama os setters). */
  restoreDraft: () => T | null;
  /** Apaga o rascunho (chamar após submit OK ou ao descartar). */
  clearDraft: () => void;
  /** Timestamp do último autosave. */
  lastSavedAt: number | null;
}

export function useFormDraft<T extends Record<string, unknown>>(
  key: string,
  options: UseFormDraftOptions,
  snapshot: T,
): UseFormDraftResult<T> {
  const fullKey = `${DRAFT_PREFIX}${key}`;
  const debounceMs = options.debounceMs ?? SAVE_DEBOUNCE_MS;

  const [hasDraft, setHasDraft] = useState<boolean>(() => {
    const raw = safeGetItem(fullKey);
    if (!raw) return false;
    try {
      const parsed = JSON.parse(raw) as DraftEnvelope<T>;
      if (parsed.v !== DRAFT_VERSION) return false;
      if (Date.now() - parsed.savedAt > DRAFT_TTL_MS) {
        safeRemoveItem(fullKey);
        return false;
      }
      return true;
    } catch {
      return false;
    }
  });

  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSerializedRef = useRef<string>("");

  // Autosave com debounce
  useEffect(() => {
    if (!options.enabled) return;
    if (options.isEmpty) {
      // Form vazio: limpa rascunho residual
      if (lastSerializedRef.current !== "") {
        safeRemoveItem(fullKey);
        lastSerializedRef.current = "";
        setHasDraft(false);
      }
      return;
    }

    const serialized = JSON.stringify(snapshot);
    if (serialized === lastSerializedRef.current) return;

    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      const envelope: DraftEnvelope<T> = {
        v: DRAFT_VERSION,
        savedAt: Date.now(),
        data: snapshot,
      };
      safeSetItem(fullKey, JSON.stringify(envelope));
      lastSerializedRef.current = serialized;
      setLastSavedAt(envelope.savedAt);
      setHasDraft(true);
    }, debounceMs);

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [snapshot, options.enabled, options.isEmpty, fullKey, debounceMs]);

  const restoreDraft = (): T | null => {
    const raw = safeGetItem(fullKey);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as DraftEnvelope<T>;
      if (parsed.v !== DRAFT_VERSION) return null;
      return parsed.data;
    } catch {
      return null;
    }
  };

  const clearDraft = () => {
    safeRemoveItem(fullKey);
    lastSerializedRef.current = "";
    setHasDraft(false);
    setLastSavedAt(null);
  };

  return { hasDraft, restoreDraft, clearDraft, lastSavedAt };
}
