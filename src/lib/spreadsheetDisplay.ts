// UI-only helpers for spreadsheet uploads:
//   - friendlyUploadName: turns "pls_carnivoro_2026-06-15.xlsx" into
//     "Resultados de Playlists • Carnívoro • 15/06/2026"
//   - downloadUploadAsXlsx: signs the storage URL and, if the original is CSV,
//     converts to XLSX in-browser before triggering the download. XLSX files
//     pass through unchanged. Nothing is written back to Storage or DB.
import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";

const MONTHS_PT = [
  "Janeiro","Fevereiro","Março","Abril","Maio","Junho",
  "Julho","Agosto","Setembro","Outubro","Novembro","Dezembro",
] as const;

function titleCase(slug: string): string {
  return slug
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toLocaleUpperCase("pt-BR") + w.slice(1).toLocaleLowerCase("pt-BR"))
    // re-apply accents for common known labels
    .map((w) => {
      const map: Record<string, string> = {
        Carnivoro: "Carnívoro",
        Sertanejo: "Sertanejo",
        Eletronica: "Eletrônica",
        Cancao: "Canção",
      };
      return map[w] ?? w;
    })
    .join(" ");
}

function formatBrDate(iso: string): string {
  const [y, m, d] = iso.split("-").map((x) => Number(x));
  if (!y || !m || !d) return iso;
  const dd = String(d).padStart(2, "0");
  const mm = String(m).padStart(2, "0");
  return `${dd}/${mm}/${y}`;
}

/**
 * Build a human-friendly label for a spreadsheet upload to show in the UI.
 * Storage path / file_name are NEVER modified — this is presentation only.
 *
 * Examples:
 *   pls_carnivoro_2026-06-15.xlsx → "Resultados de Playlists • Carnívoro • 15/06/2026"
 *   resultados_pop_2026-06-14.csv → "Resultados de Playlists • Pop • 14/06/2026"
 *   anything-else.xlsx → "anything-else.xlsx" (untouched fallback)
 */
export function friendlyUploadName(
  rawName: string | null | undefined,
  referenceDate?: string | null,
): string {
  if (!rawName) return "Planilha";
  const trimmed = rawName.trim();
  const base = trimmed.replace(/\.(xlsx|xls|csv)$/i, "");
  // Try to extract: <prefix>_<genre>_<YYYY-MM-DD>
  const m = base.match(/^([a-zA-Z]+)[_\-]([a-zA-Z0-9_\-]+?)[_\-](\d{4}-\d{2}-\d{2})$/);
  if (m) {
    const genre = titleCase(m[2]);
    const date = formatBrDate(m[3]);
    return `Resultados de Playlists • ${genre} • ${date}`;
  }
  // Without date in name but with reference_date available:
  const m2 = base.match(/^([a-zA-Z]+)[_\-]([a-zA-Z0-9_\-]+)$/);
  if (m2 && referenceDate) {
    const genre = titleCase(m2[2]);
    return `Resultados de Playlists • ${genre} • ${formatBrDate(referenceDate)}`;
  }
  if (referenceDate) {
    return `Resultados de Playlists • ${formatBrDate(referenceDate)}`;
  }
  return trimmed;
}

function isCsvName(name: string | null | undefined, filePath?: string | null): boolean {
  const candidate = (name ?? filePath ?? "").toLowerCase();
  return candidate.endsWith(".csv");
}

function parseCsv(text: string): string[][] {
  // Minimal RFC-4180-ish parser: handles quoted fields with commas/newlines and "" escapes.
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = false;
      } else cur += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") { row.push(cur); cur = ""; }
      else if (c === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
      else if (c === "\r") { /* skip; \n will close the row */ }
      else cur += c;
    }
  }
  // flush last cell/row
  if (cur.length > 0 || row.length > 0) {
    row.push(cur);
    rows.push(row);
  }
  return rows;
}

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

async function fetchAndConvertCsvToXlsx(signedUrl: string, downloadName: string): Promise<void> {
  const res = await fetch(signedUrl);
  if (!res.ok) throw new Error(`Falha ao baixar CSV (${res.status})`);
  const text = await res.text();
  const rows = parseCsv(text);
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Resultados");
  const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  const blob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  triggerBlobDownload(blob, downloadName);
}

/**
 * Download from a Storage path (creates a signed URL on the fly).
 */
export async function downloadUploadAsXlsx(params: {
  filePath: string;
  fileName: string | null;
  referenceDate?: string | null;
}): Promise<void> {
  const { filePath, fileName, referenceDate } = params;
  const { data, error } = await supabase.storage
    .from("label-spreadsheets")
    .createSignedUrl(filePath, 60);
  if (error || !data?.signedUrl) throw error ?? new Error("Falha ao gerar link");

  const friendlyBase = friendlyUploadName(fileName, referenceDate)
    .replace(/[•/\\:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim();

  if (!isCsvName(fileName, filePath)) {
    const a = document.createElement("a");
    a.href = data.signedUrl;
    a.download = `${friendlyBase}.xlsx`;
    a.target = "_blank";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    return;
  }
  await fetchAndConvertCsvToXlsx(data.signedUrl, `${friendlyBase}.xlsx`);
}

/**
 * Download from an already-signed URL (used by views that receive download_url
 * pre-signed by the backend, e.g. Curator Portal).
 */
export async function downloadUploadUrlAsXlsx(params: {
  signedUrl: string;
  fileName: string | null;
  referenceDate?: string | null;
}): Promise<void> {
  const { signedUrl, fileName, referenceDate } = params;
  const friendlyBase = friendlyUploadName(fileName, referenceDate)
    .replace(/[•/\\:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim();

  if (!isCsvName(fileName, signedUrl)) {
    const a = document.createElement("a");
    a.href = signedUrl;
    a.download = `${friendlyBase}.xlsx`;
    a.target = "_blank";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    return;
  }
  await fetchAndConvertCsvToXlsx(signedUrl, `${friendlyBase}.xlsx`);
}
