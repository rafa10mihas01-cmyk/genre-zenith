// ops-copilot — Chat IA para o painel operacional.
// Usa Lovable AI Gateway (Gemini por padrão). Suporta streaming SSE.
// Arquitetura preparada para tool-calling e troca de provedor (GPT-5) depois.
import { requireAdmin, corsHeaders, jr } from "../_shared/admin-auth.ts";

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

const SYSTEM_PROMPT = `Você é o Copiloto Operacional do NexEngine.
Função: ajudar o time a operar o sistema (deals, robô coletor, playlists, infraestrutura).
Regras:
- Português direto, técnico, sem enrolação.
- Quando o usuário pedir uma ação (restart, kill, limpar), instrua o passo a passo. Não execute por conta própria.
- Quando receber logs, identifique padrões, erros recorrentes e sugira a causa raiz mais provável.
- Se faltar contexto, peça o mínimo necessário.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.resp;
  const { supabase, userId } = auth;

  let body: any;
  try { body = await req.json(); } catch { return jr({ error: "invalid_json" }, 400); }

  const { thread_id, message, model = "google/gemini-2.5-pro", attachments = [] } = body;
  if (!message || typeof message !== "string") return jr({ error: "message_required" }, 400);

  // 1. Resolve/cria thread
  let threadId = thread_id as string | undefined;
  if (!threadId) {
    const title = message.slice(0, 60);
    const { data: t, error } = await supabase
      .from("ops_chat_threads")
      .insert({ user_id: userId, title, model })
      .select("id")
      .single();
    if (error) return jr({ error: error.message }, 500);
    threadId = t.id;
  }

  // 2. Salva mensagem do usuário
  await supabase.from("ops_chat_messages").insert({
    thread_id: threadId,
    role: "user",
    content: message,
    attachments,
  });

  // 3. Carrega histórico (últimas 30 msgs)
  const { data: history } = await supabase
    .from("ops_chat_messages")
    .select("role, content, tool_calls, tool_call_id")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: true })
    .limit(30);

  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    ...(history ?? []).map((m: any) => ({ role: m.role, content: m.content ?? "" })),
  ];

  // 4. Insere placeholder de assistant em status streaming
  const { data: asstMsg, error: asstErr } = await supabase
    .from("ops_chat_messages")
    .insert({ thread_id: threadId, role: "assistant", content: "", status: "streaming", model })
    .select("id")
    .single();
  if (asstErr) return jr({ error: asstErr.message }, 500);
  const asstId = asstMsg.id;

  // 5. Chama gateway com stream
  const upstream = await fetch(GATEWAY_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, messages, stream: true }),
  });

  if (!upstream.ok) {
    const errText = await upstream.text();
    await supabase.from("ops_chat_messages")
      .update({ status: "error", error: errText.slice(0, 500), content: "" })
      .eq("id", asstId);
    return jr({ error: "gateway_error", status: upstream.status, detail: errText.slice(0, 500) }, 502);
  }

  // 6. Stream SSE → cliente + acumula no DB
  let fullText = "";
  const reader = upstream.body!.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";

  const stream = new ReadableStream({
    async start(controller) {
      // Header com thread_id e msg id
      controller.enqueue(encoder.encode(`event: meta\ndata: ${JSON.stringify({ thread_id: threadId, message_id: asstId })}\n\n`));

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const data = line.slice(6).trim();
            if (data === "[DONE]") continue;
            try {
              const parsed = JSON.parse(data);
              const delta = parsed.choices?.[0]?.delta?.content ?? "";
              if (delta) {
                fullText += delta;
                controller.enqueue(encoder.encode(`event: delta\ndata: ${JSON.stringify({ text: delta })}\n\n`));
              }
            } catch { /* ignore parse error of partial chunks */ }
          }
        }
        await supabase.from("ops_chat_messages")
          .update({ content: fullText, status: "complete" })
          .eq("id", asstId);
        controller.enqueue(encoder.encode(`event: done\ndata: {}\n\n`));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await supabase.from("ops_chat_messages")
          .update({ content: fullText, status: "error", error: msg.slice(0, 500) })
          .eq("id", asstId);
        controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: msg })}\n\n`));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      ...corsHeaders,
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
});
