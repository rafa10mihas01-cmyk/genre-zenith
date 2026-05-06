import { useMemo, useState } from "react";
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

import {
  computeCuratorStats,
  type CuratorDeal,
  type CuratorDealLog,
  type CuratorDealSong,
  type CuratorPlaylist,
  type CuratorMatchStatus,
  type CuratorDealProgress,
} from "@/lib/curatorDealsUtils";

export interface DealHistorySheetProps {
  open: boolean;
  deal: CuratorDeal | null;
  songs?: CuratorDealSong[];
  allLogs: CuratorDealLog[];
  allPlaylists: CuratorPlaylist[];
  progress?: CuratorDealProgress | null;
  onClose: () => void;
  onReload?: () => void;
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
  editorial: "Algorítmica",
  organic: "Detectada",
  suspicious: "Suspeita",
  baseline: "Inicial",
};

const STATUS_DOT: Record<CuratorMatchStatus, string> = {
  curator: "bg-success",
  editorial: "bg-primary",
  organic: "bg-muted-foreground/60",
  suspicious: "bg-destructive",
  baseline: "bg-muted-foreground/40",
};

const STATUS_CHIP: Record<CuratorMatchStatus, string> = {
  curator: "bg-success/15 text-success",
  editorial: "bg-primary/15 text-primary",
  organic: "bg-muted/60 text-muted-foreground",
  suspicious: "bg-destructive/15 text-destructive",
  baseline: "bg-muted/40 text-muted-foreground",
};

const STATUS_ORDER: Record<CuratorMatchStatus, number> = {
  curator: 0,
  editorial: 1,
  organic: 2,
  suspicious: 3,
  baseline: 4,
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
 * KPI tile — limpo, sem "card-dentro-de-card".
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
  const toneCls =
    tone === "success"
      ? "text-success"
      : tone === "primary"
      ? "text-primary"
      : tone === "warning"
      ? "text-destructive"
      : "text-foreground";
  return (
    <div className="rounded-xl bg-[hsl(var(--elevated))] border border-white/[0.04] p-4">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className={cn("text-2xl font-bold leading-tight mt-1.5 tabular-nums", toneCls)}>
        {value}
      </div>
      {hint && (
        <div className="text-[11px] text-muted-foreground/80 mt-1 truncate">{hint}</div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------
 * Linha de playlist — densidade controlada, sem grupos artificiais.
 * ------------------------------------------------------------------ */
function PlaylistRow({ p }: { p: CuratorPlaylist }) {
  const status = (p.match_status ??
    (p.is_baseline ? "baseline" : "curator")) as CuratorMatchStatus;
  const owner = p.spotify_owner_name?.trim() || null;
  const followers = p.followers ? `${fmtCompact(Number(p.followers))} seguidores` : null;
  const plays7d = p.streams_7d ? `${fmtCompact(Number(p.streams_7d))} plays/7d` : null;
  const meta = [owner, followers, plays7d].filter(Boolean).join(" · ");
  const position = typeof p.position_in_paste === "number" ? p.position_in_paste : null;

  return (
    <li className="group flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-[hsl(var(--elevated))] transition-colors">
      {/* posição */}
      {position !== null && (
        <div className="w-6 shrink-0 text-right text-[11px] font-semibold tabular-nums text-muted-foreground">
          #{position}
        </div>
      )}

      {/* cover */}
      <div className="h-10 w-10 shrink-0 rounded-md overflow-hidden bg-[hsl(var(--elevated))] border border-white/[0.04] flex items-center justify-center">
        {p.image_url ? (
          <img src={p.image_url} alt="" className="h-full w-full object-cover" />
        ) : (
          <ListMusic className="h-4 w-4 text-muted-foreground" />
        )}
      </div>

      {/* nome + meta */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span
            className={cn("h-1.5 w-1.5 rounded-full shrink-0", STATUS_DOT[status])}
            title={STATUS_LABEL[status]}
          />
          <span className="text-[13px] font-medium text-foreground truncate">
            {p.playlist_name || "Playlist sem nome"}
          </span>
        </div>
        {meta && (
          <div className="text-[11px] text-muted-foreground truncate mt-0.5 pl-3.5">
            {meta}
          </div>
        )}
      </div>

      {/* tag + link */}
      <div className="flex items-center gap-2 shrink-0">
        <span
          className={cn(
            "text-[10px] font-semibold px-2 h-5 rounded-full inline-flex items-center",
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
            className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground transition-opacity"
            onClick={(e) => e.stopPropagation()}
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
      </div>
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
}: DealHistorySheetProps) {
  const [tab, setTab] = useState<"resumo" | "playlists" | "algoritmo" | "historico">("resumo");
  const [pasteOpen, setPasteOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [selectedLogId, setSelectedLogId] = useState<string | null>(null);
  const [plQuery, setPlQuery] = useState("");
  const [algoQuery, setAlgoQuery] = useState("");
  const [algoFilter, setAlgoFilter] = useState<"all" | "editorial" | "organic" | "suspicious">("all");

  const stats = deal ? computeCuratorStats(deal, allLogs, allPlaylists, progress ?? null) : null;

  const getSongForLog = (log: CuratorDealLog): CuratorDealSong | null => {
    if (log.song_id) return songs.find((s) => s.id === log.song_id) ?? null;
    return null;
  };

  const reversedLogs = stats ? [...stats.dealLogs].reverse() : [];

  const dealPlaylists = useMemo(
    () => (deal ? allPlaylists.filter((p) => p.deal_id === deal.id) : []),
    [allPlaylists, deal],
  );

  const sortedPlaylists = useMemo(() => {
    return [...dealPlaylists].sort((a, b) => {
      const sa = (a.match_status ?? (a.is_baseline ? "baseline" : "curator")) as CuratorMatchStatus;
      const sb = (b.match_status ?? (b.is_baseline ? "baseline" : "curator")) as CuratorMatchStatus;
      const od = STATUS_ORDER[sa] - STATUS_ORDER[sb];
      if (od !== 0) return od;
      return Number(b.streams_7d ?? 0) - Number(a.streams_7d ?? 0);
    });
  }, [dealPlaylists]);

  // contagens por categoria
  const counts = useMemo(() => {
    const c = { curator: 0, editorial: 0, organic: 0, suspicious: 0, baseline: 0 } as Record<
      CuratorMatchStatus,
      number
    >;
    for (const p of dealPlaylists) {
      const s = (p.match_status ?? (p.is_baseline ? "baseline" : "curator")) as CuratorMatchStatus;
      c[s] = (c[s] ?? 0) + 1;
    }
    return c;
  }, [dealPlaylists]);

  const filteredPlaylists = useMemo(() => {
    const q = plQuery.trim().toLowerCase();
    return sortedPlaylists.filter((p) => {
      const s = (p.match_status ?? (p.is_baseline ? "baseline" : "curator")) as CuratorMatchStatus;
      if (plFilter !== "all" && s !== plFilter) return false;
      if (!q) return true;
      return (
        (p.playlist_name ?? "").toLowerCase().includes(q) ||
        (p.spotify_owner_name ?? "").toLowerCase().includes(q)
      );
    });
  }, [sortedPlaylists, plQuery, plFilter]);

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

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <SheetContent
        side="right"
        className="w-full sm:max-w-2xl p-0 flex flex-col gap-0"
      >
        {deal && stats && (
          <>
            {/* HEADER */}
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
                <button
                  type="button"
                  onClick={onClose}
                  className="h-8 w-8 shrink-0 rounded-md flex items-center justify-center text-muted-foreground hover:bg-[hsl(var(--elevated))] hover:text-foreground transition-colors"
                  aria-label="Fechar"
                >
                  <X className="h-4 w-4" />
                </button>
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

            {/* TABS */}
            <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)} className="flex-1 flex flex-col min-h-0">
              <div className="px-6 pt-3 border-b border-white/[0.04] shrink-0">
                <TabsList className="bg-transparent p-0 h-auto gap-1">
                  <TabsTrigger
                    value="resumo"
                    className="data-[state=active]:bg-[hsl(var(--elevated))] data-[state=active]:text-foreground rounded-lg gap-2 h-9 px-3"
                  >
                    <BarChart3 className="h-3.5 w-3.5" />
                    Resumo
                  </TabsTrigger>
                  <TabsTrigger
                    value="playlists"
                    className="data-[state=active]:bg-[hsl(var(--elevated))] data-[state=active]:text-foreground rounded-lg gap-2 h-9 px-3"
                  >
                    <ListMusic className="h-3.5 w-3.5" />
                    Playlists
                    <span className="text-[10px] font-bold tabular-nums text-muted-foreground">
                      {dealPlaylists.length}
                    </span>
                  </TabsTrigger>
                  <TabsTrigger
                    value="historico"
                    className="data-[state=active]:bg-[hsl(var(--elevated))] data-[state=active]:text-foreground rounded-lg gap-2 h-9 px-3"
                  >
                    <Clock className="h-3.5 w-3.5" />
                    Histórico
                    <span className="text-[10px] font-bold tabular-nums text-muted-foreground">
                      {reversedLogs.length}
                    </span>
                  </TabsTrigger>
                </TabsList>
              </div>

              {/* BODY */}
              <div className="flex-1 overflow-y-auto">
                {/* === RESUMO === */}
                <TabsContent value="resumo" className="m-0 px-6 py-5 space-y-5">
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

                  {/* KPIs */}
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

                  {/* mini-status técnico */}
                  <div className="rounded-xl border border-white/[0.04] bg-[hsl(var(--elevated))]/50 p-4 space-y-2.5">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Estado da coleta
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-[12px]">
                      <div className="text-muted-foreground">Baseline</div>
                      <div className="text-right tabular-nums font-medium">
                        {baseline > 0 ? fmt(baseline) : "—"}
                      </div>
                      <div className="text-muted-foreground">Última leitura</div>
                      <div className="text-right tabular-nums font-medium">
                        {fmt(stats.latestPlays)}
                      </div>
                      <div className="text-muted-foreground">Última coleta</div>
                      <div className="text-right text-foreground/80">
                        {lastLog
                          ? format(new Date(lastLog.created_at), "dd MMM, HH:mm", { locale: ptBR })
                          : "—"}
                      </div>
                      <div className="text-muted-foreground">Investido</div>
                      <div className="text-right font-medium">{investido}</div>
                    </div>
                  </div>

                  {/* breakdown de playlists */}
                  <div className="rounded-xl border border-white/[0.04] bg-[hsl(var(--elevated))]/50 p-4">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                      Origem das playlists
                    </div>
                    <div className="space-y-2">
                      {(["curator", "editorial", "organic", "suspicious", "baseline"] as CuratorMatchStatus[])
                        .filter((s) => counts[s] > 0)
                        .map((s) => (
                          <div key={s} className="flex items-center gap-2 text-[12px]">
                            <span className={cn("h-1.5 w-1.5 rounded-full", STATUS_DOT[s])} />
                            <span className="text-foreground">{STATUS_LABEL[s]}</span>
                            <span className="ml-auto tabular-nums font-semibold text-muted-foreground">
                              {counts[s]}
                            </span>
                          </div>
                        ))}
                      {dealPlaylists.length === 0 && (
                        <div className="text-[12px] text-muted-foreground">
                          Nenhuma playlist registrada ainda.
                        </div>
                      )}
                    </div>
                  </div>

                  {/* anti-fraude */}
                  <div className="rounded-xl border border-white/[0.04] bg-[hsl(var(--elevated))]/50 p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <AlertTriangle className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Monitoramento anti-fraude
                      </span>
                    </div>
                    <FraudAlertsPanel dealId={deal.id} onReload={onReload} />
                  </div>

                  {deal.song_spotify_url && (
                    <Button
                      variant="outline"
                      className="w-full h-10 gap-2 text-sm"
                      onClick={() => window.open(deal.song_spotify_url!, "_blank")}
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      Abrir música no Spotify
                    </Button>
                  )}
                </TabsContent>

                {/* === PLAYLISTS === */}
                <TabsContent value="playlists" className="m-0 px-6 py-5 space-y-4">
                  {/* ações */}
                  <div className="flex items-center gap-2">
                    {deal.curator_id && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-9 gap-1.5 text-xs"
                        onClick={() => setImportOpen(true)}
                      >
                        <Library className="h-3.5 w-3.5" />
                        Catálogo do curador
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-9 gap-1.5 text-xs ml-auto"
                      onClick={() => setPasteOpen(true)}
                    >
                      <ClipboardPaste className="h-3.5 w-3.5" />
                      Colar dados
                    </Button>
                  </div>

                  {/* busca + filtros */}
                  {dealPlaylists.length > 0 && (
                    <>
                      <Input
                        value={plQuery}
                        onChange={(e) => setPlQuery(e.target.value)}
                        placeholder="Buscar playlist ou owner…"
                        className="h-9 text-sm"
                      />
                      <div className="flex flex-wrap gap-1.5">
                        {(
                          [
                            ["all", "Todas", dealPlaylists.length],
                            ["curator", "Curador", counts.curator],
                            ["editorial", "Algorítmicas", counts.editorial],
                            ["organic", "Detectadas", counts.organic],
                            ["suspicious", "Suspeitas", counts.suspicious],
                            ["baseline", "Iniciais", counts.baseline],
                          ] as Array<[typeof plFilter, string, number]>
                        )
                          .filter(([key, , c]) => key === "all" || c > 0)
                          .map(([key, label, c]) => (
                            <button
                              key={key}
                              onClick={() => setPlFilter(key)}
                              className={cn(
                                "h-7 px-2.5 rounded-full text-[11px] font-medium border transition-colors inline-flex items-center gap-1.5",
                                plFilter === key
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

                  {/* lista */}
                  {dealPlaylists.length === 0 ? (
                    <div className="rounded-xl border border-white/[0.04] bg-[hsl(var(--elevated))]/40 py-10 flex flex-col items-center text-center gap-2">
                      <div className="h-10 w-10 rounded-full bg-[hsl(var(--elevated))] border border-white/[0.04] flex items-center justify-center">
                        <ListMusic className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div className="text-sm font-medium text-foreground">
                        Nenhuma playlist registrada
                      </div>
                      <div className="text-xs text-muted-foreground max-w-xs">
                        Use "Catálogo do curador" pra puxar links já cadastrados, ou cole dados do Spotify for Artists.
                      </div>
                    </div>
                  ) : filteredPlaylists.length === 0 ? (
                    <div className="text-center text-xs text-muted-foreground py-8">
                      Nenhum resultado pra esse filtro.
                    </div>
                  ) : (
                    <ul className="space-y-0.5 -mx-2">
                      {filteredPlaylists.map((p) => (
                        <PlaylistRow key={p.id} p={p} />
                      ))}
                    </ul>
                  )}
                </TabsContent>

                {/* === HISTÓRICO === */}
                <TabsContent value="historico" className="m-0 px-6 py-5 space-y-2">
                  {reversedLogs.length === 0 ? (
                    <div className="rounded-xl border border-white/[0.04] bg-[hsl(var(--elevated))]/40 py-10 flex flex-col items-center text-center gap-2">
                      <div className="h-10 w-10 rounded-full bg-[hsl(var(--elevated))] border border-white/[0.04] flex items-center justify-center">
                        <ImageOff className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div className="text-sm font-medium text-foreground">Nenhum registro ainda</div>
                      <div className="text-xs text-muted-foreground">
                        Envie o primeiro print para começar
                      </div>
                    </div>
                  ) : (
                    reversedLogs.map((log, idx) => {
                      const prev = reversedLogs[idx + 1];
                      const isFirst = !prev;
                      const delta = prev
                        ? Number(log.total_plays) - Number(prev.total_plays)
                        : 0;
                      const positive = delta >= 0;
                      const logSong = getSongForLog(log);
                      const cover = logSong?.song_cover_url ?? deal.song_cover_url ?? null;
                      const songName = logSong?.song_name ?? deal.song_name ?? "Música";
                      const isExpanded = selectedLogId === log.id;

                      // playlists vinculadas a este registro (mesma lógica que estava no popup)
                      const linked = allPlaylists
                        .filter((p) => {
                          if (p.deal_id !== log.deal_id) return false;
                          if (log.song_id && (p as any).song_id) {
                            return (p as any).song_id === log.song_id;
                          }
                          if (log.is_baseline) return p.is_baseline === true;
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
                            "rounded-xl border transition-colors overflow-hidden",
                            isExpanded
                              ? "border-white/[0.10] bg-[hsl(var(--elevated))]"
                              : "border-white/[0.04] bg-[hsl(var(--elevated))]/30 hover:bg-[hsl(var(--elevated))] hover:border-white/[0.08]",
                          )}
                        >
                          <button
                            type="button"
                            onClick={() =>
                              setSelectedLogId(isExpanded ? null : log.id)
                            }
                            className="w-full text-left px-3 py-2.5 flex items-center gap-3"
                          >
                            {cover ? (
                              <img
                                src={cover}
                                alt=""
                                className="h-11 w-11 rounded-lg object-cover shrink-0 ring-1 ring-white/[0.06]"
                              />
                            ) : (
                              <div className="h-11 w-11 rounded-lg bg-muted/40 flex items-center justify-center shrink-0">
                                <Music2 className="h-4 w-4 text-muted-foreground" />
                              </div>
                            )}

                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span className="text-[13px] font-semibold leading-tight line-clamp-1">
                                  {songName}
                                </span>
                                {log.is_baseline && (
                                  <Badge
                                    variant="secondary"
                                    className="text-[9px] h-4 px-1.5 shrink-0"
                                  >
                                    Baseline
                                  </Badge>
                                )}
                              </div>
                              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mt-0.5">
                                <span>
                                  {format(new Date(log.created_at), "dd MMM, HH:mm", { locale: ptBR })}
                                </span>
                                {linked.length > 0 && (
                                  <>
                                    <span>·</span>
                                    <span>
                                      {linked.length} playlist
                                      {linked.length > 1 ? "s" : ""}
                                    </span>
                                  </>
                                )}
                                {log.print_urls && log.print_urls.length > 0 && (
                                  <>
                                    <span>·</span>
                                    <span>
                                      {log.print_urls.length} print
                                      {log.print_urls.length > 1 ? "s" : ""}
                                    </span>
                                  </>
                                )}
                              </div>
                            </div>

                            <div className="text-right shrink-0">
                              <div className="text-[15px] font-bold tabular-nums leading-tight">
                                {Number(log.total_plays).toLocaleString("pt-BR")}
                              </div>
                              {!isFirst && !log.is_baseline ? (
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
                                isExpanded && "rotate-90",
                              )}
                            />
                          </button>

                          {/* CORPO EXPANDIDO INLINE — sem popup */}
                          {isExpanded && (
                            <div className="border-t border-white/[0.06] px-3 py-3 space-y-3 bg-background/30">
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
                                  {log.is_baseline ? "Playlists iniciais" : "Playlists do registro"}{" "}
                                  ({linked.length})
                                </div>
                                {linked.length === 0 ? (
                                  <div className="text-xs text-muted-foreground py-2">
                                    Nenhuma playlist vinculada a este registro.
                                  </div>
                                ) : (
                                  <ul className="space-y-0.5 -mx-1">
                                    {linked.map((p) => (
                                      <PlaylistRow key={p.id} p={p} />
                                    ))}
                                  </ul>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </TabsContent>
              </div>
            </Tabs>
          </>
        )}
      </SheetContent>

      <PastePlaylistsDialog
        open={pasteOpen}
        deal={deal}
        onClose={() => setPasteOpen(false)}
        onImported={() => onReload?.()}
      />
      <ImportFromLibraryDialog
        open={importOpen}
        deal={deal}
        existingPlaylists={allPlaylists}
        onClose={() => setImportOpen(false)}
        onImported={() => onReload?.()}
      />
    </Sheet>
  );
}
