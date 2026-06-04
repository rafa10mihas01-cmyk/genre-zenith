import { useCallback, useEffect } from "react";
import { useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { showPush } from "@/lib/browserPush";
import { passesAlertPrefs } from "@/lib/alertPrefs";
import { useAuth } from "@/contexts/AuthContext";

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
const QUERY_KEY = ["notifications"] as const;

// Anti-flood de toasts: 60s por dedupe_key
const TOAST_COOLDOWN_MS = 60_000;
const recentToasts = new Map<string, number>();

function shouldToast(n: NotificationRow): boolean {
  if (n.metadata?.silent) return false;
  if (!passesAlertPrefs(n.type, n.metadata?.domain)) return false;

  const key = n.metadata?.dedupe_key ?? n.metadata?.kind ?? n.id;
  const last = recentToasts.get(key);
  const now = Date.now();
  if (last && now - last < TOAST_COOLDOWN_MS) return false;
  recentToasts.set(key, now);
  if (recentToasts.size > 200) {
    for (const [k, t] of recentToasts) {
      if (now - t > TOAST_COOLDOWN_MS * 5) recentToasts.delete(k);
    }
  }
  return true;
}

export function useNotifications() {
  const qc = useQueryClient();
  const { user, loading: authLoading } = useAuth();

  const query = useQuery({
    queryKey: [...QUERY_KEY, user?.id ?? null],
    enabled: !authLoading && !!user,
    staleTime: 10_000,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notifications")
        .select("id, type, title, message, action_url, read, created_at, metadata")
        .order("created_at", { ascending: false })
        .limit(LIMIT);
      if (error) throw error;
      return (data ?? []) as NotificationRow[];
    },
  });

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    const filter = `user_id=eq.${user.id}`;
    channel = supabase
      .channel(`notifications-stream-${user.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter },
        (payload) => {
          if (cancelled) return;
          const n = payload.new as NotificationRow;
          qc.setQueryData<NotificationRow[]>([...QUERY_KEY, user.id], (prev) => {
            const list = prev ?? [];
            if (list.some((p) => p.id === n.id)) return list;
            return [n, ...list].slice(0, LIMIT);
          });
          if (shouldToast(n)) {
            const opts = { description: n.message } as const;
            if (n.type === "critical") toast.error(n.title, { ...opts, duration: 10_000 });
            else if (n.type === "warning") toast.warning(n.title, { ...opts, duration: 6_000 });
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
        { event: "UPDATE", schema: "public", table: "notifications", filter },
        (payload) => {
          if (cancelled) return;
          const n = payload.new as NotificationRow;
          qc.setQueryData<NotificationRow[]>([...QUERY_KEY, user.id], (prev) =>
            (prev ?? []).map((p) => (p.id === n.id ? { ...p, ...n } : p)),
          );
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [qc, user]);

  const items = query.data ?? [];
  const unreadCount = items.filter((i) => !i.read).length;

  const markRead = useCallback(async (id: string) => {
    const key = [...QUERY_KEY, user?.id ?? null];
    await qc.cancelQueries({ queryKey: key });
    const previous = qc.getQueryData<NotificationRow[]>(key);
    qc.setQueryData<NotificationRow[]>(key, (prev) =>
      (prev ?? []).map((p) => (p.id === id ? { ...p, read: true } : p)),
    );
    const { error } = await supabase.from("notifications").update({ read: true }).eq("id", id);
    if (error) qc.setQueryData(key, previous);
  }, [qc, user]);

  const markAllRead = useCallback(async () => {
    const key = [...QUERY_KEY, user?.id ?? null];
    const previous = qc.getQueryData<NotificationRow[]>(key) ?? [];
    const unreadIds = previous.filter((i) => !i.read).map((i) => i.id);
    if (unreadIds.length === 0) return;
    qc.setQueryData<NotificationRow[]>(key, (prev) =>
      (prev ?? []).map((p) => ({ ...p, read: true })),
    );
    const { error } = await supabase.from("notifications").update({ read: true }).in("id", unreadIds);
    if (error) qc.setQueryData(key, previous);
  }, [qc, user]);

  const refresh = useCallback(async () => {
    await qc.invalidateQueries({ queryKey: [...QUERY_KEY, user?.id ?? null] });
  }, [qc, user]);

  const clearRead = useCallback(async () => {
    const key = [...QUERY_KEY, user?.id ?? null];
    const previous = qc.getQueryData<NotificationRow[]>(key) ?? [];
    const readIds = previous.filter((i) => i.read).map((i) => i.id);
    if (readIds.length === 0) return;
    qc.setQueryData<NotificationRow[]>(key, (prev) => (prev ?? []).filter((p) => !p.read));
    const { error } = await supabase.from("notifications").delete().in("id", readIds);
    if (error) qc.setQueryData(key, previous);
  }, [qc, user]);

  return { items, loading: query.isLoading, unreadCount, markRead, markAllRead, clearRead, refresh };
}
