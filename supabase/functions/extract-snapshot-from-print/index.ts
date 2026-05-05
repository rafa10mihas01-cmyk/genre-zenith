// extract-snapshot-from-print — Lê 1+ prints da tela do Spotify for Artists com
// Gemini Vision, extrai playlists/streams/criadores e grava em curator_deal_snapshots.
//
// POST { song_id, deal_id, print_urls: string[], batch_id? }
// Auth: header x-bot-key (mesmo do bot) OU chamada interna do bot-upload-print.
//
// Fluxo:
// 1. Carrega prints (URLs assinadas)
// 2. Manda tudo pro Gemini 2.5 Pro com tool calling estruturado
// 3. Para cada playlist extraída: match com curator_playlists (ou cria) e insere snapshot
// 4. Insere log em curator_deal_logs
// 5. Atualiza last_auto_collect_at + next_auto_collect_at na song
// 6. Marca batch como processed
import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod@3.23.8";

// ============= Schemas de validação =============
const RequestSchema = z.object({
  deal_id: z.string().uuid(),
  song_id: z.string().uuid().nullable().optional(),
  print_urls: z.array(z.string().url()).min(1).max(40),
  batch_id: z.string().uuid().optional(),
  dom_playlists: z
    .array(
      z.object({
        name: z.string().optional(),
        url: z.string().optional(),
        plays_text: z.string().optional(),
      }).passthrough(),
    )
    .optional(),
});

const GeminiPlaylistSchema = z.object({
  playlist_name: z.string().min(1).max(300),
  spotify_url: z.string().optional().nullable(),
  made_by: z.string().optional().nullable(),
  plays: z.union([z.number(), z.string()]).transform((v) => {
    const n = typeof v === "number" ? v : parseInt(String(v).replace(/\D/g, ""), 10);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
  }),
});
const GeminiResponseSchema = z.object({
  playlists: z.array(GeminiPlaylistSchema).max(500),
});

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-bot-key, authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BOT_API_KEY = Deno.env.get("BOT_API_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const extractId = (url: string | null | undefined) => {
  if (!url) return null;
  const m = url.match(/playlist[/:]([a-zA-Z0-9]{16,})/);
  return m ? m[1] : null;
};

interface ExtractedPlaylist {
  playlist_name: string;
  spotify_url?: string | null;
  made_by?: string | null;
  plays: number;
}

async function callGemini(printUrls: string[]): Promise<ExtractedPlaylist[]> {
  const userContent: any[] = [
    {
      type: "text",
      text:
        "Estas são capturas de tela da página 'Playlists' do Spotify for Artists para uma música. " +
        "Cada linha da tabela tem: posição, capa, nome da playlist, criador (coluna 'Made by' — pode ser 'Spotify', um nome de usuário, ou vazio '—'), " +
        "streams (coluna 'Streams', últimos 7 ou 28 dias), e data adicionada. " +
        "Extraia TODAS as playlists visíveis em TODOS os prints. " +
        "IMPORTANTE: " +
        "- Se a mesma playlist aparecer em mais de um print (por overlap de scroll), liste só UMA vez. " +
        "- 'plays' deve ser o número de streams como inteiro (sem vírgula/ponto separador). Ex: '316,015' → 316015. " +
        "- 'made_by' = null se aparecer '—' ou estiver em branco. " +
        "- Não invente playlists. Se não conseguir ler com clareza, pule.",
    },
    ...printUrls.map((url) => ({
      type: "image_url",
      image_url: { url },
    })),
  ];

  const body = {
    model: "google/gemini-2.5-pro",
    messages: [
      {
        role: "system",
        content:
          "Você é um extrator de dados visual preciso. Sempre retorne via tool call, nunca em texto livre.",
      },
      { role: "user", content: userContent },
    ],
    tools: [
      {
        type: "function",
        function: {
          name: "report_playlists",
          description: "Reporta a lista de playlists extraídas dos prints.",
          parameters: {
            type: "object",
            properties: {
              playlists: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    playlist_name: { type: "string", description: "Nome exato da playlist" },
                    spotify_url: {
                      type: "string",
                      description: "URL do Spotify se visível, senão omita",
                    },
                    made_by: {
                      type: "string",
                      description: "Criador (Spotify, nome do usuário). null se vazio.",
                    },
                    plays: {
                      type: "integer",
                      description: "Número de streams como inteiro",
                    },
                  },
                  required: ["playlist_name", "plays"],
                  additionalProperties: false,
                },
              },
            },
            required: ["playlists"],
            additionalProperties: false,
          },
        },
      },
    ],
    tool_choice: { type: "function", function: { name: "report_playlists" } },
  };

  const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`gemini ${resp.status}: ${t.slice(0, 500)}`);
  }
  const data = await resp.json();
  const tc = data?.choices?.[0]?.message?.tool_calls?.[0];
  if (!tc?.function?.arguments) {
    throw new Error("gemini: no tool_call returned");
  }
  const args = JSON.parse(tc.function.arguments);
  const validated = GeminiResponseSchema.safeParse(args);
  if (!validated.success) {
    console.warn("gemini schema invalid, falling back", validated.error.flatten());
    return Array.isArray(args.playlists)
      ? args.playlists.filter((p: any) => p?.playlist_name).map((p: any) => ({
          playlist_name: String(p.playlist_name),
          spotify_url: p.spotify_url ?? null,
          made_by: p.made_by ?? null,
          plays: Math.max(0, parseInt(String(p.plays ?? 0).replace(/\D/g, "")) || 0),
        }))
      : [];
  }
  return validated.data.playlists as ExtractedPlaylist[];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jr({ error: "method_not_allowed" }, 405);

  // Aceita x-bot-key OU service role (chamada interna)
  const botKey = req.headers.get("x-bot-key");
  const auth = req.headers.get("authorization") ?? "";
  const isService = auth.includes(SERVICE_KEY);
  if (botKey !== BOT_API_KEY && !isService) {
    return jr({ error: "unauthorized" }, 401);
  }

  const t0 = Date.now();
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jr({ error: "invalid_json" }, 400);
  }

  const parsedBody = RequestSchema.safeParse(body);
  if (!parsedBody.success) {
    return jr({ error: "invalid_body", detail: parsedBody.error.flatten() }, 400);
  }
  const { song_id, deal_id, print_urls, batch_id } = parsedBody.data;
  let dom_playlists: Array<{ name?: string; url?: string; plays_text?: string }> =
    parsedBody.data.dom_playlists ?? [];

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  // Se o body não trouxe dom_playlists mas temos batch_id, busca do batch
  // (caso da cron-recover-print-batches re-disparando).
  if (dom_playlists.length === 0 && batch_id) {
    const { data: bRow } = await supabase
      .from("bot_print_batches")
      .select("dom_payload")
      .eq("id", batch_id)
      .maybeSingle();
    if (Array.isArray(bRow?.dom_payload)) {
      dom_playlists = bRow!.dom_payload as any[];
    }
  }

  // Index dom por nome normalizado pra cruzar com Gemini
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const domByName = new Map<string, { id: string; url: string }>();
  for (const d of dom_playlists) {
    if (!d?.name || !d?.url) continue;
    const m = d.url.match(/playlist[/:]([a-zA-Z0-9]{16,})/);
    if (!m) continue;
    domByName.set(norm(d.name), { id: m[1], url: d.url });
  }

  // Marca batch como processing
  if (batch_id) {
    await supabase
      .from("bot_print_batches")
      .update({ status: "processing" })
      .eq("id", batch_id);
  }

  // 1. Chama Gemini
  let extracted: ExtractedPlaylist[] = [];
  try {
    extracted = await callGemini(print_urls);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("gemini extract failed", msg);

    if (batch_id) {
      await supabase
        .from("bot_print_batches")
        .update({ status: "error", error: msg.slice(0, 1000) })
        .eq("id", batch_id);
    }
    if (song_id) {
      await supabase
        .from("curator_deal_songs")
        .update({
          auto_collect_status: "error",
          auto_collect_error: `extract: ${msg.slice(0, 400)}`,
        })
        .eq("id", song_id);
    }
    await supabase.from("collection_logs").insert({
      acao: "extract_print",
      status: "error",
      mensagem: `deal=${deal_id} ${msg.slice(0, 300)}`,
    });
    return jr({ error: "extract_failed", detail: msg }, 500);
  }

  // 2. Detecta baseline — escopa por (deal_id, song_id) pra não confundir
  // coletas de outros deals/legados.
  let baselineQuery = supabase
    .from("curator_deal_logs")
    .select("id", { count: "exact", head: true })
    .eq("deal_id", deal_id);
  baselineQuery = song_id
    ? baselineQuery.eq("song_id", song_id)
    : baselineQuery.is("song_id", null);
  const { count: existingLogs } = await baselineQuery;
  const isBaseline = (existingLogs ?? 0) === 0;

  // 3. Para cada playlist: match e snapshot
  let inserted = 0;
  let skipped = 0;
  let totalPlays = 0;

  for (const pl of extracted) {
    const sName = pl.playlist_name ?? null;
    const plays = Math.max(0, parseInt(String(pl.plays ?? 0)) || 0);
    totalPlays += plays;

    // PRIORIDADE 1: bate o nome lido pelo Gemini com o DOM (link real do HTML)
    let sUrl = pl.spotify_url ?? "";
    let sId = extractId(sUrl);
    let domHit: { id: string; url: string } | undefined;
    if (sName) {
      domHit = domByName.get(norm(sName));
      if (domHit) {
        sId = domHit.id;
        sUrl = domHit.url;
      }
    }

    let playlistId: string | null = null;
    let matchMethod: string | null = null;

    const { data: matchData } = await supabase.rpc("match_curator_playlist", {
      p_deal_id: deal_id,
      p_spotify_playlist_id: sId,
      p_playlist_name: sName,
    });
    const row = Array.isArray(matchData) ? matchData[0] : null;
    if (row?.playlist_id) {
      playlistId = row.playlist_id as string;
      matchMethod = (row.match_method as string) ?? null;

      // AUTO-CURA: se bateu por nome mas DOM trouxe ID confiável,
      // popula spotify_playlist_id da row existente.
      if (domHit && matchMethod !== "spotify_id") {
        await supabase
          .from("curator_playlists")
          .update({ spotify_playlist_id: domHit.id, spotify_url: domHit.url })
          .eq("id", playlistId)
          .is("spotify_playlist_id", null);
      }
    }

    if (!playlistId) {
      const { data: created, error: cErr } = await supabase
        .from("curator_playlists")
        .insert({
          deal_id,
          song_id: song_id ?? null,
          spotify_url: sUrl,
          spotify_playlist_id: sId,
          playlist_name: sName ?? "Sem nome",
          spotify_owner_name: pl.made_by ?? null,
          is_baseline: isBaseline,
        })
        .select("id")
        .single();
      if (cErr) {
        skipped++;
        continue;
      }
      playlistId = created.id;
      matchMethod = domHit ? "dom_created" : "created";
    }

    const { error: insErr } = await supabase.from("curator_deal_snapshots").insert({
      deal_id,
      song_id: song_id ?? null,
      playlist_id: playlistId,
      plays,
      source: "spotify_for_artists",
      match_method: matchMethod ?? (sId ? "spotify_id" : "name"),
      is_baseline: isBaseline,
      print_url: print_urls[0] ?? null,
      ai_raw: { ...pl, dom_matched: !!domHit } as any,
    });
    if (insErr) skipped++;
    else inserted++;
  }

  // 4. Log
  await supabase.from("curator_deal_logs").insert({
    deal_id,
    song_id: song_id ?? null,
    total_plays: totalPlays,
    note: isBaseline ? "[ai] baseline inicial" : "[ai] auto-collect",
    print_urls,
    is_baseline: isBaseline,
  });

  // 5. Reagenda song
  if (song_id) {
    const { data: songRow } = await supabase
      .from("curator_deal_songs")
      .select("auto_collect_interval_minutes")
      .eq("id", song_id)
      .single();
    const intervalMin = songRow?.auto_collect_interval_minutes ?? 1440;
    const nextAt = new Date(Date.now() + intervalMin * 60_000).toISOString();

    await supabase
      .from("curator_deal_songs")
      .update({
        auto_collect_status: "idle",
        auto_collect_error: null,
        last_auto_collect_at: new Date().toISOString(),
        next_auto_collect_at: nextAt,
        last_print_at: new Date().toISOString(),
      })
      .eq("id", song_id);
  }

  // 6. Marca batch processado
  if (batch_id) {
    await supabase
      .from("bot_print_batches")
      .update({ status: "processed", processed_at: new Date().toISOString() })
      .eq("id", batch_id);
  }

  await supabase.from("collection_logs").insert({
    acao: "extract_print",
    status: skipped > 0 ? "parcial" : "ok",
    mensagem: `deal=${deal_id} prints=${print_urls.length} found=${extracted.length} inserted=${inserted} skipped=${skipped}`,
  });

  return jr({
    ok: true,
    playlists_found: extracted.length,
    inserted,
    skipped,
    total_plays: totalPlays,
  });
});
