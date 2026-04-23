// generate-cover-variations — gera 4 variações de capa via Nano Banana
// POST { template_id: string, custom_prompt?: string }
// → { ok, variations: [{ index, url }] }
import { corsHeaders } from "npm:@supabase/supabase-js/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

const VARIATION_COUNT = 4;
const MODEL = "google/gemini-2.5-flash-image";

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function buildPrompt(template: any, customPrompt?: string): string {
  if (customPrompt && customPrompt.trim().length > 10) return customPrompt.trim();

  const brief = (template.cover_brief ?? "").trim();
  const name = template.name ?? "playlist";
  const keywords = Array.isArray(template.keywords)
    ? template.keywords.slice(0, 5).map((k: any) => k.value ?? k).join(", ")
    : "";

  const base = brief
    ? brief
    : `Capa de playlist do Spotify chamada "${name}". Estilo visual relacionado a: ${keywords}.`;

  return [
    base,
    "Formato quadrado 1:1, alta qualidade, composição centralizada.",
    "Sem texto, sem letras, sem palavras na imagem.",
    "Cores vibrantes, contraste forte, leitura clara em thumbnails pequenos.",
    "Estética profissional de capa de playlist musical brasileira.",
  ].join(" ");
}

async function generateOne(prompt: string, seed: number): Promise<string> {
  const variedPrompt = `${prompt} [variação ${seed}: explore composição e paleta de forma única]`;
  const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "user", content: variedPrompt }],
      modalities: ["image", "text"],
    }),
  });
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`AI ${resp.status}: ${t.slice(0, 200)}`);
  }
  const data = await resp.json();
  const dataUrl = data?.choices?.[0]?.message?.images?.[0]?.image_url?.url;
  if (!dataUrl || !dataUrl.startsWith("data:image/")) {
    throw new Error("Resposta sem imagem");
  }
  return dataUrl;
}

function dataUrlToBytes(dataUrl: string): { bytes: Uint8Array; contentType: string } {
  const match = dataUrl.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
  if (!match) throw new Error("data URL inválida");
  const contentType = match[1];
  const b64 = match[2];
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { bytes, contentType };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jr({ error: "POST only" }, 405);

  let body: { template_id?: string; custom_prompt?: string };
  try { body = await req.json(); } catch { return jr({ error: "invalid json" }, 400); }
  if (!body.template_id) return jr({ error: "template_id required" }, 400);

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: tpl, error: tplErr } = await supabase
    .from("playlist_templates").select("*").eq("id", body.template_id).maybeSingle();
  if (tplErr || !tpl) return jr({ error: "template not found" }, 404);

  const prompt = buildPrompt(tpl, body.custom_prompt);
  const ts = Date.now();
  const variations: { index: number; url: string }[] = [];

  // 🧹 Cleanup: remove variações antigas do storage antes de gerar novas
  try {
    const { data: oldFiles } = await supabase.storage.from("playlist-covers").list(tpl.id);
    if (oldFiles && oldFiles.length > 0) {
      const paths = oldFiles.map((f) => `${tpl.id}/${f.name}`);
      await supabase.storage.from("playlist-covers").remove(paths);
    }
  } catch (e) { console.warn("cleanup falhou:", e); }

  // Gera em paralelo (4 chamadas)
  const results = await Promise.allSettled(
    Array.from({ length: VARIATION_COUNT }, (_, i) => generateOne(prompt, i + 1)),
  );

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status !== "fulfilled") {
      console.error(`variação ${i} falhou:`, r.reason);
      continue;
    }
    try {
      const { bytes, contentType } = dataUrlToBytes(r.value);
      const ext = contentType.split("/")[1].replace("+xml", "");
      const path = `${tpl.id}/${ts}-${i}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("playlist-covers")
        .upload(path, bytes, { contentType, upsert: true });
      if (upErr) { console.error("upload err:", upErr); continue; }
      const { data: pub } = supabase.storage.from("playlist-covers").getPublicUrl(path);
      variations.push({ index: i, url: pub.publicUrl });
    } catch (e) {
      console.error("processing err:", e);
    }
  }

  if (variations.length === 0) {
    return jr({ ok: false, error: "Nenhuma variação foi gerada com sucesso" }, 500);
  }

  await supabase.from("playlist_templates").update({
    cover_variations: variations,
    cover_generated_at: new Date().toISOString(),
  }).eq("id", tpl.id);

  return jr({ ok: true, variations, prompt_used: prompt });
});
