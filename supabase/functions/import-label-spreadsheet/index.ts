// import-label-spreadsheet
// Aceita upload de planilha (.xlsx OU .csv) da gravadora pelo cliente
// (portal público) ou pela equipe interna. Parseia, valida ISRC, cruza com
// playlists/curadores nossos, persiste linhas detalhadas em
// label_spreadsheet_rows e grava snapshots no mesmo formato que o coletor
// do Spotify usa.
//
// Formatos aceitos:
//   1) XLSX distribuidora: #, VERSION NAME, ISRC, PLAYLIST, COUNTRY,
//      OWNER NAME, CURRENT POSITION, STREAMS
//   2) CSV Spotify (separador ; ou ,): Nome, URI, Streams, Posição, URL
//
// Body:
//   { client_token, file_base64, file_name, mode: "preview" | "commit" }
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import * as XLSX from "npm:xlsx@0.18.5";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalize(s: unknown): string {
  return String(s ?? "")
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

// 🕵️ Detetive de números: aceita "1.234,56", "1,234.56", "12k", "1.2M", "12 345"
function parseFlexibleNumber(input: unknown): number {
  if (input == null) return 0;
  if (typeof input === "number") return Math.max(0, Math.round(input));
  let s = String(input).trim().toLowerCase();
  if (!s) return 0;
  // sufixos k/m/b
  let mult = 1;
  const sufMatch = s.match(/([kmb])\s*$/);
  if (sufMatch) {
    mult = sufMatch[1] === "k" ? 1_000 : sufMatch[1] === "m" ? 1_000_000 : 1_000_000_000;
    s = s.slice(0, -1).trim();
  }
  // remove tudo que não é dígito, vírgula, ponto ou sinal
  s = s.replace(/[^\d.,\-]/g, "");
  if (!s) return 0;
  // se tem os dois separadores, o último é o decimal
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  let normalized: string;
  if (lastComma >= 0 && lastDot >= 0) {
    const decSep = lastComma > lastDot ? "," : ".";
    const thouSep = decSep === "," ? "." : ",";
    normalized = s.split(thouSep).join("").replace(decSep, ".");
  } else if (lastComma >= 0) {
    // só vírgula: se tiver 3 dígitos depois e sem ponto, é separador de milhar
    const after = s.length - lastComma - 1;
    normalized = after === 3 && s.indexOf(",") !== lastComma
      ? s.split(",").join("")
      : s.replace(",", ".");
  } else {
    normalized = s;
  }
  const n = parseFloat(normalized);
  if (!isFinite(n)) return 0;
  return Math.max(0, Math.round(n * mult));
}

// 🕵️ Detetive de URL: limpa ?si=, aspas, espaços, caracteres invisíveis
function cleanUrl(input: unknown): string | null {
  if (input == null) return null;
  const s = String(input)
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/^["'\s]+|["'\s]+$/g, "")
    .trim();
  if (!s) return null;
  // tira query params do Spotify (?si=, ?utm_, etc)
  return s.split("?")[0].split("#")[0];
}

// 🕵️ Detecta linhas de "Total" / rodapé que distribuidoras costumam colocar
function isJunkRow(playlistName: string): boolean {
  const n = playlistName.toUpperCase().trim();
  if (!n) return true;
  return /^(TOTAL|TOTAIS|SUBTOTAL|GRAND TOTAL|SUM|SOMA|RESUMO|TOTAL GERAL)\b/.test(n);
}

const EMPTY_PLAYLIST_LABELS = new Set(["", "(vazio)", "vazio", "(empty)", "empty", "null", "undefined"]);

function cleanPlaylistName(input: unknown): string | null {
  const v = String(input ?? "").trim();
  return EMPTY_PLAYLIST_LABELS.has(v.toLowerCase()) ? null : v;
}

async function sha256Hex(buf: Uint8Array): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/^data:[^;]+;base64,/, "");
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Extrai spotify_playlist_id de URI (spotify:playlist:XYZ) ou URL
// (https://open.spotify.com/playlist/XYZ) ou só ID puro
function extractPlaylistId(input: string | null | undefined): string | null {
  if (!input) return null;
  const s = String(input).trim();
  if (!s) return null;
  const m = s.match(/playlist[:/]([A-Za-z0-9]{16,})/);
  if (m) return m[1];
  // ID puro (22 chars típico do Spotify)
  if (/^[A-Za-z0-9]{16,}$/.test(s)) return s;
  return null;
}

// Mapeia headers da planilha pro nosso modelo (cobre XLSX e CSV)
const HEADER_MAP: Record<string, string> = {
  "#": "row_position",
  "POSITION": "row_position",
  "VERSION NAME": "version_name",
  "TRACK": "version_name",
  "TRACK NAME": "version_name",
  "MUSICA": "version_name",
  "MÚSICA": "version_name",
  "ISRC": "isrc",
  "PLAYLIST": "playlist_name",
  "PLAYLIST NAME": "playlist_name",
  "NOME": "playlist_name",
  "NAME": "playlist_name",
  "URI": "playlist_uri",
  "URL": "playlist_url",
  "LINK": "playlist_url",
  "PLAYLIST URL": "playlist_url",
  "PLAYLIST LINK": "playlist_url",
  "COUNTRY": "country",
  "PAIS": "country",
  "PAÍS": "country",
  "OWNER NAME": "owner_name",
  "OWNER": "owner_name",
  "CURATOR": "owner_name",
  "CURADOR": "owner_name",
  "CURRENT POSITION": "position_in_playlist",
  "POSITION IN PLAYLIST": "position_in_playlist",
  "POSIÇÃO": "position_in_playlist",
  "POSICAO": "position_in_playlist",
  "STREAMS": "streams",
  "PLAYS": "streams",
};

type ParsedRow = {
  row_position: number | null;
  version_name: string;
  isrc: string;
  playlist_name: string;
  playlist_uri: string | null;
  playlist_url: string | null;
  playlist_spotify_id: string | null;
  country: string | null;
  owner_name: string | null;
  position_in_playlist: number | null;
  streams: number;
  raw: Record<string, unknown>;
  segment_index?: number;
  source_sheet?: string | null;
};

type ParsedSegment = {
  index: number;
  label: string;
  rows: ParsedRow[];
  warnings: string[];
  detected: string[];
  autoFixes: Record<string, number>;
};

function detectFormat(fileName: string, buf: Uint8Array): "csv" | "xlsx" {
  if (/\.csv$/i.test(fileName)) return "csv";
  // Bytes iniciais: PK = zip = xlsx
  if (buf[0] === 0x50 && buf[1] === 0x4b) return "xlsx";
  // BOM ou ASCII printable = csv
  return "csv";
}

// 🪟 Detecta janela temporal a partir do nome do arquivo / cabeçalhos.
// Sem isso, o guard tg_label_uploads_guard quarentena tudo que não vier
// explicitamente marcado — quebrando uploads legítimos de planilhas com
// cabeçalho não-padrão (ex.: "Resultados Playlists ... Resultados diário").
function detectWindowKind(fileName: string, headerSample: string): "all_time" | "last_28d" | "last_7d" | "last_24h" | null {
  const haystack = `${fileName} ${headerSample}`.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (/\b(all[\s_-]*time|lifetime|vitalici|desde[\s_-]*sempre|total[\s_-]*geral)\b/.test(haystack)) return "all_time";
  if (/\b(28[\s_-]*d(ias?)?|monthly|mensal|month|ultimos?[\s_-]*28|last[\s_-]*28)\b/.test(haystack)) return "last_28d";
  if (/\b(7[\s_-]*d(ias?)?|weekly|semanal|semana|ultim[ao]s?[\s_-]*7|last[\s_-]*7)\b/.test(haystack)) return "last_7d";
  if (/\b(24[\s_-]*h(ours?)?|diari[oa]|daily|1[\s_-]*d(ay|ia)?|ultim[ao][\s_-]*24|last[\s_-]*24|last[\s_-]*day)\b/.test(haystack)) return "last_24h";
  return null;
}

const MONTHS_PT: Record<string, number> = {
  janeiro: 1,
  jan: 1,
  fevereiro: 2,
  fev: 2,
  marco: 3,
  mar: 3,
  abril: 4,
  abr: 4,
  maio: 5,
  mai: 5,
  junho: 6,
  jun: 6,
  julho: 7,
  jul: 7,
  agosto: 8,
  ago: 8,
  setembro: 9,
  set: 9,
  outubro: 10,
  out: 10,
  novembro: 11,
  nov: 11,
  dezembro: 12,
  dez: 12,
};

function normalizeDateText(input: string): string {
  return input.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function isValidIsoDate(iso: string): boolean {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

function makeIsoDate(year: number, month: number, day: number, maxIso: string): string | null {
  const iso = `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
  if (!isValidIsoDate(iso)) return null;
  if (iso > maxIso) return null;
  return iso;
}

function inferDateWithoutYear(day: number, month: number, fallbackIso: string): string | null {
  const fallbackYear = Number(fallbackIso.slice(0, 4));
  return makeIsoDate(fallbackYear, month, day, fallbackIso) ?? makeIsoDate(fallbackYear - 1, month, day, fallbackIso);
}

function detectExplicitReferenceDate(label: string, fallbackIso: string): string | null {
  const stem = label.replace(/\.[a-z0-9]+$/i, "");
  const normalized = normalizeDateText(stem);
  const fullPatterns: Array<{ re: RegExp; y: number; m: number; d: number }> = [
    { re: /(20\d{2})[-_.](\d{1,2})[-_.](\d{1,2})/, y: 1, m: 2, d: 3 },
    { re: /(\d{1,2})[-_.](\d{1,2})[-_.](20\d{2})/, y: 3, m: 2, d: 1 },
    { re: /(20\d{2})(\d{2})(\d{2})/, y: 1, m: 2, d: 3 },
    { re: /(\d{2})(\d{2})(20\d{2})/, y: 3, m: 2, d: 1 },
  ];
  for (const p of fullPatterns) {
    const m = stem.match(p.re);
    if (!m) continue;
    const iso = makeIsoDate(Number(m[p.y]), Number(m[p.m]), Number(m[p.d]), fallbackIso);
    if (iso) return iso;
  }

  const monthName = normalized.match(/\b(\d{1,2})\s*(?:de\s*)?(janeiro|jan|fevereiro|fev|marco|mar|abril|abr|maio|mai|junho|jun|julho|jul|agosto|ago|setembro|set|outubro|out|novembro|nov|dezembro|dez)(?:\s*(?:de\s*)?(20\d{2}))?\b/);
  if (monthName) {
    const day = Number(monthName[1]);
    const month = MONTHS_PT[monthName[2]];
    const year = monthName[3] ? Number(monthName[3]) : null;
    const iso = year ? makeIsoDate(year, month, day, fallbackIso) : inferDateWithoutYear(day, month, fallbackIso);
    if (iso) return iso;
  }

  // Arquivos comuns chegam como "Tabela 23_06.csv" — isso é dia/mês, não data de upload.
  const dayMonth = stem.match(/(?:^|[^\d])(\d{1,2})[-_.](\d{1,2})(?:$|[^\d])/);
  if (dayMonth) {
    const iso = inferDateWithoutYear(Number(dayMonth[1]), Number(dayMonth[2]), fallbackIso);
    if (iso) return iso;
  }

  return null;
}

function hasDateRangeSignal(label: string): boolean {
  const normalized = normalizeDateText(label);
  return /\b\d{1,2}\s*(?:a|ate|até|-)\s*\d{1,2}\b/.test(normalized);
}

function parseSheetRows(sheet: XLSX.WorkSheet, segmentIndex: number, sourceSheet: string | null): Omit<ParsedSegment, "index" | "label"> {
  const warnings: string[] = [];
  const autoFixes: Record<string, number> = {
    empty_rows: 0,
    junk_rows: 0,
    duplicates: 0,
    url_cleaned: 0,
    number_normalized: 0,
    negative_clamped: 0,
    invalid_position: 0,
  };
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });

  const detected: string[] = [];
  if (raw.length > 0) {
    for (const k of Object.keys(raw[0])) {
      const mapped = HEADER_MAP[normalize(k)];
      if (mapped) detected.push(`${k} → ${mapped}`);
    }
  }

  const seen = new Set<string>();
  const rows: ParsedRow[] = [];
  for (const r of raw) {
    const mapped: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(r)) {
      const key = HEADER_MAP[normalize(k)];
      if (key) mapped[key] = v;
    }
    const rawUri = mapped.playlist_uri ? String(mapped.playlist_uri) : null;
    const rawUrl = mapped.playlist_url ? String(mapped.playlist_url) : null;
    const playlist_uri = cleanUrl(rawUri);
    const playlist_url = cleanUrl(rawUrl);
    if ((rawUri && rawUri !== playlist_uri) || (rawUrl && rawUrl !== playlist_url)) {
      autoFixes.url_cleaned++;
    }
    const playlist_spotify_id = extractPlaylistId(playlist_uri) ||
      extractPlaylistId(playlist_url);

    const playlist_name = cleanPlaylistName(mapped.playlist_name);
    if (!playlist_name && !playlist_spotify_id) { autoFixes.empty_rows++; continue; }
    if (playlist_name && isJunkRow(playlist_name)) { autoFixes.junk_rows++; continue; }

    const streamsRaw = mapped.streams;
    const streamsParsed = parseFlexibleNumber(streamsRaw);
    if (typeof streamsRaw === "string" && streamsRaw !== String(streamsParsed)) {
      autoFixes.number_normalized++;
    }
    const streams = streamsParsed < 0 ? (autoFixes.negative_clamped++, 0) : streamsParsed;

    let position_in_playlist: number | null = null;
    if (mapped.position_in_playlist != null) {
      const p = Number(mapped.position_in_playlist);
      if (isFinite(p) && p > 0) position_in_playlist = Math.round(p);
      else if (mapped.position_in_playlist !== "" && mapped.position_in_playlist !== 0) {
        autoFixes.invalid_position++;
      }
    }

    // dedupe por (spotify_id || nome+owner)
    const dedupeKey = (playlist_spotify_id ||
      `${playlist_name ?? ""}|${mapped.owner_name ?? ""}`).toLowerCase();
    if (seen.has(dedupeKey)) { autoFixes.duplicates++; continue; }
    seen.add(dedupeKey);

    rows.push({
      row_position: mapped.row_position != null ? Number(mapped.row_position) || null : null,
      version_name: String(mapped.version_name ?? "").trim(),
      isrc: String(mapped.isrc ?? "").trim().toUpperCase(),
      playlist_name: playlist_name ?? "",
      playlist_uri,
      playlist_url,
      playlist_spotify_id,
      country: mapped.country ? String(mapped.country).trim() : null,
      owner_name: mapped.owner_name ? String(mapped.owner_name).trim() : null,
      position_in_playlist,
      streams,
      raw: r as Record<string, unknown>,
      segment_index: segmentIndex,
      source_sheet: sourceSheet,
    });
  }
  if (rows.length === 0) warnings.push("Nenhuma linha válida encontrada");
  return { rows, warnings, detected, autoFixes };
}

function mergeAutoFixes(target: Record<string, number>, source: Record<string, number>) {
  for (const [k, v] of Object.entries(source)) target[k] = (target[k] ?? 0) + v;
}

function parseBuf(
  buf: Uint8Array,
  fmt: "csv" | "xlsx",
): { rows: ParsedRow[]; warnings: string[]; detected: string[]; autoFixes: Record<string, number>; segments: ParsedSegment[] } {
  let wb;
  if (fmt === "csv") {
    let text = new TextDecoder("utf-8").decode(buf);
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    const firstLine = text.split(/\r?\n/)[0] ?? "";
    const sep = (firstLine.match(/;/g) ?? []).length >
        (firstLine.match(/,/g) ?? []).length
      ? ";"
      : ",";
    wb = XLSX.read(text, { type: "string", FS: sep });
  } else {
    wb = XLSX.read(buf, { type: "array" });
  }

  const sheetNames = wb.SheetNames ?? [];
  if (sheetNames.length === 0) {
    const emptyFixes = {
      empty_rows: 0,
      junk_rows: 0,
      duplicates: 0,
      url_cleaned: 0,
      number_normalized: 0,
      negative_clamped: 0,
      invalid_position: 0,
    };
    return { rows: [], warnings: ["Planilha sem abas"], detected: [], autoFixes: emptyFixes, segments: [] };
  }

  const segments: ParsedSegment[] = [];
  const warnings: string[] = [];
  const detected = new Set<string>();
  const autoFixes: Record<string, number> = {
    empty_rows: 0,
    junk_rows: 0,
    duplicates: 0,
    url_cleaned: 0,
    number_normalized: 0,
    negative_clamped: 0,
    invalid_position: 0,
  };

  sheetNames.forEach((name: string, idx: number) => {
    const sheet = wb.Sheets[name];
    if (!sheet) return;
    const parsed = parseSheetRows(sheet, idx, fmt === "xlsx" ? name : null);
    parsed.warnings.forEach((w) => warnings.push(fmt === "xlsx" ? `${name}: ${w}` : w));
    parsed.detected.forEach((d) => detected.add(d));
    mergeAutoFixes(autoFixes, parsed.autoFixes);
    if (parsed.rows.length > 0) {
      segments.push({ index: idx, label: fmt === "xlsx" ? name : "Arquivo", ...parsed });
    }
  });

  const rows = segments.flatMap((segment) => segment.rows);
  if (rows.length === 0) warnings.push("Nenhuma linha válida encontrada");
  return { rows, warnings, detected: Array.from(detected), autoFixes, segments };
}

type SpreadsheetEnrichment = {
  matched_playlist_id: string | null;
  matched_curator_id: string | null;
  is_internal: boolean;
};

/**
 * Fase 3.B.1 — renomeado de `buildMatchers` para deixar explícito que NÃO é Match Oficial.
 *
 * Match Oficial (decisão de pertencimento `curator_playlists`) acontece exclusivamente
 * na RPC `public.match_curator_playlist`. Esta função tem responsabilidade distinta:
 * enriquece as linhas da planilha do label com `matched_playlist_id` (tabela `playlists`)
 * e `matched_curator_id` (tabela `curators`) — usado pra alimentar `label_spreadsheet_rows`
 * e calcular `is_internal`. Não escreve em `curator_playlists`, não decide curador real,
 * não disputa com o motor de Match.
 */
async function buildSpreadsheetEnrichment(
  admin: ReturnType<typeof createClient>,
  rows: ParsedRow[],
) {
  // Coleta IDs únicos pra buscar em batch
  const playlistIds = Array.from(
    new Set(rows.map((r) => r.playlist_spotify_id).filter(Boolean) as string[]),
  );
  const ownerNames = Array.from(
    new Set(
      rows
        .map((r) => r.owner_name?.trim())
        .filter((s): s is string => !!s && s.length > 0),
    ),
  );

  // Lookup de playlists por spotify_playlist_id (apenas enriquecimento de cadastro)
  const playlistMap = new Map<string, { id: string; ownership: string }>();
  if (playlistIds.length > 0) {
    const { data } = await admin
      .from("playlists")
      .select("id, spotify_playlist_id, ownership")
      .in("spotify_playlist_id", playlistIds);
    for (const p of (data ?? []) as Array<{ id: string; spotify_playlist_id: string; ownership: string }>) {
      playlistMap.set(p.spotify_playlist_id, { id: p.id, ownership: p.ownership });
    }
  }

  // Lookup de curadores por spotify_owner_id / nome (apenas enriquecimento de cadastro)
  const curatorMap = new Map<string, string>();
  if (ownerNames.length > 0) {
    const { data } = await admin
      .from("curators")
      .select("id, spotify_owner_id, name")
      .or(
        ownerNames
          .map((n) => `spotify_owner_id.eq.${n},name.ilike.${n}`)
          .join(","),
      );
    for (const c of (data ?? []) as Array<{ id: string; spotify_owner_id: string | null; name: string }>) {
      if (c.spotify_owner_id) curatorMap.set(c.spotify_owner_id.toLowerCase(), c.id);
      if (c.name) curatorMap.set(c.name.toLowerCase(), c.id);
    }
  }

  return function enrich(r: ParsedRow): SpreadsheetEnrichment {
    const pl = r.playlist_spotify_id ? playlistMap.get(r.playlist_spotify_id) : null;
    const cu = r.owner_name ? curatorMap.get(r.owner_name.toLowerCase()) : null;
    const isInternal = !!pl && pl.ownership !== "external" || !!cu;
    return {
      matched_playlist_id: pl?.id ?? null,
      matched_curator_id: cu ?? null,
      is_internal: isInternal,
    };
  };
}

async function resolveKnownPlaylistNames(
  admin: ReturnType<typeof createClient>,
  rows: Array<ParsedRow & SpreadsheetEnrichment>,
): Promise<Array<ParsedRow & SpreadsheetEnrichment>> {
  const missingIds = Array.from(new Set(
    rows
      .filter((r) => !cleanPlaylistName(r.playlist_name) && !!r.playlist_spotify_id)
      .map((r) => r.playlist_spotify_id as string),
  ));
  if (missingIds.length === 0) return rows;

  const [curatorRes, managedRes, playlistRes] = await Promise.all([
    admin.from("curator_playlists").select("spotify_playlist_id, playlist_name").in("spotify_playlist_id", missingIds),
    admin.from("managed_playlists").select("spotify_playlist_id, name").in("spotify_playlist_id", missingIds),
    admin.from("playlists").select("spotify_playlist_id, name").in("spotify_playlist_id", missingIds),
  ]);

  const names = new Map<string, string>();
  for (const r of (curatorRes.data ?? []) as Array<{ spotify_playlist_id: string; playlist_name: string | null }>) {
    const n = cleanPlaylistName(r.playlist_name);
    if (r.spotify_playlist_id && n) names.set(r.spotify_playlist_id, n);
  }
  for (const r of (managedRes.data ?? []) as Array<{ spotify_playlist_id: string; name: string | null }>) {
    const n = cleanPlaylistName(r.name);
    if (r.spotify_playlist_id && n) names.set(r.spotify_playlist_id, n);
  }
  for (const r of (playlistRes.data ?? []) as Array<{ spotify_playlist_id: string; name: string | null }>) {
    const n = cleanPlaylistName(r.name);
    if (r.spotify_playlist_id && n) names.set(r.spotify_playlist_id, n);
  }

  return rows.map((r) => {
    const current = cleanPlaylistName(r.playlist_name);
    const resolved = r.playlist_spotify_id ? names.get(r.playlist_spotify_id) : null;
    return { ...r, playlist_name: current ?? resolved ?? r.playlist_spotify_id ?? "Playlist" };
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    // Fase 3.A.1 — raw_ingest obrigatório em todo parser (planilha = parser
    // Spreadsheet). Lemos o body como texto pra preservar a auditoria fiel.
    const rawText = await req.text();
    const { logRawIngest, safeJsonParse } = await import("../_shared/raw-ingest.ts");
    const body = safeJsonParse(rawText) ?? {};
    const token = String(body?.client_token ?? "").trim();
    const fileB64 = String(body?.file_base64 ?? "");
    const fileName = String(body?.file_name ?? "planilha.xlsx");
    const mode = body?.mode === "commit" ? "commit" : "preview";

    if (!token) return jr({ ok: false, error: "Link do cliente inválido. Reabra o portal pelo link enviado." }, 200);
    if (!fileB64) return jr({ ok: false, error: "Arquivo obrigatório" }, 200);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    // Log raw — sem o file_base64 (pode ter MB) e sem o token (sensível)
    try {
      const safePayload = {
        ...body,
        file_base64: fileB64 ? `[base64:${fileB64.length}b]` : null,
        client_token: token ? "[redacted]" : null,
      };
      await logRawIngest(admin, {
        endpoint: "import-label-spreadsheet",
        req,
        rawText: JSON.stringify(safePayload),
        payload: safePayload,
      });
    } catch (_) { /* logging nunca quebra o ingest */ }


    const { data: resolved, error: resErr } = await admin.rpc("resolve_client_token", {
      _token: token,
    });
    if (resErr) return jr({ ok: false, error: resErr.message }, 200);
    const row = Array.isArray(resolved) && resolved.length > 0 ? resolved[0] : null;
    if (!row?.deal_id) return jr({ ok: false, error: "Link do cliente inválido ou expirado. Reabra o portal pelo link enviado." }, 200);

    const dealId = String(row.deal_id);
    const songId = row.song_id ? String(row.song_id) : null;

    // 🚧 Trava: baseline/coleta só depois que a campanha foi aprovada.
    // Sem isso, um link vazado ou reenvio poderia gravar uma baseline
    // antes do marco zero combinado com o cliente.
    // (2026-06-19) Resolve campanha via curator_deals.campaign_id — não mais
    // via legacy campaigns.deal_id (que só registra o deal "principal" e
    // bloqueava curadores secundários da mesma campanha).
    const { data: dealRow } = await admin
      .from("curator_deals")
      .select("campaign_id")
      .eq("id", dealId)
      .maybeSingle();
    const dealCampaignId = (dealRow as { campaign_id?: string | null } | null)?.campaign_id ?? null;
    let linkedCamp: { id: string; client_approved_at: string | null } | null = null;
    if (dealCampaignId) {
      const { data: campRow } = await admin
        .from("campaigns")
        .select("id, client_approved_at")
        .eq("id", dealCampaignId)
        .maybeSingle();
      linkedCamp = (campRow as typeof linkedCamp) ?? null;
    }
    if (!linkedCamp?.client_approved_at) {
      return jr({
        ok: false,
        error: "Campanha ainda não foi aprovada. Assim que liberarmos, você poderá enviar a primeira planilha.",
      }, 200);
    }


    let buf: Uint8Array;
    try {
      buf = base64ToBytes(fileB64);
    } catch (_) {
      return jr({ ok: false, error: "Arquivo inválido" }, 200);
    }
    if (buf.length > 8 * 1024 * 1024) {
      return jr({ ok: false, error: "Arquivo grande demais (máx 8MB)" }, 200);
    }
    const hash = await sha256Hex(buf);
    const fmt = detectFormat(fileName, buf);

    const { rows, warnings, detected, autoFixes, segments } = parseBuf(buf, fmt);
    if (rows.length === 0) {
      // 🔴 Detetive bloqueia só quando é grave de verdade
      const hasStreamsCol = detected.some((d) => d.includes("→ streams"));
      const hasPlaylistCol = detected.some((d) => d.includes("→ playlist_name"));
      let friendlyError = "Não consegui ler nenhuma linha dessa planilha.";
      if (!hasStreamsCol && !hasPlaylistCol) {
        friendlyError = "Não encontrei as colunas de playlist e streams. Confira se o cabeçalho está na primeira linha.";
      } else if (!hasStreamsCol) {
        friendlyError = "Achei a coluna de playlists, mas não a de streams. Renomeie a coluna de números para 'STREAMS' ou 'PLAYS'.";
      } else if (!hasPlaylistCol) {
        friendlyError = "Achei a coluna de streams, mas não a de playlist. Renomeie a coluna de nomes para 'PLAYLIST' ou 'NOME'.";
      }
      return jr({
        ok: false,
        error: friendlyError,
        warnings,
        detected_columns: detected,
        auto_fixes: autoFixes,
      }, 200);
    }

    const totalStreams = rows.reduce((acc, r) => acc + r.streams, 0);
    const uniqueIsrcs = Array.from(new Set(rows.map((r) => r.isrc).filter(Boolean)));

    // Enriquecimento das linhas da planilha (NÃO é Match Oficial — ver doc da função).
    const enrich = await buildSpreadsheetEnrichment(admin, rows);
    const matched = await resolveKnownPlaylistNames(
      admin,
      rows.map((r) => ({ ...r, ...enrich(r) })),
    );
    const internalCount = matched.filter((m) => m.is_internal).length;
    const playlistsRecognized = matched.filter((m) => m.matched_playlist_id).length;
    const curatorsRecognized = new Set(
      matched.map((m) => m.matched_curator_id).filter(Boolean),
    ).size;

    const previewSummary = {
      rows: rows.length,
      total_streams: totalStreams,
      unique_isrcs: uniqueIsrcs,
      format: fmt,
      detected_columns: detected,
      playlists_recognized: playlistsRecognized,
      curators_recognized: curatorsRecognized,
      internal_count: internalCount,
      organic_count: rows.length - internalCount,
      best_position: matched
        .map((r) => r.position_in_playlist)
        .filter((p): p is number => typeof p === "number" && p > 0)
        .sort((a, b) => a - b)[0] ?? null,
      top_playlists: matched
        .slice()
        .sort((a, b) => b.streams - a.streams)
        .slice(0, 5)
        .map((r) => ({
          name: r.playlist_name,
          streams: r.streams,
          owner: r.owner_name,
          is_internal: r.is_internal,
        })),
      playlists: rows.slice(0, 5).map((r) => ({
        name: r.playlist_name,
        streams: r.streams,
        owner: r.owner_name,
      })),
      warnings,
      auto_fixes: autoFixes,
      auto_fixes_total: Object.values(autoFixes).reduce((a, b) => a + b, 0),
    };

    // 🛡️ Avaliador de quarentena — chamado também no preview pra UI sinalizar antes do commit.
    //    Compara com o último upload válido: hash duplicado, janela parcial (S4A 7d/24h),
    //    regressão massiva (>50% playlists caíram, ou média < 50%).
    const evalRows = matched
      .filter((r) => typeof r.playlist_spotify_id === "string" && r.playlist_spotify_id.length > 0)
      .map((r) => ({ playlist_spotify_id: r.playlist_spotify_id, streams: r.streams }));
    const { data: evalData } = await admin.rpc("evaluate_upload_quarantine", {
      p_deal_id: dealId,
      p_content_hash: hash,
      p_rows: evalRows,
    });
    const evalResult = (evalData ?? { decision: "accept", mode: "periodic" }) as {
      decision: "accept" | "quarantine" | "reject" | "review";
      reason?: string;
      mode?: string;
      window_kind?: string | null;
      signals?: Record<string, unknown>;
      duplicate_of?: string;
    };

    if (mode === "preview") {
      return jr({
        ok: true,
        mode: "preview",
        summary: { ...previewSummary, quarantine: evalResult },
      });
    }

    // ----- COMMIT -----

    if (evalResult.decision === "reject") {
      return jr({
        ok: false,
        error: "Essa mesma planilha já foi enviada antes. Envie a versão mais recente.",
        quarantine: evalResult,
      }, 200);
    }

    const today = new Date().toISOString().slice(0, 10);

    // 🔎 Auto-detecta data de referência pelo nome do arquivo.
    // Aceita: YYYY-MM-DD, YYYY_MM_DD, DD-MM-YYYY, DD_MM_YYYY, DDMMYYYY, YYYYMMDD.
    // Usa hoje como fallback se nada bater ou se a data parecer inválida.
    function detectReferenceDate(name: string, fallback: string): string {
      const stem = name.replace(/\.[a-z0-9]+$/i, "");
      const patterns: Array<{ re: RegExp; y: number; m: number; d: number }> = [
        { re: /(20\d{2})[-_.](\d{1,2})[-_.](\d{1,2})/, y: 1, m: 2, d: 3 },
        { re: /(\d{1,2})[-_.](\d{1,2})[-_.](20\d{2})/, y: 3, m: 2, d: 1 },
        { re: /(20\d{2})(\d{2})(\d{2})/, y: 1, m: 2, d: 3 },
        { re: /(\d{2})(\d{2})(20\d{2})/, y: 3, m: 2, d: 1 },
      ];
      for (const p of patterns) {
        const m = stem.match(p.re);
        if (!m) continue;
        const yyyy = Number(m[p.y]);
        const mm = Number(m[p.m]);
        const dd = Number(m[p.d]);
        if (mm < 1 || mm > 12 || dd < 1 || dd > 31) continue;
        const iso = `${yyyy.toString().padStart(4, "0")}-${mm.toString().padStart(2, "0")}-${dd.toString().padStart(2, "0")}`;
        const dt = new Date(iso + "T00:00:00Z");
        if (isNaN(dt.getTime())) continue;
        // Não aceita datas futuras (> hoje) — usa fallback.
        if (iso > fallback) continue;
        return iso;
      }
      return fallback;
    }
    const referenceDate = detectReferenceDate(fileName, today);

    // 🎯 Primeiro upload do deal vira BASELINE automaticamente.
    const { count: prevUploadsCount } = await admin
      .from("label_spreadsheet_uploads")
      .select("id", { count: "exact", head: true })
      .eq("deal_id", dealId);
    const isBaseline = (prevUploadsCount ?? 0) === 0;

    // Modo final do upload
    const willQuarantine = evalResult.decision === "quarantine";
    const uploadMode = willQuarantine
      ? "partial_window"
      : (isBaseline ? "baseline" : (evalResult.mode ?? "periodic"));

    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
    const filePath = `${dealId}/${Date.now()}-${safeName}`;
    try {
      const contentType = fmt === "csv"
        ? "text/csv"
        : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      await admin.storage.from("label-spreadsheets").upload(filePath, buf, {
        contentType,
        upsert: false,
      });
    } catch (_) {
      // best-effort
    }

    // 1) Registra upload primeiro pra ter o id
    const { data: uploadRow, error: upErr } = await admin
      .from("label_spreadsheet_uploads")
      .insert({
        deal_id: dealId,
        song_id: songId,
        uploaded_via: "client_portal",
        file_path: filePath,
        file_name: fileName,
        content_hash: hash,
        rows_imported: rows.length,
        total_streams: totalStreams,
        status: willQuarantine ? "quarantined" : "imported",
        reference_date: referenceDate,
        is_baseline: isBaseline && !willQuarantine,
        upload_mode: uploadMode,
        window_kind: (() => {
          const allowed = new Set(["all_time", "last_28d", "last_7d", "last_24h"]);
          const wk = evalResult.window_kind;
          if (wk && allowed.has(wk)) return wk;
          // Heurística por nome do arquivo / cabeçalho.
          const headerSample = (detected ?? []).join(" ");
          const detectedWk = detectWindowKind(fileName, headerSample);
          if (detectedWk) return detectedWk;
          // Sem sinal explícito: assume janela diária (caso S4A mais comum).
          // É o mesmo comportamento do bot DOM (que sempre cai em 24h/7d).
          // Mantém o upload fora da quarentena por classificação ausente.
          return "last_24h";
        })(),
        quarantined_at: willQuarantine ? new Date().toISOString() : null,
        quarantine_reason: willQuarantine ? (evalResult.reason ?? null) : null,
        quarantine_signals: willQuarantine ? (evalResult.signals ?? null) : null,
      })
      .select()
      .single();

    if (upErr) return jr({ ok: false, error: upErr.message }, 200);
    const uploadId = uploadRow.id as string;

    // 2) Insere linhas detalhadas com match
    const detailRows = matched.map((r) => ({
      upload_id: uploadId,
      deal_id: dealId,
      song_id: songId,
      position: r.position_in_playlist ?? r.row_position,
      version_name: r.version_name || null,
      isrc: r.isrc || null,
      playlist_name: r.playlist_name,
      playlist_uri: r.playlist_uri,
      playlist_url: r.playlist_url,
      playlist_spotify_id: r.playlist_spotify_id,
      owner_name: r.owner_name,
      country: r.country,
      streams: r.streams,
      matched_playlist_id: r.matched_playlist_id,
      matched_curator_id: r.matched_curator_id,
      is_internal: r.is_internal,
      raw_payload: r.raw,
    }));

    // insere em chunks de 200
    for (let i = 0; i < detailRows.length; i += 200) {
      const chunk = detailRows.slice(i, i + 200);
      const { error: rowsErr } = await admin
        .from("label_spreadsheet_rows")
        .insert(chunk);
      if (rowsErr) console.error("rows insert error", rowsErr);
    }

    // 🚫 Upload quarentenado: ainda gravou upload + rows pra auditoria, mas NÃO propaga
    //    snapshots, collections, total_delivered nem proofs. O cliente vê o aviso.
    if (willQuarantine) {
      return jr({
        ok: true,
        mode: "commit",
        quarantined: true,
        quarantine: evalResult,
        message: evalResult.reason === "partial_window_detected"
          ? "Essa planilha parece ser de janela curta (últimos 7d). Foi arquivada e NÃO afeta os totais."
          : "Planilha em quarentena: regressão massiva detectada. Os totais anteriores foram preservados.",
        upload: uploadRow,
      });
    }

    // 3) Snapshots + delivery_proofs — só para linhas que casaram com
    //    uma playlist nossa (matched_playlist_id é UUID real). Sem isso,
    //    a inserção quebrava inteira (playlist_id é UUID) e nada do
    //    upload aparecia no admin/cliente.
    const capturedAt = new Date().toISOString();

    // Buscamos a música/campanha pra ter o track_name correto em proofs.
    let trackNameForProofs = "";
    let campaignIdForUpdate: string | null = null;
    let spotifyTrackIdForProofs: string | null = null;
    {
      // (2026-06-19) Resolve campanha via curator_deals.campaign_id (1:N safe).
      const { data: dealCamp } = await admin
        .from("curator_deals")
        .select("campaign_id, campaigns:campaign_id(id, track_name, spotify_track_id)")
        .eq("id", dealId)
        .maybeSingle();
      const campRow = (dealCamp as any)?.campaigns ?? null;
      if (campRow) {
        trackNameForProofs = campRow.track_name ?? "";
        campaignIdForUpdate = campRow.id ?? null;
        spotifyTrackIdForProofs = campRow.spotify_track_id ?? null;
      }
    }

    // Pra baseline a gente precisa registrar TODAS as playlists (internas +
    // orgânicas) pra ter ponto de partida completo. Só exige spotify_id.
    const allPlaylistRows = matched.filter(
      (r) => typeof r.playlist_spotify_id === "string" && r.playlist_spotify_id.length > 0,
    );
    const matchedInternal = matched.filter(
      (r) => typeof r.matched_playlist_id === "string" && r.matched_playlist_id.length === 36 && !!r.playlist_spotify_id,
    );

    if (allPlaylistRows.length > 0) {
      // 3.0) Garante que existe um curator_playlists pra cada (deal, song, spotify_id).
      //      Snapshots e proofs têm FK pra essa tabela — sem ela o insert quebra.
      //      ⚠️ Não usar .upsert({ onConflict: "deal_id,song_id,spotify_playlist_id" })
      //         porque a unicidade real é um índice de EXPRESSÃO (COALESCE no song_id)
      //         — PostgREST não casa e o upsert falha em silêncio, deixando 0 linhas
      //         e quebrando snapshots/proofs em cascata. Por isso fazemos
      //         "select existentes → insert apenas o que falta".
      const spIds = Array.from(
        new Set(allPlaylistRows.map((r) => r.playlist_spotify_id as string)),
      );
      const { data: existingCp } = await admin
        .from("curator_playlists")
        .select("id, spotify_playlist_id")
        .eq("deal_id", dealId)
        .in("spotify_playlist_id", spIds);
      const cpIdBySpotify = new Map<string, string>(
        (existingCp ?? []).map((p: any) => [p.spotify_playlist_id as string, p.id as string]),
      );
      const missingRows = allPlaylistRows.filter(
        (r) => !cpIdBySpotify.has(r.playlist_spotify_id as string),
      );
      if (missingRows.length > 0) {
        const insertRows = missingRows.map((r) => ({
          deal_id: dealId,
          song_id: songId,
          spotify_playlist_id: r.playlist_spotify_id as string,
          spotify_url: r.playlist_url
            || (r.playlist_spotify_id ? `https://open.spotify.com/playlist/${r.playlist_spotify_id}` : ""),
          playlist_name: r.playlist_name,
          spotify_owner_name: r.owner_name ?? null,
          canonical_playlist_id: (typeof r.matched_playlist_id === "string" && r.matched_playlist_id.length === 36)
            ? r.matched_playlist_id
            : null,
          attribution_method: "label_spreadsheet",
        }));
        const { data: inserted, error: cpErr } = await admin
          .from("curator_playlists")
          .insert(insertRows)
          .select("id, spotify_playlist_id");
        if (cpErr) console.error("curator_playlists insert error", cpErr);
        for (const row of (inserted ?? []) as any[]) {
          cpIdBySpotify.set(row.spotify_playlist_id as string, row.id as string);
        }
      }


      // Snapshots: TODAS as playlists (internas + orgânicas) — pra baseline ter
      // a foto completa e pra calcular entrega a partir de qualquer playlist.
      const enrichedAll = allPlaylistRows
        .map((r) => ({ r, cpId: cpIdBySpotify.get(r.playlist_spotify_id as string) }))
        .filter((x): x is { r: typeof allPlaylistRows[number]; cpId: string } => !!x.cpId);

      const snapshotRows = enrichedAll.map(({ r, cpId }) => ({
        deal_id: dealId,
        song_id: songId,
        playlist_id: cpId,
        plays: r.streams,
        captured_at: capturedAt,
        source: "label_spreadsheet",
        is_initial_capture: isBaseline,
        notes: r.playlist_name + (r.owner_name ? ` (${r.owner_name})` : ""),
        ai_raw: {
          source: "label_spreadsheet",
          format: fmt,
          playlist_name: r.playlist_name,
          playlist_spotify_id: r.playlist_spotify_id,
          owner_name: r.owner_name,
          country: r.country,
          isrc: r.isrc,
          position_in_playlist: r.position_in_playlist,
          version_name: r.version_name,
          matched_curator_id: r.matched_curator_id,
          managed_playlist_id: r.matched_playlist_id,
          is_internal: r.is_internal,
          upload_id: uploadId,
        },
      }));

      const { error: snapErr } = await admin
        .from("curator_deal_snapshots")
        .insert(snapshotRows);
      if (snapErr) console.error("snapshot insert error", snapErr);

      // delivery_proofs — alimenta o painel admin (campaign hub → Prints).
      // ⚠️ Baseline NÃO vira entrega: é apenas o ponto de partida da música
      //   antes da campanha. Só uploads incrementais geram delivery_proofs.
      // E só vale pras playlists INTERNAS (nossas) — orgânicas ficam só
      // no snapshot, sem print de entrega.
      if (!isBaseline && songId && trackNameForProofs) {
        const enrichedInternal = matchedInternal
          .map((r) => ({ r, cpId: cpIdBySpotify.get(r.playlist_spotify_id as string) }))
          .filter((x): x is { r: typeof matchedInternal[number]; cpId: string } => !!x.cpId);
        const proofRows = enrichedInternal.map(({ r, cpId }) => ({
          deal_id: dealId,
          song_id: songId,
          playlist_id: cpId,
          spotify_playlist_id: r.playlist_spotify_id as string,
          playlist_name: r.playlist_name,
          track_name: trackNameForProofs,
          plays_total: r.streams,
          position_in_playlist: r.position_in_playlist ?? null,
          source: "label_spreadsheet",
          captured_at: capturedAt,
          spotify_track_id: spotifyTrackIdForProofs,
        }));
        if (proofRows.length > 0) {
          const { error: proofErr } = await admin.from("delivery_proofs").insert(proofRows);
          if (proofErr) console.error("delivery_proofs insert error", proofErr);
        }
      }

      // Música rastreada via planilha (Excel) NÃO deve ser coletada pelo bot S4A.
      // O bot não encontra breakdown porque a entrega vem do upload manual.
      // Desliga auto_collect e limpa estado de erro/pausa pra evitar loop.
      if (songId) {
        const { error: acErr } = await admin
          .from("curator_deal_songs")
          .update({
            auto_collect: false,
            auto_collect_status: "manual",
            auto_collect_error: null,
            collect_attempt_count: 0,
            collect_error_code: null,
            collect_paused_until: null,
          })
          .eq("id", songId)
          .eq("auto_collect", true);
        if (acErr) console.error("auto_collect off error", acErr);
      }
    }

    // 3b) Atualiza campaigns.total_delivered via Growth Engine (P1.1).
    //     Fonte ÚNICA = fn_campaign_delivery_accumulated → curadores + eco +
    //     orgânico, sempre delivery_accumulated (Σ deltas positivos por
    //     playlist, ignorando uploads quarentenados). A RPC também sincroniza
    //     curator_deals.reconciled_total_plays de TODOS os deals da campanha.
    if (campaignIdForUpdate) {
      const { error: recErr } = await admin.rpc(
        "recompute_campaign_total_delivered",
        { p_campaign_id: campaignIdForUpdate },
      );
      if (recErr) {
        console.error("[total_delivered] recompute error", recErr);
      } else {
        const { data: row } = await admin
          .from("campaigns")
          .select("total_delivered")
          .eq("id", campaignIdForUpdate)
          .maybeSingle();
        console.log(
          `[total_delivered] campaign=${campaignIdForUpdate} ` +
          `delivered=${row?.total_delivered ?? 0} via=growth_engine`,
        );
      }
    }

    // 3c) Espelho em campaign_playlist_collections — fonte de verdade da aba
    //     Monitoramento. Fase 3.A.1: escrita exclusivamente via Collection
    //     Writer (`_shared/collection-writer.ts`). Proibido INSERT/UPSERT
    //     direto nesta tabela em qualquer Edge Function.
    if (campaignIdForUpdate && allPlaylistRows.length > 0) {
      const intent: "baseline" | "periodic" = isBaseline ? "baseline" : "periodic";
      const collectionRows = allPlaylistRows
        .filter((r) => typeof r.playlist_spotify_id === "string" && r.playlist_spotify_id.length > 0)
        .map((r) => ({
          spotify_playlist_id: r.playlist_spotify_id as string,
          playlist_url: r.playlist_url
            || `https://open.spotify.com/playlist/${r.playlist_spotify_id}`,
          playlist_name: r.playlist_name ?? null,
          plays_7d: Math.max(0, Number(r.streams || 0)),
          source: "label_spreadsheet",
        }));
      const rejected = allPlaylistRows.length - collectionRows.length;
      console.log(`[mirror] start campaign=${campaignIdForUpdate} intent=${intent} received=${allPlaylistRows.length} valid=${collectionRows.length} rejected=${rejected}`);
      if (collectionRows.length > 0) {
        try {
          const { writeCollectionBatch } = await import("../_shared/collection-writer.ts");
          const result = await writeCollectionBatch(admin, {
            writer: "import-label-spreadsheet",
            campaign_id: campaignIdForUpdate,
            intent,
            rows: collectionRows,
            upload_id: uploadId,
            default_source: "label_spreadsheet",
          });
          console.log(`[mirror] writer ok campaign=${campaignIdForUpdate}`, JSON.stringify(result));
        } catch (e) {
          console.error(`[mirror] exception campaign=${campaignIdForUpdate}`, (e as Error).message);
        }

        // 3d) Auto-matcher: promove pending_match → matched quando há vínculo
        //     real (curator_playlists.match_status='curator') no(s) deal(s) da
        //     mesma campanha. Sem isso, a aba Curadores fica em "Matched 0"
        //     mesmo com a planilha já refletindo entrega real.
        try {
          const { data: matchData, error: matchErr } = await admin.rpc("match_curator_campaign_playlists", {
            p_campaign_id: campaignIdForUpdate,
          });
          if (matchErr) {
            console.error(`[matcher] error campaign=${campaignIdForUpdate}`, matchErr.message);
          } else {
            console.log(`[matcher] ok campaign=${campaignIdForUpdate}`, JSON.stringify(matchData));
          }
        } catch (e) {
          console.error(`[matcher] exception campaign=${campaignIdForUpdate}`, (e as Error).message);
        }
      }
    }




    // 4) Log agregado
    await admin.from("curator_deal_logs").insert({
      deal_id: dealId,
      song_id: songId,
      total_plays: totalStreams,
      note: `Planilha (${fmt.toUpperCase()}) — ${rows.length} playlists · ${internalCount} nossas · ${
        rows.length - internalCount
      } orgânicas${isBaseline ? " · BASELINE" : ""}`,
      is_initial_capture_event: isBaseline,
    });

    // 5) Primeira importação tira a campanha do limbo automaticamente
    //    + marca baseline_captured_at em campaigns e no curator_deal,
    //    pra UI (chip "Baseline coletada" / "Pronto para aprovação")
    //    refletir em tempo real. Sem isso o card ficava em "Baseline pendente"
    //    mesmo depois do cliente subir a planilha.
    if (isBaseline) {
      const baselineAt = capturedAt;

      // FASE 10.3 — Cronologia oficial da baseline:
      //  * baseline_reference_date (DATE) = data oficial do arquivo (referenceDate). Imutável.
      //    Só é gravada quando ainda está NULL (a trigger lock_baseline_reference_date
      //    garante a regra no banco; o filtro `.is("baseline_reference_date", null)`
      //    impede que UPDATEs subsequentes tentem reescrever e estourem a trigger).
      //  * baseline_captured_at (TIMESTAMPTZ) = quando o operador rodou a primeira
      //    importação. Também é gravado APENAS na primeira vez. Reimportações nunca
      //    mexem nele — respeitamos a decisão da RPC `ingest_campaign_collection_batch`
      //    (que retorna reason: 'baseline_already_captured' quando há baseline ativa).

      // Deal interno (placeholder da campanha) — só transita NULL → valor.
      await admin
        .from("curator_deals")
        .update({
          state: "collecting",
          baseline_captured_at: baselineAt,
          baseline_reference_date: referenceDate,
          baseline_plays: totalStreams,
        })
        .eq("id", dealId)
        .is("baseline_captured_at", null);

      // Garante baseline_reference_date mesmo em deals antigos cujo
      // baseline_captured_at já existia (mas o campo novo ainda está NULL).
      await admin
        .from("curator_deals")
        .update({ baseline_reference_date: referenceDate })
        .eq("id", dealId)
        .is("baseline_reference_date", null);

      // Campaign — só primeira baseline define data e marco temporal.
      // (2026-06-19) Resolve via campaignIdForUpdate (derivado de
      // curator_deals.campaign_id), não mais via campaigns.deal_id.
      if (campaignIdForUpdate) {
        await admin
          .from("campaigns")
          .update({
            status: "active",
            baseline_captured_at: baselineAt,
            baseline_reference_date: referenceDate,
            baseline_status: "captured",
          })
          .eq("id", campaignIdForUpdate)
          .is("baseline_captured_at", null);

        await admin
          .from("campaigns")
          .update({ baseline_reference_date: referenceDate })
          .eq("id", campaignIdForUpdate)
          .is("baseline_reference_date", null);
      }

      // Propaga para curator_deals reais da mesma campanha (collection_mode=spreadsheet).
      // Como a planilha reporta total por playlist (não por curador), gravamos só o marco
      // temporal: baseline_plays = null evita inventar número individual.
      if (campaignIdForUpdate) {
        const { data: camp } = await admin
          .from("campaigns")
          .select("collection_mode")
          .eq("id", campaignIdForUpdate)
          .maybeSingle();
        if ((camp as any)?.collection_mode === "spreadsheet") {
          await admin
            .from("curator_deals")
            .update({
              state: "collecting",
              baseline_captured_at: baselineAt,
              baseline_reference_date: referenceDate,
              baseline_plays: null,
            })
            .eq("campaign_id", campaignIdForUpdate)
            .neq("id", dealId)
            .is("baseline_captured_at", null);

          await admin
            .from("curator_deals")
            .update({ baseline_reference_date: referenceDate })
            .eq("campaign_id", campaignIdForUpdate)
            .neq("id", dealId)
            .is("baseline_reference_date", null);
        }
      }
    }

    // 6) Enriquece curator_playlists novas com capa/nome/seguidores do Spotify
    //    (best-effort — não bloqueia a resposta se falhar). Sem isso a aba
    //    Monitoramento mostra capa cinza e nome cru da planilha.
    try {
      const enrichUrl = `${SUPABASE_URL}/functions/v1/enrich-curator-playlists-spotify`;
      fetch(enrichUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SERVICE_KEY}`,
        },
        body: JSON.stringify({ deal_id: dealId }),
      }).catch(() => {});
    } catch (_) {
      // ignore
    }






    return jr({
      ok: true,
      mode: "commit",
      duplicate: false,
      summary: {
        ...previewSummary,
        rows_inserted: detailRows.length,
      },
      upload: uploadRow,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return jr({ ok: false, error: msg }, 200);
  }
});
