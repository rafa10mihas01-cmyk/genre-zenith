import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type NotificationType = "critical" | "warning" | "info";

export interface NotificationRow {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  action_url: string | null;
  read: boolean;
  created_at: string;
}

const LIMIT = 10;

/**
 * Hook global de notificações.
 * - Carrega últimas 10
 * - Subscribe realtime para novas → toast + atualiza lista
 * - Expõe ações: markRead, markAllRead
 */
export function useNotifications() {
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const initializedRef = useRef(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("notifications")
      .select("id, type, title, message, action_url, read, created_at")
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
          // Toast em tempo real
          const opts = { description: n.message } as const;
          if (n.type === "critical") toast.error(n.title, opts);
          else if (n.type === "warning") toast.warning(n.title, opts);
          else toast.success(n.title, opts);
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
