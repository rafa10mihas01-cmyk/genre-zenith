import { useMemo, useState, ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ArrowDown, ArrowUp, ArrowUpDown, Download, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { downloadCSV } from "@/lib/csv";

export interface Column<T> {
  key: string;
  header: string;
  accessor: (row: T) => any;
  cell?: (row: T) => ReactNode;
  sortable?: boolean;
  className?: string;
  align?: "left" | "right" | "center";
}

interface DataTableProps<T> {
  rows: T[];
  columns: Column<T>[];
  searchKeys?: (keyof T | string)[];
  searchPlaceholder?: string;
  initialSort?: { key: string; dir: "asc" | "desc" };
  exportFilename?: string;
  emptyLabel?: string;
  pageSize?: number;
  toolbarLeft?: ReactNode;
}

export function DataTable<T extends Record<string, any>>({
  rows,
  columns,
  searchKeys,
  searchPlaceholder = "Buscar...",
  initialSort,
  exportFilename,
  emptyLabel = "Nenhum dado.",
  pageSize = 50,
  toolbarLeft,
}: DataTableProps<T>) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" } | null>(initialSort ?? null);
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    const keys = searchKeys && searchKeys.length > 0 ? searchKeys : Object.keys(rows[0] ?? {});
    return rows.filter((r) =>
      keys.some((k) => String(r[k as string] ?? "").toLowerCase().includes(q))
    );
  }, [rows, query, searchKeys]);

  const sorted = useMemo(() => {
    if (!sort) return filtered;
    const col = columns.find((c) => c.key === sort.key);
    if (!col) return filtered;
    return [...filtered].sort((a, b) => {
      const va = col.accessor(a);
      const vb = col.accessor(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === "number" && typeof vb === "number") {
        return sort.dir === "asc" ? va - vb : vb - va;
      }
      return sort.dir === "asc"
        ? String(va).localeCompare(String(vb))
        : String(vb).localeCompare(String(va));
    });
  }, [filtered, sort, columns]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(page, totalPages - 1);
  const pageRows = sorted.slice(safePage * pageSize, (safePage + 1) * pageSize);

  function toggleSort(key: string) {
    setPage(0);
    setSort((cur) => {
      if (!cur || cur.key !== key) return { key, dir: "desc" };
      if (cur.dir === "desc") return { key, dir: "asc" };
      return null;
    });
  }

  function handleExport() {
    if (!exportFilename) return;
    const data = sorted.map((row) => {
      const out: Record<string, unknown> = {};
      columns.forEach((c) => { out[c.header] = c.accessor(row); });
      return out;
    });
    downloadCSV(exportFilename, data, columns.map((c) => c.header));
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        {toolbarLeft}
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => { setQuery(e.target.value); setPage(0); }}
            placeholder={searchPlaceholder}
            className="pl-8 h-9 text-sm"
          />
        </div>
        <div className="text-xs text-muted-foreground tabular-nums">
          {sorted.length.toLocaleString("pt-BR")} {sorted.length === 1 ? "registro" : "registros"}
        </div>
        {exportFilename && (
          <Button variant="outline" size="sm" onClick={handleExport} disabled={sorted.length === 0}>
            <Download className="h-3.5 w-3.5" /> CSV
          </Button>
        )}
      </div>

      <div className="border border-border rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr>
                {columns.map((c) => {
                  const active = sort?.key === c.key;
                  return (
                    <th
                      key={c.key}
                      className={cn(
                        "px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground border-b border-border",
                        c.align === "right" && "text-right",
                        c.align === "center" && "text-center",
                        !c.align && "text-left",
                        c.sortable && "cursor-pointer select-none hover:text-foreground",
                        c.className,
                      )}
                      onClick={c.sortable ? () => toggleSort(c.key) : undefined}
                    >
                      <span className="inline-flex items-center gap-1">
                        {c.header}
                        {c.sortable && (
                          active
                            ? (sort!.dir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)
                            : <ArrowUpDown className="h-3 w-3 opacity-30" />
                        )}
                      </span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {pageRows.length === 0 && (
                <tr>
                  <td colSpan={columns.length} className="px-3 py-12 text-center text-xs text-muted-foreground">
                    {emptyLabel}
                  </td>
                </tr>
              )}
              {pageRows.map((row, i) => (
                <tr key={i} className="border-b border-border/50 last:border-b-0 hover:bg-muted/20 transition-colors">
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      className={cn(
                        "px-3 py-2 align-middle",
                        c.align === "right" && "text-right tabular-nums",
                        c.align === "center" && "text-center",
                        c.className,
                      )}
                    >
                      {c.cell ? c.cell(row) : c.accessor(row)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <div>
            Página {safePage + 1} de {totalPages}
          </div>
          <div className="flex gap-1">
            <Button variant="outline" size="sm" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>
              Anterior
            </Button>
            <Button variant="outline" size="sm" disabled={safePage >= totalPages - 1} onClick={() => setPage(safePage + 1)}>
              Próxima
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
