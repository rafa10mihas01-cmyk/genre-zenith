// Lista de "Playlists monitoradas" do portal do cliente.
// Mesma UI da página antiga /campanha/:token — recebe a lista
// já sanitizada (curator + engine) vinda do payload público.
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ListMusic, CheckCircle2, FileSpreadsheet, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import { exportCSV } from "@/lib/export";
import * as XLSX from "xlsx";

export type MonitoredPlaylist = {
  name: string;
  image_url: string | null;
  delivered: number;
  status: "Nova" | "Crescendo" | "Destaque" | "Estável";
  source?: "curator" | "engine";
  planned?: number;
  plays_24h?: number | null;
  plays_7d?: number | null;
  plays_28d?: number | null;
  last_import_delta?: number | null;
  spotify_playlist_id?: string | null;
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
  if (p.status === "Nova" || p.delivered <= 0) return "aguardando";
  return "entregando";
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

function exportExcel(filename: string, rows: Record<string, unknown>[]) {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Playlists");
  XLSX.writeFile(wb, filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`);
}

export function MonitoredPlaylistsCard({
  playlists,
  clientName,
  collectionMode = "bot",
}: {
  playlists: MonitoredPlaylist[];
  clientName?: string;
  /**
   * "bot"         = coleta automática via S4A → mostra 7D/28D
   * "spreadsheet" = importação manual de planilha → esconde 7D/28D
   *                 (essas janelas só existem quando o bot coleta)
   */
  collectionMode?: "bot" | "spreadsheet";
}) {
  const isManual = collectionMode === "spreadsheet";

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

  // Ordenação: entregando primeiro (delivered desc), aguardando depois
  const sorted = [...playlists].sort((a, b) => {
    const sa = clientStatus(a) === "entregando" ? 1 : 0;
    const sb = clientStatus(b) === "entregando" ? 1 : 0;
    if (sa !== sb) return sb - sa;
    return (b.delivered ?? 0) - (a.delivered ?? 0);
  });
  const entregandoCount = sorted.filter((p) => clientStatus(p) === "entregando").length;

  function buildRows() {
    return sorted.map((p) => {
      const base: Record<string, unknown> = {
        PLAYLIST: p.name,
        URL: p.spotify_playlist_id
          ? `https://open.spotify.com/playlist/${p.spotify_playlist_id}`
          : "",
        "ENTREGA ACUMULADA": p.delivered ?? 0,
        "ÚLTIMA IMPORTAÇÃO": p.last_import_delta ?? "",
      };
      // 7D/28D só fazem sentido no fluxo automático (S4A).
      // No fluxo manual (planilha) essas colunas não existem na fonte.
      if (!isManual) {
        base["7D"] = p.plays_7d ?? "";
        base["28D"] = p.plays_28d ?? "";
      }
      base["STATUS"] = p.status;
      return base;
    });
  }

  function handleExportExcel() {
    const rows = buildRows();
    if (rows.length === 0) return;
    const baseName = sanitizeFileName(clientName || "cliente");
    exportExcel(`playlists-${baseName}-${isoDate()}`, rows);
  }

  function handleExportCSV() {
    const rows = buildRows();
    if (rows.length === 0) return;
    const baseName = sanitizeFileName(clientName || "cliente");
    exportCSV(`playlists-${baseName}-${isoDate()}.csv`, rows);
  }

  return (
    <Card className="border-border">
      <CardContent className="p-5 sm:p-6 space-y-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold inline-flex items-center gap-2 tracking-tight">
              <ListMusic className="h-4 w-4 text-muted-foreground" />
              Playlists monitoradas
            </h2>
            <p className="text-[12px] text-muted-foreground mt-1 leading-snug">
              {entregandoCount} de {sorted.length} entregando agora
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-[11px] gap-1.5"
              onClick={handleExportCSV}
              disabled={sorted.length === 0}
            >
              <FileText className="h-3.5 w-3.5" />
              Exportar CSV
            </Button>
            <Button
              variant="default"
              size="sm"
              className="h-8 text-[11px] gap-1.5"
              onClick={handleExportExcel}
              disabled={sorted.length === 0}
            >
              <FileSpreadsheet className="h-3.5 w-3.5" />
              Exportar Excel
            </Button>
            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-primary bg-primary/10 ring-1 ring-primary/20 rounded-full px-2.5 py-1 tabular-nums">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full rounded-full bg-primary opacity-75 animate-ping" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
              </span>
              {sorted.length} ativas
            </span>
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
                    <div className="flex items-center gap-2 mt-1 text-[10px] tabular-nums text-muted-foreground">
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
