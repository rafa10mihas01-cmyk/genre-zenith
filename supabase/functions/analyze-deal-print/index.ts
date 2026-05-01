// analyze-deal-print — extrai a contagem de plays de um print do Spotify for Artists
// usando Lovable AI Gateway (Gemini multimodal). Retorna apenas o inteiro lido.
//
// Body: { image_base64: string, mime_type: string }
// Resp: { ok: true, count: number, raw: string } | { ok: false, error: string }
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function j(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return j({ ok: false, error: "Method not allowed" }, 405);

  // Auth: qualquer usuário autenticado pode usar (deals são per-user).
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return j({ ok: false, error: "missing auth" }, 401);
  const supabase = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData?.user) return j({ ok: false, error: "unauthorized" }, 401);

  if (!LOVABLE_API_KEY) return j({ ok: false, error: "LOVABLE_API_KEY ausente" }, 500);

  let body: { image_base64?: string; mime_type?: string };
  try {
    body = await req.json();
  } catch {
    return j({ ok: false, error: "Invalid JSON" }, 400);
  }
  const { image_base64, mime_type } = body;
  if (!image_base64 || !mime_type) {
    return j({ ok: false, error: "image_base64 e mime_type são obrigatórios" }, 400);
  }
  if (!/^image\//.test(mime_type)) {
    return j({ ok: false, error: "mime_type inválido" }, 400);
  }
  // Limite defensivo: ~10MB em base64
  if (image_base64.length > 14_000_000) {
    return j({ ok: false, error: "imagem muito grande (máx ~10MB)" }, 413);
  }

  const dataUrl = `data:${mime_type};base64,${image_base64}`;

  try {
    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        max_tokens: 50,
        messages: [
          {
            role: "user",
            content: [
              { type: "image_url", image_url: { url: dataUrl } },
              {
                type: "text",
                text:
                  "This is a screenshot from Spotify for Artists showing streaming statistics. " +
                  "Find the main play/stream count number. Return ONLY the raw integer — " +
                  "digits only, no commas, no dots, no text, no explanation.",
              },
            ],
          },
        ],
      }),
    });

    if (!resp.ok) {
      const txt = await resp.text();
      if (resp.status === 429) {
        return j({ ok: false, error: "Limite de uso atingido. Tente novamente em alguns minutos." }, 429);
      }
      if (resp.status === 402) {
        return j({ ok: false, error: "Créditos de IA esgotados." }, 402);
      }
      console.error("[analyze-deal-print] gateway error", resp.status, txt);
      return j({ ok: false, error: "Falha ao analisar imagem" }, 502);
    }

    const data = await resp.json();
    const raw: string = data?.choices?.[0]?.message?.content ?? "";
    const digits = raw.replace(/\D/g, "");
    if (!digits) {
      return j({ ok: false, error: "Não foi possível ler um número no print", raw }, 422);
    }
    const count = parseInt(digits, 10);
    if (!Number.isFinite(count)) {
      return j({ ok: false, error: "Número inválido", raw }, 422);
    }
    return j({ ok: true, count, raw });
  } catch (e) {
    console.error("[analyze-deal-print] exception", e);
    return j({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
