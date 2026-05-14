import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { showPush } from "@/lib/browserPush";

export type NotificationType = "critical" | "warning" | "info";
export type NotificationDomain =
  | "bot"
  | "ocr"
  | "queue"
  | "curator"
  | "system"
  | "financeiro"
  | "security"
  | "ai"
  | "geral";
export type NotificationSeverity = "critical" | "high" | "medium" | "low" | "info";

export interface NotificationMeta {
  domain?: NotificationDomain;
  severity?: NotificationSeverity;
  dedupe_key?: string;
  kind?: string;
  action_required?: boolean;
  silent?: boolean;
  occurrences?: number;
  last_seen_at?: string;
  source?: string;
  [k: string]: unknown;
}

export interface NotificationRow {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  action_url: string | null;
  read: boolean;
  created_at: string;
  metadata?: NotificationMeta | null;
}

const LIMIT = 30;

// Anti-flood de toasts: 60s por dedupe_key
const TOAST_COOLDOWN_MS = 60_000;
const recentToasts = new Map<string, number>();

function shouldToast(n: NotificationRow): boolean {
  // Regras: info nunca vira toast (apenas badge); silent suprime; respeita cooldown por dedupe_key
  if (n.metadata?.silent) return false;
  if (n.type === "info") return false;

  const key = n.metadata?.dedupe_key ?? n.metadata?.kind ?? n.id;
  const last = recentToasts.get(key);
  const now = Date.now();
  if (last && now - last < TOAST_COOLDOWN_MS) return false;
  recentToasts.set(key, now);
  // GC
  if (recentToasts.size > 200) {
    for (const [k, t] of recentToasts) {
      if (now - t > TOAST_COOLDOWN_MS * 5) recentToasts.delete(k);
    }
  }
  return true;
}

export function useNotifications() {
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const initializedRef = useRef(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("notifications")
      .select("id, type, title, message, action_url, read, created_at, metadata")
      .order("created_at", { ascending: false })
      .limit(LIMIT);
    if (!error && data) setItems(data as NotificationRow[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    load();

    const channel = supabase
      .channel("notifications-stream")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications" },
        (payload) => {
          const n = payload.new as NotificationRow;
          setItems((prev) => {
            if (prev.some((p) => p.id === n.id)) return prev;
            return [n, ...prev].slice(0, LIMIT);
          });
          if (shouldToast(n)) {
            const opts = { description: n.message } as const;
            if (n.type === "critical") toast.error(n.title, { ...opts, duration: 10_000 });
            else if (n.type === "warning") toast.warning(n.title, { ...opts, duration: 6_000 });
            // Browser push nativo: dispara só se aba estiver oculta (a função decide).
            if (n.type === "critical" || n.type === "warning") {
              showPush({
                title: n.title,
                body: n.message,
                tag: n.metadata?.dedupe_key ?? n.metadata?.kind ?? n.id,
                url: n.action_url ?? undefined,
              });
            }
          }
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "notifications" },
        (payload) => {
          const n = payload.new as NotificationRow;
          setItems((prev) => prev.map((p) => (p.id === n.id ? { ...p, ...n } : p)));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [load]);

  const unreadCount = items.filter((i) => !i.read).length;

  const markRead = useCallback(async (id: string) => {
    setItems((prev) => prev.map((p) => (p.id === id ? { ...p, read: true } : p)));
    await supabase.from("notifications").update({ read: true }).eq("id", id);
  }, []);

  const markAllRead = useCallback(async () => {
    const unreadIds = items.filter((i) => !i.read).map((i) => i.id);
    if (unreadIds.length === 0) return;
    setItems((prev) => prev.map((p) => ({ ...p, read: true })));
    await supabase.from("notifications").update({ read: true }).in("id", unreadIds);
  }, [items]);

  return { items, loading, unreadCount, markRead, markAllRead, refresh: load };
}
