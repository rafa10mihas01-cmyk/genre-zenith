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
  let m = s.match(/playlist[:/]([A-Za-z0-9]{16,})/);
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
};

function detectFormat(fileName: string, buf: Uint8Array): "csv" | "xlsx" {
  if (/\.csv$/i.test(fileName)) return "csv";
  // Bytes iniciais: PK = zip = xlsx
  if (buf[0] === 0x50 && buf[1] === 0x4b) return "xlsx";
  // BOM ou ASCII printable = csv
  return "csv";
}

function parseBuf(
  buf: Uint8Array,
  fmt: "csv" | "xlsx",
): { rows: ParsedRow[]; warnings: string[]; detected: string[]; autoFixes: Record<string, number> } {
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
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return { rows: [], warnings: ["Planilha sem abas"], detected: [], autoFixes };
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
    const playlist_name = String(mapped.playlist_name ?? "").trim();
    if (!playlist_name) { autoFixes.empty_rows++; continue; }
    if (isJunkRow(playlist_name)) { autoFixes.junk_rows++; continue; }

    const streamsRaw = mapped.streams;
    const streamsParsed = parseFlexibleNumber(streamsRaw);
    if (typeof streamsRaw === "string" && streamsRaw !== String(streamsParsed)) {
      autoFixes.number_normalized++;
    }
    const streams = streamsParsed < 0 ? (autoFixes.negative_clamped++, 0) : streamsParsed;

    const rawUri = mapped.playlist_uri ? String(mapped.playlist_uri) : null;
    const rawUrl = mapped.playlist_url ? String(mapped.playlist_url) : null;
    const playlist_uri = cleanUrl(rawUri);
    const playlist_url = cleanUrl(rawUrl);
    if ((rawUri && rawUri !== playlist_uri) || (rawUrl && rawUrl !== playlist_url)) {
      autoFixes.url_cleaned++;
    }
    const playlist_spotify_id = extractPlaylistId(playlist_uri) ||
      extractPlaylistId(playlist_url);

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
      `${playlist_name}|${mapped.owner_name ?? ""}`).toLowerCase();
    if (seen.has(dedupeKey)) { autoFixes.duplicates++; continue; }
    seen.add(dedupeKey);

    rows.push({
      row_position: mapped.row_position != null ? Number(mapped.row_position) || null : null,
      version_name: String(mapped.version_name ?? "").trim(),
      isrc: String(mapped.isrc ?? "").trim().toUpperCase(),
      playlist_name,
      playlist_uri,
      playlist_url,
      playlist_spotify_id,
      country: mapped.country ? String(mapped.country).trim() : null,
      owner_name: mapped.owner_name ? String(mapped.owner_name).trim() : null,
      position_in_playlist,
      streams,
      raw: r as Record<string, unknown>,
    });
  }
  if (rows.length === 0) warnings.push("Nenhuma linha válida encontrada");
  return { rows, warnings, detected, autoFixes };
}

type MatchResult = {
  matched_playlist_id: string | null;
  matched_curator_id: string | null;
  is_internal: boolean;
};

async function buildMatchers(
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

  // Match de playlists por spotify_playlist_id
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

  // Match de curadores por spotify_owner_id (case-insensitive)
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

  return function match(r: ParsedRow): MatchResult {
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const token = String(body?.client_token ?? "").trim();
    const fileB64 = String(body?.file_base64 ?? "");
    const fileName = String(body?.file_name ?? "planilha.xlsx");
    const mode = body?.mode === "commit" ? "commit" : "preview";

    if (!token) return jr({ ok: false, error: "Link do cliente inválido. Reabra o portal pelo link enviado." }, 200);
    if (!fileB64) return jr({ ok: false, error: "Arquivo obrigatório" }, 200);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    const { data: resolved, error: resErr } = await admin.rpc("resolve_client_token", {
      _token: token,
    });
    if (resErr) return jr({ ok: false, error: resErr.message }, 200);
    const row = Array.isArray(resolved) && resolved.length > 0 ? resolved[0] : null;
    if (!row?.deal_id) return jr({ ok: false, error: "Link do cliente inválido ou expirado. Reabra o portal pelo link enviado." }, 200);

    const dealId = String(row.deal_id);
    const songId = row.song_id ? String(row.song_id) : null;

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

    const { rows, warnings, detected, autoFixes } = parseBuf(buf, fmt);
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

    // Match com playlists/curadores nossos
    const matcher = await buildMatchers(admin, rows);
    const matched = rows.map((r) => ({ ...r, ...matcher(r) }));
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

    if (mode === "preview") {
      return jr({ ok: true, mode: "preview", summary: previewSummary });
    }

    // ----- COMMIT -----

    const today = new Date().toISOString().slice(0, 10);
    const { data: existingUpload } = await admin
      .from("label_spreadsheet_uploads")
      .select("id, rows_imported, total_streams, created_at")
      .eq("deal_id", dealId)
      .eq("content_hash", hash)
      .eq("reference_date", today)
      .maybeSingle();
    if (existingUpload) {
      return jr({
        ok: true,
        mode: "commit",
        duplicate: true,
        message: "Essa mesma planilha já foi enviada hoje.",
        upload: existingUpload,
      });
    }

    // 🎯 Primeiro upload do deal vira BASELINE automaticamente.
    // Sem isso, o cálculo de "delivered" conta tudo desde o início como
    // entrega — inflando o progresso. Marcamos uma vez só.
    const { count: prevUploadsCount } = await admin
      .from("label_spreadsheet_uploads")
      .select("id", { count: "exact", head: true })
      .eq("deal_id", dealId);
    const isBaseline = (prevUploadsCount ?? 0) === 0;

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
        status: "imported",
        reference_date: today,
        is_baseline: isBaseline,
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
      const { data: campRow } = await admin
        .from("campaigns")
        .select("id, track_name, spotify_track_id")
        .eq("deal_id", dealId)
        .maybeSingle();
      if (campRow) {
        trackNameForProofs = (campRow as any).track_name ?? "";
        campaignIdForUpdate = (campRow as any).id ?? null;
        spotifyTrackIdForProofs = (campRow as any).spotify_track_id ?? null;
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
      const upsertRows = allPlaylistRows.map((r) => ({
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
      const { error: cpErr } = await admin
        .from("curator_playlists")
        .upsert(upsertRows, {
          onConflict: "deal_id,song_id,spotify_playlist_id",
          ignoreDuplicates: false,
        });
      if (cpErr) console.error("curator_playlists upsert error", cpErr);

      // 3.0b) Lê de volta os ids (curator_playlists.id) pra usar como playlist_id.
      const spIds = matchedInternal.map((r) => r.playlist_spotify_id as string);
      const { data: cpRows } = await admin
        .from("curator_playlists")
        .select("id, spotify_playlist_id")
        .eq("deal_id", dealId)
        .in("spotify_playlist_id", spIds);
      const cpIdBySpotify = new Map<string, string>(
        (cpRows ?? []).map((p: any) => [p.spotify_playlist_id as string, p.id as string]),
      );

      const enriched = matchedInternal
        .map((r) => ({ r, cpId: cpIdBySpotify.get(r.playlist_spotify_id as string) }))
        .filter((x): x is { r: typeof matchedInternal[number]; cpId: string } => !!x.cpId);

      const snapshotRows = enriched.map(({ r, cpId }) => ({
        deal_id: dealId,
        song_id: songId,
        playlist_id: cpId,
        plays: r.streams,
        captured_at: capturedAt,
        source: "label_spreadsheet",
        is_baseline: isBaseline,
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
      if (!isBaseline && songId && trackNameForProofs) {
        const proofRows = enriched.map(({ r, cpId }) => ({
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
    }

    // 3b) Atualiza campaigns.total_delivered = soma (por playlist) do
    //     último upload incremental MENOS a baseline. Baseline sozinha
    //     deixa total_delivered = 0 — o ponto de partida não é entrega.
    if (campaignIdForUpdate) {
      const { data: allRows } = await admin
        .from("label_spreadsheet_rows")
        .select("streams, playlist_spotify_id, upload_id, label_spreadsheet_uploads!inner(is_baseline, created_at)")
        .eq("deal_id", dealId);

      const baselineByPlaylist = new Map<string, number>();
      // Map<playlist_spotify_id, { streams, createdAt }>
      const latestByPlaylist = new Map<string, { streams: number; t: number }>();
      for (const row of (allRows ?? []) as any[]) {
        const pid = row.playlist_spotify_id as string | null;
        if (!pid) continue;
        const upload = row.label_spreadsheet_uploads as any;
        const streams = Number(row.streams || 0);
        if (upload?.is_baseline) {
          baselineByPlaylist.set(pid, Math.max(baselineByPlaylist.get(pid) ?? 0, streams));
        } else {
          const t = new Date(upload?.created_at ?? 0).getTime();
          const cur = latestByPlaylist.get(pid);
          if (!cur || t > cur.t) latestByPlaylist.set(pid, { streams, t });
        }
      }

      let delivered = 0;
      for (const [pid, { streams }] of latestByPlaylist) {
        const base = baselineByPlaylist.get(pid) ?? 0;
        delivered += Math.max(0, streams - base);
      }

      await admin
        .from("campaigns")
        .update({ total_delivered: delivered })
        .eq("id", campaignIdForUpdate);
    }

    // 4) Log agregado
    await admin.from("curator_deal_logs").insert({
      deal_id: dealId,
      song_id: songId,
      total_plays: totalStreams,
      note: `Planilha (${fmt.toUpperCase()}) — ${rows.length} playlists · ${internalCount} nossas · ${
        rows.length - internalCount
      } orgânicas${isBaseline ? " · BASELINE" : ""}`,
      is_baseline: isBaseline,
    });

    // 5) Primeira importação tira a campanha do limbo automaticamente
    if (isBaseline) {
      await admin
        .from("curator_deals")
        .update({ state: "collecting" })
        .eq("id", dealId)
        .in("state", ["awaiting_playlists", "draft", "pending"]);
      await admin
        .from("campaigns")
        .update({ status: "active" })
        .eq("deal_id", dealId)
        .neq("status", "active");
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
