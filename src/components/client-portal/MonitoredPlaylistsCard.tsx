// Lista de "Playlists monitoradas" do portal do cliente.
// Mesma UI da página antiga /campanha/:token — recebe a lista
// já sanitizada (curator + engine) vinda do payload público.
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ListMusic, CheckCircle2, FileSpreadsheet, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import { exportCSV } from "@/lib/export";
import ExcelJS from "exceljs";

export type MonitoredPlaylist = {
  name: string;
  image_url: string | null;
  delivered: number;
  status: "Nova" | "Crescendo" | "Destaque" | "Estável" | "Aguardando coleta";
  source?: "curator" | "engine";
  planned?: number;
  plays_24h?: number | null;
  plays_7d?: number | null;
  plays_28d?: number | null;
  last_import_delta?: number | null;
  spotify_playlist_id?: string | null;
  registered_at?: string | null;
  is_pre_campaign?: boolean;
};

function formatPlays(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return "0";
  const v = Number(n);
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
  return Math.round(v).toString();
}

function clientStatus(p: MonitoredPlaylist): "entregando" | "aguardando" {
  // Regra única: se já entrou play, está entregando — independente de idade
  // ou de o backend ter rotulado como "Nova" / "Aguardando coleta".
  if ((p.delivered ?? 0) > 0 || (p.last_import_delta ?? 0) > 0) return "entregando";
  return "aguardando";
}

const STATUS_LABEL: Record<"entregando" | "aguardando", string> = {
  entregando: "Entregando",
  aguardando: "Aguardando",
};

function sanitizeFileName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function isoDate(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function nowPtBr(): string {
  return new Date().toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

// Paleta de status (preenchimento da célula STATUS).
const STATUS_FILL: Record<string, string> = {
  "Destaque":          "FF1DB954", // verde marca
  "Crescendo":         "FF22C55E", // verde
  "Estável":           "FF6B7280", // cinza
  "Nova":              "FFF59E0B", // âmbar
  "Aguardando coleta": "FF3F3F46", // cinza escuro
};
const STATUS_FONT: Record<string, string> = {
  "Destaque":          "FFFFFFFF",
  "Crescendo":         "FFFFFFFF",
  "Estável":           "FFFFFFFF",
  "Nova":              "FF111111",
  "Aguardando coleta": "FFFFFFFF",
};

export function MonitoredPlaylistsCard({
  playlists,
  loading = false,
  clientName,
  campaignName,
  artistName,
  collectionMode = "bot",
}: {
  playlists: MonitoredPlaylist[];
  loading?: boolean;
  clientName?: string;
  campaignName?: string;
  artistName?: string;
  /**
   * "bot"         = coleta automática via S4A → mostra 7D/28D
   * "spreadsheet" = importação manual de planilha → esconde 7D/28D
   */
  collectionMode?: "bot" | "spreadsheet";
}) {
  const isManual = collectionMode === "spreadsheet";

  if (loading && (!playlists || playlists.length === 0)) {
    return (
      <Card className="border-border">
        <CardContent className="p-5 sm:p-6 space-y-3">
          <div className="flex items-center gap-2">
            <ListMusic className="h-4 w-4 text-muted-foreground" />
            <span className="text-[13px] text-muted-foreground">Carregando playlists monitoradas…</span>
          </div>
          <ul className="space-y-1.5">
            {Array.from({ length: 6 }).map((_, i) => (
              <li key={i} className="rounded-lg border border-border bg-card px-3 py-2">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-md bg-muted/60 animate-pulse" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3 w-2/3 rounded bg-muted/60 animate-pulse" />
                    <div className="h-2 w-1/3 rounded bg-muted/40 animate-pulse" />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    );
  }

  if (!playlists || playlists.length === 0) {
    return (
      <Card className="border-border">
        <CardContent className="p-8 text-center space-y-2">
          <div className="mx-auto h-12 w-12 rounded-2xl bg-muted/40 ring-1 ring-border flex items-center justify-center">
            <ListMusic className="h-5 w-5 text-muted-foreground" />
          </div>
          <p className="text-[14px] font-semibold">Aguardando primeira coleta</p>
          <p className="text-[12px] text-muted-foreground">
            As playlists monitoradas aparecerão aqui assim que o curador iniciar a entrega.
          </p>
        </CardContent>
      </Card>
    );
  }

  // Ordenação na UI: entregando primeiro (delivered desc), aguardando depois
  const sorted = [...playlists].sort((a, b) => {
    const sa = clientStatus(a) === "entregando" ? 1 : 0;
    const sb = clientStatus(b) === "entregando" ? 1 : 0;
    if (sa !== sb) return sb - sa;
    return (b.delivered ?? 0) - (a.delivered ?? 0);
  });
  const entregandoCount = sorted.filter((p) => clientStatus(p) === "entregando").length;

  // Dados pra export (ordenados só por delivered desc, conforme prompt).
  function exportRows() {
    return [...playlists]
      .sort((a, b) => (b.delivered ?? 0) - (a.delivered ?? 0))
      .map((p, idx) => ({
        POS: idx + 1,
        PLAYLIST: p.name,
        URL: p.spotify_playlist_id
          ? `https://open.spotify.com/playlist/${p.spotify_playlist_id}`
          : "",
        "ENTREGA ACUMULADA": Number(p.delivered ?? 0),
        "ÚLTIMA IMPORTAÇÃO":
          p.last_import_delta == null ? null : Number(p.last_import_delta),
        ...(isManual
          ? {}
          : {
              "7D": p.plays_7d == null ? null : Number(p.plays_7d),
              "28D": p.plays_28d == null ? null : Number(p.plays_28d),
            }),
        STATUS: p.status,
      }));
  }

  // CSV continua simples — só ordenado e com POS.
  function handleExportCSV() {
    const rows = exportRows();
    if (rows.length === 0) return;
    const baseName = sanitizeFileName(clientName || "cliente");
    exportCSV(`Playlists-${baseName}-${isoDate()}.csv`, rows);
  }

  async function handleExportExcel() {
    const rows = exportRows();
    if (rows.length === 0) return;

    const wb = new ExcelJS.Workbook();
    wb.creator = "NexEngine";
    wb.created = new Date();
    const ws = wb.addWorksheet("Playlists", {
      views: [{ state: "frozen", ySplit: 9 }], // congela cabeçalho exec + header da tabela
    });

    const totalDelivered = rows.reduce(
      (sum, r) => sum + (Number(r["ENTREGA ACUMULADA"]) || 0),
      0,
    );

    // Define colunas (chaves bate com keys de rows).
    type Col = { header: string; key: string; width: number };
    const baseCols: Col[] = [
      { header: "POS", key: "POS", width: 6 },
      { header: "PLAYLIST", key: "PLAYLIST", width: 42 },
      { header: "LINK", key: "URL", width: 56 },
      { header: "ENTREGA ACUMULADA", key: "ENTREGA ACUMULADA", width: 20 },
      { header: "ÚLTIMA IMPORTAÇÃO", key: "ÚLTIMA IMPORTAÇÃO", width: 20 },
    ];
    if (!isManual) {
      baseCols.push({ header: "7D", key: "7D", width: 12 });
      baseCols.push({ header: "28D", key: "28D", width: 12 });
    }
    baseCols.push({ header: "STATUS", key: "STATUS", width: 14 });

    // Remove colunas totalmente vazias (exceto URL/POS/PLAYLIST/STATUS, sempre fixas).
    const fixedKeys = new Set(["POS", "PLAYLIST", "URL", "STATUS", "ENTREGA ACUMULADA"]);
    const cols = baseCols.filter((c) => {
      if (fixedKeys.has(c.key)) return true;
      return rows.some((r) => {
        const v = (r as Record<string, unknown>)[c.key];
        return v != null && v !== "";
      });
    });

    // ===== Cabeçalho executivo (linhas 1–7) =====
    const lastColLetter = ws.getColumn(cols.length).letter;
    const mergeRange = (row: number) => `A${row}:${lastColLetter}${row}`;

    // Linha 1: título grande
    ws.mergeCells(mergeRange(1));
    const titleCell = ws.getCell("A1");
    titleCell.value = "Relatório de Playlists Monitoradas";
    titleCell.font = { name: "Calibri", size: 16, bold: true, color: { argb: "FFFFFFFF" } };
    titleCell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
    titleCell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF0F0F0F" },
    };
    ws.getRow(1).height = 26;

    // Linhas 2–6: metadados (label | valor)
    const meta: [string, string | number][] = [
      ["Campanha", campaignName || "—"],
      ["Artista", artistName || clientName || "—"],
      ["Data da exportação", nowPtBr()],
      ["Quantidade de playlists", rows.length],
      ["Entrega acumulada total", totalDelivered],
    ];

    meta.forEach(([label, value], i) => {
      const row = i + 2;
      ws.mergeCells(`A${row}:B${row}`);
      ws.mergeCells(`C${row}:${lastColLetter}${row}`);
      const labelCell = ws.getCell(`A${row}`);
      const valueCell = ws.getCell(`C${row}`);
      labelCell.value = label;
      labelCell.font = { name: "Calibri", size: 10, bold: true, color: { argb: "FFB3B3B3" } };
      labelCell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
      labelCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF171717" } };
      valueCell.value = value;
      valueCell.font = { name: "Calibri", size: 11, bold: true, color: { argb: "FFFFFFFF" } };
      valueCell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
      valueCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF171717" } };
      if (label === "Quantidade de playlists") {
        valueCell.numFmt = "#,##0";
      } else if (label === "Entrega acumulada total") {
        valueCell.numFmt = "#,##0";
      }
      ws.getRow(row).height = 18;
    });

    // Linha 7: separador
    ws.getRow(7).height = 8;

    // ===== Cabeçalho da tabela (linha 8) =====
    const headerRowIdx = 8;
    const headerRow = ws.getRow(headerRowIdx);
    cols.forEach((c, i) => {
      const cell = headerRow.getCell(i + 1);
      cell.value = c.header;
      cell.font = { name: "Calibri", size: 11, bold: true, color: { argb: "FFFFFFFF" } };
      cell.alignment = { vertical: "middle", horizontal: "center" };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F0F0F" } };
      cell.border = {
        top:    { style: "thin", color: { argb: "FF2A2A2A" } },
        bottom: { style: "thin", color: { argb: "FF2A2A2A" } },
        left:   { style: "thin", color: { argb: "FF2A2A2A" } },
        right:  { style: "thin", color: { argb: "FF2A2A2A" } },
      };
    });
    headerRow.height = 22;

    // Aplica larguras das colunas
    cols.forEach((c, i) => {
      ws.getColumn(i + 1).width = c.width;
    });

    // ===== Linhas de dados =====
    const firstDataRow = headerRowIdx + 1;
    rows.forEach((r, rIdx) => {
      const excelRow = ws.getRow(firstDataRow + rIdx);
      const zebra = rIdx % 2 === 1;

      cols.forEach((c, cIdx) => {
        const cell = excelRow.getCell(cIdx + 1);
        const raw = (r as Record<string, unknown>)[c.key];

        if (c.key === "URL") {
          const url = (raw as string) || "";
          cell.value = url || "—";
          cell.font = {
            name: "Calibri",
            size: 11,
            color: { argb: url ? "FF111111" : "FF6B7280" },
          };
          cell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
        } else if (c.key === "STATUS") {
          const st = String(raw ?? "");
          cell.value = st || "—";
          const bg = STATUS_FILL[st];
          const fg = STATUS_FONT[st] ?? "FFFFFFFF";
          if (bg) {
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };
            cell.font = { name: "Calibri", size: 10, bold: true, color: { argb: fg } };
          } else {
            cell.font = { name: "Calibri", size: 10, color: { argb: "FF111111" } };
          }
          cell.alignment = { vertical: "middle", horizontal: "center" };
        } else if (
          c.key === "ENTREGA ACUMULADA" ||
          c.key === "ÚLTIMA IMPORTAÇÃO" ||
          c.key === "7D" ||
          c.key === "28D" ||
          c.key === "POS"
        ) {
          cell.value = raw == null || raw === "" ? null : Number(raw);
          cell.numFmt = "#,##0";
          cell.alignment = { vertical: "middle", horizontal: "right" };
          cell.font = {
            name: "Calibri",
            size: 11,
            bold: c.key === "ENTREGA ACUMULADA",
            color: { argb: "FF111111" },
          };
        } else {
          cell.value = (raw as string | number | null) ?? "";
          cell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
          cell.font = { name: "Calibri", size: 11, color: { argb: "FF111111" } };
        }

        // Zebra (não sobrescreve fill de STATUS).
        if (zebra && c.key !== "STATUS") {
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FFF5F5F5" },
          };
        }
        cell.border = {
          bottom: { style: "hair", color: { argb: "FFE5E5E5" } },
        };
      });
      excelRow.height = 18;
    });

    // Sem autoFilter — exportação limpa, só os nomes nas colunas.

    // Gera arquivo e dispara download.
    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const baseName = sanitizeFileName(clientName || "cliente");
    a.href = url;
    a.download = `Playlists-${baseName}-${isoDate()}.xlsx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <Card className="border-border">
      <CardContent className="p-5 sm:p-6 space-y-5">
        <div className="space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <h2 className="text-[15px] font-semibold inline-flex items-center gap-2 tracking-tight">
                <ListMusic className="h-4 w-4 text-muted-foreground" />
                Playlists monitoradas
              </h2>
              <p className="text-[12px] text-muted-foreground mt-1 leading-snug">
                {entregandoCount} de {sorted.length} entregando agora
              </p>
            </div>
            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-primary bg-primary/10 ring-1 ring-primary/20 rounded-full px-2.5 py-1 tabular-nums shrink-0 whitespace-nowrap">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full rounded-full bg-primary opacity-75 animate-ping" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
              </span>
              {sorted.length} ativas
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:flex sm:justify-end">
            <Button
              variant="outline"
              size="sm"
              className="h-9 text-[12px] gap-1.5 w-full sm:w-auto"
              onClick={handleExportCSV}
              disabled={sorted.length === 0}
            >
              <FileText className="h-3.5 w-3.5" />
              Exportar CSV
            </Button>
            <Button
              variant="default"
              size="sm"
              className="h-9 text-[12px] gap-1.5 w-full sm:w-auto"
              onClick={handleExportExcel}
              disabled={sorted.length === 0}
            >
              <FileSpreadsheet className="h-3.5 w-3.5" />
              Exportar Excel
            </Button>
          </div>
        </div>

        <div className="flex items-start gap-2 rounded-xl bg-muted/30 border border-border/60 px-3 py-2.5">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0 mt-0.5 text-primary" />
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Atualizado automaticamente a partir dos prints enviados pelo curador. Esta página é apenas de leitura.
          </p>
        </div>

        {/* ~10 linhas visíveis, demais com scroll. Cada item ~56px. */}
        <ul className="space-y-1.5 max-h-[600px] overflow-y-auto pr-1">
          {sorted.map((p, i) => {
            const st = clientStatus(p);
            const delivering = st === "entregando";
            return (
              <li
                key={`${p.name}-${i}`}
                className={cn(
                  "rounded-lg border bg-card px-3 py-2 transition-all hover:bg-muted/30",
                  delivering ? "border-success/30" : "border-border"
                )}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className={cn(
                    "relative h-10 w-10 rounded-md overflow-hidden bg-muted ring-1 shrink-0",
                    delivering ? "ring-success/40" : "ring-border"
                  )}>
                    {p.image_url ? (
                      <img src={p.image_url} alt={p.name} className="h-full w-full object-cover" loading="lazy" />
                    ) : (
                      <div className="h-full w-full flex items-center justify-center">
                        <ListMusic className="h-3.5 w-3.5 text-muted-foreground" />
                      </div>
                    )}
                    {delivering && (
                      <span className="absolute -top-0.5 -right-0.5 flex h-2 w-2">
                        <span className="absolute inline-flex h-full w-full rounded-full bg-success opacity-75 animate-ping" />
                        <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
                      </span>
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className={cn(
                      "text-[12px] font-medium truncate leading-tight",
                      delivering ? "text-foreground" : "text-muted-foreground"
                    )} title={p.name}>
                      {p.name}
                    </p>
                    <div className="flex items-center gap-x-2 gap-y-1 mt-1 text-[10px] tabular-nums text-muted-foreground flex-wrap">
                      <span className={cn(
                        "inline-flex items-center gap-1 font-medium",
                        delivering ? "text-success" : "text-muted-foreground/70"
                      )}>
                        <span className={cn(
                          "h-1.5 w-1.5 rounded-full",
                          delivering ? "bg-success" : "bg-muted-foreground/40"
                        )} />
                        {STATUS_LABEL[st]}
                      </span>
                      <span className="text-border">·</span>
                      <span>últ. import: <span className={cn("font-medium", p.last_import_delta != null && p.last_import_delta > 0 ? "text-foreground" : "text-muted-foreground/70")}>
                        {p.last_import_delta == null ? "—" : `+${formatPlays(p.last_import_delta)}`}
                      </span></span>
                      {p.registered_at && (
                        <>
                          <span className="text-border">·</span>
                          <span title={`Curador colou esta playlist no portal em ${new Date(p.registered_at).toLocaleString("pt-BR")}`}>
                            cadastrada {new Date(p.registered_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} {new Date(p.registered_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                          </span>
                        </>
                      )}
                      {p.is_pre_campaign && (
                        <span
                          className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[9.5px] font-semibold text-amber-400"
                          title="Esta música já estava nesta playlist antes da campanha começar. O curador se comprometeu a subir a posição da faixa."
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="h-2.5 w-2.5">
                            <path d="M12 19V5M5 12l7-7 7 7" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                          Pré-campanha · subiu posição
                        </span>
                      )}
                    </div>

                  </div>

                  <div className="text-right shrink-0 flex flex-col items-end gap-0.5">
                    {p.delivered > 0 ? (
                      <div className={cn(
                        "text-[15px] font-bold tabular-nums leading-none",
                        delivering ? "text-success" : "text-foreground"
                      )}>
                        +{formatPlays(p.delivered)}
                      </div>
                    ) : (
                      <div className="text-[14px] font-semibold tabular-nums text-muted-foreground/60 leading-none">—</div>
                    )}
                    {!isManual && (
                      <div className="flex items-center gap-1.5 text-[9.5px] tabular-nums text-muted-foreground">
                        <span>7d <span className="text-foreground/80 font-medium">{p.plays_7d != null ? formatPlays(p.plays_7d) : "—"}</span></span>
                        <span className="text-border">·</span>
                        <span>28d <span className="text-foreground/80 font-medium">{p.plays_28d != null ? formatPlays(p.plays_28d) : "—"}</span></span>
                      </div>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
