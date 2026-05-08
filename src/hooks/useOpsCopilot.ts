// useOpsCopilot — chat com IA via SSE.
// O endpoint ops-copilot exige JWT de admin.
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

const FN_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ops-copilot`;

export type OpsThread = {
  id: string;
  title: string;
  model: string;
  pinned: boolean;
  last_message_at: string | null;
  archived_at: string | null;
};

export type OpsMessage = {
  id: string;
  thread_id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string | null;
  status: "streaming" | "complete" | "error";
  error: string | null;
  created_at: string;
};

export function useOpsCopilot() {
  const [threads, setThreads] = useState<OpsThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<OpsMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const loadThreads = useCallback(async () => {
    const { data } = await supabase
      .from("ops_chat_threads")
      .select("id,title,model,pinned,last_message_at,archived_at")
      .is("archived_at", null)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(50);
    setThreads((data ?? []) as OpsThread[]);
  }, []);

  const loadMessages = useCallback(async (threadId: string) => {
    const { data } = await supabase
      .from("ops_chat_messages")
      .select("id,thread_id,role,content,status,error,created_at")
      .eq("thread_id", threadId)
      .order("created_at", { ascending: true });
    setMessages((data ?? []) as OpsMessage[]);
  }, []);

  useEffect(() => { void loadThreads(); }, [loadThreads]);
  useEffect(() => {
    if (activeThreadId) void loadMessages(activeThreadId);
    else setMessages([]);
  }, [activeThreadId, loadMessages]);

  const send = useCallback(async (text: string, model = "google/gemini-2.5-pro") => {
    if (!text.trim() || streaming) return;
    setError(null);
    setStreaming(true);

    // Otimista: insere user msg na UI
    const tempId = `tmp-${Date.now()}`;
    setMessages((m) => [
      ...m,
      { id: tempId, thread_id: activeThreadId ?? "", role: "user", content: text, status: "complete", error: null, created_at: new Date().toISOString() },
      { id: `${tempId}-a`, thread_id: activeThreadId ?? "", role: "assistant", content: "", status: "streaming", error: null, created_at: new Date().toISOString() },
    ]);

    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) { setError("Sessão expirada"); setStreaming(false); return; }

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const resp = await fetch(FN_URL, {
        method: "POST",
        signal: ctrl.signal,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ thread_id: activeThreadId, message: text, model }),
      });
      if (!resp.ok || !resp.body) {
        const t = await resp.text().catch(() => "");
        throw new Error(t || `HTTP ${resp.status}`);
      }

      const reader = resp.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let acc = "";
      let createdThreadId: string | null = null;
      let asstMessageId: string | null = null;

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const events = buf.split("\n\n");
        buf = events.pop() ?? "";
        for (const ev of events) {
          const lines = ev.split("\n");
          let evType = "message";
          let dataStr = "";
          for (const ln of lines) {
            if (ln.startsWith("event: ")) evType = ln.slice(7).trim();
            else if (ln.startsWith("data: ")) dataStr += ln.slice(6);
          }
          if (!dataStr) continue;
          try {
            const json = JSON.parse(dataStr);
            if (evType === "meta") {
              createdThreadId = json.thread_id;
              asstMessageId = json.message_id;
              if (!activeThreadId && createdThreadId) setActiveThreadId(createdThreadId);
            } else if (evType === "delta") {
              acc += json.text;
              setMessages((m) => m.map((msg) =>
                msg.id === `${tempId}-a` ? { ...msg, content: acc } : msg
              ));
            } else if (evType === "error") {
              throw new Error(json.error ?? "stream_error");
            }
          } catch (e) { console.warn("SSE parse:", e); }
        }
      }

      // Recarrega oficial do DB
      const finalThreadId = createdThreadId ?? activeThreadId;
      if (finalThreadId) {
        await loadMessages(finalThreadId);
        await loadThreads();
      }
    } catch (e: any) {
      if (e.name !== "AbortError") {
        setError(e.message);
        setMessages((m) => m.map((msg) =>
          msg.id === `${tempId}-a` ? { ...msg, status: "error", error: e.message } : msg
        ));
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }, [activeThreadId, streaming, loadMessages, loadThreads]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const newThread = useCallback(() => {
    setActiveThreadId(null);
    setMessages([]);
  }, []);

  const deleteThread = useCallback(async (id: string) => {
    await supabase.from("ops_chat_threads").update({ archived_at: new Date().toISOString() }).eq("id", id);
    if (activeThreadId === id) setActiveThreadId(null);
    await loadThreads();
  }, [activeThreadId, loadThreads]);

  return { threads, activeThreadId, setActiveThreadId, messages, streaming, error, send, stop, newThread, deleteThread, reloadThreads: loadThreads };
}
