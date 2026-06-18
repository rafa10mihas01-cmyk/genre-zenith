// Utilitários para exportar dados em CSV ou JSON

function download(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: `${mime};charset=utf-8;` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function escapeCsvCell(v: unknown): string {
  if (v == null) return "";
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  if (/[",\n;]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function exportJSON(filename: string, data: unknown) {
  download(filename.endsWith(".json") ? filename : `${filename}.json`,
    JSON.stringify(data, null, 2), "application/json");
}

export function exportCSV<T extends Record<string, any>>(
  filename: string,
  rows: T[],
  columns?: { key: keyof T | string; label?: string }[],
) {
  if (rows.length === 0) {
    download(filename.endsWith(".csv") ? filename : `${filename}.csv`, "", "text/csv");
    return;
  }
  const cols = columns ?? Object.keys(rows[0]).map(k => ({ key: k }));
  const header = cols.map(c => escapeCsvCell(c.label ?? c.key)).join(",");
  const body = rows.map(r => cols.map(c => escapeCsvCell((r as any)[c.key as string])).join(",")).join("\n");
  download(filename.endsWith(".csv") ? filename : `${filename}.csv`,
    `${header}\n${body}`, "text/csv");
}

export function timestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}
