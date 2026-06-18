import { useMemo, useState, useEffect } from "react";
import { toast } from "sonner";
import {
  ExternalLink,
  ImageOff,
  Music2,
  ClipboardPaste,
  Library,
  ChevronRight,
  X,
  ListMusic,
  BarChart3,
  Clock,
  AlertTriangle,
  TrendingUp,
  Sparkles,
  Activity,
  Radio,
  Shuffle,
  Disc3,
  Compass,
  Headphones,
  Copy,
  ExternalLink as ExternalLinkIcon,
} from "lucide-react";

import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { PastePlaylistsDialog } from "./PastePlaylistsDialog";
import { ImportFromLibraryDialog } from "./ImportFromLibraryDialog";
import { FraudAlertsPanel } from "./FraudAlertsPanel";
import { PrintThumbs } from "./PrintThumbs";
import { useCuratorDealBreakdown, ecosystemTotal } from "@/hooks/useCuratorDealBreakdown";
import { useDealTodayPlaylistBreakdown } from "@/hooks/useDealTodayPlaylistBreakdown";

import {
  computeCuratorStats,
  dedupeCuratorPlaylists,
  type CuratorDeal,
  type CuratorDealLog,
  type CuratorDealSong,
  type CuratorPlaylist,
  type CuratorMatchStatus,
  type CuratorDealProgress,
} from "@/lib/curatorDealsUtils";
import { Kpi as UnifiedKpi } from "@/components/ui/kpi";

export interface DealHistorySheetProps {
  open: boolean;
  deal: CuratorDeal | null;
  songs?: CuratorDealSong[];
  allLogs: CuratorDealLog[];
  allPlaylists: CuratorPlaylist[];
  progress?: CuratorDealProgress | null;
  onClose: () => void;
  onReload?: () => void;
  /**
   * Quando true, renderiza o conteúdo como página dedicada (sem o Sheet drawer).
   * Usado pela rota /playlist-deals/:dealId — mesma UI/lógica, sem overlay.
   */
  asPage?: boolean;
}

/* ------------------------------------------------------------------
 * Status taxonomy — alinhada à nova lógica:
 *  - curator   = veio do link cadastrado pelo curador (whitelist)
 *  - editorial = playlist editorial do Spotify (Discover Weekly etc.)
 *  - organic   = detectada pelo robô (não-whitelist, não-editorial)
 *  - suspicious= flag de fraude
 *  - baseline  = onde a música já estava no início do deal
 * ------------------------------------------------------------------ */
const STATUS_LABEL: Record<CuratorMatchStatus, string> = {
  curator: "Curador",
  editorial: "Editorial",
  algorithmic: "Algorítmica",
  organic: "Detectada",
  suspicious: "Suspeita",
  baseline: "Inicial",
};

const STATUS_DOT: Record<CuratorMatchStatus, string> = {
  curator: "bg-success",
  editorial: "bg-primary",
  algorithmic: "bg-muted-foreground/60",
  organic: "bg-muted-foreground/60",
  suspicious: "bg-destructive",
  baseline: "bg-muted-foreground/40",
};

const STATUS_CHIP: Record<CuratorMatchStatus, string> = {
  curator: "bg-success/15 text-success",
  editorial: "bg-primary/15 text-primary",
  algorithmic: "bg-muted/60 text-muted-foreground",
  organic: "bg-muted/60 text-muted-foreground",
  suspicious: "bg-destructive/15 text-destructive",
  baseline: "bg-muted/40 text-muted-foreground",
};

const STATUS_ORDER: Record<CuratorMatchStatus, number> = {
  curator: 0,
  editorial: 1,
  algorithmic: 2,
  organic: 3,
  suspicious: 4,
  baseline: 5,
};

function fmt(n: number): string {
  return Math.round(n).toLocaleString("pt-BR");
}

function fmtCompact(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const a = Math.abs(n);
  if (a >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (a >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return Math.round(n).toString();
}

/* ------------------------------------------------------------------
 * KPI tile — wrapper fino sobre <UnifiedKpi> mantendo a API local (tone).
 * ------------------------------------------------------------------ */
function Kpi({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  tone?: "default" | "success" | "primary" | "warning";
}) {
  const mappedTone = tone === "warning" ? "warning" : tone;
  return <UnifiedKpi label={label} value={value} hint={hint} tone={mappedTone as any} />;
}


/* Card seção — wrapper para blocos de leitura no Resumo */
function SectionCard({
  title,
  right,
  children,
}: {
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl bg-card border border-border p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

/* ------------------------------------------------------------------
 * Ícone padrão para playlists algorítmicas (Radio, Mixes, Discover…)
 * — Spotify não expõe imagem pública dessas, então usamos lucide.
 * ------------------------------------------------------------------ */
function algoIconFor(name: string | null | undefined) {
  const n = (name ?? "").toLowerCase();
  if (n.startsWith("radio")) return Radio;
  if (n.startsWith("mix")) return Shuffle;
  if (n.includes("discover")) return Compass;
  if (n.includes("daily")) return Disc3;
  return Sparkles;
}

/* ------------------------------------------------------------------
 * Linha de breakdown — usada nas abas Curador e Algoritmo.
 * Mostra capa (ou ícone algorítmico), nome, Δ hoje e 24h/7d/28d.
 * ------------------------------------------------------------------ */
type BreakdownRowData = {
  playlist_id: string;
  playlist_name: string;
  spotify_url: string | null;
  spotify_owner_name: string | null;
  image_url: string | null;
  match_status: string;
  today_plays: number;
  plays_24h: number | null;
  plays_7d: number | null;
  plays_28d: number | null;
  total_delivered: number;
  baseline_total: number;
  last_total: number;
  last_captured_at: string | null;
  song_name?: string | null;
};

function BreakdownRow({ r, kind }: { r: BreakdownRowData; kind: "curator" | "algo" }) {
  const AlgoIcon = algoIconFor(r.playlist_name);
  return (
    <li className="min-w-0 px-4 sm:px-5 py-3 flex items-center gap-3 hover:bg-[hsl(var(--elevated))] transition-colors">
      {/* capa / ícone padrão */}
      <div className="h-10 w-10 shrink-0 rounded-md overflow-hidden bg-[hsl(var(--elevated))] border border-white/[0.04] flex items-center justify-center">
        {r.image_url ? (
          <img src={r.image_url} alt="" className="h-full w-full object-cover" />
        ) : kind === "algo" ? (
          <AlgoIcon className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ListMusic className="h-4 w-4 text-muted-foreground" />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={cn(
              "h-1.5 w-1.5 rounded-full shrink-0",
              kind === "curator" ? "bg-success" : "bg-muted-foreground/60",
            )}
          />
          <span className="text-[13px] text-foreground font-medium truncate">
            {r.playlist_name}
          </span>
          {r.spotify_url && (
            <a
              href={r.spotify_url}
              target="_blank"
              rel="noreferrer"
              className="text-muted-foreground hover:text-foreground shrink-0"
              onClick={(e) => e.stopPropagation()}
              aria-label="Abrir no Spotify"
            >
              <ExternalLinkIcon className="h-3 w-3" />
            </a>
          )}
        </div>
        <div className="text-[11px] text-muted-foreground tabular-nums mt-0.5 pl-3.5">
          <span className="text-muted-foreground/70">Δ hoje </span>
          <span className="text-foreground font-medium">+{fmtCompact(r.today_plays)}</span>
          {r.song_name && <> · <span className="text-foreground/80">♪ {r.song_name}</span></>}
          {r.spotify_owner_name && <> · {r.spotify_owner_name}</>}
        </div>
      </div>

      {/* Janelas oficiais do Spotify for Artists: 7d (pagamento) e 28d (contexto) */}
      <div className="flex items-center gap-1 shrink-0">
        {(["7d", "28d"] as const).map((w) => {
          const v = w === "7d" ? r.plays_7d : r.plays_28d;
          return (
            <div
              key={w}
              className="w-14 text-right rounded-md px-1.5 py-1"
              title={`Plays na janela ${w} segundo o Spotify for Artists`}
            >
              <div className="text-[13px] font-semibold text-foreground tabular-nums leading-tight">
                {v != null ? fmtCompact(v) : "—"}
              </div>
              <div className="text-[9.5px] uppercase tracking-wider text-muted-foreground">
                {w}
              </div>
            </div>
          );
        })}
      </div>
    </li>
  );
}

/* ------------------------------------------------------------------
 * Linha de playlist — densidade controlada, sem grupos artificiais.
 * ------------------------------------------------------------------ */
function PlaylistRow({
  p,
  snapshot7d,
}: {
  p: CuratorPlaylist;
  snapshot7d?: number | null;
}) {
  const status = (p.match_status ??
    (p.is_initial_roster ? "baseline" : "curator")) as CuratorMatchStatus;
  const owner = p.spotify_owner_name?.trim() || null;
  const followers = p.followers ? `${fmtCompact(Number(p.followers))} seguidores` : null;
  const plays7d =
    snapshot7d != null
      ? `${fmtCompact(snapshot7d)} plays/7d`
      : p.streams_7d
      ? `${fmtCompact(Number(p.streams_7d))} plays/7d (paste)`
      : null;
  const meta = [owner, followers, plays7d].filter(Boolean).join(" · ");
  const position = typeof p.position_in_paste === "number" ? p.position_in_paste : null;

  return (
    <li className="group flex items-center gap-3 px-3 sm:px-4 py-3 min-h-[60px] hover:bg-[hsl(var(--elevated))] transition-colors min-w-0">
      {/* posição (esconde no mobile) */}
      {position !== null && (
        <div className="hidden sm:block w-7 text-right text-[11px] font-semibold tabular-nums text-muted-foreground shrink-0">
          #{position}
        </div>
      )}

      {/* cover */}
      <div className="h-10 w-10 shrink-0 rounded-md overflow-hidden bg-[hsl(var(--elevated))] border border-border flex items-center justify-center">
        {p.image_url ? (
          <img src={p.image_url} alt="" className="h-full w-full object-cover" />
        ) : (
          <ListMusic className="h-4 w-4 text-muted-foreground" />
        )}
      </div>

      {/* nome + meta */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={cn("h-1.5 w-1.5 rounded-full shrink-0", STATUS_DOT[status])}
            title={STATUS_LABEL[status]}
          />
          <span className="text-[13px] font-medium text-foreground truncate">
            {p.playlist_name || "Playlist sem nome"}
          </span>
          {p.song_names && p.song_names.length > 0 && (
            <span className="hidden sm:flex items-center gap-1 shrink-0">
              {p.song_names.slice(0, 2).map((n) => (
                <span
                  key={n}
                  className="text-[9.5px] uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-muted/40 text-muted-foreground truncate max-w-[120px]"
                  title={n}
                >
                  ♪ {n}
                </span>
              ))}
              {p.song_names.length > 2 && (
                <span className="text-[9.5px] text-muted-foreground">+{p.song_names.length - 2}</span>
              )}
            </span>
          )}
        </div>
        {meta && (
          <div className="text-[11px] text-muted-foreground truncate mt-0.5 pl-3.5">
            {meta}
          </div>
        )}
      </div>

      {/* tag (só desktop) + link */}
      <span
        className={cn(
          "hidden sm:inline-flex text-[10px] font-semibold px-2 h-5 rounded-full items-center justify-center w-24 shrink-0",
          STATUS_CHIP[status],
        )}
      >
        {STATUS_LABEL[status]}
      </span>
      {p.spotify_url && (
        <a
          href={p.spotify_url}
          target="_blank"
          rel="noreferrer"
          className="text-muted-foreground/70 hover:text-foreground transition-colors shrink-0"
          onClick={(e) => e.stopPropagation()}
          aria-label="Abrir no Spotify"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      )}
    </li>
  );
}

export function DealHistorySheet({
  open,
  deal,
  songs = [],
  allLogs,
  allPlaylists,
  progress,
  onClose,
  onReload,
  asPage = false,
}: DealHistorySheetProps) {
  const [tab, setTab] = useState<"resumo" | "playlists" | "algoritmo" | "historico">("historico");

  const [perfWindow, setPerfWindow] = useState<"7d" | "28d">("7d");
  const [pasteOpen, setPasteOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [selectedLogId, setSelectedLogId] = useState<string | null>(null);
  const [plQuery, setPlQuery] = useState("");
  const [algoQuery, setAlgoQuery] = useState("");
  const [algoFilter, setAlgoFilter] = useState<"all" | "editorial" | "organic" | "suspicious">("all");
  const [algoSongFilter, setAlgoSongFilter] = useState<string>("all");
  const [curatorSongFilter, setCuratorSongFilter] = useState<string>("all");

  // Reset filtros ao trocar de deal — evita que filtro de música/busca de um deal anterior
  // (ex: deal multi-música) zere a lista ao abrir um deal diferente.
  useEffect(() => {
    setPlQuery("");
    setAlgoQuery("");
    setAlgoFilter("all");
    setAlgoSongFilter("all");
    setCuratorSongFilter("all");
    setSelectedLogId(null);
    setTab("historico");
  }, [deal?.id]);

  const stats = deal ? computeCuratorStats(deal, allLogs, allPlaylists, progress ?? null) : null;
  const { data: breakdown } = useCuratorDealBreakdown(deal?.id ?? null);
  const { data: todayBreakdown, isLoading: loadingToday } = useDealTodayPlaylistBreakdown(deal?.id ?? null);
  const eco = ecosystemTotal(breakdown);

  const getSongForLog = (log: CuratorDealLog): CuratorDealSong | null => {
    if (log.song_id) return songs.find((s) => s.id === log.song_id) ?? null;
    return null;
  };

  // Dedup visual: durante testes, o bot disparou várias vezes no mesmo dia
  // gerando vários cards redundantes no histórico. Para a visão de Deal,
  // mostramos só UM card por música/dia — o mais completo por prints e,
  // em empate, o mais recente. Baselines nunca são ocultados.
  const reversedLogs = useMemo(() => {
    if (!stats) return [] as CuratorDealLog[];
    const desc = [...stats.dealLogs].reverse();
    type Group = { rep: CuratorDealLog; ts: number; orderTs: number };
    const groups = new Map<string, Group>();
    for (const log of desc) {
      const ts = new Date(log.created_at).getTime();
      if (log.is_initial_capture_event) {
        const k = `b:${log.id}`;
        groups.set(k, { rep: log, ts, orderTs: ts });
        continue;
      }
      const songKey = log.song_id ?? "_";
      const dayKey = format(new Date(log.created_at), "yyyy-MM-dd");
      const k = `${songKey}:${dayKey}`;
      const existing = groups.get(k);
      if (existing) {
        const prints = (log.print_urls?.length ?? 0);
        const repPrints = (existing.rep.print_urls?.length ?? 0);
        if (prints > repPrints || (prints === repPrints && ts > existing.ts)) {
          existing.rep = log;
          existing.ts = ts;
        }
      } else {
        groups.set(k, { rep: log, ts, orderTs: ts });
      }
    }
    return [...groups.values()]
      .sort((a, b) => b.orderTs - a.orderTs)
      .map((g) => g.rep);
  }, [stats]);


  const dealPlaylists = useMemo(() => {
    if (!deal) return [] as CuratorPlaylist[];
    const raw = allPlaylists.filter((p) => p.deal_id === deal.id);
    return dedupeCuratorPlaylists(raw, songs);
  }, [allPlaylists, deal, songs]);

  const sortedPlaylists = useMemo(() => {
    return [...dealPlaylists].sort((a, b) => {
      const sa = (a.match_status ?? (a.is_initial_roster ? "baseline" : "curator")) as CuratorMatchStatus;
      const sb = (b.match_status ?? (b.is_initial_roster ? "baseline" : "curator")) as CuratorMatchStatus;
      const od = STATUS_ORDER[sa] - STATUS_ORDER[sb];
      if (od !== 0) return od;
      return Number(b.streams_7d ?? 0) - Number(a.streams_7d ?? 0);
    });
  }, [dealPlaylists]);

  // contagens por categoria
  const counts = useMemo(() => {
    const c = { curator: 0, editorial: 0, algorithmic: 0, organic: 0, suspicious: 0, baseline: 0 } as Record<
      CuratorMatchStatus,
      number
    >;
    for (const p of dealPlaylists) {
      const s = (p.match_status ?? (p.is_initial_roster ? "baseline" : "curator")) as CuratorMatchStatus;
      c[s] = (c[s] ?? 0) + 1;
    }
    return c;
  }, [dealPlaylists]);

  // Aba "Curador" → só whitelist (curator + baseline)
  const curatorPlaylists = useMemo(() => {
    const q = plQuery.trim().toLowerCase();
    return sortedPlaylists.filter((p) => {
      const s = (p.match_status ?? (p.is_initial_roster ? "baseline" : "curator")) as CuratorMatchStatus;
      if (s !== "curator" && s !== "baseline") return false;
      if (curatorSongFilter !== "all") {
        const ids = p.song_ids?.length ? p.song_ids : (p.song_id ? [p.song_id] : []);
        if (!ids.includes(curatorSongFilter)) return false;
      }
      if (!q) return true;
      return (
        (p.playlist_name ?? "").toLowerCase().includes(q) ||
        (p.spotify_owner_name ?? "").toLowerCase().includes(q)
      );
    });
  }, [sortedPlaylists, plQuery, curatorSongFilter]);

  // Aba "Algoritmo" → editorial + organic + suspicious
  const algoPlaylists = useMemo(() => {
    const q = algoQuery.trim().toLowerCase();
    return sortedPlaylists.filter((p) => {
      const s = (p.match_status ?? (p.is_initial_roster ? "baseline" : "curator")) as CuratorMatchStatus;
      if (s !== "editorial" && s !== "algorithmic" && s !== "organic" && s !== "suspicious") return false;
      if (algoFilter !== "all" && s !== algoFilter) return false;
      if (algoSongFilter !== "all") {
        const ids = p.song_ids?.length ? p.song_ids : (p.song_id ? [p.song_id] : []);
        if (!ids.includes(algoSongFilter)) return false;
      }
      if (!q) return true;
      return (
        (p.playlist_name ?? "").toLowerCase().includes(q) ||
        (p.spotify_owner_name ?? "").toLowerCase().includes(q)
      );
    });
  }, [sortedPlaylists, algoQuery, algoFilter, algoSongFilter]);

  const curatorTotal = counts.curator + counts.baseline;
  const algoTotal = counts.editorial + counts.algorithmic + counts.organic + counts.suspicious;

  // Breakdown por origem (usado nas abas Curador/Algoritmo + Performance)
  const curatorBreakdownRows = useMemo(
    () => (todayBreakdown?.rows ?? []).filter((r) => r.match_status === "curator"),
    [todayBreakdown],
  );
  const algoBreakdownRows = useMemo(
    () => (todayBreakdown?.rows ?? []).filter((r) => r.match_status !== "curator"),
    [todayBreakdown],
  );
  const sumWindow = (rows: typeof curatorBreakdownRows, w: "7d" | "28d") =>
    rows.reduce((s, r) => s + (w === "7d" ? r.plays_7d ?? 0 : r.total_delivered || r.plays_28d || 0), 0);
  const curatorWindowTotal = sumWindow(curatorBreakdownRows, perfWindow);
  const algoWindowTotal = sumWindow(algoBreakdownRows, perfWindow);

  // Mapa playlist_id → breakdown (pra fundir cadastro + snapshot)
  const breakdownMap = useMemo(() => {
    const m = new Map<string, (typeof curatorBreakdownRows)[number]>();
    for (const r of todayBreakdown?.rows ?? []) m.set(r.playlist_id, r);
    return m;
  }, [todayBreakdown]);

  const toBreakdownRowData = (p: CuratorPlaylist): BreakdownRowData => {
    const snap = breakdownMap.get(p.id);
    const song = p.song_id ? songs.find((s) => s.id === p.song_id) ?? null : null;
    return {
      playlist_id: p.id,
      playlist_name: p.playlist_name || "Playlist sem nome",
      spotify_url: p.spotify_url ?? null,
      spotify_owner_name: p.spotify_owner_name ?? null,
      image_url: p.image_url ?? null,
      match_status: p.match_status ?? "curator",
      today_plays: snap?.today_plays ?? 0,
      plays_24h: snap?.plays_24h ?? null,
      plays_7d: snap?.plays_7d ?? null,
      plays_28d: snap?.plays_28d ?? null,
      total_delivered: snap?.total_delivered ?? 0,
      baseline_total: snap?.baseline_total ?? 0,
      last_total: snap?.last_total ?? 0,
      last_captured_at: snap?.last_captured_at ?? null,
      song_name: song?.song_name ?? null,
    };
  };

  // dados auxiliares
  const baseline = Number(deal?.baseline_plays ?? 0);
  const target = Number(deal?.target_plays ?? 0);
  const previsao =
    !stats || stats.eta === null
      ? "—"
      : stats.eta === 0
      ? "Concluído"
      : `${Math.round(stats.eta)} dias`;
  const investido =
    deal && deal.cost !== null && deal.cost !== undefined
      ? `R$ ${Number(deal.cost).toLocaleString("pt-BR")}`
      : "—";
  const lastLog = stats?.dealLogs?.[stats.dealLogs.length - 1] ?? null;

  const hasCuratorWhitelist = counts.curator > 0;

  const body = (
    <>
        {deal && stats && (
          <>
            {/* HEADER — só aparece no modo Sheet (drawer). Quando é página dedicada, o header é o PageHeader + KPIs externos. */}
            {!asPage && (
              <header className="shrink-0 px-6 pt-6 pb-4 border-b border-white/[0.04] bg-background">
                <div className="flex items-start gap-4">
                  {deal.song_cover_url ? (
                    <img
                      src={deal.song_cover_url}
                      alt=""
                      className="h-14 w-14 rounded-xl object-cover ring-1 ring-white/[0.06] shrink-0"
                    />
                  ) : (
                    <div className="h-14 w-14 rounded-xl bg-[hsl(var(--elevated))] border border-white/[0.04] flex items-center justify-center shrink-0">
                      <Music2 className="h-5 w-5 text-muted-foreground" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <h2 className="text-lg font-semibold text-foreground leading-tight break-words">
                      {deal.song_name}
                    </h2>
                    <div className="text-sm text-muted-foreground mt-0.5 truncate">
                      {deal.song_artist || "—"}
                    </div>
                    <div className="text-xs text-muted-foreground/80 mt-1.5 truncate">
                      Curador: <span className="text-foreground font-medium">{deal.curator_name}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={async () => {
                        const { curatorPublicUrl } = await import("@/lib/curatorPublicUrl");
                        const url = curatorPublicUrl({ slug: deal.slug, public_token: deal.public_token });
                        try {
                          await navigator.clipboard.writeText(url);
                          toast.success("Link do curador copiado", { description: url });
                        } catch {
                          toast.error("Não foi possível copiar o link");
                        }
                      }}
                      className="h-8 px-2.5 rounded-md inline-flex items-center gap-1.5 text-[12px] text-muted-foreground hover:bg-[hsl(var(--elevated))] hover:text-foreground transition-colors"
                      title="Copiar link do portal do curador"
                    >
                      <Headphones className="h-3.5 w-3.5" />
                      Link do curador
                      <Copy className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      onClick={onClose}
                      className="h-8 w-8 rounded-md flex items-center justify-center text-muted-foreground hover:bg-[hsl(var(--elevated))] hover:text-foreground transition-colors"
                      aria-label="Fechar"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>

                </div>

                {/* progresso linear principal */}
                <div className="mt-4">
                  <div className="flex items-baseline justify-between mb-1.5">
                    <div className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">
                      Entrega do curador
                    </div>
                    <div className="text-xs tabular-nums text-muted-foreground">
                      <span className="text-foreground font-semibold">{fmt(stats.earned)}</span>
                      {target > 0 && <> / {fmt(target)}</>}
                      <span className="ml-2 text-foreground font-semibold">{stats.pct}%</span>
                    </div>
                  </div>
                  <Progress value={stats.pct} className="h-1.5" />
                </div>
              </header>
            )}

            {/* TABS */}
            <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)} className={cn("flex-1 flex flex-col min-h-0", asPage && "space-y-4")}>
              <div className={cn(
                asPage
                  ? "-mx-1 px-1"
                  : "px-3 sm:px-6 pt-3 border-b border-border shrink-0"
              )}>
                <TabsList
                  className={cn(
                    asPage
                      ? "w-full grid grid-cols-4 bg-transparent p-0 h-auto gap-2"
                      : "bg-transparent p-0 h-auto gap-0 grid grid-cols-4 w-full sm:w-full",
                  )}
                >
                  <TabsTrigger
                    value="resumo"
                    aria-label="Resumo"
                    className={cn(
                      asPage
                        ? "flex flex-col items-center justify-center gap-1 rounded-xl border border-border bg-card data-[state=active]:border-primary/60 data-[state=active]:bg-primary/10 data-[state=active]:text-primary text-muted-foreground h-[68px] px-1 min-w-0 transition-colors"
                        : "gap-1.5 bg-transparent data-[state=active]:bg-transparent data-[state=active]:text-primary data-[state=active]:shadow-[inset_0_-2px_0_0_hsl(var(--primary))] text-muted-foreground rounded-none h-12 sm:h-10 px-2 sm:px-3 flex-col sm:flex-row",
                    )}
                  >
                    <BarChart3 className={cn("shrink-0", asPage ? "h-4 w-4" : "h-3.5 w-3.5")} />
                    <span className={cn(asPage ? "text-[12px] font-medium truncate leading-none" : "hidden sm:inline text-sm")}>Resumo</span>
                  </TabsTrigger>
                  <TabsTrigger
                    value="playlists"
                    aria-label="Curador"
                    className={cn(
                      asPage
                        ? "flex flex-col items-center justify-center gap-1 rounded-xl border border-border bg-card data-[state=active]:border-primary/60 data-[state=active]:bg-primary/10 data-[state=active]:text-primary text-muted-foreground h-[68px] px-1 min-w-0 transition-colors"
                        : "gap-1.5 bg-transparent data-[state=active]:bg-transparent data-[state=active]:text-primary data-[state=active]:shadow-[inset_0_-2px_0_0_hsl(var(--primary))] text-muted-foreground rounded-none h-12 sm:h-10 px-2 sm:px-3 flex-col sm:flex-row sm:border-l sm:border-border",
                    )}
                  >
                    <ListMusic className={cn("shrink-0", asPage ? "h-4 w-4" : "h-3.5 w-3.5")} />
                    <span className={cn(asPage ? "text-[12px] font-medium truncate leading-none" : "hidden sm:inline text-sm")}>Curador</span>
                    {asPage
                      ? <span className="text-[11px] font-bold tabular-nums leading-none">{curatorTotal}</span>
                      : <span className="hidden sm:inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-muted text-muted-foreground text-[10px] font-bold tabular-nums shrink-0">{curatorTotal}</span>}
                  </TabsTrigger>
                  <TabsTrigger
                    value="algoritmo"
                    aria-label="Algoritmo"
                    className={cn(
                      asPage
                        ? "flex flex-col items-center justify-center gap-1 rounded-xl border border-border bg-card data-[state=active]:border-primary/60 data-[state=active]:bg-primary/10 data-[state=active]:text-primary text-muted-foreground h-[68px] px-1 min-w-0 transition-colors"
                        : "gap-1.5 bg-transparent data-[state=active]:bg-transparent data-[state=active]:text-primary data-[state=active]:shadow-[inset_0_-2px_0_0_hsl(var(--primary))] text-muted-foreground rounded-none h-12 sm:h-10 px-2 sm:px-3 flex-col sm:flex-row sm:border-l sm:border-border",
                    )}
                  >
                    <Sparkles className={cn("shrink-0", asPage ? "h-4 w-4" : "h-3.5 w-3.5")} />
                    <span className={cn(asPage ? "text-[12px] font-medium truncate leading-none" : "hidden sm:inline text-sm")}>Algoritmo</span>
                    {asPage
                      ? <span className="text-[11px] font-bold tabular-nums leading-none">{algoTotal}</span>
                      : <span className="hidden sm:inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-muted text-muted-foreground text-[10px] font-bold tabular-nums shrink-0">{algoTotal}</span>}
                  </TabsTrigger>
                  <TabsTrigger
                    value="historico"
                    aria-label="Histórico"
                    className={cn(
                      asPage
                        ? "flex flex-col items-center justify-center gap-1 rounded-xl border border-border bg-card data-[state=active]:border-primary/60 data-[state=active]:bg-primary/10 data-[state=active]:text-primary text-muted-foreground h-[68px] px-1 min-w-0 transition-colors"
                        : "gap-1.5 bg-transparent data-[state=active]:bg-transparent data-[state=active]:text-primary data-[state=active]:shadow-[inset_0_-2px_0_0_hsl(var(--primary))] text-muted-foreground rounded-none h-12 sm:h-10 px-2 sm:px-3 flex-col sm:flex-row sm:border-l sm:border-border",
                    )}
                  >
                    <Clock className={cn("shrink-0", asPage ? "h-4 w-4" : "h-3.5 w-3.5")} />
                    <span className={cn(asPage ? "text-[12px] font-medium truncate leading-none" : "hidden sm:inline text-sm")}>Histórico</span>
                    {asPage
                      ? <span className="text-[11px] font-bold tabular-nums leading-none">{reversedLogs.length}</span>
                      : <span className="hidden sm:inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-muted text-muted-foreground text-[10px] font-bold tabular-nums shrink-0">{reversedLogs.length}</span>}
                  </TabsTrigger>
                </TabsList>
              </div>

              {/* BODY */}
              <div className={cn(asPage ? "space-y-4" : "flex-1 overflow-y-auto")}>

                {/* === RESUMO === */}
                <TabsContent value="resumo" className={cn("m-0 space-y-5", asPage ? "rounded-2xl border border-border bg-card p-5" : "px-6 py-5")}>
                  {/* aviso whitelist vazia */}
                  {!hasCuratorWhitelist && (
                    <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 flex gap-3">
                      <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                      <div className="text-xs text-foreground leading-relaxed">
                        <strong className="font-semibold text-destructive">
                          Curador ainda não cadastrou playlists.
                        </strong>
                        <div className="text-muted-foreground mt-1">
                          Sem whitelist, o sistema não coleta nem calcula entrega — apenas registra detecções orgânicas como referência.
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Performance na janela (24h/7d/28d) */}
                  {todayBreakdown && todayBreakdown.rows.length > 0 && (
                    <SectionCard
                      title="Performance"
                      right={
                        <div className="inline-flex rounded-lg border border-border bg-[hsl(var(--elevated))] p-0.5">
                          {(["7d", "28d"] as const).map((w) => (
                            <button
                              key={w}
                              onClick={() => setPerfWindow(w)}
                              className={cn(
                                "h-7 px-3 rounded-md text-[11px] font-semibold tabular-nums transition-colors",
                                perfWindow === w
                                  ? "bg-card text-foreground"
                                  : "text-muted-foreground hover:text-foreground",
                              )}
                            >
                              {w}
                            </button>
                          ))}
                        </div>
                      }
                    >
                      <div className="grid grid-cols-3 divide-x divide-border/60 -mx-1">
                        <div className="px-2 min-w-0">
                          <div className="text-[10px] uppercase tracking-wider text-muted-foreground truncate">Total</div>
                          <div className="text-lg sm:text-2xl font-semibold text-primary tabular-nums leading-tight mt-1 truncate">
                            {(() => {
                              const v =
                                perfWindow === "7d"
                                  ? todayBreakdown.total_7d
                                  : todayBreakdown.total_28d;
                              return v == null ? "—" : fmtCompact(v);
                            })()}
                          </div>
                          <div className="text-[10px] text-muted-foreground mt-1">janela {perfWindow}</div>
                        </div>
                        <div className="px-2 min-w-0">
                          <div className="text-[10px] uppercase tracking-wider text-muted-foreground truncate">Curador</div>
                          <div className="text-lg sm:text-2xl font-semibold text-success tabular-nums leading-tight mt-1 truncate">
                            {fmtCompact(curatorWindowTotal)}
                          </div>
                          <div className="text-[10px] text-muted-foreground tabular-nums mt-1">
                            {curatorBreakdownRows.length}/{curatorTotal} playlists
                          </div>
                        </div>
                        <div className="px-2 min-w-0">
                          <div className="text-[10px] uppercase tracking-wider text-muted-foreground truncate">Algoritmo</div>
                          <div className="text-lg sm:text-2xl font-semibold text-foreground tabular-nums leading-tight mt-1 truncate">
                            {fmtCompact(algoWindowTotal)}
                          </div>
                          <div className="text-[10px] text-muted-foreground tabular-nums mt-1">
                            {algoBreakdownRows.length} playlists
                          </div>
                        </div>
                      </div>
                      <div className="flex items-baseline justify-between pt-3 mt-3 border-t border-border">
                        <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
                          Δ hoje
                        </div>
                        <div className="text-base font-semibold text-foreground tabular-nums">
                          +{fmtCompact(todayBreakdown.total_today)}
                        </div>
                      </div>
                    </SectionCard>
                  )}

                  {/* KPIs duplicados — só renderiza no drawer; na página dedicada o hero do topo já mostra. */}
                  {!asPage && (
                    <div className="grid grid-cols-2 gap-3">
                      <Kpi
                        label="Plays entregues"
                        value={fmtCompact(stats.earned)}
                        hint={target > 0 ? `de ${fmtCompact(target)} contratados` : "sem meta definida"}
                        tone={stats.pct >= 100 ? "success" : "primary"}
                      />
                      <Kpi
                        label="Velocidade"
                        value={stats.vel !== null ? `${fmtCompact(stats.vel)}/dia` : "—"}
                        hint={stats.vel !== null ? "média desde o início" : "aguardando 2º registro"}
                      />
                      <Kpi label="Previsão" value={previsao} hint="para bater a meta" />
                      <Kpi
                        label="Score de qualidade"
                        value={`${stats.score}`}
                        hint={`${Math.round(stats.legitShare * 100)}% legítimo`}
                        tone={stats.score >= 75 ? "success" : stats.score >= 50 ? "primary" : "warning"}
                      />
                    </div>
                  )}

                  {/* Estado da coleta */}
                  <SectionCard title="Estado da coleta">
                    <ul className="divide-y divide-border/60 -my-2">
                      {[
                        { label: "Baseline", value: baseline > 0 ? fmt(baseline) : "—" },
                        { label: "Última leitura", value: fmt(stats.latestPlays) },
                        {
                          label: "Última coleta",
                          value: lastLog
                            ? format(new Date(lastLog.created_at), "dd MMM, HH:mm", { locale: ptBR })
                            : "—",
                        },
                        { label: "Investido", value: investido },
                      ].map((r) => (
                        <li key={r.label} className="flex items-center justify-between gap-3 py-2.5 text-[13px]">
                          <span className="text-muted-foreground">{r.label}</span>
                          <span className="text-right tabular-nums font-medium text-foreground truncate">
                            {r.value}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </SectionCard>

                  {/* Origem das playlists */}
                  <SectionCard title="Origem das playlists">
                    <ul className="divide-y divide-border/60 -my-2">
                      {(["curator", "editorial", "organic", "suspicious", "baseline"] as CuratorMatchStatus[])
                        .filter((s) => counts[s] > 0)
                        .map((s) => (
                          <li key={s} className="flex items-center gap-2 py-2.5 text-[13px]">
                            <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", STATUS_DOT[s])} />
                            <span className="text-foreground truncate">{STATUS_LABEL[s]}</span>
                            <span className="ml-auto tabular-nums font-semibold text-muted-foreground shrink-0">
                              {counts[s]}
                            </span>
                          </li>
                        ))}
                      {dealPlaylists.length === 0 && (
                        <li className="py-2.5 text-[13px] text-muted-foreground">
                          Nenhuma playlist registrada ainda.
                        </li>
                      )}
                    </ul>
                  </SectionCard>

                  {/* Curador vs Ecossistema (RPC breakdown) */}
                  {breakdown && (
                    <SectionCard
                      title="Entrega vs Ecossistema"
                      right={<span className="hidden sm:inline text-[10px] text-muted-foreground">plays únicos por playlist</span>}
                    >
                      <div className="grid grid-cols-3 divide-x divide-border/60 -mx-1">
                        <div className="px-2 min-w-0">
                          <div className="text-[10px] uppercase tracking-wider text-muted-foreground truncate">Curador</div>
                          <div className="text-base sm:text-lg font-semibold tabular-nums text-success leading-tight mt-1">
                            {fmtCompact(breakdown.curator.plays)}
                          </div>
                          <div className="text-[10px] text-muted-foreground tabular-nums mt-0.5">
                            {breakdown.curator.playlists} playlists
                          </div>
                        </div>
                        <div className="px-2 min-w-0">
                          <div className="text-[10px] uppercase tracking-wider text-muted-foreground truncate">Ecossistema</div>
                          <div className="text-base sm:text-lg font-semibold tabular-nums text-primary leading-tight mt-1">
                            {fmtCompact(eco.plays)}
                          </div>
                          <div className="text-[10px] text-muted-foreground tabular-nums mt-0.5">
                            {eco.playlists} playlists
                          </div>
                        </div>
                        <div className="px-2 min-w-0">
                          <div className="text-[10px] uppercase tracking-wider text-muted-foreground truncate">Total</div>
                          <div className="text-base sm:text-lg font-semibold tabular-nums text-foreground leading-tight mt-1">
                            {fmtCompact(breakdown.total.plays)}
                          </div>
                          <div className="text-[10px] text-muted-foreground tabular-nums mt-0.5">
                            {breakdown.total.playlists} playlists
                          </div>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-3 mt-3 border-t border-border">
                        {(["editorial","algorithmic","organic","suspicious"] as const).map((k) => {
                          const v = breakdown.ecosystem[k];
                          if (!v.playlists && !v.plays) return null;
                          const labels = { editorial: "Editorial", algorithmic: "Algorítmica", organic: "Orgânica", suspicious: "Suspeita" } as const;
                          return (
                            <div key={k} className="text-[11px]">
                              <div className="text-muted-foreground">{labels[k]}</div>
                              <div className="text-foreground font-semibold tabular-nums">
                                {fmtCompact(v.plays)} <span className="text-muted-foreground font-normal">· {v.playlists}</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      <div className="text-[11px] text-muted-foreground leading-relaxed pt-3 mt-3 border-t border-border">
                        Apenas a coluna <span className="text-success font-medium">Curador</span> conta na meta contratual. Ecossistema é exibição.
                      </div>
                    </SectionCard>
                  )}

                  <SectionCard
                    title="Monitoramento anti-fraude"
                    right={<AlertTriangle className="h-3.5 w-3.5 text-muted-foreground" />}
                  >
                    <FraudAlertsPanel dealId={deal.id} onReload={onReload} />
                  </SectionCard>

                  {deal.song_spotify_url && (
                    <Button
                      variant="ghost"
                      className="w-full h-10 gap-2 text-sm text-muted-foreground hover:text-foreground border border-border/60 hover:bg-[hsl(var(--elevated))]"
                      onClick={() => window.open(deal.song_spotify_url!, "_blank")}
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      Abrir música no Spotify
                    </Button>
                  )}
                </TabsContent>

                {/* === CURADOR (whitelist) === */}
                <TabsContent value="playlists" className={cn("m-0 space-y-4", asPage ? "rounded-2xl border border-border bg-card p-5" : "px-6 py-5")}>
                  {/* Search + ação inline */}
                  {(curatorTotal > 0 || deal.curator_id) && (
                    <div className="flex items-center gap-2">
                      {curatorTotal > 0 && (
                        <Input
                          value={plQuery}
                          onChange={(e) => setPlQuery(e.target.value)}
                          placeholder="Buscar playlist ou owner…"
                          className="h-9 text-sm flex-1"
                        />
                      )}
                      {deal.curator_id && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-9 gap-1.5 text-xs text-muted-foreground hover:text-foreground border border-border/60 hover:bg-[hsl(var(--elevated))] shrink-0"
                          onClick={() => {
                            const firstSongId = curatorSongFilter !== "all" ? curatorSongFilter : (songs[0]?.id ?? "all");
                            setCuratorSongFilter(firstSongId);
                            setImportOpen(true);
                          }}
                        >
                          <Library className="h-3.5 w-3.5" />
                          Catálogo
                        </Button>
                      )}
                      {deal.curator_id && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-9 gap-1.5 text-xs text-muted-foreground hover:text-foreground border border-border/60 hover:bg-[hsl(var(--elevated))] shrink-0"
                          onClick={() => setPasteOpen(true)}
                        >
                          <ClipboardPaste className="h-3.5 w-3.5" />
                          Colar URLs
                        </Button>
                      )}
                    </div>
                  )}

                  <p className="text-[11px] text-muted-foreground leading-relaxed px-1">
                    Playlists cadastradas pelo curador — é o que conta como entrega contratada.
                  </p>

                  {curatorTotal > 0 && curatorWindowTotal === 0 && (
                    <div className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-[11px] text-foreground leading-relaxed">
                      <strong className="font-semibold">Curador ainda não detectado no Spotify for Artists.</strong>
                      <div className="text-muted-foreground mt-1">
                        As playlists estão na whitelist mas ainda não apareceram nos snapshots do S4A.
                        Plays de orgânicas/editoriais aparecem na aba <span className="text-foreground font-medium">Algoritmo</span> e não contam para a meta.
                      </div>
                    </div>
                  )}

                  {curatorTotal > 0 && songs.length > 1 && (
                    <div className="flex flex-wrap gap-1.5">
                      <button
                        onClick={() => setCuratorSongFilter("all")}
                        className={cn(
                          "h-7 px-2.5 rounded-full text-[11px] font-medium border transition-colors inline-flex items-center gap-1.5",
                          curatorSongFilter === "all"
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-transparent border-white/[0.06] text-muted-foreground hover:text-foreground hover:bg-[hsl(var(--elevated))]",
                        )}
                      >
                        Todas as músicas
                      </button>
                      {songs.map((s) => {
                        const c = sortedPlaylists.filter((p) => {
                          const st = (p.match_status ?? (p.is_initial_roster ? "baseline" : "curator")) as CuratorMatchStatus;
                          return (st === "curator" || st === "baseline") && p.song_id === s.id;
                        }).length;
                        return (
                          <button
                            key={s.id}
                            onClick={() => setCuratorSongFilter(s.id)}
                            className={cn(
                              "h-7 px-2.5 rounded-full text-[11px] font-medium border transition-colors inline-flex items-center gap-1.5 max-w-[220px]",
                              curatorSongFilter === s.id
                                ? "bg-primary text-primary-foreground border-primary"
                                : "bg-transparent border-white/[0.06] text-muted-foreground hover:text-foreground hover:bg-[hsl(var(--elevated))]",
                            )}
                            title={`${s.song_name ?? ""} — ${s.song_artist ?? ""}`}
                          >
                            <span className="truncate">{s.song_name || "Música"}</span>
                            <span className="tabular-nums opacity-70 shrink-0">{c}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* lista */}
                  {curatorTotal === 0 ? (
                    <div className="rounded-xl border border-white/[0.04] bg-[hsl(var(--elevated))]/40 py-10 flex flex-col items-center text-center gap-2">
                      <div className="h-10 w-10 rounded-full bg-[hsl(var(--elevated))] border border-white/[0.04] flex items-center justify-center">
                        <ListMusic className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div className="text-sm font-medium text-foreground">
                        Nenhuma playlist do curador
                      </div>
                      <div className="text-xs text-muted-foreground max-w-xs">
                        Use "Catálogo do curador" pra puxar links já cadastrados, ou cole dados do Spotify for Artists.
                      </div>
                    </div>
                  ) : curatorPlaylists.length === 0 ? (
                    <div className="text-center text-xs text-muted-foreground py-8">
                      Nenhum resultado pra essa busca.
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-border bg-card overflow-y-auto overflow-x-hidden max-h-[680px] scrollbar-none">
                      <ul className="divide-y divide-border">
                        {curatorPlaylists.map((p) => (
                          <BreakdownRow key={p.id} r={toBreakdownRowData(p)} kind="curator" />
                        ))}
                      </ul>
                    </div>
                  )}
                </TabsContent>

                {/* === ALGORITMO (editorial / orgânica / suspeita) === */}
                <TabsContent value="algoritmo" className={cn("m-0 space-y-4", asPage ? "rounded-2xl border border-border bg-card p-5" : "px-6 py-5")}>
                  <p className="text-[11px] text-muted-foreground leading-relaxed px-1">
                    <span className="text-foreground font-medium">Visualização apenas.</span>{" "}
                    Playlists detectadas pelo algoritmo do Spotify ou orgânicas — não contam na entrega do curador.
                  </p>

                  {algoTotal > 0 && (
                    <>
                      <Input
                        value={algoQuery}
                        onChange={(e) => setAlgoQuery(e.target.value)}
                        placeholder="Buscar playlist ou owner…"
                        className="h-9 text-sm"
                      />
                      {songs.length > 1 && (
                        <div className="flex flex-wrap gap-1.5">
                          <button
                            onClick={() => setAlgoSongFilter("all")}
                            className={cn(
                              "h-7 px-2.5 rounded-full text-[11px] font-medium border transition-colors inline-flex items-center gap-1.5",
                              algoSongFilter === "all"
                                ? "bg-primary text-primary-foreground border-primary"
                                : "bg-transparent border-white/[0.06] text-muted-foreground hover:text-foreground hover:bg-[hsl(var(--elevated))]",
                            )}
                          >
                            Todas as músicas
                          </button>
                          {songs.map((s) => {
                            const c = sortedPlaylists.filter((p) => {
                              const st = (p.match_status ?? (p.is_initial_roster ? "baseline" : "curator")) as CuratorMatchStatus;
                              return (st === "editorial" || st === "algorithmic" || st === "organic" || st === "suspicious") && p.song_id === s.id;
                            }).length;
                            return (
                              <button
                                key={s.id}
                                onClick={() => setAlgoSongFilter(s.id)}
                                className={cn(
                                  "h-7 px-2.5 rounded-full text-[11px] font-medium border transition-colors inline-flex items-center gap-1.5 max-w-[220px]",
                                  algoSongFilter === s.id
                                    ? "bg-primary text-primary-foreground border-primary"
                                    : "bg-transparent border-white/[0.06] text-muted-foreground hover:text-foreground hover:bg-[hsl(var(--elevated))]",
                                )}
                                title={`${s.song_name ?? ""} — ${s.song_artist ?? ""}`}
                              >
                                <span className="truncate">{s.song_name || "Música"}</span>
                                <span className="tabular-nums opacity-70 shrink-0">{c}</span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                      <div className="flex flex-wrap gap-1.5">
                        {(
                          [
                            ["all", "Todas", algoTotal],
                            ["editorial", "Algorítmicas", counts.editorial],
                            ["organic", "Detectadas", counts.organic],
                            ["suspicious", "Suspeitas", counts.suspicious],
                          ] as Array<[typeof algoFilter, string, number]>
                        )
                          .filter(([key, , c]) => key === "all" || c > 0)
                          .map(([key, label, c]) => (
                            <button
                              key={key}
                              onClick={() => setAlgoFilter(key)}
                              className={cn(
                                "h-7 px-2.5 rounded-full text-[11px] font-medium border transition-colors inline-flex items-center gap-1.5",
                                algoFilter === key
                                  ? "bg-foreground text-background border-foreground"
                                  : "bg-transparent border-white/[0.06] text-muted-foreground hover:text-foreground hover:bg-[hsl(var(--elevated))]",
                              )}
                            >
                              {label}
                              <span className="tabular-nums opacity-70">{c}</span>
                            </button>
                          ))}
                      </div>
                    </>
                  )}

                  {algoTotal === 0 ? (
                    <div className="rounded-xl border border-white/[0.04] bg-[hsl(var(--elevated))]/40 py-10 flex flex-col items-center text-center gap-2">
                      <div className="h-10 w-10 rounded-full bg-[hsl(var(--elevated))] border border-white/[0.04] flex items-center justify-center">
                        <Sparkles className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div className="text-sm font-medium text-foreground">
                        Nenhuma detecção do algoritmo ainda
                      </div>
                      <div className="text-xs text-muted-foreground max-w-xs">
                        Quando o Spotify ou outras playlists tocarem essa música, elas aparecem aqui.
                      </div>
                    </div>
                  ) : algoPlaylists.length === 0 ? (
                    <div className="text-center text-xs text-muted-foreground py-8">
                      Nenhum resultado pra esse filtro.
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-border bg-card overflow-y-auto overflow-x-hidden max-h-[680px] scrollbar-none">
                      <ul className="divide-y divide-border">
                        {algoPlaylists.map((p) => (
                          <BreakdownRow key={p.id} r={toBreakdownRowData(p)} kind="algo" />
                        ))}
                      </ul>
                    </div>
                  )}
                </TabsContent>

                {/* === HISTÓRICO === */}
                <TabsContent value="historico" className={cn("m-0 space-y-3", asPage ? "rounded-2xl border border-border bg-card p-5" : "px-6 py-5")}>
                  {reversedLogs.length === 0 ? (
                    <div className="rounded-2xl border border-warning/40 bg-card py-10 px-5 flex flex-col items-center text-center gap-3">
                      <div className="h-10 w-10 rounded-full bg-[hsl(var(--elevated))] border border-border flex items-center justify-center">
                        <ImageOff className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div className="text-sm font-medium text-foreground">Nenhuma coleta gravada</div>
                      <div className="text-xs text-muted-foreground max-w-sm leading-relaxed">
                        Existem {curatorTotal} playlists do curador nesta campanha, mas não há registros em curator_deal_logs para mostrar histórico interno.
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3 max-h-[680px] overflow-y-auto pr-1 scrollbar-none">
                    {reversedLogs.map((log, idx) => {
                      const prev = reversedLogs[idx + 1];
                      const isFirst = !prev;
                      const delta = prev
                        ? Number(log.total_plays) - Number(prev.total_plays)
                        : 0;
                      const positive = delta >= 0;
                      const logSong = getSongForLog(log);
                      // Fallback de song_name SÓ quando o log não tem song_id (legado).
                      // Se log tem song_id mas a song foi removida → mostrar "Música removida"
                      // pra não fingir que pertence à música principal do deal.
                      const songMissing = !!log.song_id && !logSong;
                      const cover = logSong?.song_cover_url ?? (log.song_id ? null : deal.song_cover_url) ?? null;
                      const songName = songMissing
                        ? "Música removida"
                        : (logSong?.song_name ?? (log.song_id ? "Música" : deal.song_name) ?? "Música");
                      const isExpanded = selectedLogId === log.id;

                      // playlists vinculadas a este registro (mesma lógica que estava no popup)
                      const linked = allPlaylists
                        .filter((p) => {
                          if (p.deal_id !== log.deal_id) return false;
                          if (log.song_id && p.song_id) {
                            return p.song_id === log.song_id;
                          }
                          if (log.is_initial_capture_event) return p.is_initial_roster === true;
                          return true;
                        })
                        .sort(
                          (a, b) =>
                            (Number(b.streams_7d) || 0) - (Number(a.streams_7d) || 0),
                        );

                      return (
                        <div
                          key={log.id}
                          className={cn(
                            "rounded-2xl border overflow-hidden transition-colors",
                            isExpanded
                              ? "border-primary/40 bg-card shadow-[0_0_0_1px_hsl(var(--primary)/0.15)]"
                              : "border-border bg-card hover:border-border/80",
                          )}
                        >
                          <button
                            type="button"
                            onClick={() =>
                              setSelectedLogId(isExpanded ? null : log.id)
                            }
                            className={cn(
                              "w-full text-left px-4 py-3 flex items-center gap-3",
                              isExpanded && "bg-[hsl(var(--elevated))]",
                            )}
                          >
                            {cover ? (
                              <img
                                src={cover}
                                alt=""
                                className="h-11 w-11 rounded-lg object-cover shrink-0 ring-1 ring-border"
                              />
                            ) : (
                              <div className="h-11 w-11 rounded-lg bg-muted/40 flex items-center justify-center shrink-0">
                                <Music2 className="h-4 w-4 text-muted-foreground" />
                              </div>
                            )}

                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span className={cn(
                                  "text-[13px] leading-tight line-clamp-1",
                                  isExpanded ? "font-bold text-foreground" : "font-semibold",
                                )}>
                                  {songName}
                                </span>
                                {log.is_initial_capture_event && (
                                  <Badge
                                    variant="secondary"
                                    className="text-[9px] h-4 px-1.5 shrink-0"
                                  >
                                    Baseline
                                  </Badge>
                                )}
                              </div>
                              <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-muted-foreground mt-0.5">
                                <span className="whitespace-nowrap">
                                  {format(new Date(log.created_at), "dd MMM, HH:mm", { locale: ptBR })}
                                </span>
                                {linked.length > 0 && (
                                  <>
                                    <span>·</span>
                                    <span className="whitespace-nowrap">
                                      {linked.length} playlist{linked.length > 1 ? "s" : ""}
                                    </span>
                                  </>
                                )}
                                {log.print_urls && log.print_urls.length > 0 && (
                                  <>
                                    <span>·</span>
                                    <span className="whitespace-nowrap">
                                      {log.print_urls.length} print{log.print_urls.length > 1 ? "s" : ""}
                                    </span>
                                  </>
                                )}
                              </div>
                            </div>

                            <div className="text-right shrink-0">
                              <div className="text-[15px] font-bold tabular-nums leading-tight">
                                {Number(log.total_plays).toLocaleString("pt-BR")}
                              </div>
                              {!isFirst && !log.is_initial_capture_event ? (
                                <div
                                  className={cn(
                                    "text-[11px] font-semibold tabular-nums mt-0.5 inline-flex items-center gap-0.5",
                                    positive ? "text-success" : "text-destructive",
                                  )}
                                >
                                  <TrendingUp
                                    className={cn("h-3 w-3", !positive && "rotate-180")}
                                  />
                                  {positive ? "+" : "−"}
                                  {Math.abs(delta).toLocaleString("pt-BR")}
                                </div>
                              ) : (
                                <div className="text-[10px] text-muted-foreground mt-0.5">plays</div>
                              )}
                            </div>

                            <ChevronRight
                              className={cn(
                                "h-4 w-4 text-muted-foreground/60 shrink-0 transition-transform",
                                isExpanded && "rotate-90 text-primary",
                              )}
                            />
                          </button>

                          {/* CORPO EXPANDIDO INLINE — sem popup */}
                          {isExpanded && (
                            <div className="border-t border-border px-4 py-4 space-y-4 bg-card">
                              {log.note && (
                                <div>
                                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                                    Observação
                                  </div>
                                  <div className="text-xs text-foreground/90 rounded-md bg-muted/20 px-2.5 py-1.5 leading-relaxed">
                                    {log.note}
                                  </div>
                                </div>
                              )}

                              {log.print_urls && log.print_urls.length > 0 && (
                                <div>
                                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
                                    Prints ({log.print_urls.length})
                                  </div>
                                  <PrintThumbs urls={log.print_urls} size="sm" />
                                </div>
                              )}

                              <div>
                                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
                                  {log.is_initial_capture_event ? "Playlists iniciais" : "Playlists do registro"}{" "}
                                  ({linked.length})
                                </div>
                                {linked.length === 0 ? (
                                  <div className="text-xs text-muted-foreground py-2">
                                    Nenhuma playlist vinculada a este registro.
                                  </div>
                                ) : (
                                  <ul className="rounded-2xl border border-border bg-card divide-y divide-border overflow-hidden">
                                    {linked.map((p) => (
                                      <PlaylistRow
                                        key={p.id}
                                        p={p}
                                        snapshot7d={breakdownMap.get(p.id)?.plays_7d ?? null}
                                      />
                                    ))}
                                  </ul>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                    </div>
                  )}
                </TabsContent>
              </div>
            </Tabs>
          </>
        )}
    </>
  );

  const dialogs = (
    <>
      <PastePlaylistsDialog
        open={pasteOpen}
        deal={deal}
        onClose={() => setPasteOpen(false)}
        onImported={() => onReload?.()}
      />
      <ImportFromLibraryDialog
        open={importOpen}
        deal={deal}
        songs={songs}
        existingPlaylists={allPlaylists}
        initialSongId={curatorSongFilter !== "all" ? curatorSongFilter : null}
        onClose={() => setImportOpen(false)}
        onImported={() => onReload?.()}
      />
    </>
  );

  if (asPage) {
    return (
      <div className="flex flex-col">
        {body}
        {dialogs}
      </div>
    );
  }


  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <SheetContent side="right" className="w-full sm:max-w-2xl p-0 flex flex-col gap-0">
        {body}
      </SheetContent>
      {dialogs}
    </Sheet>
  );
}
