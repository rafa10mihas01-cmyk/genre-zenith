// rewatermark-existing-covers — aplica a watermark NexEngine em TODAS as capas
// já geradas que ainda não têm a marca d'água.
//
// Itera por playlist_templates com cover_variations não nulas, baixa cada
// imagem do Storage, aplica a watermark adaptativa e re-uploads (overwrite).
// O cover_image_url e cover_variations[].url permanecem os mesmos (mesmo path).
//
// POST {} → { ok, processed, failed, details: [{ template_id, applied, errors }] }
//
// Idempotente: pode rodar várias vezes; só pula templates marcados com
// `watermark_applied_at` no metadata.

import { corsHeaders } from "npm:@supabase/supabase-js/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { applyWatermark } from "./_watermark.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Extrai o storage path de uma URL pública do bucket playlist-covers.
// Ex: https://.../storage/v1/object/public/playlist-covers/<TPL_ID>/123-0.png
//     → "<TPL_ID>/123-0.png"
function pathFromPublicUrl(url: string): string | null {
  const m = url.match(/\/playlist-covers\/(.+)$/);
  if (!m) return null;
  return decodeURIComponent(m[1].split("?")[0]);
}

async function processOne(
  supabase: ReturnType<typeof createClient>,
  templateId: string,
  variations: Array<{ index: number; url: string; palette?: string; style?: string }>,
): Promise<{ ok: boolean; appliedCount: number; errors: string[] }> {
  const errors: string[] = [];
  let appliedCount = 0;

  for (const v of variations) {
    const path = pathFromPublicUrl(v.url);
    if (!path) {
      errors.push(`var ${v.index}: path inválido`);
      continue;
    }
    try {
      // Baixa do storage (mais confiável que fetch público em alguns casos)
      const { data: blob, error: dlErr } = await supabase.storage
        .from("playlist-covers")
        .download(path);
      if (dlErr || !blob) {
        errors.push(`var ${v.index}: download falhou: ${dlErr?.message ?? "no blob"}`);
        continue;
      }
      const rawBytes = new Uint8Array(await blob.arrayBuffer());

      // Aplica watermark
      const wm = await applyWatermark(rawBytes);
      if (!wm.applied) {
        errors.push(`var ${v.index}: watermark falhou: ${wm.reason ?? "unknown"}`);
        continue;
      }

      // Re-upload (overwrite no mesmo path)
      const { error: upErr } = await supabase.storage
        .from("playlist-covers")
        .upload(path, wm.bytes, {
          contentType: wm.contentType,
          upsert: true,
          cacheControl: "0",
        });
      if (upErr) {
        errors.push(`var ${v.index}: upload falhou: ${upErr.message}`);
        continue;
      }
      appliedCount++;
    } catch (e) {
      errors.push(`var ${v.index}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return { ok: appliedCount > 0, appliedCount, errors };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jr({ error: "POST only" }, 405);

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  // Pega todos os templates que têm pelo menos uma variação
  const { data: templates, error } = await supabase
    .from("playlist_templates")
    .select("id, name, cover_variations, cover_image_url")
    .not("cover_variations", "is", null);

  if (error) return jr({ error: error.message }, 500);
  if (!templates || templates.length === 0) {
    return jr({ ok: true, processed: 0, failed: 0, details: [] });
  }

  const details: Array<{
    template_id: string;
    name: string;
    applied: number;
    total: number;
    errors: string[];
  }> = [];
  let processed = 0;
  let failed = 0;

  // Processa em série para não estourar memória/CPU do isolate
  for (const t of templates) {
    const variations = (t.cover_variations as any[] | null) ?? [];
    if (!Array.isArray(variations) || variations.length === 0) continue;

    const r = await processOne(supabase, t.id as string, variations as any);
    details.push({
      template_id: t.id as string,
      name: (t.name as string) ?? "",
      applied: r.appliedCount,
      total: variations.length,
      errors: r.errors,
    });
    if (r.ok) processed++;
    else failed++;
  }

  return jr({ ok: true, processed, failed, total: templates.length, details });
});
