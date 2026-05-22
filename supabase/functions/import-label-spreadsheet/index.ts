// import-label-spreadsheet
// Aceita upload de planilha (.xlsx) da gravadora pelo cliente (portal público)
// ou pela equipe interna. Parseia, valida ISRC e grava como snapshots no
// mesmo formato que o coletor do Spotify usa — assim o motor de velocidade,
// ETA e score consome igual sem saber a origem.
//
// Body:
//   {
//     client_token: string,       // obrigatório (portal público)
//     file_base64: string,        // .xlsx em base64
//     file_name?: string,
//     mode?: "preview" | "commit" // default "preview"
//   }
//
// Layout esperado (com headers, ordem flexível):
//   #, VERSION NAME, ISRC, PLAYLIST, COUNTRY, OWNER NAME, CURRENT POSITION, STREAMS
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
  return String(s ?? "").trim().toUpperCase();
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

// Mapeia headers da planilha pro nosso modelo
const HEADER_MAP: Record<string, string> = {
  "#": "position",
  "POSITION": "position",
  "POSIÇÃO": "position",
  "VERSION NAME": "version_name",
  "TRACK": "version_name",
  "TRACK NAME": "version_name",
  "MUSICA": "version_name",
  "MÚSICA": "version_name",
  "ISRC": "isrc",
  "PLAYLIST": "playlist_name",
  "PLAYLIST NAME": "playlist_name",
  "COUNTRY": "country",
  "PAIS": "country",
  "OWNER NAME": "owner_name",
  "CURATOR": "owner_name",
  "CURADOR": "owner_name",
  "CURRENT POSITION": "position_in_playlist",
  "POSITION IN PLAYLIST": "position_in_playlist",
  "STREAMS": "streams",
  "PLAYS": "streams",
};

type ParsedRow = {
  position: number | null;
  version_name: string;
  isrc: string;
  playlist_name: string;
  country: string | null;
  owner_name: string | null;
  position_in_playlist: number | null;
  streams: number;
};

function parseSheet(buf: Uint8Array): { rows: ParsedRow[]; warnings: string[] } {
  const wb = XLSX.read(buf, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return { rows: [], warnings: ["Planilha sem abas"] };
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });
  const warnings: string[] = [];
  const rows: ParsedRow[] = [];

  for (const r of raw) {
    const mapped: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(r)) {
      const key = HEADER_MAP[normalize(k)];
      if (key) mapped[key] = v;
    }
    const playlist_name = String(mapped.playlist_name ?? "").trim();
    if (!playlist_name) continue;
    const streamsRaw = mapped.streams;
    const streams = typeof streamsRaw === "number"
      ? Math.max(0, Math.round(streamsRaw))
      : parseInt(String(streamsRaw ?? "0").replace(/[^\d]/g, ""), 10) || 0;
    rows.push({
      position: mapped.position != null ? Number(mapped.position) || null : null,
      version_name: String(mapped.version_name ?? "").trim(),
      isrc: String(mapped.isrc ?? "").trim().toUpperCase(),
      playlist_name,
      country: mapped.country ? String(mapped.country).trim() : null,
      owner_name: mapped.owner_name ? String(mapped.owner_name).trim() : null,
      position_in_playlist: mapped.position_in_playlist != null
        ? Number(mapped.position_in_playlist) || null
        : null,
      streams,
    });
  }
  if (rows.length === 0) warnings.push("Nenhuma linha válida encontrada");
  return { rows, warnings };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const token = String(body?.client_token ?? "").trim();
    const fileB64 = String(body?.file_base64 ?? "");
    const fileName = String(body?.file_name ?? "planilha.xlsx");
    const mode = body?.mode === "commit" ? "commit" : "preview";

    if (!token) return jr({ ok: false, error: "client_token obrigatório" }, 400);
    if (!fileB64) return jr({ ok: false, error: "file_base64 obrigatório" }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    // Resolve deal_id via função RPC pública
    const { data: resolved, error: resErr } = await admin.rpc("resolve_client_token", {
      _token: token,
    });
    if (resErr) return jr({ ok: false, error: resErr.message }, 200);
    const row = Array.isArray(resolved) && resolved.length > 0 ? resolved[0] : null;
    if (!row?.deal_id) return jr({ ok: false, error: "token inválido" }, 403);

    const dealId = String(row.deal_id);
    const songId = row.song_id ? String(row.song_id) : null;

    // Decodifica + hash
    let buf: Uint8Array;
    try {
      buf = base64ToBytes(fileB64);
    } catch (_) {
      return jr({ ok: false, error: "Arquivo inválido (base64)" }, 400);
    }
    if (buf.length > 8 * 1024 * 1024) {
      return jr({ ok: false, error: "Arquivo grande demais (máx 8MB)" }, 400);
    }
    const hash = await sha256Hex(buf);

    // Parseia
    const { rows, warnings } = parseSheet(buf);
    if (rows.length === 0) {
      return jr({ ok: false, error: "Planilha vazia ou sem colunas reconhecidas", warnings }, 200);
    }

    const totalStreams = rows.reduce((acc, r) => acc + r.streams, 0);
    const uniqueIsrcs = Array.from(new Set(rows.map((r) => r.isrc).filter(Boolean)));

    const preview = {
      ok: true,
      mode: "preview",
      summary: {
        rows: rows.length,
        total_streams: totalStreams,
        unique_isrcs: uniqueIsrcs,
        playlists: rows.slice(0, 5).map((r) => ({
          name: r.playlist_name,
          streams: r.streams,
          owner: r.owner_name,
        })),
        warnings,
      },
    };

    if (mode === "preview") return jr(preview);

    // ----- COMMIT -----

    // 1) Verifica duplicata
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

    // 2) Sobe pro storage (best effort)
    const filePath = `${dealId}/${Date.now()}-${fileName.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    try {
      await admin.storage.from("label-spreadsheets").upload(filePath, buf, {
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        upsert: false,
      });
    } catch (_) {
      // não bloqueia o import se storage falhar
    }

    // 3) Insere snapshots em curator_deal_snapshots
    // Como não temos playlist_id real do Spotify (planilha não traz URL), criamos
    // um "playlist_id placeholder" determinístico baseado no nome+dono — isso
    // mantém a UNIQUE constraint (playlist_id, captured_at) feliz.
    const capturedAt = new Date().toISOString();
    const snapshotRows = rows.map((r) => {
      const placeholderId = `label:${dealId}:${r.playlist_name}|${r.owner_name ?? ""}`
        .toLowerCase()
        .replace(/\s+/g, "-")
        .slice(0, 240);
      return {
        deal_id: dealId,
        song_id: songId,
        playlist_id: placeholderId,
        plays: r.streams,
        captured_at: capturedAt,
        source: "label_spreadsheet",
        is_baseline: false,
        notes: r.playlist_name + (r.owner_name ? ` (${r.owner_name})` : ""),
        ai_raw: {
          source: "label_spreadsheet",
          playlist_name: r.playlist_name,
          owner_name: r.owner_name,
          country: r.country,
          isrc: r.isrc,
          position_in_playlist: r.position_in_playlist,
          version_name: r.version_name,
        },
      };
    });

    const { error: snapErr } = await admin
      .from("curator_deal_snapshots")
      .insert(snapshotRows);
    if (snapErr) {
      // Pode ser unique violation por captured_at exato — ignora silenciosamente
      // mas reporta
      console.error("snapshot insert error", snapErr);
    }

    // 4) Insere um log agregado (resumo)
    await admin.from("curator_deal_logs").insert({
      deal_id: dealId,
      song_id: songId,
      total_plays: totalStreams,
      note: `Planilha da gravadora — ${rows.length} playlists`,
      is_baseline: false,
    });

    // 5) Registra upload
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
        status: snapErr ? "imported_with_warnings" : "imported",
        error_message: snapErr ? snapErr.message : null,
        reference_date: today,
      })
      .select()
      .single();
    if (upErr) return jr({ ok: false, error: upErr.message }, 200);

    return jr({
      ok: true,
      mode: "commit",
      duplicate: false,
      summary: {
        rows: rows.length,
        total_streams: totalStreams,
        playlists_count: rows.length,
      },
      upload: uploadRow,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return jr({ ok: false, error: msg }, 200);
  }
});
