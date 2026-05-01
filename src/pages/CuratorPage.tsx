import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import {
  Loader2,
  Target,
  Clock,
  Zap,
  TrendingUp,
  ListMusic,
  ExternalLink,
  Upload,
  Download,
} from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { NexEngineLogo } from "@/components/NexEngineLogo";
import { PrintThumbs } from "@/components/playlist-deals/PrintThumbs";

type Deal = {
  id: string;
  curator_name: string;
  song_spotify_url: string;
  song_name: string;
  song_artist: string | null;
  song_cover_url: string | null;
  target_plays: number | null;
  daily_goal: number | null;
  baseline_plays: number | null;
  cost: number | null;
  started_at: string | null;
  public_token: string;
  created_at: string;
};

type Playlist = {
  id: string;
  deal_id: string;
  spotify_url: string;
  playlist_name: string;
  followers: number | null;
  is_baseline: boolean;
  added_at: string;
};

type DealLog = {
  id: string;
  deal_id: string;
  total_plays: number;
  note: string | null;
  is_baseline: boolean;
  created_at: string;
  print_urls?: string[] | null;
};

function formatPlays(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return Math.round(n).toString();
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return "—";
  }
}

export default function CuratorPage() {
  const { token } = useParams<{ token: string }>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deal, setDeal] = useState<Deal | null>(null);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [logs, setLogs] = useState<DealLog[]>([]);
  const [url, setUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    if (!token) return;
    const { data, error: fnErr } = await supabase.functions.invoke(
      "get-curator-deal-public",
      { body: { public_token: token } },
    );
    if (fnErr || !data?.ok) {
      setError(data?.error || fnErr?.message || "not found");
      setDeal(null);
      setPlaylists([]);
      setLogs([]);
    } else {
      setDeal(data.deal as Deal);
      setPlaylists((data.playlists ?? []) as Playlist[]);
      setLogs((data.logs ?? []) as DealLog[]);
      setError(null);
    }
    setLoading(false);
  };

  useEffect(() => {
    setLoading(true);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const stats = useMemo(() => {
    if (!deal) {
      return {
        target: 0,
        dailyGoal: 0,
        baseline: 0,
        latest: 0,
        earned: 0,
        remaining: 0,
        pct: 0,
        todayPlays: 0,
        todayPct: 0,
        vel: null as number | null,
        eta: null as number | null,
        hasBaseline: false,
        daysRunning: 0,
      };
    }
    const target = Number(deal.target_plays ?? 0);
    const dailyGoal = Number(deal.daily_goal ?? 0);
    const baseline = Number(deal.baseline_plays ?? 0);
    const sorted = [...logs].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );
    const nonBase = sorted.filter((l) => !l.is_baseline);
    const hasBaseline = sorted.some((l) => l.is_baseline);
    const latest = nonBase.length > 0 ? Number(nonBase[nonBase.length - 1].total_plays) : baseline;
    const earned = nonBase.length > 0 ? Math.max(0, latest - baseline) : 0;
    const remaining = Math.max(0, target - earned);
    const pct = target > 0 ? Math.min(100, Math.round((earned / target) * 100)) : 0;

    let todayPlays = 0;
    if (nonBase.length > 0) {
      const todayKey = new Date().toISOString().slice(0, 10);
      const lastBefore = [...sorted]
        .reverse()
        .find((l) => l.created_at.slice(0, 10) !== todayKey);
      const lastBeforeVal = lastBefore ? Number(lastBefore.total_plays) : baseline;
      todayPlays = Math.max(0, latest - lastBeforeVal);
    }
    const todayPct =
      dailyGoal > 0 ? Math.min(100, Math.round((todayPlays / dailyGoal) * 100)) : 0;

    let vel: number | null = null;
    if (nonBase.length >= 2) {
      const first = nonBase[0];
      const last = nonBase[nonBase.length - 1];
      const days =
        (new Date(last.created_at).getTime() - new Date(first.created_at).getTime()) /
        (1000 * 60 * 60 * 24);
      const delta = Number(last.total_plays) - Number(first.total_plays);
      if (days > 0 && delta > 0) vel = delta / days;
    }

    let eta: number | null = null;
    if (target > 0 && earned >= target) eta = 0;
    else if (vel && vel > 0) eta = Math.ceil(remaining / vel);

    const startRef = deal.started_at ?? deal.created_at;
    const daysRunning = startRef
      ? Math.max(
          0,
          Math.floor((Date.now() - new Date(startRef).getTime()) / (1000 * 60 * 60 * 24)),
        )
      : 0;

    return { target, dailyGoal, baseline, latest, earned, remaining, pct, todayPlays, todayPct, vel, eta, hasBaseline, daysRunning };
  }, [deal, logs]);

  const handleAdd = async () => {
    if (!token || !url.trim()) return;
    setSubmitting(true);
    const { data, error: fnErr } = await supabase.functions.invoke(
      "add-curator-playlist",
      { body: { public_token: token, spotify_url: url.trim() } },
    );
    setSubmitting(false);
    if (fnErr || !data?.ok) {
      toast.error(data?.error || fnErr?.message || "Erro ao adicionar playlist");
      return;
    }
    toast.success("Playlist adicionada");
    setUrl("");
    await load();
  };

  const handleDownloadTemplate = () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ["URL da playlist"],
      ["https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M"],
      ["https://open.spotify.com/playlist/37i9dQZF1DX0XUsuxWHRQd"],
    ]);
    ws["!cols"] = [{ wch: 70 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Playlists");
    XLSX.writeFile(wb, "playlists-template.xlsx");
  };

  const extractUrlsFromSheet = (file: File): Promise<string[]> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target?.result as ArrayBuffer);
          const wb = XLSX.read(data, { type: "array" });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, {
            header: 1,
            blankrows: false,
          });
          const urls: string[] = [];
          for (const row of rows) {
            for (const cell of row as unknown[]) {
              if (typeof cell === "string" && cell.includes("spotify.com")) {
                urls.push(cell.trim());
              }
            }
          }
          resolve(urls);
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(file);
    });

  const handleImportFile = async (file: File) => {
    if (!token) return;
    setImporting(true);
    try {
      const urls = await extractUrlsFromSheet(file);
      if (urls.length === 0) {
        toast.error("Nenhuma URL do Spotify encontrada na planilha");
        return;
      }
      if (urls.length > 200) {
        toast.error("Máximo de 200 playlists por importação");
        return;
      }
      const { data, error: fnErr } = await supabase.functions.invoke(
        "add-curator-playlists-batch",
        { body: { public_token: token, urls } },
      );
      if (fnErr || !data?.ok) {
        toast.error(data?.error || fnErr?.message || "Erro ao importar");
        return;
      }
      const parts: string[] = [`${data.added} adicionadas`];
      if (data.skipped_duplicate) parts.push(`${data.skipped_duplicate} já existiam`);
      if (data.skipped_invalid) parts.push(`${data.skipped_invalid} inválidas`);
      toast.success("Importação concluída", { description: parts.join(" · ") });
      await load();
    } catch (err) {
      toast.error("Não foi possível ler o arquivo");
      console.error(err);
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !deal) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <Card className="max-w-md w-full">
          <CardContent className="p-6 text-center">
            <p className="text-base font-medium">Link inválido ou expirado</p>
            <p className="text-sm text-muted-foreground mt-2">
              Verifique o link com quem o enviou.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const isDone = stats.target > 0 && stats.earned >= stats.target;

  return (
    <div className="min-h-screen bg-black px-4 sm:px-6 py-8 sm:py-12">
      <div className="max-w-xl mx-auto space-y-6">
        {/* Logo NexEngine */}
        <div className="flex justify-center pb-2">
          <NexEngineLogo variant="dark" size={28} />
        </div>

        {/* Header — música + curador */}
        <Card className="bg-card border-white/[0.08] ring-1 ring-white/[0.04] shadow-[0_4px_20px_rgba(0,0,0,0.5)]">
          <CardContent className="p-5">
            <div className="flex items-center gap-3">
              {deal.song_cover_url ? (
                <img
                  src={deal.song_cover_url}
                  alt={deal.song_name}
                  className="w-14 h-14 rounded-md object-cover shrink-0"
                />
              ) : (
                <div className="w-14 h-14 rounded-md bg-muted shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <h1 className="text-base font-semibold truncate leading-tight">
                  {deal.song_name}
                </h1>
                {deal.song_artist && (
                  <p className="text-muted-foreground truncate text-xs mt-0.5">
                    {deal.song_artist}
                  </p>
                )}
                <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
                    {deal.curator_name}
                  </Badge>
                  <Badge
                    className={
                      "text-[10px] px-1.5 py-0 h-4 border-0 " +
                      (isDone
                        ? "bg-primary text-black hover:bg-primary/90 font-semibold"
                        : !stats.hasBaseline
                        ? "bg-warning/15 text-warning hover:bg-warning/15"
                        : "bg-primary/15 text-primary hover:bg-primary/15")
                    }
                  >
                    {isDone
                      ? "Concluído"
                      : !stats.hasBaseline
                      ? "Aguardando"
                      : "Em progresso"}
                  </Badge>
                </div>
              </div>
            </div>
            <a
              href={deal.song_spotify_url}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
            >
              <ExternalLink className="h-2.5 w-2.5" />
              Abrir no Spotify
            </a>
          </CardContent>
        </Card>

        {/* Plays hoje vs combinado diário */}
        {stats.hasBaseline && (
          <Card className="bg-card border-white/[0.08] ring-1 ring-white/[0.04] shadow-[0_4px_20px_rgba(0,0,0,0.5)]">
            <CardContent className="p-5 grid grid-cols-2 gap-4">
              <div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                  Plays totais hoje
                </div>
                <div className="text-2xl font-semibold tabular-nums text-foreground">
                  {formatPlays(stats.latest)}
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                  Hoje / combinado
                </div>
                <div className="text-2xl font-semibold tabular-nums">
                  <span className="text-primary">{formatPlays(stats.todayPlays)}</span>
                  <span className="text-muted-foreground text-base"> / {formatPlays(stats.dailyGoal)}</span>
                </div>
                {stats.dailyGoal > 0 && (
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    {stats.todayPct}% do combinado do dia
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Progresso da campanha */}
        <Card className="bg-card border-white/[0.08] ring-1 ring-white/[0.04] shadow-[0_4px_20px_rgba(0,0,0,0.5)]">
          <CardContent className="p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Combinado total</h2>
              <span className="text-lg font-semibold tabular-nums">{stats.pct}%</span>
            </div>

            <div className="space-y-1.5">
              <Progress value={stats.pct} className="h-2" />
              <div className="flex items-center justify-between text-xs tabular-nums">
                <span className="text-foreground font-medium">
                  {formatPlays(stats.earned)} plays
                </span>
                <span className="text-muted-foreground">
                  combinado: {formatPlays(stats.target)}
                </span>
              </div>
            </div>

            <Separator />

            {/* Grid de KPIs */}
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-md bg-muted/30 ring-1 ring-white/[0.04] p-2.5">
                <div className="flex items-center gap-1 text-[10px] text-muted-foreground mb-0.5 uppercase tracking-wide">
                  <Target className="h-2.5 w-2.5" />
                  Faltam
                </div>
                <div className="text-sm font-semibold tabular-nums">
                  {formatPlays(stats.remaining)}
                </div>
              </div>

              <div className="rounded-md bg-muted/30 ring-1 ring-white/[0.04] p-2.5">
                <div className="flex items-center gap-1 text-[10px] text-muted-foreground mb-0.5 uppercase tracking-wide">
                  <Clock className="h-2.5 w-2.5" />
                  Decorrido
                </div>
                <div className="text-sm font-semibold tabular-nums">
                  {stats.daysRunning} {stats.daysRunning === 1 ? "dia" : "dias"}
                </div>
              </div>

              <div className="rounded-md bg-muted/30 ring-1 ring-white/[0.04] p-2.5">
                <div className="flex items-center gap-1 text-[10px] text-muted-foreground mb-0.5 uppercase tracking-wide">
                  <Zap className="h-2.5 w-2.5 text-primary" />
                  Velocidade
                </div>
                <div className="text-sm font-semibold tabular-nums">
                  {stats.vel !== null ? `${formatPlays(stats.vel)}/dia` : "—"}
                </div>
              </div>

              <div className="rounded-md bg-muted/30 ring-1 ring-white/[0.04] p-2.5">
                <div className="flex items-center gap-1 text-[10px] text-muted-foreground mb-0.5 uppercase tracking-wide">
                  <TrendingUp className="h-2.5 w-2.5" />
                  ETA
                </div>
                <div className="text-sm font-semibold tabular-nums">
                  {stats.eta === null
                    ? "—"
                    : stats.eta === 0
                    ? "✓"
                    : `~${stats.eta}d`}
                </div>
              </div>
            </div>

            <Separator />

            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <div>
                <div className="text-muted-foreground">Início</div>
                <div className="text-foreground font-medium mt-0.5">
                  {formatDate(deal.started_at ?? deal.created_at)}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground">Plays iniciais</div>
                <div className="text-foreground font-medium tabular-nums mt-0.5">
                  {formatPlays(stats.baseline)}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Suas playlists */}
        <Card className="bg-card border-white/[0.08] ring-1 ring-white/[0.04] shadow-[0_4px_20px_rgba(0,0,0,0.5)]">
          <CardContent className="p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold inline-flex items-center gap-1.5">
                <ListMusic className="h-3.5 w-3.5" />
                Suas playlists
              </h2>
              <span className="text-[10px] text-muted-foreground">
                {playlists.length} {playlists.length === 1 ? "playlist" : "playlists"}
              </span>
            </div>

            {playlists.length === 0 ? (
              <p className="text-xs text-muted-foreground py-3 text-center">
                Nenhuma playlist adicionada ainda
              </p>
            ) : (
              <ul className="space-y-1.5 max-h-[280px] overflow-y-auto pr-1 -mr-1 scroll-smooth">
                {playlists.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center justify-between gap-2 rounded-md bg-muted/30 ring-1 ring-white/[0.04] px-2.5 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <a
                        href={p.spotify_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs font-medium truncate hover:underline block"
                      >
                        {p.playlist_name}
                      </a>
                      {p.followers !== null && (
                        <div className="text-[10px] text-muted-foreground mt-0.5 tabular-nums">
                          {formatPlays(p.followers)} seguidores
                        </div>
                      )}
                    </div>
                    {p.is_baseline ? (
                      <Badge variant="secondary" className="shrink-0 text-[10px] px-1.5 py-0 h-4">
                        Inicial
                      </Badge>
                    ) : (
                      <Badge className="bg-primary text-black hover:bg-primary/90 shrink-0 text-[10px] px-1.5 py-0 h-4 border-0 font-semibold">
                        Nova
                      </Badge>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Adicionar playlist */}
        <Card className="bg-card border-white/[0.08] ring-1 ring-white/[0.04] shadow-[0_4px_20px_rgba(0,0,0,0.5)]">
          <CardContent className="p-5 space-y-3">
            <div>
              <h2 className="text-sm font-semibold">Adicionar playlist</h2>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Cole o link ou importe um lote em planilha
              </p>
            </div>
            <Input
              placeholder="https://open.spotify.com/playlist/..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={submitting || importing}
              className="h-9 text-sm"
            />
            <Button
              onClick={handleAdd}
              disabled={submitting || importing || !url.trim()}
              className="w-full h-9"
              size="sm"
            >
              {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" />}
              Adicionar
            </Button>

            <div className="flex items-center gap-2 pt-1">
              <div className="flex-1 h-px bg-border" />
              <span className="text-[10px] text-muted-foreground uppercase tracking-wide">
                ou em lote
              </span>
              <div className="flex-1 h-px bg-border" />
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleImportFile(f);
              }}
            />
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9"
                onClick={() => fileInputRef.current?.click()}
                disabled={submitting || importing}
              >
                {importing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                ) : (
                  <Upload className="h-3.5 w-3.5 mr-1.5" />
                )}
                Importar planilha
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-9"
                onClick={handleDownloadTemplate}
                disabled={importing}
              >
                <Download className="h-3.5 w-3.5 mr-1.5" />
                Baixar modelo
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground text-center">
              Aceita .xlsx, .xls ou .csv · até 200 playlists
            </p>
          </CardContent>
        </Card>


        {/* Histórico de prints */}
        {logs.length > 0 && (
          <Card className="bg-card border-white/[0.08] ring-1 ring-white/[0.04] shadow-[0_4px_20px_rgba(0,0,0,0.5)]">
            <CardContent className="p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold">Histórico</h2>
                <span className="text-[10px] text-muted-foreground">
                  {logs.length} {logs.length === 1 ? "registro" : "registros"}
                </span>
              </div>
              <ul className="space-y-2.5 max-h-[420px] overflow-y-auto pr-1 -mr-1 scroll-smooth">
                {[...logs].reverse().map((log) => (
                  <li
                    key={log.id}
                    className="rounded-md bg-muted/30 ring-1 ring-white/[0.04] p-2.5 space-y-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-xs font-semibold tabular-nums">
                          {Number(log.total_plays).toLocaleString("pt-BR")} plays
                        </span>
                        {log.is_baseline && (
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
                            Inicial
                          </Badge>
                        )}
                      </div>
                      <span className="text-[10px] text-muted-foreground shrink-0">
                        {formatDate(log.created_at)}
                      </span>
                    </div>
                    {log.note && (
                      <div className="text-[11px] text-muted-foreground">{log.note}</div>
                    )}
                    {log.print_urls && log.print_urls.length > 0 && (
                      <PrintThumbs urls={log.print_urls} size="sm" />
                    )}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        {/* Footer minimalista */}
        <div className="text-center pt-2 pb-4">
          <p className="text-[10px] text-muted-foreground">
            Powered by NexEngine
          </p>
        </div>
      </div>
    </div>
  );
}
