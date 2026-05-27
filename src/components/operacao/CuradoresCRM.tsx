import { useEffect, useMemo, useRef, useState } from "react";
import {
  Upload, Search, Mail, Instagram, Link2, ExternalLink, Star, Ban, Copy,
  CheckCircle2, Trash2, Users, Filter, Download, Loader2, MoreHorizontal,
  SlidersHorizontal, Send, ChevronRight,
} from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

import { supabase } from "@/integrations/supabase/client";
import type { TablesInsert } from "@/integrations/supabase/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { downloadCSV } from "@/lib/csv";
import { EmailPreviewDialog, openInstagramWithMessage } from "./EmailPreviewDialog";
import {
  PipelineStatusBadge, PIPELINE_STATUS_META, type PipelineStatus,
} from "./PipelineStatusBadge";
import { CommercialScoreDots, type CommercialScore } from "./CommercialScoreEditor";
import { CuradorDetailSheet, type DetailCurator } from "./CuradorDetailSheet";

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
  // CRM operacional
  pipeline_status: PipelineStatus;
  commercial_score: CommercialScore | null;
  operational_tags: string[];
  whatsapp: string | null;
  last_outreach_at: string | null;
  last_response_at: string | null;
  followup_count: number;
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
  if (typeof value === "number") {
    // Planilhas em pt-BR vêm com ponto como separador de milhar.
    // Excel lê "2.312" como o número 2.312. Reconstruímos: se for fracionário
    // com 1-3 casas decimais, tratamos a parte decimal como milhares.
    if (Number.isInteger(value)) return value;
    const str = String(value);
    const [intPart, decPart = ""] = str.split(".");
    if (decPart.length >= 1 && decPart.length <= 3) {
      const padded = decPart.padEnd(3, "0");
      return Math.round(Number(intPart) * 1000 + Number(padded));
    }
    return Math.round(value);
  }
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

type Imported = Omit<CuradorRow,
  "id" | "user_id" | "status" | "favorite" | "notes" |
  "pipeline_status" | "commercial_score" | "operational_tags" | "whatsapp" |
  "last_outreach_at" | "last_response_at" | "followup_count"
>;

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
          // Estritamente as 3 colunas: Links, Social, E-mail.
          // Email pode aparecer em qualquer uma das 3.
          const emailCellRaw = String(get(iEmail) ?? "").trim() || null;
          const socialCellRaw = String(get(iSocial) ?? "").trim() || null;
          const linksCellRaw = String(get(iLinks) ?? "").trim() || null;
          const email = extractEmail(emailCellRaw, socialCellRaw, linksCellRaw);
          // Instagram é só pra exibição — extraído do que estiver em Social/Links
          const instagram = normalizeInstagram(socialCellRaw ?? linksCellRaw);
          const linkInRow = linksCellRaw;
          const socialInRow = socialCellRaw;
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
  // Estritamente: precisa ter algo em Links, Social ou E-mail (não usa owner/descrição).
  return Boolean(r.email || r.social || r.links);
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

type Segment = "ativos" | "prospeccao";

export function CuradoresCRM({ segment }: { segment?: Segment } = {}) {
  const [rows, setRows] = useState<CuradorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"todos" | Status>("todos");
  const [scoreFilter, setScoreFilter] = useState<"todos" | "A+" | "A" | "B" | "C" | "D">("todos");
  const [sizeFilter, setSizeFilter] = useState<SizeBucket>("todos");
  const [contactFilter, setContactFilter] = useState<"todos" | "nao_contatado" | "enviado" | "aguardando" | "respondeu">("todos");
  const [favOnly, setFavOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize] = useState<number>(25);
  type ExpandedFilter = "status" | "score" | "tamanho" | "contato" | null;
  const [expandedFilter, setExpandedFilter] = useState<ExpandedFilter>(null);
  const [emailTarget, setEmailTarget] = useState<{ externalCuratorId: string; recipientEmail: string; curatorName: string; playlistName: string | null; followupNumber?: 1 | 2 } | null>(null);
  const [detailCurator, setDetailCurator] = useState<DetailCurator | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const toDetail = (r: CuradorRow): DetailCurator => ({
    id: r.id,
    name: r.name,
    owner_name: r.owner_name,
    email: r.email,
    instagram: r.instagram,
    whatsapp: r.whatsapp,
    spotify_url: r.spotify_url,
    pipeline_status: r.pipeline_status,
    commercial_score: r.commercial_score,
    operational_tags: r.operational_tags ?? [],
    followup_count: r.followup_count ?? 0,
  });

  const sendFollowup = (r: CuradorRow) => {
    if (!r.email) { toast.error("Sem email para follow-up"); return; }
    const n = (Math.min(2, (r.followup_count ?? 0) + 1)) as 1 | 2;
    setEmailTarget({
      externalCuratorId: r.id,
      recipientEmail: r.email,
      curatorName: r.owner_name ?? r.name,
      playlistName: r.name,
      followupNumber: n,
    });
  };

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
        if (isBlockedOwner(r.owner_name)) return false;
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

  const clearAll = async () => {
    if (rows.length === 0) { toast.info("CRM já está vazio"); return; }
    if (!confirm(`Apagar TODOS os ${rows.length} curadores do CRM? Essa ação não pode ser desfeita.`)) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { toast.error("Sessão expirada"); return; }
    const { error } = await supabase.from("external_curators").delete().eq("user_id", user.id);
    if (error) { toast.error("Erro ao limpar"); return; }
    setRows([]);
    toast.success("CRM zerado — pode importar de novo");
  };

  /* -------- derived -------- */
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const bucket = SIZE_BUCKETS.find((b) => b.id === sizeFilter)!;
    return rows
      .filter((r) => {
        if (segment === "ativos" && r.status !== "comprado") return false;
        if (segment === "prospeccao" && r.status === "comprado") return false;
        if (statusFilter !== "todos" && r.status !== statusFilter) return false;
        if (scoreFilter !== "todos" && r.score !== scoreFilter) return false;
        if (favOnly && !r.favorite) return false;
        const f = r.followers ?? 0;
        if (f < bucket.min || f >= bucket.max) return false;
        // Filtro de Contato (estágio operacional do outreach)
        if (contactFilter !== "todos") {
          const sent = !!r.last_outreach_at;
          const ps = r.pipeline_status;
          if (contactFilter === "nao_contatado" && (sent || ps !== "novo")) return false;
          if (contactFilter === "enviado" && !sent) return false;
          if (contactFilter === "aguardando" && !(sent && (ps === "contatado" || ps === "sem_resposta"))) return false;
          if (contactFilter === "respondeu" && !(ps === "respondeu" || ps === "negociando" || ps === "fechado")) return false;
        }
        if (q && !(r.name.toLowerCase().includes(q) || (r.owner_name ?? "").toLowerCase().includes(q) || (r.email ?? "").toLowerCase().includes(q))) return false;
        return true;
      })
      .sort((a, b) => {
        if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
        return (b.followers ?? 0) - (a.followers ?? 0);
      });
  }, [rows, search, statusFilter, scoreFilter, sizeFilter, favOnly, contactFilter, segment]);

  // Reseta página quando filtros mudam
  useEffect(() => { setPage(1); }, [search, statusFilter, scoreFilter, sizeFilter, favOnly, contactFilter, pageSize, segment]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageStart = (safePage - 1) * pageSize;
  const pageEnd = Math.min(pageStart + pageSize, filtered.length);
  const pageRows = filtered.slice(pageStart, pageEnd);

  const stats = useMemo(() => {
    const total = rows.length;
    const naoContatado = rows.filter((r) => !r.last_outreach_at && r.pipeline_status === "novo").length;
    const enviado = rows.filter((r) => !!r.last_outreach_at).length;
    const respondeu = rows.filter((r) => ["respondeu","negociando","fechado"].includes(r.pipeline_status)).length;
    return { total, naoContatado, enviado, respondeu };
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
  const statusActive = statusFilter !== "todos";
  const scoreActive = scoreFilter !== "todos" || favOnly;
  const sizeActive = sizeFilter !== "todos";
  const contactActive = contactFilter !== "todos";
  const activeFilterCount = (statusActive ? 1 : 0) + (scoreActive ? 1 : 0) + (sizeActive ? 1 : 0) + (contactActive ? 1 : 0);

  return (
    <div className="space-y-4">
      {/* KPIs — sempre primeiro */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <MiniStat label="Total" value={stats.total} />
        <MiniStat label="Não contatados" value={stats.naoContatado} tone="warning" />
        <MiniStat label="Enviados" value={stats.enviado} tone="primary" />
        <MiniStat label="Responderam" value={stats.respondeu} tone="primary" />
      </div>

      {/* Toolbar compacta — busca + Importar + ⋯ */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar"
            className="pl-9 h-10 rounded-lg bg-elevated border-border"
          />
        </div>
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
          variant="outline"
          size="sm"
          className="h-10 gap-1.5 shrink-0"
        >
          {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          Importar
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon" className="h-10 w-10 shrink-0" aria-label="Mais ações">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48 rounded-xl p-1.5">
            <DropdownMenuItem className="gap-2 rounded-lg" onClick={exportCSV}>
              <Download className="h-4 w-4" /> Exportar CSV
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="gap-2 rounded-lg text-destructive focus:text-destructive"
              onClick={clearAll}
            >
              <Trash2 className="h-4 w-4" /> Limpar CRM
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Filtros — categorias colapsáveis */}
      <div className="rounded-xl border border-border/40 bg-card/40">
        <div className="flex items-center gap-1 p-1.5 flex-wrap">
          <SlidersHorizontal className="h-3.5 w-3.5 text-muted-foreground mx-2 shrink-0" />
          {([
            { id: "contato" as const, label: "Contato", active: contactActive, show: true },
            { id: "status" as const, label: "Status", active: statusActive, show: segment !== "ativos" },
            { id: "score" as const, label: "Score", active: scoreActive, show: true },
            { id: "tamanho" as const, label: "Tamanho", active: sizeActive, show: true },
          ]).filter((f) => f.show).map((f) => {
            const open = expandedFilter === f.id;
            return (
              <button
                key={f.id}
                onClick={() => setExpandedFilter(open ? null : f.id)}
                className={cn(
                  "h-8 px-3 rounded-lg text-[12px] font-medium transition-colors inline-flex items-center gap-1.5",
                  open
                    ? "bg-elevated text-foreground"
                    : f.active
                    ? "bg-primary/10 text-primary hover:bg-primary/15"
                    : "text-muted-foreground hover:text-foreground hover:bg-elevated/60",
                )}
              >
                {f.label}
                {f.active && !open && <span className="w-1.5 h-1.5 rounded-full bg-primary" />}
              </button>
            );
          })}
          {activeFilterCount > 0 && (
            <button
              onClick={() => {
                setStatusFilter("todos");
                setScoreFilter("todos");
                setSizeFilter("todos");
                setContactFilter("todos");
                setFavOnly(false);
              }}
              className="ml-auto h-8 px-3 text-[11px] font-medium text-muted-foreground hover:text-destructive transition-colors"
            >
              Limpar filtros
            </button>
          )}
        </div>

        {expandedFilter && (
          <div className="px-3 pb-3 pt-1 border-t border-border/40 animate-tab-in">
            {expandedFilter === "contato" && (
              <div className="flex items-center gap-1.5 flex-wrap pt-2">
                {([
                  { id: "todos", label: "Todos" },
                  { id: "nao_contatado", label: "Não contatados" },
                  { id: "enviado", label: "Enviados" },
                  { id: "aguardando", label: "Aguardando resposta" },
                  { id: "respondeu", label: "Responderam" },
                ] as const).map((s) => (
                  <Chip key={s.id} active={contactFilter === s.id} onClick={() => setContactFilter(s.id)}>
                    {s.label}
                  </Chip>
                ))}
              </div>
            )}
            {expandedFilter === "status" && segment !== "ativos" && (
              <div className="flex items-center gap-1.5 flex-wrap pt-2">
                {(segment === "prospeccao"
                  ? (["todos","novo","negociando","blacklist"] as const)
                  : (["todos","novo","negociando","comprado","blacklist"] as const)
                ).map((s) => (
                  <Chip key={s} active={statusFilter === s} onClick={() => setStatusFilter(s)}>
                    {s === "todos" ? "Todos" : STATUS_META[s].label}
                  </Chip>
                ))}
              </div>
            )}
            {expandedFilter === "score" && (
              <div className="flex items-center gap-1.5 flex-wrap pt-2">
                {(["todos","A+","A","B","C","D"] as const).map((s) => (
                  <Chip key={s} active={scoreFilter === s} onClick={() => setScoreFilter(s)}>
                    {s === "todos" ? "Todos" : s}
                  </Chip>
                ))}
                <span className="mx-1 text-muted-foreground/40">·</span>
                <Chip active={favOnly} onClick={() => setFavOnly(!favOnly)}>
                  <Star className={cn("h-3 w-3 inline mr-1", favOnly && "fill-current")} /> Favoritos
                </Chip>
              </div>
            )}
            {expandedFilter === "tamanho" && (
              <div className="flex items-center gap-1.5 flex-wrap pt-2">
                {SIZE_BUCKETS.map((b) => (
                  <Chip key={b.id} active={sizeFilter === b.id} onClick={() => setSizeFilter(b.id)}>
                    {b.label}
                  </Chip>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Lista */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {[0,1,2,3,4,5,6,7].map((i) => <div key={i} className="h-56 rounded-2xl border border-border/40 bg-card animate-pulse" />)}
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
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {pageRows.map((r) => (
              <CuradorRowCard
                key={r.id}
                r={r}
                onUpdate={updateRow}
                onRemove={removeRow}
                onOpenEmail={(row) => setEmailTarget({
                  externalCuratorId: row.id,
                  recipientEmail: row.email!,
                  curatorName: row.owner_name || row.name,
                  playlistName: row.name,
                })}
                onSendFollowup={sendFollowup}
                onOpenDetail={(row) => setDetailCurator(toDetail(row))}
              />
            ))}
          </div>
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-1 pt-2">
              <Button variant="outline" size="sm" className="rounded-full h-8" disabled={safePage === 1} onClick={() => setPage(1)}>«</Button>
              <Button variant="outline" size="sm" className="rounded-full h-8" disabled={safePage === 1} onClick={() => setPage(safePage - 1)}>‹</Button>
              <span className="text-xs text-muted-foreground px-3">
                Página <span className="text-foreground font-medium">{safePage}</span> de <span className="text-foreground font-medium">{totalPages}</span>
              </span>
              <Button variant="outline" size="sm" className="rounded-full h-8" disabled={safePage === totalPages} onClick={() => setPage(safePage + 1)}>›</Button>
              <Button variant="outline" size="sm" className="rounded-full h-8" disabled={safePage === totalPages} onClick={() => setPage(totalPages)}>»</Button>
            </div>
          )}
        </>
      )}

      <EmailPreviewDialog
        open={!!emailTarget}
        onOpenChange={(v) => { if (!v) setEmailTarget(null); }}
        target={emailTarget}
        onSent={() => load()}
      />

      <CuradorDetailSheet
        open={!!detailCurator}
        onOpenChange={(v) => { if (!v) setDetailCurator(null); }}
        curator={detailCurator}
        onChanged={() => { load(); }}
        onSendEmail={(c) => {
          if (!c.email) return;
          setEmailTarget({
            externalCuratorId: c.id,
            recipientEmail: c.email,
            curatorName: c.owner_name ?? c.name,
            playlistName: c.name,
          });
        }}
        onSendFollowup={(c) => {
          if (!c.email) return;
          const n = (Math.min(2, (c.followup_count ?? 0) + 1)) as 1 | 2;
          setEmailTarget({
            externalCuratorId: c.id,
            recipientEmail: c.email,
            curatorName: c.owner_name ?? c.name,
            playlistName: c.name,
            followupNumber: n,
          });
        }}
      />
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
function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-[10.5px] uppercase tracking-[0.12em] text-muted-foreground font-medium w-[64px] shrink-0">
        {label}
      </span>
      <div className="flex items-center gap-1.5 flex-wrap">
        {children}
      </div>
    </div>
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
  r, onUpdate, onRemove, onOpenEmail, onSendFollowup, onOpenDetail,
}: {
  r: CuradorRow;
  onUpdate: (id: string, patch: Partial<CuradorRow>) => void;
  onRemove: (id: string) => void;
  onOpenEmail: (row: CuradorRow) => void;
  onSendFollowup: (row: CuradorRow) => void;
  onOpenDetail: (row: CuradorRow) => void;
}) {
  const sc = scoreOf(r);
  const pipeline = (r.pipeline_status ?? "novo") as PipelineStatus;
  const pipelineMeta = PIPELINE_STATUS_META[pipeline] ?? PIPELINE_STATUS_META.novo;

  const copyEmail = () => {
    if (!r.email) return;
    navigator.clipboard.writeText(r.email);
    toast.success("Email copiado");
  };
  const openEmail = () => {
    if (!r.email) return;
    onOpenEmail(r);
  };
  const openIg = () => {
    if (!r.instagram) return;
    openInstagramWithMessage(r.instagram, r.owner_name || r.name, r.name);
  };
  const igHandle = r.instagram ? r.instagram.replace(/^@/, "") : null;

  // Activity color
  const actLower = (r.activity ?? "").toLowerCase();
  const actColor =
    actLower === "high"   ? "text-primary" :
    actLower === "medium" ? "text-warning" :
    actLower === "low"    ? "text-muted-foreground" : "text-foreground/70";
  const actLabel = actLower ? actLower.charAt(0).toUpperCase() + actLower.slice(1) : "—";

  // Follow-up CTA: precisa de email, sem resposta, último contato > 5 dias, < 2 follow-ups
  const lastSent = r.last_outreach_at ? new Date(r.last_outreach_at).getTime() : 0;
  const daysSince = lastSent ? Math.floor((Date.now() - lastSent) / (1000 * 60 * 60 * 24)) : 0;
  const showFollowup =
    !!r.email &&
    lastSent > 0 &&
    daysSince >= 5 &&
    (r.followup_count ?? 0) < 2 &&
    !["respondeu","negociando","fechado","blacklist"].includes(pipeline);

  return (
    <div className={cn(
      "bg-card rounded-2xl border border-border/40 border-l-4 overflow-hidden flex flex-col transition-colors group cursor-pointer",
      pipelineMeta.border,
      pipeline === "blacklist" ? "opacity-60 hover:border-destructive/40" : "hover:border-primary/40",
    )}
    onClick={() => onOpenDetail(r)}
    >
      {/* Header: pipeline status + nome + owner + score badge */}
      <div className="p-3.5 flex justify-between items-start gap-3 border-b border-border/40">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
            <PipelineStatusBadge
              status={pipeline}
              size="xs"
              onChange={(next) => onUpdate(r.id, { pipeline_status: next } as Partial<CuradorRow>)}
            />
            {r.favorite && <Star className="h-3 w-3 fill-warning text-warning shrink-0" />}
            <CommercialScoreDots score={r.commercial_score} className="ml-auto" />
          </div>
          <h3 className="text-foreground font-semibold text-[13.5px] leading-tight line-clamp-2" title={r.name}>
            {r.name}
          </h3>
          <p className="text-muted-foreground text-[11.5px] truncate mt-0.5">{r.owner_name || "—"}</p>
          {(r.operational_tags?.length ?? 0) > 0 && (
            <div className="flex items-center gap-1 flex-wrap mt-2">
              {r.operational_tags!.slice(0, 4).map((t) => (
                <span key={t} className="px-1.5 py-0.5 rounded-md bg-elevated border border-border text-[9.5px] text-muted-foreground">
                  {t.replace(/_/g, " ")}
                </span>
              ))}
              {r.operational_tags!.length > 4 && (
                <span className="text-[9.5px] text-muted-foreground">+{r.operational_tags!.length - 4}</span>
              )}
            </div>
          )}
        </div>
        <span
          className={cn(
            "shrink-0 inline-flex items-center justify-center min-w-[28px] h-6 px-1.5 rounded-md border text-[11px] font-bold tabular-nums",
            sc.tone,
          )}
          title={`Score ${sc.label}`}
        >
          {sc.label}
        </span>
      </div>

      {/* Follow-up CTA */}
      {showFollowup && (
        <button
          onClick={(e) => { e.stopPropagation(); onSendFollowup(r); }}
          className="px-3.5 py-2 text-[11px] font-medium text-warning bg-warning/10 border-b border-warning/20 hover:bg-warning/15 transition-colors inline-flex items-center justify-between w-full"
        >
          <span className="inline-flex items-center gap-1.5">
            <Send className="h-3 w-3" />
            Sem resposta há {daysSince}d · enviar follow-up #{(r.followup_count ?? 0) + 1}
          </span>
          <ChevronRight className="h-3 w-3" />
        </button>
      )}

      {/* Stats */}
      <div className="p-4 grid grid-cols-3 gap-2 border-b border-border/40">
        <div className="flex flex-col min-w-0">
          <span className="text-[10px] text-muted-foreground uppercase font-bold truncate">Salvam.</span>
          <span className="text-foreground text-xs font-semibold tabular-nums truncate">{formatN(r.followers)}</span>
        </div>
        <div className="flex flex-col min-w-0">
          <span className="text-[10px] text-muted-foreground uppercase font-bold truncate">Faixas</span>
          <span className="text-foreground text-xs font-semibold tabular-nums truncate">{r.tracks || "—"}</span>
        </div>
        <div className="flex flex-col min-w-0">
          <span className="text-[10px] text-muted-foreground uppercase font-bold truncate">Atividade</span>
          <span className={cn("text-xs font-semibold truncate", actColor)}>{actLabel}</span>
        </div>
      </div>

      {/* Contact badges */}
      <div className="px-4 py-3 flex flex-wrap gap-1.5 min-h-[44px]" onClick={(e) => e.stopPropagation()}>
        {r.email && (
          <button
            onClick={openEmail}
            className="px-2 py-0.5 bg-elevated border border-border rounded text-[10px] text-foreground/80 font-medium flex items-center gap-1 hover:border-primary/40 transition-colors max-w-full"
            title={`Enviar apresentação para ${r.email}`}
          >
            <Mail className="w-3 h-3 text-primary shrink-0" />
            <span className="truncate">{r.email}</span>
          </button>
        )}
        {igHandle && (
          <button
            onClick={openIg}
            className="px-2 py-0.5 bg-elevated border border-border rounded text-[10px] text-foreground/80 font-medium flex items-center gap-1 hover:border-primary/40 transition-colors"
            title={`Abrir DM de @${igHandle} e copiar mensagem`}
          >
            <Instagram className="w-3 h-3 text-pink-500" />
            <span className="truncate max-w-[120px]">@{igHandle}</span>
          </button>
        )}
        {r.links && (
          <a
            href={r.links.startsWith("http") ? r.links : `https://${r.links}`}
            target="_blank" rel="noreferrer"
            className="px-2 py-0.5 bg-elevated border border-border rounded text-[10px] text-foreground/80 font-medium flex items-center gap-1 hover:border-primary/40 transition-colors"
          >
            <Link2 className="w-3 h-3 text-blue-400" />
            Link
          </a>
        )}
        {!r.email && !igHandle && !r.links && (
          <span className="text-[10px] text-muted-foreground italic self-center">Sem contato direto</span>
        )}
      </div>

      {/* Action bar */}
      <div className="mt-auto p-2 bg-black/30 flex items-center justify-between gap-1" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-0.5">
          {r.spotify_url && (
            <a
              href={r.spotify_url} target="_blank" rel="noreferrer"
              className="p-1.5 hover:bg-primary/20 text-muted-foreground hover:text-primary rounded transition-colors"
              title="Abrir no Spotify"
            >
              <ExternalLink className="w-4 h-4" />
            </a>
          )}
          {r.email && (
            <button onClick={openEmail} className="p-1.5 hover:bg-primary/20 text-muted-foreground hover:text-primary rounded transition-colors" title="Enviar email">
              <Mail className="w-4 h-4" />
            </button>
          )}
          {r.email && (
            <button onClick={copyEmail} className="p-1.5 hover:bg-elevated text-muted-foreground hover:text-foreground rounded transition-colors" title="Copiar email">
              <Copy className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={() => onUpdate(r.id, { favorite: !r.favorite })}
            className={cn("p-1.5 hover:bg-warning/20 hover:text-warning rounded transition-colors", r.favorite ? "text-warning" : "text-muted-foreground")}
            title={r.favorite ? "Desfavoritar" : "Favoritar"}
          >
            <Star className={cn("w-4 h-4", r.favorite && "fill-warning")} />
          </button>
          <button
            onClick={() => onUpdate(r.id, { status: r.status === "comprado" ? "novo" : "comprado" })}
            className={cn("p-1.5 rounded transition-colors hover:bg-primary/20 hover:text-primary", r.status === "comprado" ? "text-primary bg-primary/15" : "text-muted-foreground")}
            title="Marcar comprada"
          >
            <CheckCircle2 className={cn("w-4 h-4", r.status === "comprado" && "fill-primary/20")} />
          </button>
        </div>
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => onUpdate(r.id, { pipeline_status: pipeline === "blacklist" ? "novo" : "blacklist" } as Partial<CuradorRow>)}
            className={cn("p-1.5 hover:bg-destructive/20 hover:text-destructive rounded transition-colors", pipeline === "blacklist" ? "text-destructive bg-destructive/15" : "text-muted-foreground")}
            title="Blacklist"
          >
            <Ban className="w-4 h-4" />
          </button>
          <button onClick={() => onRemove(r.id)} className="p-1.5 hover:bg-destructive hover:text-white text-muted-foreground rounded transition-colors" title="Excluir">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
