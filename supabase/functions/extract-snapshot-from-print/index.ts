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
        position: z.union([z.number(), z.string()]).optional(),
        name: z.string().optional(),
        url: z.string().optional(),
        made_by: z.string().optional(),
        plays_text: z.string().optional(),
      }).passthrough(),
    )
    .optional(),
});

function parsePlaysText(s: string | null | undefined): number | null {
  if (s == null) return null;
  const onlyDigits = String(s).replace(/[^\d]/g, "");
  if (!onlyDigits) return null;
  const n = parseInt(onlyDigits, 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

const GeminiPlaylistSchema = z.object({
  playlist_name: z.string().min(1).max(300),
  spotify_url: z.string().optional().nullable(),
  made_by: z.string().optional().nullable(),
  position: z.union([z.number(), z.string()]).optional().nullable().transform((v) => {
    if (v === null || v === undefined || v === "") return null;
    const n = typeof v === "number" ? v : parseInt(String(v).replace(/\D/g, ""), 10);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
  }),
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
  position?: number | null;
}

async function callGeminiChunked(printUrls: string[]): Promise<ExtractedPlaylist[]> {
  // Processa em pedaços de 2 prints pra evitar truncamento de tool_call.
  const CHUNK = 2;
  const all: ExtractedPlaylist[] = [];
  const seen = new Map<string, number>(); // key -> idx em `all`
  let runningIndex = 0;
  for (let i = 0; i < printUrls.length; i += CHUNK) {
    const slice = printUrls.slice(i, i + CHUNK);
    let part: ExtractedPlaylist[] = [];
    try {
      part = await callGeminiOnce(slice, runningIndex);
    } catch (e) {
      console.warn(`gemini chunk ${i / CHUNK + 1} falhou, segue`, e instanceof Error ? e.message : e);
      runningIndex += 12; // estima ~6 linhas por print pra não colidir posições
      continue;
    }
    for (const p of part) {
      const key = normName(p.playlist_name ?? "");
      if (!key) continue;
      if (seen.has(key)) {
        // mantém entrada com mais plays + menor position
        const idx = seen.get(key)!;
        const cur = all[idx];
        const merged: ExtractedPlaylist = {
          ...cur,
          plays: Math.max(cur.plays ?? 0, p.plays ?? 0),
          position: Math.min(
            cur.position ?? Number.MAX_SAFE_INTEGER,
            p.position ?? Number.MAX_SAFE_INTEGER,
          ),
          spotify_url: cur.spotify_url ?? p.spotify_url ?? null,
          made_by: cur.made_by ?? p.made_by ?? null,
        };
        all[idx] = merged;
      } else {
        seen.set(key, all.length);
        all.push(p);
      }
    }
    // próximo chunk começa a partir da maior posição vista (ou +CHUNK*6 fallback)
    const maxPos = part.reduce((m, x) => Math.max(m, x.position ?? 0), 0);
    runningIndex = Math.max(runningIndex + slice.length * 6, maxPos);
  }
  // garante ordenação final por position (asc), com NULLs no fim
  all.sort((a, b) => (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER));
  // re-numera sequencialmente pra ficar 1..N consistente
  return all.map((p, i) => ({ ...p, position: i + 1 }));
}

// Normalização forte: minúsculas, sem acentos, sem emojis, sem múltiplos espaços
function normName(s: string): string {
  if (!s) return "";
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

async function callGeminiOnce(printUrls: string[], startIndex: number): Promise<ExtractedPlaylist[]> {
  const userContent: any[] = [
    {
      type: "text",
      text:
        "Estas são capturas de tela da página 'Playlists' do Spotify for Artists para uma música. " +
        "Cada linha da tabela tem: posição (rank, do topo pro fim), capa, nome da playlist, criador (coluna 'Made by' — pode ser 'Spotify', um nome de usuário, ou vazio '—'), " +
        "streams (coluna 'Streams', últimos 7 ou 28 dias), e data adicionada. " +
        "Extraia TODAS as playlists visíveis em TODOS os prints, NA ORDEM EXATA em que aparecem (de cima pra baixo). " +
        "IMPORTANTE: " +
        `- 'position' é a posição na lista, começando em ${startIndex + 1} para a primeira playlist do PRIMEIRO print enviado, e seguindo sequencialmente. ` +
        "- Se a mesma playlist aparecer em mais de um print (por overlap de scroll), liste só UMA vez (mantenha a posição da primeira aparição). " +
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
          description: "Reporta a lista de playlists extraídas dos prints, na ordem em que aparecem.",
          parameters: {
            type: "object",
            properties: {
              playlists: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    position: {
                      type: "integer",
                      description: "Posição (rank) da playlist na lista do Spotify for Artists, do topo pro fim.",
                    },
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
                  required: ["position", "playlist_name", "plays"],
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
      ? args.playlists.filter((p: any) => p?.playlist_name).map((p: any, i: number) => ({
          playlist_name: String(p.playlist_name),
          spotify_url: p.spotify_url ?? null,
          made_by: p.made_by ?? null,
          position: typeof p.position === "number" ? p.position : (startIndex + i + 1),
          plays: Math.max(0, parseInt(String(p.plays ?? 0).replace(/\D/g, "")) || 0),
        }))
      : [];
  }
  return validated.data.playlists as ExtractedPlaylist[];
}

// Insere snapshot. Se houver batch_id e já existir registro pra mesma playlist
// nesse batch, atualiza apenas se o novo plays for maior (idempotência por lote).
async function upsertSnapshot(
  supabase: any,
  row: {
    deal_id: string;
    song_id: string | null;
    playlist_id: string;
    plays: number;
    source: string;
    match_method: string;
    is_baseline: boolean;
    print_url: string | null;
    ai_raw: any;
    batch_id: string | null;
  },
): Promise<any> {
  if (!row.batch_id) {
    const { error } = await supabase.from("curator_deal_snapshots").insert(row);
    return error;
  }

  const { data: existing } = await supabase
    .from("curator_deal_snapshots")
    .select("id, plays")
    .eq("batch_id", row.batch_id)
    .eq("playlist_id", row.playlist_id)
    .maybeSingle();

  if (existing?.id) {
    if ((row.plays ?? 0) > (existing.plays ?? 0)) {
      const { error } = await supabase
        .from("curator_deal_snapshots")
        .update({
          plays: row.plays,
          match_method: row.match_method,
          ai_raw: row.ai_raw,
          print_url: row.print_url,
        })
        .eq("id", existing.id);
      return error;
    }
    return null; // já existe com plays >= novo, ignora
  }

  const { error } = await supabase.from("curator_deal_snapshots").insert(row);
  return error;
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

  // GUARD: se batch já foi processado, ignora (evita reprocessamento que duplica dados)
  if (batch_id) {
    const { data: bStatus } = await supabase
      .from("bot_print_batches")
      .select("status, processed_at")
      .eq("id", batch_id)
      .maybeSingle();
    if (bStatus?.status === "processed") {
      console.log(`[extract] batch ${batch_id} já processado em ${bStatus.processed_at}, ignorando`);
      return jr({ ok: true, skipped_reason: "batch_already_processed", batch_id });
    }
    if (bStatus?.status === "processing") {
      console.log(`[extract] batch ${batch_id} já em processing, ignorando concorrência`);
      return jr({ ok: true, skipped_reason: "batch_in_progress", batch_id });
    }
  }

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

  // Index DOM por nome/ID/posição. Filtra entradas com url vazia (algorítmicas
  // do Spotify como Radio, Mixes, Smart Shuffle, que não têm link no HTML).
  const norm = normName;
  const domByName = new Map<string, { id: string; url: string; name: string; position?: number; plays?: number | null; made_by?: string | null }>();
  const domByPos = new Map<number, { id: string; url: string; name: string; position: number; plays?: number | null; made_by?: string | null }>();
  const domItems: Array<{ id: string; url: string; name: string; position?: number; plays?: number | null; made_by?: string | null }> = [];
  let domHasPlaysText = false;
  // Mantemos algorítmicas (made_by=Spotify) mesmo sem URL — id sintético "algo:<nome>".
  for (let i = 0; i < dom_playlists.length; i++) {
    const d = dom_playlists[i];
    if (!d?.name) continue;
    const name = String(d.name).trim();
    const madeBy = ((d as any).made_by ?? null) as string | null;
    const isAlgoRow = (madeBy ?? "").trim().toLowerCase() === "spotify" || !d.url;
    let id: string;
    if (d.url) {
      const m = d.url.match(/playlist[/:]([a-zA-Z0-9]{16,})/);
      if (!m) {
        if (!isAlgoRow) continue;
        id = `algo:${normName(name)}`;
      } else {
        id = m[1];
      }
    } else {
      if (!isAlgoRow) continue;
      id = `algo:${normName(name)}`;
    }
    const playsNum = parsePlaysText(d.plays_text);
    if (playsNum != null) domHasPlaysText = true;
    const posRaw = (d as any).position;
    const pos = typeof posRaw === "number"
      ? posRaw
      : posRaw != null ? parseInt(String(posRaw).replace(/\D/g, ""), 10) : NaN;
    const position = Number.isFinite(pos) && pos > 0 ? pos : (i + 1);
    const item = {
      id,
      url: d.url ?? "",
      name,
      position,
      plays: playsNum,
      made_by: madeBy,
    };
    domByName.set(norm(name), item);
    domByPos.set(position, item);
    domItems.push(item);
  }

  // WHITELIST: só consideramos playlists declaradas pelo curador.
  // Se o curador ainda não cadastrou nenhuma, mantemos comportamento atual
  // (grava tudo). Se cadastrou, ignoramos qualquer playlist fora da lista.
  const { data: whitelistRows } = await supabase
    .from("curator_playlists")
    .select("spotify_playlist_id")
    .eq("deal_id", deal_id)
    .not("spotify_playlist_id", "is", null);
  const whitelist = new Set<string>(
    (whitelistRows ?? [])
      .map((r: any) => r.spotify_playlist_id)
      .filter((v: unknown): v is string => typeof v === "string" && v.length > 0),
  );
  const whitelistActive = whitelist.size > 0;
  console.log(`[extract] whitelist deal=${deal_id} size=${whitelist.size} active=${whitelistActive}`);

  // Marca batch como processing
  if (batch_id) {
    await supabase
      .from("bot_print_batches")
      .update({ status: "processing" })
      .eq("id", batch_id);
  }

  // 1. Fonte de dados: se DOM trouxer plays_text preenchido, usa DOM direto
  // (mais confiável que OCR). Caso contrário, chama Gemini Vision como antes.
  let extracted: ExtractedPlaylist[] = [];
  let usedDomDirect = false;
  if (domHasPlaysText && domItems.length > 0) {
    usedDomDirect = true;
    extracted = domItems
      .filter((d) => d.plays != null) // só linhas com plays lidos do DOM
      .map((d) => ({
        playlist_name: d.name,
        spotify_url: d.url,
        made_by: d.made_by ?? null,
        position: d.position ?? null,
        plays: d.plays ?? 0,
      }));
    console.log(`[extract] usando DOM direto: ${extracted.length} playlists com plays_text`);
  } else {
    try {
      extracted = await callGeminiChunked(print_urls);
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
  let algorithmicCount = 0;
  let algorithmicNew = 0;
  let totalPlays = 0;
  let domLinked = 0;

  // IDs das playlists algorítmicas vistas nesta coleta — usado pra detectar "saiu"
  const algorithmicSeenIds: string[] = [];
  const processedSpotifyIds = new Set<string>();
  const processedNames = new Set<string>();

  // Blocklist: nomes exatos da seção "Ouvintes / Algorítmico" do Spotify for Artists.
  // Essas linhas aparecem abaixo da curadoria e NÃO são playlists curadas.
  const ALGO_NAMES = new Set([
    "radio", "mixes", "daylist", "smart shuffle", "on repeat", "blend",
    "your dj", "discover weekly", "release radar", "made for you",
    "repeat rewind", "your top songs", "niche mixes", "uniquely yours",
  ]);
  const isAlgorithmic = (name: string | null, madeBy: string | null, spotifyId?: string | null) => {
    if ((spotifyId ?? "").startsWith("37i9dQZF")) return true;
    if ((madeBy ?? "").trim().toLowerCase() === "spotify") return true;
    const n = (name ?? "").trim().toLowerCase();
    if (!n) return false;
    if (ALGO_NAMES.has(n)) return true;
    // variações tipo "X Mix", "Daily Mix 1", "Discover Weekly"
    if (/\b(daily mix|mix \d+|on repeat|smart shuffle)\b/.test(n)) return true;
    return false;
  };

  let filteredOut = 0;

  for (const pl of extracted) {
    const sName = pl.playlist_name ?? null;
    const plays = Math.max(0, parseInt(String(pl.plays ?? 0)) || 0);
    const isAlgo = isAlgorithmic(sName, pl.made_by ?? null);

    // Resolve spotify_playlist_id antecipadamente (Gemini URL ou DOM por nome)
    // pra aplicar whitelist do curador antes de qualquer escrita.
    let preResolvedId = extractId(pl.spotify_url ?? "");
    if (!preResolvedId && sName) {
      const hit = domByName.get(norm(sName));
      if (hit) preResolvedId = hit.id;
    }
    if (whitelistActive && !isAlgo) {
      if (!preResolvedId || preResolvedId.startsWith("algo:") || !whitelist.has(preResolvedId)) {
        filteredOut++;
        continue;
      }
    }

    // Algorítmicas: registram como playlist interna (match_status=algorithmic),
    // sem entrar no totalPlays e sem aparecer em curadoria, mas geram alerta
    // quando entram (primeira vez vista) ou somem (próxima coleta).
    if (isAlgo) {
      algorithmicCount++;
      const algoName = sName ?? "Algorítmica";
      // Procura registro existente
      const { data: existing } = await supabase
        .from("curator_playlists")
        .select("id, match_status")
        .eq("deal_id", deal_id)
        .eq("playlist_name", algoName)
        .eq("match_status", "algorithmic")
        .maybeSingle();

      let algoId = existing?.id as string | undefined;
      if (!algoId) {
        const { data: created } = await supabase
          .from("curator_playlists")
          .insert({
            deal_id,
            song_id: song_id ?? null,
            spotify_url: pl.spotify_url ?? "",
            playlist_name: algoName,
            spotify_owner_name: pl.made_by ?? "Spotify",
            is_baseline: false,
            match_status: "algorithmic",
          })
          .select("id")
          .single();
        algoId = created?.id;
        if (algoId) {
          algorithmicNew++;
          // Alerta interno: nova algorítmica entrou
          try {
            await supabase.rpc("create_notification" as any, {
              p_type: "info",
              p_title: "Nova playlist algorítmica",
              p_message: `${algoName} começou a tocar a faixa (${plays.toLocaleString("pt-BR")} streams).`,
              p_action_url: `/playlist-deals?deal=${deal_id}`,
              p_metadata: { deal_id, song_id, playlist_name: algoName, plays, kind: "algorithmic_in" },
            });
          } catch (_) { /* ignore */ }
        }
      }
      if (algoId) {
        algorithmicSeenIds.push(algoId);
        // Snapshot interno (não conta no curador)
        await upsertSnapshot(supabase, {
          deal_id,
          song_id: song_id ?? null,
          playlist_id: algoId,
          plays,
          source: "spotify_for_artists",
          match_method: "algorithmic",
          is_baseline: false,
          print_url: print_urls[0] ?? null,
          ai_raw: { ...pl, algorithmic: true },
          batch_id: batch_id ?? null,
        });
      }
      continue;
    }

    totalPlays += plays;

    // PRIORIDADE 1: bate o nome lido pelo Gemini com o DOM (link real do HTML).
    // PRIORIDADE 2 (fallback): se nome não bateu, tenta casar por position.
    let sUrl = pl.spotify_url ?? "";
    let sId = extractId(sUrl);
    let domHit: { id: string; url: string } | undefined;
    if (sName) {
      const byName = domByName.get(norm(sName));
      if (byName) domHit = { id: byName.id, url: byName.url };
    }
    if (!domHit && typeof pl.position === "number" && pl.position > 0) {
      const byPos = domByPos.get(pl.position);
      if (byPos && (!sId || byPos.id !== sId)) domHit = { id: byPos.id, url: byPos.url };
    }
    if (domHit) {
      sId = domHit.id;
      sUrl = domHit.url;
    }
    if (sId) processedSpotifyIds.add(sId);
    if (sName) processedNames.add(norm(sName));

    let playlistId: string | null = null;
    let matchMethod: string | null = null;

    const { data: matchData } = await supabase.rpc("match_curator_playlist", {
      p_deal_id: deal_id,
      p_spotify_playlist_id: sId,
      p_playlist_name: sName,
      p_song_id: song_id ?? null,
    } as any);
    const row = Array.isArray(matchData) ? matchData[0] : null;
    if (row?.playlist_id) {
      playlistId = row.playlist_id as string;
      matchMethod = (row.match_method as string) ?? null;

      // AUTO-CURA: se bateu por nome mas DOM trouxe ID confiável,
      // popula spotify_playlist_id da row existente.
      const updPayload: any = {};
      if (domHit && matchMethod !== "spotify_id") {
        updPayload.spotify_playlist_id = domHit.id;
        updPayload.spotify_url = domHit.url;
      }
      if (typeof pl.position === "number" && pl.position > 0) {
        updPayload.position_in_paste = pl.position;
        updPayload.last_paste_at = new Date().toISOString();
      }
      if (Object.keys(updPayload).length > 0) {
        await supabase
          .from("curator_playlists")
          .update(updPayload)
          .eq("id", playlistId);
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
          position_in_paste: typeof pl.position === "number" ? pl.position : null,
          last_paste_at: new Date().toISOString(),
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

    const insErr = await upsertSnapshot(supabase, {
      deal_id,
      song_id: song_id ?? null,
      playlist_id: playlistId,
      plays,
      source: "spotify_for_artists",
      match_method: matchMethod ?? (sId ? "spotify_id" : "name"),
      is_baseline: isBaseline,
      print_url: print_urls[0] ?? null,
      ai_raw: { ...pl, dom_matched: !!domHit },
      batch_id: batch_id ?? null,
    });
    if (insErr) skipped++;
    else inserted++;
  }

  // 3.1. Complemento DOM: o bot pode mandar 100 links do HTML mesmo quando
  // mandou só 1 print. A IA só lê plays do que está visível; aqui garantimos
  // que a lista de links fique completa, sem inventar streams.
  for (const dom of domItems) {
    if (dom.id.startsWith("algo:")) continue; // já tratada no loop principal
    if (processedSpotifyIds.has(dom.id) || processedNames.has(norm(dom.name))) continue;
    if (isAlgorithmic(dom.name, dom.made_by ?? null, dom.id)) continue;
    if (whitelistActive && !whitelist.has(dom.id)) {
      filteredOut++;
      continue;
    }

    const { data: matchData } = await supabase.rpc("match_curator_playlist", {
      p_deal_id: deal_id,
      p_spotify_playlist_id: dom.id,
      p_playlist_name: dom.name,
      p_song_id: song_id ?? null,
    } as any);
    const row = Array.isArray(matchData) ? matchData[0] : null;

    if (row?.playlist_id) {
      await supabase
        .from("curator_playlists")
        .update({ spotify_playlist_id: dom.id, spotify_url: dom.url })
        .eq("id", row.playlist_id as string);
      domLinked++;
      continue;
    }

    const { error: cErr } = await supabase
      .from("curator_playlists")
      .insert({
        deal_id,
        song_id: song_id ?? null,
        spotify_url: dom.url,
        spotify_playlist_id: dom.id,
        playlist_name: dom.name,
        is_baseline: false,
        match_status: "organic",
        match_reason: "dom_only_link_no_visual_plays",
      });
    if (cErr) skipped++;
    else domLinked++;
  }

  // 3.5. Detecta algorítmicas que sumiram (existiam, mas não vieram nesta coleta)
  let algorithmicGone = 0;
  if (!isBaseline) {
    let goneQ = supabase
      .from("curator_playlists")
      .select("id, playlist_name")
      .eq("deal_id", deal_id)
      .eq("match_status", "algorithmic");
    if (algorithmicSeenIds.length > 0) {
      goneQ = goneQ.not("id", "in", `(${algorithmicSeenIds.join(",")})`);
    }
    const { data: goneList } = await goneQ;
    for (const g of goneList ?? []) {
      // Só notifica se ainda não notificamos a saída recente (última snap > 24h)
      const { data: lastSnap } = await supabase
        .from("curator_deal_snapshots")
        .select("captured_at")
        .eq("playlist_id", g.id)
        .order("captured_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const lastTs = lastSnap?.captured_at ? new Date(lastSnap.captured_at).getTime() : 0;
      // Evita spam: só dispara se a última leitura foi há menos de 7 dias (saída "fresca")
      if (lastTs > 0 && Date.now() - lastTs < 7 * 86400_000) {
        algorithmicGone++;
        try {
          await supabase.rpc("create_notification" as any, {
            p_type: "info",
            p_title: "Playlist algorítmica saiu",
            p_message: `${g.playlist_name} parou de tocar a faixa.`,
            p_action_url: `/playlist-deals?deal=${deal_id}`,
            p_metadata: { deal_id, song_id, playlist_name: g.playlist_name, kind: "algorithmic_out" },
          });
        } catch (_) { /* ignore */ }
      }
    }
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

  const elapsedMs = Date.now() - t0;
  await supabase.from("collection_logs").insert({
    acao: "extract_print",
    status: skipped > 0 ? "parcial" : "ok",
    duracao_ms: elapsedMs,
    mensagem: `deal=${deal_id} src=${usedDomDirect ? "dom" : "gemini"} prints=${print_urls.length} dom=${dom_playlists.length} found=${extracted.length} dom_linked=${domLinked} algo=${algorithmicCount} algo_new=${algorithmicNew} algo_gone=${algorithmicGone} inserted=${inserted} skipped=${skipped} whitelist=${whitelistActive ? whitelist.size : "off"} filtered_out=${filteredOut} ms=${elapsedMs}`,
  });

  return jr({
    ok: true,
    playlists_found: extracted.length,
    inserted,
    skipped,
    dom_linked: domLinked,
    algorithmic: algorithmicCount,
    algorithmic_new: algorithmicNew,
    algorithmic_gone: algorithmicGone,
    total_plays: totalPlays,
    whitelist_active: whitelistActive,
    whitelist_size: whitelist.size,
    filtered_out: filteredOut,
  });
});

