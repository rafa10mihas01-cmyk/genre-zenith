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
import { writeCuratorDealSnapshot } from "../_shared/snapshot-writer.ts";
import { z } from "npm:zod@3.23.8";
import { fetchPlaylistMeta } from "../_shared/curator-playlist.ts";
import { recordMetric } from "../_shared/ops-metrics.ts";
import { logAiUsage } from "../_shared/rate-limit.ts";
import { classifyPlaylistKind } from "../_shared/algorithmic-classifier.ts";

// ============= Schemas de validação =============
const RequestSchema = z.object({
  deal_id: z.string().uuid(),
  song_id: z.string().uuid().nullable().optional(),
  print_urls: z.array(z.string().url()).min(1).max(40),
  batch_id: z.string().uuid().optional(),
  correlation_id: z.string().uuid().nullable().optional(),
  dom_playlists: z
    .array(
      z.object({
        position: z.union([z.number(), z.string()]).optional(),
        name: z.string().optional(),
        url: z.string().optional(),
        made_by: z.string().optional(),
        plays_text: z.string().optional(),
        plays_24h: z.union([z.number(), z.string()]).nullable().optional(),
        plays_7d: z.union([z.number(), z.string()]).nullable().optional(),
        plays_28d: z.union([z.number(), z.string()]).nullable().optional(),
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

function parseWindowNum(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : parseInt(String(v).replace(/[^\d]/g, ""), 10);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
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
  plays_24h?: number | null;
  plays_7d?: number | null;
  plays_28d?: number | null;
}

// Hash estável da URL de storage (ignora token de assinatura)
function stripSignedQuery(u: string): string {
  try {
    const url = new URL(u);
    return url.origin + url.pathname;
  } catch {
    return u;
  }
}

async function sha256Hex(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Cache de IA por hash de print: evita reprocessar o mesmo lote com Gemini.
async function callGeminiOnceCached(
  printUrls: string[],
  startIndex: number,
  cacheClient: ReturnType<typeof createClient>,
): Promise<ExtractedPlaylist[]> {
  const MODEL = "google/gemini-2.5-flash";
  const key = await sha256Hex(MODEL + "|" + printUrls.map(stripSignedQuery).sort().join("\n"));

  // 1) tenta cache
  try {
    const { data: cached } = await cacheClient
      .from("ai_print_cache")
      .select("result")
      .eq("print_hash", key)
      .maybeSingle();
    if (cached?.result?.playlists) {
      await cacheClient
        .from("ai_print_cache")
        .update({ hits: (cached as any).hits + 1 || 1, last_hit_at: new Date().toISOString() })
        .eq("print_hash", key);
      return cached.result.playlists as ExtractedPlaylist[];
    }
  } catch (e) {
    console.warn("ai_print_cache read failed (ignore):", e instanceof Error ? e.message : e);
  }

  // 2) chama o modelo
  const fresh = await callGeminiOnce(printUrls, startIndex);

  // 3) grava no cache (best-effort)
  try {
    await cacheClient.from("ai_print_cache").upsert(
      {
        print_hash: key,
        model: MODEL,
        result: { playlists: fresh },
        hits: 0,
      },
      { onConflict: "print_hash" },
    );
  } catch (e) {
    console.warn("ai_print_cache write failed (ignore):", e instanceof Error ? e.message : e);
  }

  return fresh;
}

async function callGeminiChunked(
  printUrls: string[],
  cacheClient?: ReturnType<typeof createClient>,
): Promise<ExtractedPlaylist[]> {
  // Processa em pedaços de 2 prints pra evitar truncamento de tool_call.
  const CHUNK = 2;
  const all: ExtractedPlaylist[] = [];
  const seen = new Map<string, number>(); // key -> idx em `all`
  let runningIndex = 0;
  for (let i = 0; i < printUrls.length; i += CHUNK) {
    const slice = printUrls.slice(i, i + CHUNK);
    let part: ExtractedPlaylist[] = [];
    try {
      part = cacheClient
        ? await callGeminiOnceCached(slice, runningIndex, cacheClient)
        : await callGeminiOnce(slice, runningIndex);
    } catch (e) {
      console.warn(`gemini chunk ${i / CHUNK + 1} falhou, segue`, e instanceof Error ? e.message : e);
      runningIndex += 12; // estima ~6 linhas por print pra não colidir posições
      continue;
    }
    for (const p of part) {
      // Preferir spotify_playlist_id (extraído da URL) como chave. Nome só como fallback.
      const idKey = extractId(p.spotify_url ?? "");
      let key: string;
      if (idKey) {
        key = `id:${idKey}`;
      } else {
        const nameKey = normName(p.playlist_name ?? "");
        if (!nameKey) continue;
        console.warn(`[WARN] extract-snapshot-from-print: dedupe por playlist_name fallback (sem spotify URL). name="${p.playlist_name}"`);
        key = `name:${nameKey}`;
      }
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
    model: "google/gemini-2.5-flash",
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

  const aiStart = Date.now();
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
    await logAiUsage({
      functionName: "extract-snapshot-from-print",
      model: "google/gemini-2.5-flash",
      durationMs: Date.now() - aiStart,
      status: "error",
      error: `HTTP ${resp.status}: ${t.slice(0, 200)}`,
      metadata: { prints: printUrls.length },
    });
    throw new Error(`gemini ${resp.status}: ${t.slice(0, 500)}`);
  }
  const data = await resp.json();
  const usage = data?.usage ?? {};
  await logAiUsage({
    functionName: "extract-snapshot-from-print",
    model: "google/gemini-2.5-flash",
    tokensIn: Number(usage.prompt_tokens) || null,
    tokensOut: Number(usage.completion_tokens) || null,
    tokensTotal: Number(usage.total_tokens) || null,
    durationMs: Date.now() - aiStart,
    status: "ok",
    metadata: { prints: printUrls.length, cache: "miss" },
  });
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
    is_initial_capture: boolean;
    print_url: string | null;
    ai_raw: any;
    batch_id: string | null;
    correlation_id?: string | null;
    plays_24h?: number | null;
    plays_7d?: number | null;
    plays_28d?: number | null;
  },
): Promise<any> {
  // NC-003: writer único via _shared/snapshot-writer.ts.
  const r = await writeCuratorDealSnapshot(supabase, {
    deal_id: row.deal_id,
    song_id: row.song_id,
    playlist_id: row.playlist_id,
    plays: row.plays,
    source: row.source,
    match_method: row.match_method,
    is_initial_capture: row.is_initial_capture,
    print_url: null,
    snapshot_run_id: row.batch_id,
    ai_raw: row.ai_raw,
    batch_id: row.batch_id,
    correlation_id: row.correlation_id ?? null,
    plays_24h: row.plays_24h ?? null,
    plays_7d: row.plays_7d ?? null,
    plays_28d: row.plays_28d ?? null,
  });
  return r.error ? { message: r.error } as any : null;
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
  let rawText = "";
  try {
    rawText = await req.text();
    body = rawText ? JSON.parse(rawText) : null;
  } catch {
    return jr({ error: "invalid_json" }, 400);
  }

  // Fase 3.A.1 — raw_ingest obrigatório em todo parser (OCR = parser de imagem).
  // Mesmo quando invocado internamente por `bot-upload-print`, registramos aqui
  // pra fechar o ciclo de auditoria do parser propriamente dito.
  try {
    const { logRawIngest } = await import("../_shared/raw-ingest.ts");
    const sbForAudit = createClient(SUPABASE_URL, SERVICE_KEY);
    await logRawIngest(sbForAudit, {
      endpoint: "extract-snapshot-from-print",
      req,
      rawText,
      payload: body,
    });
  } catch (_) { /* logging nunca quebra o ingest */ }

  const parsedBody = RequestSchema.safeParse(body);
  if (!parsedBody.success) {
    return jr({ error: "invalid_body", detail: parsedBody.error.flatten() }, 400);
  }
  const { song_id, deal_id, print_urls, batch_id } = parsedBody.data;
  let correlation_id: string | null = parsedBody.data.correlation_id ?? null;
  let dom_playlists: Array<{ name?: string; url?: string; plays_text?: string }> =
    parsedBody.data.dom_playlists ?? [];

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  // GUARD: se batch já foi processado, ignora (evita reprocessamento que duplica dados)
  if (batch_id) {
    const { data: bStatus } = await supabase
      .from("bot_print_batches")
      .select("status, processed_at, correlation_id")
      .eq("id", batch_id)
      .maybeSingle();
    // Recupera correlation_id do batch se body não trouxe
    if (!correlation_id && bStatus?.correlation_id) correlation_id = bStatus.correlation_id;
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
  type DomItem = {
    id: string;
    url: string;
    name: string;
    position?: number;
    plays?: number | null;
    made_by?: string | null;
    plays_24h?: number | null;
    plays_7d?: number | null;
    plays_28d?: number | null;
  };
  const domByName = new Map<string, DomItem>();
  const domByPos = new Map<number, DomItem>();
  const domItems: DomItem[] = [];
  let domHasPlaysText = false;
  // Mantemos algorítmicas (made_by=Spotify) mesmo sem URL — id sintético "algo:<nome>".
  for (let i = 0; i < dom_playlists.length; i++) {
    const d = dom_playlists[i] as any;
    // Aceita ambos os shapes: o legado `{name,url}` e o oficial gravado pelo
    // bot (`{playlist_name, spotify_url, spotify_playlist_id}`).
    const rawName = d?.name ?? d?.playlist_name ?? null;
    const rawUrl = d?.url ?? d?.spotify_url ?? null;
    const rawSpId = d?.spotify_playlist_id ?? null;
    if (!rawName) continue;
    const name = String(rawName).trim();
    const madeBy = (d.made_by ?? null) as string | null;
    const hasUrl = !!rawUrl || !!rawSpId;
    const isAlgoRow = (madeBy ?? "").trim().toLowerCase() === "spotify" || !hasUrl;
    let id: string;
    if (rawSpId) {
      id = String(rawSpId);
    } else if (rawUrl) {
      const m = String(rawUrl).match(/playlist[/:]([a-zA-Z0-9]{16,})/);
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
    const w24 = parseWindowNum(d.plays_24h);
    const w7 = parseWindowNum(d.plays_7d);
    const w28 = parseWindowNum(d.plays_28d);
    // plays "principal" do DOM: prioriza 7d (janela default histórica), depois 24h, 28d, depois plays_text legado
    const playsLegacy = parsePlaysText(d.plays_text);
    const playsNum = w7 ?? w24 ?? w28 ?? playsLegacy;
    if (playsNum != null) domHasPlaysText = true;
    const posRaw = d.position;
    const pos = typeof posRaw === "number"
      ? posRaw
      : posRaw != null ? parseInt(String(posRaw).replace(/\D/g, ""), 10) : NaN;
    const position = Number.isFinite(pos) && pos > 0 ? pos : (i + 1);
    const item: DomItem = {
      id,
      url: rawUrl ?? (id && !id.startsWith("algo:") ? `https://open.spotify.com/playlist/${id}` : ""),
      name,
      position,
      plays: playsNum,
      made_by: madeBy,
      plays_24h: w24,
      plays_7d: w7,
      plays_28d: w28,
    };
    // Dedup interno: se o bot mandar a mesma playlist em prints diferentes,
    // mantém apenas a 1ª ocorrência (por spotify_playlist_id / id sintético algo:).
    if (domItems.some((x) => x.id === id)) continue;
    domByName.set(normName(name), item);
    domByPos.set(position, item);
    domItems.push(item);
  }
  const domWindowCoverage = domItems.reduce(
    (acc, item) => {
      if (item.plays_24h != null) acc.with24h += 1;
      if (item.plays_7d != null) acc.with7d += 1;
      if (item.plays_28d != null) acc.with28d += 1;
      return acc;
    },
    { total: domItems.length, with24h: 0, with7d: 0, with28d: 0 },
  );

  // WHITELIST: só consideramos playlists declaradas pelo curador.
  // 🔒 BLINDAGEM: se o curador NÃO cadastrou nenhuma playlist, NÃO coleta.
  // Recusa o batch, marca a song como aguardando, e não grava nada.
  const { data: whitelistRows } = await supabase
    .from("curator_playlists")
    .select("spotify_playlist_id")
    .eq("deal_id", deal_id)
    .neq("match_status", "algorithmic")
    .not("spotify_playlist_id", "is", null);
  const whitelist = new Set<string>(
    (whitelistRows ?? [])
      .map((r: any) => r.spotify_playlist_id)
      .filter((v: unknown): v is string => typeof v === "string" && v.length > 0),
  );
  const whitelistActive = whitelist.size > 0;
  console.log(`[extract] whitelist deal=${deal_id} size=${whitelist.size} active=${whitelistActive}`);

  // Campanhas internas também têm playlists próprias em managed_playlists.
  // Elas não pertencem à whitelist do curador, mas DEVEM ser atribuídas ao Ecossistema.
  const { data: dealRowForEco } = await supabase
    .from("curator_deals")
    .select("campaign_id, source")
    .eq("id", deal_id)
    .maybeSingle();
  const ecoCampaignId = (dealRowForEco as any)?.campaign_id ?? null;
  const isCampaignInternal = !!ecoCampaignId && (dealRowForEco as any)?.source === "campaign_internal";
  const { data: managedRows } = isCampaignInternal
    ? await supabase
        .from("managed_playlists")
        .select("id, spotify_playlist_id, spotify_url, name, followers")
        .neq("playlist_type", "ARCHIVED")
    : { data: [] as any[] };
  const managedById = new Map<string, any>();
  const managedByName = new Map<string, any>();
  for (const mp of managedRows ?? []) {
    if (mp.spotify_playlist_id) managedById.set(mp.spotify_playlist_id, mp);
    if (mp.name) managedByName.set(norm(mp.name), mp);
  }

  // Deals internos de campanha não têm whitelist de curador; eles devem capturar o
  // ecossistema/orgânico completo do S4A. O bloqueio por whitelist vale só para
  // deals de curador externo.
  if (!whitelistActive && !isCampaignInternal) {
    if (batch_id) {
      await supabase
        .from("bot_print_batches")
        .update({
          status: "error",
          error: "no_curator_whitelist",
        })
        .eq("id", batch_id);
    }
    if (song_id) {
      await supabase
        .from("curator_deal_songs")
        .update({
          auto_collect_status: "idle",
          auto_collect_error: "Aguardando curador cadastrar playlists",
          next_auto_collect_at: new Date(Date.now() + 60 * 60_000).toISOString(),
          queued_at: null,
        })
        .eq("id", song_id);
    }
    await supabase.from("collection_logs").insert({
      acao: "extract_print",
      status: "skipped",
      mensagem: `deal=${deal_id} bloqueado: curador sem playlists cadastradas`,
    });
    return jr({
      ok: false,
      skipped_reason: "no_curator_whitelist",
      message: "Nenhuma playlist cadastrada pelo curador. Coleta bloqueada.",
    });
  }

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
        plays_24h: d.plays_24h ?? null,
        plays_7d: d.plays_7d ?? null,
        plays_28d: d.plays_28d ?? null,
      }));
    console.log(`[extract] usando DOM direto: ${extracted.length} playlists com plays_text`);
  } else {
    try {
      extracted = await callGeminiChunked(print_urls, supabase);
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
            queued_at: null,
          })
          .eq("id", song_id);
      }
      await supabase.from("collection_logs").insert({
        acao: "extract_print",
        status: "error",
        mensagem: `deal=${deal_id} ${msg.slice(0, 300)}`,
      });
      recordMetric(supabase, {
        scope: "ocr",
        operation: "extract-snapshot-from-print",
        status: "error",
        duration_ms: Date.now() - t0,
        deal_id,
        song_id: song_id ?? null,
        metadata: { error: msg.slice(0, 240), prints: print_urls.length, batch_id: batch_id ?? null },
      });
      if (correlation_id) {
        void supabase.from("bot_events").insert({
          bot_name: "spotify-artists-bot",
          deal_id, song_id: song_id ?? null,
          step: "extract_snapshot",
          status: "error",
          lifecycle_state: "FAILED",
          correlation_id,
          message: msg.slice(0, 400),
          discard_reason: `gemini_extract: ${msg.slice(0, 200)}`,
          metadata: { batch_id: batch_id ?? null, stage: "gemini_extract" },
        });
      }
      return jr({ error: "extract_failed", detail: msg }, 500);
    }
  }

  // 1.5. Dedupe temporal — se já existe log dessa (deal, song) nos últimos 90s,
  // ignora pra evitar duplicação quando "forçar coleta" + cron + bot disparam
  // quase juntos (ou quando o mesmo lote de prints é processado 2x).
  // Mesmo padrão do bot-ingest-snapshot.
  {
    const since = new Date(Date.now() - 90_000).toISOString();
    let recentQuery = supabase
      .from("curator_deal_logs")
      .select("id, created_at, is_initial_capture_event")
      .eq("deal_id", deal_id)
      .gte("created_at", since)
      .limit(1);
    recentQuery = song_id
      ? recentQuery.eq("song_id", song_id)
      : recentQuery.is("song_id", null);
    const { data: recent } = await recentQuery;
    if (recent && recent.length > 0) {
      console.log(`[extract] deduped deal=${deal_id} song=${song_id ?? "null"} — log within 90s exists`);
      const recentLog = recent[0];
      const firstPrintUrl = print_urls[0] ?? null;

      await supabase
        .from("curator_deal_logs")
        .update({ print_urls })
        .eq("id", recentLog.id);

      const snapshotPatch: Record<string, unknown> = {
        batch_id: batch_id ?? null,
        correlation_id: correlation_id ?? null,
        snapshot_run_id: batch_id ?? null,
      };


      let snapQ = supabase
        .from("curator_deal_snapshots")
        .update(snapshotPatch)
        .eq("deal_id", deal_id)
        .eq("is_initial_capture", recentLog.is_initial_capture_event)
        .gte("created_at", since);
      snapQ = song_id ? snapQ.eq("song_id", song_id) : snapQ.is("song_id", null);
      await snapQ;

      if (song_id) {
        await supabase
          .from("curator_deal_songs")
          .update({
            auto_collect_status: "idle",
            auto_collect_error: null,
            queued_at: null,
          })
          .eq("id", song_id);
      }
      if (batch_id) {
        await supabase
          .from("bot_print_batches")
          .update({ status: "processed", processed_at: new Date().toISOString() })
          .eq("id", batch_id);
      }
      return jr({ ok: true, deduped: true, reason: "log within 90s exists" });
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

  // Patch A: spotify_track_id usado pra gravar quarentena em organic_plays_snapshots
  // quando uma playlist não pertence à whitelist do curador. Fetch único.
  let songSpotifyTrackId: string | null = null;
  if (song_id) {
    const { data: songRow } = await supabase
      .from("curator_deal_songs")
      .select("spotify_track_id")
      .eq("id", song_id)
      .maybeSingle();
    songSpotifyTrackId = (songRow as any)?.spotify_track_id ?? null;
  }

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

  // Blocklist: superfícies algorítmicas do Spotify for Artists.
  // Importante: playlist oficial do Spotify COM link real (ex: "This Is", editoriais)
  // não deve cair aqui só por made_by=Spotify; isso é Editorial, não Algorítmico.
  const ALGO_NAMES = new Set([
    "radio", "mixes", "daylist", "smart shuffle", "on repeat", "blend",
    "your dj", "discover weekly", "release radar", "made for you",
    "repeat rewind", "your top songs", "niche mixes", "uniquely yours",
  ]);
  const isAlgorithmic = (name: string | null, madeBy: string | null, spotifyId?: string | null) => {
    const n = (name ?? "").trim().toLowerCase();
    if (!n) return false;
    if (ALGO_NAMES.has(n)) return true;
    // variações tipo "X Mix", "Daily Mix 1", "Discover Weekly"
    if (/\b(daily mix|mix \d+|on repeat|smart shuffle)\b/.test(n)) return true;
    // Linhas sem playlist_id real vindas do Spotify são superfícies internas.
    if ((madeBy ?? "").trim().toLowerCase() === "spotify" && !(spotifyId ?? "").trim()) return true;
    return false;
  };
  const isSpotifyEditorial = (name: string | null, madeBy: string | null, spotifyId?: string | null) => {
    const hasRealPlaylistId = !!spotifyId && !spotifyId.startsWith("algo:");
    if (!hasRealPlaylistId) return false;
    if (isAlgorithmic(name, madeBy, spotifyId)) return false;
    return (madeBy ?? "").trim().toLowerCase() === "spotify" || spotifyId.startsWith("37i9dQZF");
  };

  const filteredOut = 0;

  for (const pl of extracted) {
    const sName = pl.playlist_name ?? null;
    const plays = Math.max(0, parseInt(String(pl.plays ?? 0)) || 0);
    const preResolvedFromUrl = extractId(pl.spotify_url ?? "");
    const preResolvedFromDom = !preResolvedFromUrl && sName ? domByName.get(norm(sName))?.id ?? null : null;
    const preResolvedFromEcoName = !preResolvedFromUrl && !preResolvedFromDom && sName
      ? managedByName.get(norm(sName))?.spotify_playlist_id ?? null
      : null;
    const preResolvedIdForKind = preResolvedFromUrl ?? preResolvedFromDom ?? preResolvedFromEcoName ?? null;
    const isAlgo = isAlgorithmic(sName, pl.made_by ?? null, preResolvedIdForKind);
    const isEditorial = isSpotifyEditorial(sName, pl.made_by ?? null, preResolvedIdForKind);
    // O histórico/base representa o total observado no Spotify for Artists.
    // A entrega contratada continua vindo apenas dos snapshots match_status='curator'
    // via get_curator_deal_progress.
    totalPlays += plays;

    // Resolve spotify_playlist_id antecipadamente (Gemini URL ou DOM por nome)
    // para classificar whitelist do curador sem descartar as demais 100 linhas.
    const preResolvedId = preResolvedIdForKind;
    const isWhitelistedCurator = !!preResolvedId && !preResolvedId.startsWith("algo:") && whitelist.has(preResolvedId);
    const preResolvedManaged = preResolvedId && !preResolvedId.startsWith("algo:")
      ? managedById.get(preResolvedId)
      : sName ? managedByName.get(norm(sName)) : null;
    // ECOSSISTEMA COMPLETO: não descartamos mais linhas fora da whitelist.
    // Whitelist agora apenas marca origem (curator vs organic). Captura permanece 100%.

    // Algorítmicas: registram como playlist interna (match_status=algorithmic),
    // sem entrar no totalPlays e sem aparecer em curadoria, mas geram alerta
    // quando entram (primeira vez vista) ou somem (próxima coleta).
    if (isAlgo) {
      algorithmicCount++;
      const algoName = sName ?? "Algorítmica";
      // Prefere lookup por spotify_playlist_id real quando existir.
      // Cai pra nome só como fallback (algoritmicas reais raramente têm ID).
      const hasRealId = !!preResolvedId && !preResolvedId.startsWith("algo:");
      let existing: { id: string; match_status: string } | null = null;
      if (hasRealId) {
        const { data } = await supabase
          .from("curator_playlists")
          .select("id, match_status")
          .eq("deal_id", deal_id)
          .eq("spotify_playlist_id", preResolvedId)
          .eq("match_status", "algorithmic")
          .maybeSingle();
        existing = (data as any) ?? null;
      }
      if (!existing) {
        if (!hasRealId) {
          console.warn(`[WARN] extract-snapshot-from-print: lookup algorítmica por playlist_name fallback (sem spotify_playlist_id). deal=${deal_id} name="${algoName}"`);
        }
        const { data } = await supabase
          .from("curator_playlists")
          .select("id, match_status")
          .eq("deal_id", deal_id)
          .eq("playlist_name", algoName)
          .eq("match_status", "algorithmic")
          .maybeSingle();
        existing = (data as any) ?? null;
      }

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
            is_initial_roster: isBaseline,
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
      } else if (isBaseline) {
        await supabase.from("curator_playlists").update({ is_initial_roster: true }).eq("id", algoId);
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
          is_initial_capture: false,
          print_url: print_urls[0] ?? null,
          ai_raw: { ...pl, algorithmic: true },
          batch_id: batch_id ?? null,
          correlation_id: correlation_id ?? null,
          plays_24h: (pl as any).plays_24h ?? null,
          plays_7d: (pl as any).plays_7d ?? null,
          plays_28d: (pl as any).plays_28d ?? null,
        });
      }
      continue;
    }

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
    const managedHit = sId && !sId.startsWith("algo:")
      ? managedById.get(sId)
      : preResolvedManaged;
    if (managedHit && !sId) {
      sId = managedHit.spotify_playlist_id;
      sUrl = managedHit.spotify_url ?? `https://open.spotify.com/playlist/${managedHit.spotify_playlist_id}`;
    }
    if (sId) processedSpotifyIds.add(sId);
    if (sName) processedNames.add(norm(sName));

    let playlistId: string | null = null;
    let matchMethod: string | null = null;

    if (isWhitelistedCurator) {
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
    } else if (managedHit && sId) {
      const { data: existingEco } = await supabase
        .from("curator_playlists")
        .select("id")
        .eq("deal_id", deal_id)
        .eq("spotify_playlist_id", sId)
        .eq("match_reason", "ecosystem_managed_playlist")
        .maybeSingle();
      playlistId = existingEco?.id ?? null;
      matchMethod = "ecosystem";
    } else if (sId) {
      const { data: organic } = await supabase
        .from("curator_playlists")
        .select("id")
        .eq("deal_id", deal_id)
        .eq("spotify_playlist_id", sId)
        .eq("match_status", isEditorial ? "editorial" : "organic")
        .maybeSingle();
      playlistId = organic?.id ?? null;
      matchMethod = isEditorial ? "editorial" : "organic";
    }

    if (!playlistId) {
      // PATCH A — contenção do bug `organic_created`:
      // Só criamos linhas novas em curator_playlists para playlists da WHITELIST
      // do curador. Tudo que não é whitelist (editorial/orgânica/desconhecida)
      // vai para `organic_plays_snapshots` (quarentena), espelhando o padrão
      // já usado por bot-ingest-snapshot e _shared/ingest-dom. Isso preserva
      // a tração sem fragmentar a identidade da playlist no deal.
      if (isWhitelistedCurator) {
        const { data: created, error: cErr } = await supabase
          .from("curator_playlists")
          .insert({
            deal_id,
            song_id: song_id ?? null,
            spotify_url: sUrl,
            spotify_playlist_id: sId,
            playlist_name: sName ?? "Sem nome",
            spotify_owner_name: pl.made_by ?? null,
            is_initial_roster: isBaseline,
            match_status: "curator",
            match_reason: "curator_whitelist",
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
      } else if (managedHit && sId) {
        const { data: created, error: cErr } = await supabase
          .from("curator_playlists")
          .insert({
            deal_id,
            song_id: song_id ?? null,
            spotify_url: sUrl || managedHit.spotify_url || `https://open.spotify.com/playlist/${sId}`,
            spotify_playlist_id: sId,
            playlist_name: managedHit.name ?? sName ?? "Playlist Ecossistema",
            followers: managedHit.followers ?? null,
            spotify_owner_name: pl.made_by ?? "Ecossistema",
            is_initial_roster: isBaseline,
            match_status: "organic",
            match_reason: "ecosystem_managed_playlist",
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
        matchMethod = "ecosystem";
      } else {
        // Não-whitelist: NÃO insere em curator_playlists.
        // Classifica e grava em organic_plays_snapshots quando temos sId real.
        // Sem sId: loga no_match e segue (preserva total_plays já contabilizado acima).
        const kind = classifyPlaylistKind(sName, pl.made_by ?? null, sId);
        if (kind && sId) {
          await supabase.from("organic_plays_snapshots").insert({
            deal_id,
            song_id: song_id ?? null,
            spotify_track_id: songSpotifyTrackId,
            spotify_playlist_id: sId,
            playlist_name: sName,
            kind,
            plays_24h: (pl as any).plays_24h ?? null,
            plays_7d: (pl as any).plays_7d ?? null,
            plays_28d: (pl as any).plays_28d ?? null,
            source: "spotify_for_artists",
          });
        } else {
          const ref = sId ?? sName ?? "unknown";
          await supabase.from("collection_logs").insert({
            acao: "no_match",
            status: "alerta",
            mensagem: `[WARN] no_match (extract-print): playlist ${ref} not in whitelist for deal ${deal_id}`,
          });
        }
        skipped++;
        continue;
      }
    }

    // Enriquece metadados (capa, owner, followers) via Spotify Web API
    // se ainda faltarem. Não bloqueia o snapshot em caso de erro.
    if (playlistId && sId) {
      try {
        const { data: cur } = await supabase
          .from("curator_playlists")
          .select("image_url, spotify_owner_id, followers")
          .eq("id", playlistId)
          .maybeSingle();
        const needsEnrich =
          !cur?.image_url || !cur?.spotify_owner_id || cur?.followers == null;
        if (needsEnrich) {
          const meta = await fetchPlaylistMeta(sId);
          if (meta) {
            await supabase
              .from("curator_playlists")
              .update({
                image_url: meta.image_url,
                spotify_owner_id: meta.owner_id,
                spotify_owner_name: meta.owner_name,
                followers: meta.followers,
                playlist_name: meta.name,
              })
              .eq("id", playlistId);
          }
        }
      } catch (_) { /* ignora — capa não é crítica */ }
    }

    // Janelas: vêm do DOM (direto ou via match). Gemini OCR não distingue janelas.
    const domSrc = domHit
      ? domItems.find((di) => di.id === domHit!.id)
      : undefined;
    const w24 = (pl as any).plays_24h ?? domSrc?.plays_24h ?? null;
    const w7 = (pl as any).plays_7d ?? domSrc?.plays_7d ?? null;
    const w28 = (pl as any).plays_28d ?? domSrc?.plays_28d ?? null;

    const insErr = await upsertSnapshot(supabase, {
      deal_id,
      song_id: song_id ?? null,
      playlist_id: playlistId,
      plays,
      source: "spotify_for_artists",
      match_method: matchMethod ?? (sId ? "spotify_id" : "name"),
      is_initial_capture: isBaseline,
      print_url: print_urls[0] ?? null,
      ai_raw: { ...pl, dom_matched: !!domHit },
      batch_id: batch_id ?? null,
      correlation_id: correlation_id ?? null,
      plays_24h: w24,
      plays_7d: w7,
      plays_28d: w28,
    });
    if (insErr) skipped++;
    else {
      inserted++;
      if (ecoCampaignId && managedHit?.id && sId) {
        await supabase.from("campaign_eco_snapshots").upsert({
          campaign_id: ecoCampaignId,
          managed_playlist_id: managedHit.id,
          spotify_playlist_id: sId,
          plays_24h: w24,
          plays_7d: w7 ?? plays,
          plays_28d: w28,
          source: "spotify_for_artists",
          correlation_id: correlation_id ?? null,
        }, { onConflict: "campaign_id,managed_playlist_id,captured_at", ignoreDuplicates: true });
      }
    }
  }

  // 3.1. Complemento DOM: o bot pode mandar 100 links do HTML mesmo quando
  // mandou só 1 print. A IA só lê plays do que está visível; aqui garantimos
  // que a lista de links fique completa, sem inventar streams.
  for (const dom of domItems) {
    if (dom.id.startsWith("algo:")) continue; // já tratada no loop principal
    // Dedup APENAS por spotify_playlist_id. Nomes parecidos (ex.: várias playlists
    // do Spotify com "Tubarões…" no título) são playlists DIFERENTES e devem entrar.
    if (processedSpotifyIds.has(dom.id)) continue;
    if (isAlgorithmic(dom.name, dom.made_by ?? null, dom.id)) continue;
    const isEditorialDom = isSpotifyEditorial(dom.name, dom.made_by ?? null, dom.id);
    // ECOSSISTEMA COMPLEMENTO DOM: não descartamos mais linhas fora da whitelist.
    // Persistimos como 'organic' para preservar 100% do DOM bruto.

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
        is_initial_roster: false,
        match_status: isEditorialDom ? "editorial" : "organic",
        match_reason: isEditorialDom ? "spotify_editorial_dom_only" : "dom_only_link_no_visual_plays",
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

  // 3.9. Fase 1.A.1 — baseline oficial vai exclusivamente para
  // `campaign_playlist_collections` via writer compartilhado.
  // Sem campaign_id → skip estruturado em bot_events. Nada em legado.
  // Para campaign_internal, se a baseline em `campaign_playlist_collections`
  // ainda não existe (ex.: primeiras tentativas falharam por whitelist vazia),
  // permitimos rodar a baseline mesmo quando não é mais o primeiro batch.
  let shouldRunBaseline = isBaseline;
  if (!shouldRunBaseline && isCampaignInternal && ecoCampaignId) {
    const { count: baselineCount } = await supabase
      .from("campaign_playlist_collections")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", ecoCampaignId)
      .eq("is_baseline", true);
    if ((baselineCount ?? 0) === 0) {
      shouldRunBaseline = true;
      console.log(`[extract] baseline retry (campaign_internal, no prior baseline): deal=${deal_id} campaign=${ecoCampaignId}`);
    }
  }
  if (shouldRunBaseline) {
    const { writeBaselineOfficial } = await import("../_shared/collection-writer.ts");
    let baselineQ = supabase
      .from("curator_deal_snapshots")
      .select("id, captured_at, plays, curator_playlists!inner(spotify_playlist_id, playlist_name, match_status, spotify_url)")
      .eq("deal_id", deal_id)
      .eq("is_initial_capture", true);
    baselineQ = batch_id
      ? baselineQ.eq("batch_id", batch_id)
      : baselineQ.gte("created_at", new Date(Date.now() - 10 * 60_000).toISOString());
    baselineQ = song_id ? baselineQ.eq("song_id", song_id) : baselineQ.is("song_id", null);

    const { data: baselineSnaps } = await baselineQ;
    let rows = (baselineSnaps ?? [])
      .map((s: any) => ({ snapshot: s, playlist: s.curator_playlists }))
      .filter(({ playlist }: any) =>
        playlist?.spotify_playlist_id &&
        !String(playlist.spotify_playlist_id).startsWith("algo:") &&
        playlist.match_status !== "algorithmic",
      )
      .map(({ snapshot, playlist }: any) => ({
        spotify_playlist_id: playlist.spotify_playlist_id,
        playlist_name: playlist.playlist_name ?? null,
        playlist_url: playlist.spotify_url ?? null,
        plays_7d: Number(snapshot.plays ?? 0) || 0,
        captured_at: snapshot.captured_at,
      }));

    // Fallback campaign_internal: quando a baseline não conseguiu ser montada a
    // partir de `curator_deal_snapshots` (ex.: nenhuma playlist do print bateu
    // com whitelist nem com managed_playlists), usa o próprio DOM da S4A como
    // fonte de verdade. O ecossistema da campanha precisa nascer com a foto
    // completa daquilo que o S4A mostrou, mesmo sem cadastro prévio.
    if (rows.length === 0 && isCampaignInternal && domItems.length > 0) {
      const capturedAt = new Date().toISOString();
      rows = domItems
        .filter((d) => d.id && !d.id.startsWith("algo:"))
        .map((d) => ({
          spotify_playlist_id: d.id,
          playlist_name: d.name ?? null,
          playlist_url: d.url || `https://open.spotify.com/playlist/${d.id}`,
          plays_7d: Number(d.plays_7d ?? d.plays ?? 0) || 0,
          captured_at: capturedAt,
        }));
      console.log(
        `[extract] baseline fallback via DOM (campaign_internal): deal=${deal_id} rows=${rows.length}`,
      );
    }

    await writeBaselineOfficial(supabase, {
      writer: "extract-snapshot-from-print",
      deal_id,
      song_id: song_id ?? null,
      rows,
    });

    // 3.9.1) Baseline pronta: ativa o deal. State awaiting_baseline → collecting
    // e marca baseline_captured_at. Só transiciona se ainda estava esperando.
    try {
      const nowIso = new Date().toISOString();
      const { data: updated, error: stateErr } = await supabase
        .from("curator_deals")
        .update({ state: "collecting", baseline_captured_at: nowIso })
        .eq("id", deal_id)
        .eq("state", "awaiting_baseline")
        .is("baseline_captured_at", null)
        .select("id")
        .maybeSingle();
      if (stateErr) console.error("[extract] activate deal error", stateErr);
      else if (updated) console.log(`[extract] deal ${deal_id} ativado: state=collecting, baseline_captured_at=${nowIso}`);
    } catch (e) {
      console.error("[extract] activate deal exception", e);
    }
  }

  // 4. Log
  await supabase.from("curator_deal_logs").insert({
    deal_id,
    song_id: song_id ?? null,
    total_plays: totalPlays,
    note: isBaseline ? "[ai] baseline inicial" : "[ai] auto-collect",
    print_urls,
    is_initial_capture_event: isBaseline,
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
        queued_at: null,
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
  await supabase.from("collection_logs").insert({
    acao: "extract_window_coverage",
    status:
      domWindowCoverage.with7d === domWindowCoverage.total &&
      domWindowCoverage.with28d === domWindowCoverage.total &&
      domWindowCoverage.with24h === domWindowCoverage.total
        ? "ok"
        : "parcial",
    duracao_ms: 0,
    mensagem: `deal=${deal_id} batch=${batch_id ?? "none"} dom=${domWindowCoverage.total} 24h=${domWindowCoverage.with24h} 7d=${domWindowCoverage.with7d} 28d=${domWindowCoverage.with28d}`,
  });

  recordMetric(supabase, {
    scope: "ocr",
    operation: "extract-snapshot-from-print",
    status: skipped > 0 ? "partial" : "success",
    duration_ms: elapsedMs,
    deal_id,
    song_id: song_id ?? null,
    metadata: {
      source: usedDomDirect ? "dom" : "gemini",
      prints: print_urls.length,
      found: extracted.length,
      inserted,
      skipped,
      dom_linked: domLinked,
      algorithmic: algorithmicCount,
      filtered_out: filteredOut,
      window_coverage: domWindowCoverage,
      batch_id: batch_id ?? null,
    },
  });

  if (correlation_id) {
    void supabase.from("bot_events").insert([
      {
        bot_name: "spotify-artists-bot",
        deal_id, song_id: song_id ?? null,
        step: "snapshot_sent",
        status: "success",
        lifecycle_state: "SNAPSHOT_SENT",
        correlation_id,
        message: `inserted=${inserted} skipped=${skipped} total_plays=${totalPlays}`,
        duration_ms: elapsedMs,
        metadata: { batch_id: batch_id ?? null, found: extracted.length },
      },
      {
        bot_name: "spotify-artists-bot",
        deal_id, song_id: song_id ?? null,
        step: "finished",
        status: "success",
        lifecycle_state: "FINISHED",
        correlation_id,
        duration_ms: Date.now() - t0,
        metadata: { batch_id: batch_id ?? null },
      },
    ]);
  }

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
    correlation_id: correlation_id ?? null,
  });
});

