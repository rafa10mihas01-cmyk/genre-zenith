// CopilotoPanel — chat IA estilo ChatGPT no design do NexEngine.
import { useEffect, useRef, useState } from "react";
import { Send, Plus, Loader2, MessageSquare, Trash2, AlertTriangle, Bot, User as UserIcon, Square, Copy, Check } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { timeAgo } from "@/lib/format";
import { useOpsCopilot } from "@/hooks/useOpsCopilot";
import { toast } from "@/hooks/use-toast";

export function CopilotoPanel() {
  const { threads, activeThreadId, setActiveThreadId, messages, streaming, error, send, stop, newThread, deleteThread } = useOpsCopilot();
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const submit = async () => {
    const text = input.trim();
    if (!text || streaming) return;
    setInput("");
    await send(text);
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-[260px_1fr] gap-4 h-[calc(100vh-220px)] min-h-[480px]">
      {/* === Sidebar de threads === */}
      <div className="nx-card p-3 flex flex-col gap-2 overflow-hidden">
        <Button size="sm" onClick={newThread} className="w-full justify-start gap-2">
          <Plus className="h-3.5 w-3.5" /> Nova conversa
        </Button>
        <ScrollArea className="flex-1 -mx-1">
          <div className="space-y-1 px-1">
            {threads.length === 0 && (
              <p className="text-xs text-muted-foreground p-2">Nenhuma conversa ainda.</p>
            )}
            {threads.map((t) => (
              <div
                key={t.id}
                className={cn(
                  "group flex items-start gap-2 p-2 rounded-md cursor-pointer text-sm transition-colors",
                  activeThreadId === t.id ? "bg-primary/10 text-foreground" : "hover:bg-foreground/5 text-muted-foreground",
                )}
                onClick={() => setActiveThreadId(t.id)}
              >
                <MessageSquare className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{t.title}</p>
                  {t.last_message_at && (
                    <p className="text-[10px] text-muted-foreground">{timeAgo(t.last_message_at)}</p>
                  )}
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); void deleteThread(t.id); }}
                  className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        </ScrollArea>
      </div>

      {/* === Conversa === */}
      <div className="nx-card flex flex-col overflow-hidden">
        <ScrollArea className="flex-1" ref={scrollRef as any}>
          <div className="p-4 md:p-5 space-y-5 max-w-3xl mx-auto" ref={scrollRef}>
            {messages.length === 0 && (
              <div className="text-center py-12">
                <Bot className="h-8 w-8 text-muted-foreground/40 mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">
                  Pergunte sobre deals, robô, fila ou cole logs para análise.
                </p>
              </div>
            )}
            {messages.map((m) => (
              <MessageBubble key={m.id} role={m.role} content={m.content ?? ""} status={m.status} error={m.error} />
            ))}
            {error && (
              <div className="flex items-center gap-2 text-xs text-destructive p-3 rounded-md border border-destructive/30 bg-destructive/5">
                <AlertTriangle className="h-3.5 w-3.5" /> {error}
              </div>
            )}
          </div>
        </ScrollArea>

        {/* Composer */}
        <div className="border-t border-border p-3">
          <div className="max-w-3xl mx-auto flex items-end gap-2">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void submit(); }
              }}
              placeholder="Pergunte qualquer coisa sobre a operação…"
              className="min-h-[44px] max-h-[200px] resize-none"
              disabled={streaming}
            />
            {streaming ? (
              <Button onClick={stop} variant="outline" size="icon" className="shrink-0">
                <Square className="h-4 w-4" />
              </Button>
            ) : (
              <Button onClick={submit} size="icon" className="shrink-0" disabled={!input.trim()}>
                <Send className="h-4 w-4" />
              </Button>
            )}
          </div>
          <p className="text-[10px] text-muted-foreground text-center mt-1.5">
            Enter envia · Shift+Enter quebra linha · Modelo: gemini-2.5-pro
          </p>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ role, content, status, error }: { role: string; content: string; status: string; error: string | null }) {
  const isUser = role === "user";
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast({ title: "Não foi possível copiar", variant: "destructive" });
    }
  };

  return (
    <div className={cn("group flex gap-3", isUser && "flex-row-reverse")}>
      <div className={cn(
        "h-7 w-7 rounded-full flex items-center justify-center shrink-0",
        isUser ? "bg-primary/15 text-primary" : "bg-foreground/5 text-foreground",
      )}>
        {isUser ? <UserIcon className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
      </div>
      <div className={cn("min-w-0 max-w-[85%] flex flex-col", isUser ? "items-end" : "items-start")}>
        <div
          className={cn(
            "rounded-2xl px-4 py-2.5 text-sm break-words text-left selection:bg-primary/30",
            isUser ? "bg-primary/10 text-foreground whitespace-pre-wrap" : "bg-foreground/5 text-foreground",
            status === "error" && "border border-destructive/40",
          )}
        >
          {isUser ? (
            content
          ) : content ? (
            <div className="prose prose-sm prose-invert max-w-none
              prose-p:my-2 prose-p:leading-relaxed
              prose-headings:mt-3 prose-headings:mb-2 prose-headings:font-semibold
              prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5
              prose-pre:bg-background prose-pre:border prose-pre:border-border prose-pre:rounded-lg prose-pre:p-3 prose-pre:my-2 prose-pre:text-xs
              prose-code:bg-background prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-xs prose-code:before:content-none prose-code:after:content-none
              prose-strong:text-foreground prose-strong:font-semibold
              prose-a:text-primary hover:prose-a:underline">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
            </div>
          ) : status === "streaming" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin inline" />
          ) : ""}
        </div>
        {content && status !== "streaming" && (
          <button
            onClick={copy}
            className="opacity-0 group-hover:opacity-100 transition-opacity mt-1 text-[10px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
          >
            {copied ? <><Check className="h-3 w-3" /> Copiado</> : <><Copy className="h-3 w-3" /> Copiar</>}
          </button>
        )}
        {error && <p className="text-[10px] text-destructive mt-1">{error}</p>}
      </div>
    </div>
  );
}
