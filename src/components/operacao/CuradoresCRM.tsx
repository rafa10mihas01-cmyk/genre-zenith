import { useEffect, useMemo, useRef, useState } from "react";
import {
  Upload, Search, Mail, Instagram, Link2, ExternalLink, Star, Ban, Copy,
  CheckCircle2, Trash2, Users, Filter, Download, Loader2,
} from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";

import { supabase } from "@/integrations/supabase/client";
import type { TablesInsert } from "@/integrations/supabase/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { downloadCSV } from "@/lib/csv";

/* ============================================================
   Tipos & helpers
   ============================================================ */

type Status = "novo" | "negociando" | "comprado" | "blacklist";

type CuradorRow = {
  id: string;
  user_id: string;
  spotify_playlist_id: string | null;
  spotify_url: string | null;
  name: string;
  owner_name: string | null;
  followers: number;
  tracks: number;
  track_popularity: number;
  activity: string | null;
  last_modified: string | null;
  email: string | null;
  instagram: string | null;
  social: string | null;
  links: string | null;
  description: string | null;
  score: string | null;
  score_raw: number | null;
  status: Status;
  favorite: boolean;
  notes: string | null;
};

type ExternalCuratorInsert = TablesInsert<"external_curators">;
type SheetCell = string | number | boolean | Date | null;

// Selos/owners corporativos a remover automaticamente
const BLOCKED_OWNERS = [
  "spotify", "filtr", "topsify", "universal", "sony", "warner",
  "digster", "spinnin", "kondzilla", "altafonte", "onerpm",
  "som livre", "somlivre", "atlantic", "republic records",
];

function isBlockedOwner(owner: string | null | undefined): boolean {
  const o = (owner ?? "").toLowerCase().trim();
  if (!o) return false;
  // Só bloqueia quando o owner bate com um selo conhecido — não usa o nome da playlist
  // pra evitar falsos positivos (ex: "Sony Music Vibes" feito por curador independente).
  return BLOCKED_OWNERS.some((b) => o === b || o.startsWith(b + " ") || o.endsWith(" " + b));
}

function findUrlInRow(row: SheetCell[]): string | null {
  for (const cell of row) {
    if (typeof cell !== "string") continue;
    const m = cell.match(/https?:\/\/[^\s,;]+/i);
    if (m) return m[0];
  }
  return null;
}

function extractPlaylistId(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = String(url).match(/playlist\/([A-Za-z0-9]+)/);
  return m ? m[1] : null;
}

function normalizeInstagram(text: unknown): string | null {
  if (!text) return null;
  const s = String(text).trim().replace(/[⧉↗→]/g, "");
  const m = s.match(/(?:instagram\.com\/|@)([A-Za-z0-9_.]+)/i);
  if (m) return m[1].replace(/^@/, "");
  if (/^[A-Za-z0-9_.]+$/.test(s)) return s.replace(/^@/, "");
  return s || null;
}

function extractEmail(...sources: unknown[]): string | null {
  const blob = sources.filter(Boolean).join(" ");
  const m = blob.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return m ? m[0] : null;
}

// Score A+/A/B/C/D — prioriza independentes humanos com contato real
function scoreOf(r: Pick<CuradorRow, "followers" | "tracks" | "email" | "instagram" | "links" | "social" | "activity" | "track_popularity" | "score_raw">): { label: string; tone: string; n: number } {
  let n = 0;
  // tamanho (até 40)
  if (r.followers >= 50000) n += 40;
  else if (r.followers >= 20000) n += 32;
  else if (r.followers >= 8000) n += 24;
  else if (r.followers >= 4000) n += 16;
  else n += 8;
  // contato (até 30)
  if (r.email) n += 18;
  if (r.instagram) n += 8;
  if (r.links || r.social) n += 4;
  // atividade (até 15)
  const a = (r.activity ?? "").toLowerCase();
  if (a === "high") n += 15;
  else if (a === "medium") n += 9;
  else if (a === "low") n += 3;
  // catálogo (até 10)
  if (r.tracks >= 80 && r.tracks <= 600) n += 10;
  else if (r.tracks > 0) n += 5;
  // bonus PlaylistSupply score (até 5)
  if (r.score_raw && r.score_raw >= 70) n += 5;
  else if (r.score_raw && r.score_raw >= 40) n += 3;

  let label = "D", tone = "text-muted-foreground border-border bg-elevated";
  if (n >= 80)      { label = "A+"; tone = "text-primary border-primary/40 bg-primary/15"; }
  else if (n >= 65) { label = "A";  tone = "text-primary border-primary/30 bg-primary/10"; }
  else if (n >= 50) { label = "B";  tone = "text-foreground border-foreground/20 bg-elevated"; }
  else if (n >= 35) { label = "C";  tone = "text-warning border-warning/30 bg-warning/10"; }
  return { label, tone, n };
}

function formatN(n: number) {
  if (!n) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return n.toLocaleString("pt-BR");
}

function parseCount(value: unknown): number {
  if (typeof value === "number") return Math.round(value);
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return 0;
  const multiplier = raw.includes("k") ? 1_000 : raw.includes("m") ? 1_000_000 : 1;
  const compact = raw.replace(/[\s+]/g, "").replace(/[km]/g, "");
  const normalized = compact.includes(",") && compact.includes(".")
    ? compact.replace(/\./g, "").replace(",", ".")
    : compact.replace(/[.,](?=\d{3}(\D|$))/g, "").replace(",", ".");
  const n = Number(normalized.replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? Math.round(n * multiplier) : 0;
}

/* ============================================================
   Parser XLSX/CSV (PlaylistSupply-like)
   ============================================================ */

type Imported = Omit<CuradorRow, "id" | "user_id" | "status" | "favorite" | "notes">;

function parseSheet(file: File): Promise<Imported[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = ev.target?.result;
        const wb = XLSX.read(data, { type: "binary" });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        // Pega como matriz e procura linha de cabeçalho
        const matrix = XLSX.utils.sheet_to_json<SheetCell[]>(sheet, { header: 1, defval: null });
        let headerIdx = matrix.findIndex((row) =>
          row.some((c) => typeof c === "string" && /nome|playlist name|name/i.test(c)) &&
          row.some((c) => typeof c === "string" && /follower/i.test(c)),
        );
        if (headerIdx < 0) headerIdx = 0;
        const header = matrix[headerIdx].map((h) => String(h ?? "").trim().toLowerCase());
        const idx = (...names: string[]) => header.findIndex((h) => names.some((n) => h.includes(n)));

        const iScore = idx("score");
        const iName = idx("nome", "name");
        const iFollow = idx("follower");
        const iTracks = idx("track") - (idx("track popular") === idx("track") ? 0 : 0);
        const iTracksReal = header.findIndex((h) => h === "tracks" || h === "faixas");
        const iPop = idx("popular");
        const iAct = idx("activity", "atividade");
        const iMod = idx("modific", "modified", "última");
        const iOwner = idx("owner");
        const iLinks = idx("link");
        const iSocial = idx("social");
        const iEmail = idx("e-mail", "email");
        const iDesc = idx("descri", "description");
        const iUrl = idx("url");

        const rows: Imported[] = [];
        for (let r = headerIdx + 1; r < matrix.length; r++) {
          const row = matrix[r];
          if (!row || row.every((c) => c == null || c === "")) continue;
          const get = (i: number) => (i >= 0 ? (row[i] ?? null) : null);
          const url = String(get(iUrl) ?? "").trim() || null;
          const name = String(get(iName) ?? "").trim();
          if (!name) continue;
          const followers = parseCount(get(iFollow));
          const tracks = parseCount(get(iTracksReal >= 0 ? iTracksReal : iTracks));
          const desc = get(iDesc) ? String(get(iDesc)) : null;
          // Varre TODAS as células da linha pra achar contato — independe de nome de coluna
          const email = extractEmail(...row);
          const instagram = normalizeInstagram(
            get(iSocial) ?? get(iLinks) ?? extractFromDesc(desc) ?? findInstagramInRow(row),
          );
          const linkInRow = String(get(iLinks) ?? "").trim() || findUrlInRow(row);
          const socialInRow = String(get(iSocial) ?? "").trim() || null;
          const scoreRawN = Number(get(iScore));

          rows.push({
            spotify_playlist_id: extractPlaylistId(url),
            spotify_url: url,
            name,
            owner_name: get(iOwner) ? String(get(iOwner)).trim() : null,
            followers,
            tracks,
            track_popularity: Number(get(iPop)) || 0,
            activity: get(iAct) ? String(get(iAct)).toLowerCase() : null,
            last_modified: get(iMod) ? String(get(iMod)) : null,
            email,
            instagram,
            social: socialInRow,
            links: linkInRow,
            description: desc,
            score: null,
            score_raw: Number.isFinite(scoreRawN) ? scoreRawN : null,
          });
        }
        resolve(rows);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsBinaryString(file);
  });
}

function findInstagramInRow(row: SheetCell[]): string | null {
  for (const cell of row) {
    if (typeof cell !== "string") continue;
    const m = cell.match(/(?:instagram\.com\/|@)([A-Za-z0-9_.]+)/i);
    if (m) return m[1];
  }
  return null;
}

function extractFromDesc(desc: string | null): string | null {
  if (!desc) return null;
  const m = desc.match(/(?:ig|insta|instagram)[:\s@]+([A-Za-z0-9_.]+)/i);
  return m ? m[1] : null;
}

function hasContact(r: Imported | CuradorRow): boolean {
  return Boolean(r.email || r.instagram || r.links || r.social);
}

type CuratorIdentity = Pick<Imported, "spotify_playlist_id" | "spotify_url" | "name" | "owner_name">;

type IdentityRegistry = {
  ids: Set<string>;
  urls: Set<string>;
  nameOwners: Set<string>;
};

function normalizeIdentity(value: string | null | undefined): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[⧉↗→]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function normalizeUrl(value: string | null | undefined): string {
  return normalizeIdentity(value).replace(/[?#].*$/, "").replace(/\/$/, "");
}

function registerIdentity(registry: IdentityRegistry, row: CuratorIdentity) {
  const id = normalizeIdentity(row.spotify_playlist_id);
  const url = normalizeUrl(row.spotify_url);
  const name = normalizeIdentity(row.name);
  const owner = normalizeIdentity(row.owner_name);

  if (id) registry.ids.add(id);
  if (url) registry.urls.add(url);
  if (name && owner) registry.nameOwners.add(`${name}|${owner}`);
}

function hasIdentityMatch(registry: IdentityRegistry, row: CuratorIdentity): boolean {
  const id = normalizeIdentity(row.spotify_playlist_id);
  const url = normalizeUrl(row.spotify_url);
  const name = normalizeIdentity(row.name);
  const owner = normalizeIdentity(row.owner_name);

  return Boolean(
    (id && registry.ids.has(id)) ||
    (url && registry.urls.has(url)) ||
    (name && owner && registry.nameOwners.has(`${name}|${owner}`)),
  );
}

function createIdentityRegistry(rows: CuratorIdentity[]): IdentityRegistry {
  const registry: IdentityRegistry = { ids: new Set(), urls: new Set(), nameOwners: new Set() };
  rows.forEach((row) => registerIdentity(registry, row));
  return registry;
}

/* ============================================================
   Componente
   ============================================================ */

const STATUS_META: Record<Status, { label: string; cls: string }> = {
  novo:        { label: "Novo",       cls: "bg-elevated text-muted-foreground border-border" },
  negociando:  { label: "Negociando", cls: "bg-warning/10 text-warning border-warning/30" },
  comprado:    { label: "Comprado",   cls: "bg-primary/15 text-primary border-primary/30" },
  blacklist:   { label: "Blacklist",  cls: "bg-destructive/10 text-destructive border-destructive/30" },
};

type SizeBucket = "todos" | "micro" | "pequeno" | "medio" | "grande" | "macro";

const SIZE_BUCKETS: { id: SizeBucket; label: string; min: number; max: number }[] = [
  { id: "todos",   label: "Todos tamanhos", min: 0,      max: Infinity },
  { id: "micro",   label: "0–500",          min: 0,      max: 500 },
  { id: "pequeno", label: "500–1k",         min: 500,    max: 1000 },
  { id: "medio",   label: "1k–5k",          min: 1000,   max: 5000 },
  { id: "grande",  label: "5k–20k",         min: 5000,   max: 20000 },
  { id: "macro",   label: "20k+",           min: 20000,  max: Infinity },
];

export function CuradoresCRM() {
  const [rows, setRows] = useState<CuradorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"todos" | Status>("todos");
  const [scoreFilter, setScoreFilter] = useState<"todos" | "A+" | "A" | "B" | "C" | "D">("todos");
  const [sizeFilter, setSizeFilter] = useState<SizeBucket>("todos");
  const [favOnly, setFavOnly] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("external_curators")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) toast.error("Erro ao carregar curadores");
    else setRows((data ?? []) as CuradorRow[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  /* -------- import -------- */
  const onFile = async (file: File | undefined | null) => {
    if (!file) return;
    setImporting(true);
    try {
      const parsed = await parseSheet(file);
      // Filtros de import: precisa ter contato (email/social/links) e não ser selo corporativo.
      // Sem mínimo de seguidores — filtro por tamanho fica na UI.
      const filtered = parsed.filter((r) => {
        if (isBlockedOwner(r.owner_name, r.name)) return false;
        if (!hasContact(r)) return false;
        return true;
      });

      if (filtered.length === 0) {
        toast.warning("Nenhuma playlist passou nos filtros (precisa ter email, social ou link e não ser selo corporativo)");
        return;
      }

      const existingRegistry = createIdentityRegistry(rows);
      const batchRegistry = createIdentityRegistry([]);
      const toInsert = filtered.filter((r) => {
        if (hasIdentityMatch(existingRegistry, r) || hasIdentityMatch(batchRegistry, r)) return false;
        registerIdentity(batchRegistry, r);
        return true;
      });

      if (toInsert.length === 0) {
        toast.info(`${parsed.length} linhas analisadas — todas já estavam no CRM`);
        return;
      }

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { toast.error("Sessão expirada"); return; }

      const payload = toInsert.map((r) => {
        const sc = scoreOf({ ...r });
        return {
          ...r,
          user_id: user.id,
          score: sc.label,
          status: "novo" as Status,
          favorite: false,
        };
      });

      // Insert em lotes de 200. A duplicidade já é validada por ID, URL e nome+owner antes do envio.
      let ok = 0;
      for (let i = 0; i < payload.length; i += 200) {
        const chunk = payload.slice(i, i + 200);
        const { error } = await supabase
          .from("external_curators")
          .insert(chunk as ExternalCuratorInsert[]);
        if (error) throw error;
        ok += chunk.length;
      }

      toast.success(
        `${ok} curadores importados — ${parsed.length - filtered.length} descartados nos filtros, ${filtered.length - toInsert.length} duplicados`,
      );
      await load();
    } catch (e) {
      console.error(e);
      toast.error("Falha ao processar planilha");
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  /* -------- mutations -------- */
  const updateRow = async (id: string, patch: Partial<CuradorRow>) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    const { error } = await supabase.from("external_curators").update(patch).eq("id", id);
    if (error) { toast.error("Erro ao salvar"); load(); }
  };

  const removeRow = async (id: string) => {
    if (!confirm("Remover este curador do CRM?")) return;
    setRows((prev) => prev.filter((r) => r.id !== id));
    const { error } = await supabase.from("external_curators").delete().eq("id", id);
    if (error) { toast.error("Erro ao remover"); load(); }
    else toast.success("Removido");
  };

  /* -------- derived -------- */
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const bucket = SIZE_BUCKETS.find((b) => b.id === sizeFilter)!;
    return rows
      .filter((r) => {
        if (statusFilter !== "todos" && r.status !== statusFilter) return false;
        if (scoreFilter !== "todos" && r.score !== scoreFilter) return false;
        if (favOnly && !r.favorite) return false;
        const f = r.followers ?? 0;
        if (f < bucket.min || f >= bucket.max) return false;
        if (q && !(r.name.toLowerCase().includes(q) || (r.owner_name ?? "").toLowerCase().includes(q) || (r.email ?? "").toLowerCase().includes(q))) return false;
        return true;
      })
      .sort((a, b) => {
        if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
        return (b.followers ?? 0) - (a.followers ?? 0);
      });
  }, [rows, search, statusFilter, scoreFilter, sizeFilter, favOnly]);

  const stats = useMemo(() => {
    const total = rows.length;
    const aplus = rows.filter((r) => r.score === "A+" || r.score === "A").length;
    const negociando = rows.filter((r) => r.status === "negociando").length;
    const comprados = rows.filter((r) => r.status === "comprado").length;
    return { total, aplus, negociando, comprados };
  }, [rows]);

  const exportCSV = () => {
    if (!filtered.length) { toast.info("Nada pra exportar"); return; }
    downloadCSV("curadores-crm", filtered.map((r) => ({
      score: r.score, nome: r.name, owner: r.owner_name, seguidores: r.followers,
      email: r.email, instagram: r.instagram, links: r.links,
      spotify: r.spotify_url, status: r.status, favorito: r.favorite ? "sim" : "",
    })));
  };

  /* -------- render -------- */
  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="nx-card !p-3">
        <div className="flex items-center gap-2 flex-wrap">
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => onFile(e.target.files?.[0])}
          />
          <Button
            onClick={() => fileRef.current?.click()}
            disabled={importing}
            className="rounded-full h-9 gap-1.5"
          >
            {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            Importar XLSX/CSV
          </Button>
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar playlist, owner ou email…"
              className="pl-9 h-9 rounded-full bg-elevated"
            />
          </div>
          <Button variant="outline" size="sm" className="rounded-full h-9" onClick={exportCSV}>
            <Download className="h-3.5 w-3.5 mr-1.5" /> Exportar
          </Button>
        </div>

        {/* Chips */}
        <div className="flex items-center gap-1.5 flex-wrap mt-3">
          <Filter className="h-3.5 w-3.5 text-muted-foreground" />
          {(["todos","novo","negociando","comprado","blacklist"] as const).map((s) => (
            <Chip key={s} active={statusFilter === s} onClick={() => setStatusFilter(s)}>
              {s === "todos" ? "Todos" : STATUS_META[s].label}
            </Chip>
          ))}
          <span className="mx-1 text-muted-foreground/50">·</span>
          {(["todos","A+","A","B","C","D"] as const).map((s) => (
            <Chip key={s} active={scoreFilter === s} onClick={() => setScoreFilter(s)}>
              {s === "todos" ? "Todos scores" : s}
            </Chip>
          ))}
          <Chip active={favOnly} onClick={() => setFavOnly(!favOnly)}>
            <Star className="h-3 w-3 inline mr-1" /> Favoritos
          </Chip>
        </div>

        {/* Faixa de tamanho (seguidores) */}
        <div className="flex items-center gap-1.5 flex-wrap mt-2">
          <span className="text-[10.5px] uppercase tracking-[0.12em] text-muted-foreground mr-1">Tamanho</span>
          {SIZE_BUCKETS.map((b) => (
            <Chip key={b.id} active={sizeFilter === b.id} onClick={() => setSizeFilter(b.id)}>
              {b.label}
            </Chip>
          ))}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <MiniStat label="Curadores" value={stats.total} />
        <MiniStat label="Score A+/A" value={stats.aplus} tone="primary" />
        <MiniStat label="Negociando" value={stats.negociando} tone="warning" />
        <MiniStat label="Comprados" value={stats.comprados} tone="primary" />
      </div>

      {/* Lista */}
      {loading ? (
        <div className="flex flex-col gap-2">
          {[0,1,2,3].map((i) => <div key={i} className="h-24 rounded-2xl border border-border/40 bg-card animate-pulse" />)}
        </div>
      ) : filtered.length === 0 ? (
        <Card className="p-12 text-center">
          <Users className="mx-auto size-10 text-muted-foreground/40 mb-3" />
          <p className="text-sm text-foreground font-medium mb-1">
            {rows.length === 0 ? "Nenhum curador no CRM ainda" : "Nada com esse filtro"}
          </p>
          <p className="text-xs text-muted-foreground">
            {rows.length === 0
              ? "Importe um XLSX/CSV do PlaylistSupply pra começar. Trazemos toda playlist com email, social ou link — você filtra o tamanho aqui em cima."
              : "Tente outro filtro ou limpe a busca."}
          </p>
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map((r) => <CuradorRowCard key={r.id} r={r} onUpdate={updateRow} onRemove={removeRow} />)}
        </div>
      )}
    </div>
  );
}

/* ============================================================
   Subcomponentes
   ============================================================ */

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "h-7 px-3 rounded-full text-[11px] font-medium border transition-colors",
        active
          ? "bg-primary/15 border-primary/40 text-primary"
          : "bg-elevated border-border text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: number; tone?: "primary" | "warning" }) {
  return (
    <div className="nx-card !p-3">
      <div className="text-[10.5px] uppercase tracking-[0.12em] text-muted-foreground">{label}</div>
      <div className={cn(
        "text-xl font-bold tabular-nums mt-0.5",
        tone === "primary" && "text-primary",
        tone === "warning" && "text-warning",
      )}>
        {value.toLocaleString("pt-BR")}
      </div>
    </div>
  );
}

function CuradorRowCard({
  r, onUpdate, onRemove,
}: {
  r: CuradorRow;
  onUpdate: (id: string, patch: Partial<CuradorRow>) => void;
  onRemove: (id: string) => void;
}) {
  const sc = scoreOf(r);
  const initials = (r.name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0]?.toUpperCase()).join("");

  const copyEmail = () => {
    if (!r.email) return;
    navigator.clipboard.writeText(r.email);
    toast.success("Email copiado");
  };
  const mailto = () => {
    if (!r.email) return;
    const subject = encodeURIComponent(`Parceria — ${r.name}`);
    const body = encodeURIComponent(
      `Olá! Vi sua playlist "${r.name}" no Spotify e gostaria de conversar sobre uma parceria de divulgação. Tem interesse?\n\n— enviado via NexEngine`,
    );
    window.location.href = `mailto:${r.email}?subject=${subject}&body=${body}`;
  };
  const igUrl = r.instagram ? `https://instagram.com/${r.instagram.replace(/^@/, "")}` : null;

  return (
    <div className={cn(
      "rounded-2xl border bg-card transition-colors",
      r.status === "blacklist" ? "border-destructive/20 opacity-60" : "border-border/50 hover:border-foreground/20",
    )}>
      {/* Linha 1 — identidade */}
      <div className="flex items-center gap-3 px-3 sm:px-4 pt-3 pb-2.5 min-w-0">
        <div className="h-10 w-10 rounded-md bg-primary/15 border border-primary/25 flex items-center justify-center text-[12px] font-bold text-primary shrink-0">
          {initials || <Users className="h-4 w-4" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0">
            <span className={cn("inline-flex items-center justify-center h-5 px-1.5 min-w-[28px] text-[10.5px] font-bold rounded-md border", sc.tone)}>
              {sc.label}
            </span>
            <h3 className="text-[14px] font-semibold text-foreground truncate leading-tight">{r.name}</h3>
            {r.favorite && <Star className="h-3.5 w-3.5 fill-warning text-warning shrink-0" />}
          </div>
          <div className="text-[11.5px] text-muted-foreground truncate mt-0.5">
            <span>{r.owner_name || "—"}</span>
            <span className="mx-1.5 opacity-50">·</span>
            <span className="tabular-nums text-foreground/80 font-medium">{formatN(r.followers)}</span> salv.
            {r.tracks > 0 && <><span className="mx-1.5 opacity-50">·</span><span className="tabular-nums">{r.tracks} faixas</span></>}
            {r.activity && <><span className="mx-1.5 opacity-50">·</span><span className="capitalize">{r.activity}</span></>}
          </div>
        </div>
        <span className={cn("inline-flex items-center h-6 px-2 rounded-full border text-[10.5px] font-medium shrink-0", STATUS_META[r.status].cls)}>
          {STATUS_META[r.status].label}
        </span>
      </div>

      <div className="mx-3 sm:mx-4 border-t border-border/40" />

      {/* Linha 2 — contatos + ações */}
      <div className="flex items-center gap-2 px-3 sm:px-4 py-2.5 flex-wrap">
        {/* Contatos */}
        <div className="flex items-center gap-1.5 flex-wrap min-w-0 flex-1">
          {r.email && (
            <button onClick={copyEmail} className="inline-flex items-center gap-1 h-7 px-2 rounded-full text-[11px] bg-elevated border border-border hover:border-foreground/30 text-foreground max-w-[200px] truncate" title={r.email}>
              <Mail className="h-3 w-3 shrink-0" /><span className="truncate">{r.email}</span>
            </button>
          )}
          {igUrl && (
            <a href={igUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 h-7 px-2 rounded-full text-[11px] bg-elevated border border-border hover:border-primary/40 text-foreground" onClick={(e) => e.stopPropagation()}>
              <Instagram className="h-3 w-3" /> @{r.instagram?.replace(/^@/, "")}
            </a>
          )}
          {r.links && (
            <a href={r.links.startsWith("http") ? r.links : `https://${r.links}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 h-7 px-2 rounded-full text-[11px] bg-elevated border border-border hover:border-primary/40 text-foreground">
              <Link2 className="h-3 w-3" /> Link
            </a>
          )}
          {!r.email && !igUrl && !r.links && (
            <span className="text-[11px] text-muted-foreground italic">Sem contato direto</span>
          )}
        </div>

        {/* Ações */}
        <div className="flex items-center gap-1 shrink-0">
          {r.email && (
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={mailto} title="Enviar email">
              <Mail className="h-3.5 w-3.5" />
            </Button>
          )}
          {r.email && (
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={copyEmail} title="Copiar email">
              <Copy className="h-3.5 w-3.5" />
            </Button>
          )}
          {r.spotify_url && (
            <Button asChild size="icon" variant="ghost" className="h-7 w-7" title="Abrir no Spotify">
              <a href={r.spotify_url} target="_blank" rel="noreferrer"><ExternalLink className="h-3.5 w-3.5" /></a>
            </Button>
          )}
          <Button
            size="icon" variant="ghost" className="h-7 w-7"
            onClick={() => onUpdate(r.id, { favorite: !r.favorite })}
            title={r.favorite ? "Desfavoritar" : "Favoritar"}
          >
            <Star className={cn("h-3.5 w-3.5", r.favorite && "fill-warning text-warning")} />
          </Button>
          <Button
            size="icon" variant="ghost" className="h-7 w-7"
            onClick={() => onUpdate(r.id, { status: r.status === "negociando" ? "novo" : "negociando" })}
            title="Marcar negociando"
          >
            <CheckCircle2 className={cn("h-3.5 w-3.5", r.status === "negociando" && "text-warning")} />
          </Button>
          <Button
            size="icon" variant="ghost" className="h-7 w-7"
            onClick={() => onUpdate(r.id, { status: r.status === "comprado" ? "novo" : "comprado" })}
            title="Marcar comprada"
          >
            <CheckCircle2 className={cn("h-3.5 w-3.5", r.status === "comprado" && "text-primary fill-primary/20")} />
          </Button>
          <Button
            size="icon" variant="ghost" className="h-7 w-7"
            onClick={() => onUpdate(r.id, { status: r.status === "blacklist" ? "novo" : "blacklist" })}
            title="Blacklist"
          >
            <Ban className={cn("h-3.5 w-3.5", r.status === "blacklist" && "text-destructive")} />
          </Button>
          <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => onRemove(r.id)} title="Excluir">
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
