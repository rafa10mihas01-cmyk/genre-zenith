// analyze-deal-prints — recebe múltiplos prints + a lista de playlists cadastradas
// no deal e usa Lovable AI (Gemini multimodal) para casar cada playlist com o
// número de plays correspondente nos prints. Também devolve um total agregado.
//
// Body: {
//   images: { base64: string, mime_type: string }[],   // até 40
//   playlists: string[],                                // nomes cadastrados
//   mode: "baseline" | "update"
// }
//
// Resp: {
//   ok: true,
//   matches: { playlist_name: string, plays: number | null, found: boolean, source_index: number | null }[],
//   total_plays: number,
//   not_found: string[],
//   raw: string
// } | { ok: false, error: string }
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

const MAX_IMAGES = 40;
const MAX_BASE64_LEN = 14_000_000; // ~10MB cada

type ImageInput = { base64: string; mime_type: string };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return j({ ok: false, error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return j({ ok: false, error: "missing auth" }, 401);
  const supabase = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData?.user) return j({ ok: false, error: "unauthorized" }, 401);

  if (!LOVABLE_API_KEY) return j({ ok: false, error: "LOVABLE_API_KEY ausente" }, 500);

  let body: { images?: ImageInput[]; playlists?: string[]; mode?: string };
  try {
    body = await req.json();
  } catch {
    return j({ ok: false, error: "Invalid JSON" }, 400);
  }
  const images = Array.isArray(body.images) ? body.images : [];
  const playlists = Array.isArray(body.playlists)
    ? body.playlists.map((s) => String(s).trim()).filter((s) => s.length > 0)
    : [];
  const mode = body.mode === "baseline" ? "baseline" : "update";

  if (images.length === 0) return j({ ok: false, error: "Envie pelo menos uma imagem" }, 400);
  if (images.length > MAX_IMAGES) {
    return j({ ok: false, error: `Máximo de ${MAX_IMAGES} prints por envio` }, 400);
  }
  for (const img of images) {
    if (!img?.base64 || !img?.mime_type) {
      return j({ ok: false, error: "image_base64 e mime_type são obrigatórios" }, 400);
    }
    if (!/^image\//.test(img.mime_type)) {
      return j({ ok: false, error: "mime_type inválido" }, 400);
    }
    if (img.base64.length > MAX_BASE64_LEN) {
      return j({ ok: false, error: "imagem muito grande (máx ~10MB)" }, 413);
    }
  }
  if (mode === "update" && playlists.length === 0) {
    return j({ ok: false, error: "Lista de playlists do deal está vazia" }, 400);
  }

  const imageParts = images.map((img) => ({
    type: "image_url" as const,
    image_url: { url: `data:${img.mime_type};base64,${img.base64}` },
  }));

  const playlistList = playlists.map((p, i) => `${i + 1}. "${p}"`).join("\n");

  const promptText =
    mode === "baseline"
      ? `Você está analisando ${images.length} screenshot(s) do Spotify for Artists. ` +
        `Para CADA print, identifique a playlist e o número de streams/plays mostrado. ` +
        `Retorne APENAS um JSON válido neste formato exato, sem nenhum texto antes ou depois:\n` +
        `{"items":[{"playlist_name":"nome exato como no print","plays":12345,"source_index":0}]}\n\n` +
        `- "source_index" = índice (0-based) do print onde a playlist foi encontrada.\n` +
        `- "plays" = inteiro, sem pontos ou vírgulas.\n` +
        `- Inclua TODAS as playlists visíveis nos prints.`
      : `Você está analisando ${images.length} screenshot(s) do Spotify for Artists. ` +
        `Estas são as playlists já cadastradas neste deal:\n${playlistList}\n\n` +
        `Sua missão: para CADA playlist da lista acima, procure-a nos prints (o nome pode aparecer ` +
        `parcial, abreviado ou com pequenas variações de capitalização/acentos) e extraia o número ` +
        `de streams/plays atual mostrado ao lado dela. Se uma playlist da lista NÃO aparecer em ` +
        `nenhum print, retorne plays=null e found=false.\n\n` +
        `Retorne APENAS um JSON válido neste formato exato, sem texto antes ou depois:\n` +
        `{"items":[{"playlist_name":"nome EXATO da lista cadastrada","plays":12345,"found":true,"source_index":0}]}\n\n` +
        `- Use exatamente os nomes da lista cadastrada em "playlist_name".\n` +
        `- "source_index" = índice 0-based do print onde encontrou (ou null se não encontrou).\n` +
        `- "plays" = inteiro sem pontos/vírgulas (ou null se não encontrou).`;

  try {
    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        max_tokens: 2000,
        messages: [
          {
            role: "user",
            content: [
              ...imageParts,
              { type: "text", text: promptText },
            ],
          },
        ],
      }),
    });

    if (!resp.ok) {
      const txt = await resp.text();
      if (resp.status === 429) {
        return j({ ok: false, error: "Limite de uso atingido. Tente em alguns minutos." }, 429);
      }
      if (resp.status === 402) {
        return j({ ok: false, error: "Créditos de IA esgotados." }, 402);
      }
      console.error("[analyze-deal-prints] gateway error", resp.status, txt);
      return j({ ok: false, error: "Falha ao analisar imagens" }, 502);
    }

    const data = await resp.json();
    const raw: string = data?.choices?.[0]?.message?.content ?? "";

    // Extrai bloco JSON do retorno (a IA pode envelopar com ```json ... ```)
    let jsonStr = raw.trim();
    const fence = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) jsonStr = fence[1].trim();
    const firstBrace = jsonStr.indexOf("{");
    const lastBrace = jsonStr.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      jsonStr = jsonStr.slice(firstBrace, lastBrace + 1);
    }

    let parsed: { items?: Array<{ playlist_name?: string; plays?: number | null; found?: boolean; source_index?: number | null }> };
    try {
      parsed = JSON.parse(jsonStr);
    } catch (e) {
      console.error("[analyze-deal-prints] parse fail", e, raw);
      return j({ ok: false, error: "IA não retornou JSON válido", raw }, 422);
    }

    const items = Array.isArray(parsed.items) ? parsed.items : [];

    let matches: Array<{
      playlist_name: string;
      plays: number | null;
      found: boolean;
      source_index: number | null;
    }> = [];

    if (mode === "baseline") {
      matches = items
        .filter((it) => typeof it.playlist_name === "string" && it.playlist_name!.trim().length > 0)
        .map((it) => {
          const playsNum = it.plays != null ? Number(it.plays) : null;
          return {
            playlist_name: String(it.playlist_name).trim(),
            plays: Number.isFinite(playsNum as number) ? (playsNum as number) : null,
            found: it.plays != null,
            source_index:
              typeof it.source_index === "number" ? it.source_index : null,
          };
        });
    } else {
      // update: garante todas as playlists cadastradas no resultado
      const map = new Map<string, { playlist_name: string; plays: number | null; found: boolean; source_index: number | null }>();
      for (const p of playlists) {
        map.set(p.toLowerCase(), {
          playlist_name: p,
          plays: null,
          found: false,
          source_index: null,
        });
      }
      for (const it of items) {
        const name = String(it.playlist_name ?? "").trim();
        if (!name) continue;
        const key = name.toLowerCase();
        const target = map.get(key);
        const playsNum = it.plays != null ? Number(it.plays) : null;
        const validPlays = Number.isFinite(playsNum as number) ? (playsNum as number) : null;
        if (target) {
          target.plays = validPlays;
          target.found = it.found !== false && validPlays != null;
          target.source_index =
            typeof it.source_index === "number" ? it.source_index : null;
        } else {
          // Nome retornado pela IA não bateu exatamente — tenta match fuzzy simples
          const fuzzy = playlists.find(
            (p) =>
              p.toLowerCase().includes(name.toLowerCase()) ||
              name.toLowerCase().includes(p.toLowerCase()),
          );
          if (fuzzy) {
            const t = map.get(fuzzy.toLowerCase());
            if (t && !t.found) {
              t.plays = validPlays;
              t.found = it.found !== false && validPlays != null;
              t.source_index =
                typeof it.source_index === "number" ? it.source_index : null;
            }
          }
        }
      }
      matches = Array.from(map.values());
    }

    const total_plays = matches.reduce(
      (acc, m) => acc + (m.plays != null && m.found ? m.plays : 0),
      0,
    );
    const not_found = matches.filter((m) => !m.found).map((m) => m.playlist_name);

    return j({ ok: true, matches, total_plays, not_found, raw });
  } catch (e) {
    console.error("[analyze-deal-prints] exception", e);
    return j({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
