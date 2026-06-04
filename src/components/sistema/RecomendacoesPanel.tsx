// Wave 2/3 — Painel de Recomendações (Curadoria assistida)
// Wave 3 adicionou: Abrir Spotify · Criar deal · Pedir remoção
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription,
} from "@/components/ui/drawer";
import { ArrowRight, Check, EyeOff, RefreshCw, RotateCw, Search, FileSearch, ExternalLink, Plus, Mail } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { PedirRemocaoDialog } from "./PedirRemocaoDialog";

type FitRow = {
  id: string;
  spotify_track_id: string;
  spotify_playlist_id: string;
  playlist_kind: string;
  fit_score: number;
  fit_reason: string[] | null;
  recommendation_kind: "adicionar" | "remover" | "manter";
  evidence: any;
  already_present: boolean;
  confidence: number;
  calculated_at: string;
};

type FeedbackAction = "visto" | "descartado" | "converted_to_deal" | "removal_requested";

const KIND_COLORS: Record<string, string> = {
  adicionar: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  remover: "bg-rose-500/15 text-rose-400 border-rose-500/30",
  manter: "bg-zinc-500/15 text-zinc-300 border-zinc-500/30",
};

const KIND_FILTERS = ["todos", "adicionar", "remover", "manter"] as const;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
function fmtNum(n: number | null | undefined): string {
  if (n == null) return "—";
  return Math.round(n).toLocaleString("pt-BR");
}
function fmtPct(n: number | null | undefined): string {
  if (n == null) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${Number(n).toFixed(1)}%`;
}

export function RecomendacoesPanel() {
  const [rows, setRows] = useState<FitRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [kindFilter, setKindFilter] = useState<typeof KIND_FILTERS[number]>("todos");
  const [search, setSearch] = useState("");
  const [minFit, setMinFit] = useState(50);
  const [minConf, setMinConf] = useState(0);
  const [recalcAll, setRecalcAll] = useState(false);
  const [feedbackMap, setFeedbackMap] = useState<Record<string, FeedbackAction>>({});
  const [evidenceRow, setEvidenceRow] = useState<FitRow | null>(null);
  const [removalRow, setRemovalRow] = useState<FitRow | null>(null);
  const navigate = useNavigate();
  const { toast } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: fits, error: fitsErr }, { data: { user } }] = await Promise.all([
      supabase
        .from("track_playlist_fit")
        .select("*")
        .order("fit_score", { ascending: false })
        .limit(2000),
      supabase.auth.getUser(),
    ]);
    if (fitsErr) toast({ title: "Erro ao carregar", description: fitsErr.message, variant: "destructive" });
    setRows((fits ?? []) as FitRow[]);

    if (user) {
      const { data: fb } = await supabase
        .from("recommendation_feedback")
        .select("fit_id, action")
        .eq("user_id", user.id);
      const map: Record<string, FeedbackAction> = {};
      for (const r of (fb ?? []) as any[]) map[r.fit_id] = r.action as FeedbackAction;
      setFeedbackMap(map);
    }
    setLoading(false);
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (kindFilter !== "todos" && r.recommendation_kind !== kindFilter) return false;
      if (r.fit_score < minFit) return false;
      if (r.confidence < minConf) return false;
      if (s) {
        const ev = r.evidence ?? {};
        const hit =
          (ev?.track?.name ?? "").toLowerCase().includes(s) ||
          (ev?.track?.artist ?? "").toLowerCase().includes(s) ||
          (ev?.playlist?.name ?? "").toLowerCase().includes(s) ||
          (ev?.playlist?.curator ?? "").toLowerCase().includes(s);
        if (!hit) return false;
      }
      return true;
    });
  }, [rows, kindFilter, search, minFit, minConf]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of rows) c[r.recommendation_kind] = (c[r.recommendation_kind] ?? 0) + 1;
    return c;
  }, [rows]);

  const handleRecalcAll = async () => {
    if (!confirm("Recalcular todos os fits? Pode levar alguns minutos (processa em lotes).")) return;
    setRecalcAll(true);
    let offset = 0;
    const limit = 25;
    let totalOk = 0, totalWritten = 0, grandTotal = 0;
    try {
      while (true) {
        const { data, error } = await supabase.functions.invoke("calculate-track-playlist-fit", {
          body: { mode: "batch", offset, limit },
        });
        if (error) throw error;
        totalOk += data?.ok ?? 0;
        totalWritten += data?.written ?? 0;
        grandTotal = data?.total ?? grandTotal;
        toast({
          title: `Massa ${offset}–${data?.processed_to ?? offset}`,
          description: `${totalOk}/${grandTotal} faixas · ${totalWritten} sugestões`,
        });
        if (!data?.has_more) break;
        offset = data.processed_to;
      }
      toast({ title: "Recálculo completo", description: `${totalOk} faixas · ${totalWritten} sugestões` });
      await load();
    } catch (e: unknown) {
      toast({ title: "Erro no lote", description: errorMessage(e), variant: "destructive" });
    } finally {
      setRecalcAll(false);
    }
  };

  const handleFeedback = async (r: FitRow, action: FeedbackAction, extra?: { deal_id?: string }) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      toast({ title: "Faça login", variant: "destructive" });
      return;
    }
    const payload: any = { user_id: user.id, fit_id: r.id, action };
    if (extra?.deal_id) payload.deal_id = extra.deal_id;
    const { error } = await supabase
      .from("recommendation_feedback")
      .upsert(payload, { onConflict: "user_id,fit_id" });
    if (error) {
      await supabase.from("recommendation_feedback").insert(payload);
    }
    setFeedbackMap((m) => ({ ...m, [r.id]: action }));
    const labels: Record<FeedbackAction, string> = {
      visto: "Marcada como vista",
      descartado: "Sugestão descartada",
      converted_to_deal: "Sugestão enviada pro fluxo de deal",
      removal_requested: "Remoção marcada como pedida",
    };
    toast({ title: labels[action] ?? "Feedback registrado" });
  };

  const handleCreateDeal = async (r: FitRow) => {
    await handleFeedback(r, "converted_to_deal");
    const playlistUrl = r.evidence?.playlist?.spotify_url ?? `https://open.spotify.com/playlist/${r.spotify_playlist_id}`;
    const trackUrl = r.evidence?.track?.spotify_url ?? `https://open.spotify.com/track/${r.spotify_track_id}`;
    const params = new URLSearchParams({
      new: "1",
      from_fit: r.id,
      prefill_song_url: trackUrl,
      prefill_playlist_url: playlistUrl,
    });
    navigate(`/playlist-deals?${params.toString()}`);
  };

  const openSpotify = (r: FitRow) => {
    const url = r.evidence?.playlist?.spotify_url ?? `https://open.spotify.com/playlist/${r.spotify_playlist_id}`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="space-y-4 pt-4">
      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <div className="text-sm text-muted-foreground">Sugestões geradas</div>
            <div className="text-2xl font-semibold">{rows.length.toLocaleString("pt-BR")}</div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              <RefreshCw className={cn("h-3.5 w-3.5 mr-2", loading && "animate-spin")} />
              Atualizar
            </Button>
            <Button size="sm" onClick={handleRecalcAll} disabled={recalcAll}>
              <RotateCw className={cn("h-3.5 w-3.5 mr-2", recalcAll && "animate-spin")} />
              {recalcAll ? "Recalculando…" : "Recalcular tudo"}
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Buscar por faixa, artista, playlist ou curador…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-9"
            />
          </div>
          <div className="flex flex-wrap gap-1">
            {KIND_FILTERS.map((f) => (
              <button
                key={f}
                onClick={() => setKindFilter(f)}
                className={cn(
                  "px-2.5 h-7 text-xs rounded-md border transition-colors",
                  kindFilter === f
                    ? "bg-primary/15 text-primary border-primary/40"
                    : "bg-transparent text-muted-foreground border-border hover:text-foreground",
                )}
              >
                {f} {f !== "todos" && counts[f] ? `(${counts[f]})` : ""}
              </button>
            ))}
          </div>
          <label className="text-xs text-muted-foreground flex items-center gap-2">
            Fit mín.
            <input
              type="range" min={0} max={100} step={5}
              value={minFit} onChange={(e) => setMinFit(Number(e.target.value))}
              className="w-24"
            />
            <span className="font-medium tabular-nums text-foreground w-7">{minFit}</span>
          </label>
          <label className="text-xs text-muted-foreground flex items-center gap-2">
            Conf. mín.
            <input
              type="range" min={0} max={1} step={0.05}
              value={minConf} onChange={(e) => setMinConf(Number(e.target.value))}
              className="w-24"
            />
            <span className="font-medium tabular-nums text-foreground w-9">{minConf.toFixed(2)}</span>
          </label>
        </div>
      </Card>

      {loading && rows.length === 0 && (
        <Card className="p-8 text-center text-sm text-muted-foreground">Carregando…</Card>
      )}

      {!loading && filtered.length === 0 && (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          Nenhuma sugestão com esses filtros. Tente baixar o fit mínimo ou clicar em “Recalcular tudo”.
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {filtered.map((r) => {
          const ev = r.evidence ?? {};
          const fb = feedbackMap[r.id];
          const dimmed = fb === "descartado";
          return (
            <Card
              key={r.id}
              className={cn(
                "p-4 transition-opacity",
                dimmed && "opacity-50",
              )}
            >
              <div className="flex items-start gap-3">
                <div
                  className={cn(
                    "shrink-0 w-14 h-14 rounded-lg flex flex-col items-center justify-center border tabular-nums",
                    KIND_COLORS[r.recommendation_kind] ?? "bg-zinc-700/30 text-zinc-400 border-zinc-700/40",
                  )}
                  title={`Fit ${r.fit_score}/100`}
                >
                  <div className="text-lg font-bold leading-none">{r.fit_score}</div>
                  <div className="text-[9px] uppercase tracking-wider mt-0.5 opacity-70">/100</div>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge
                      variant="outline"
                      className={cn("text-[10px] uppercase tracking-wider", KIND_COLORS[r.recommendation_kind])}
                    >
                      {r.recommendation_kind}
                    </Badge>
                    {r.already_present && (
                      <Badge variant="outline" className="text-[10px] uppercase tracking-wider bg-muted text-muted-foreground border-border">
                        já presente
                      </Badge>
                    )}
                    <span className="ml-auto text-[10px] text-muted-foreground tabular-nums">
                      conf {r.confidence?.toFixed?.(2) ?? "—"}
                    </span>
                  </div>

                  <div className="text-sm font-medium truncate">
                    {ev?.track?.name ?? r.spotify_track_id}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {ev?.track?.artist ?? "—"} · momentum <span className="text-foreground">{ev?.track?.momentum ?? "—"}</span>
                  </div>

                  <div className="flex items-center gap-2 my-2 text-xs text-muted-foreground">
                    <ArrowRight className="h-3 w-3" />
                    <div className="truncate">
                      <span className="text-foreground font-medium">{ev?.playlist?.name ?? r.spotify_playlist_id}</span>
                      {" · "}{ev?.playlist?.curator ?? "—"}
                      {" · saúde "}<span className="text-foreground">{ev?.playlist?.health ?? "—"}</span>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-1 mt-2">
                    {(r.fit_reason ?? []).map((tag) => (
                      <span
                        key={tag}
                        className="px-1.5 py-0.5 text-[10px] rounded bg-muted/60 text-muted-foreground border border-border"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>

                  <div className="flex flex-wrap items-center gap-2 mt-3">
                    <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setEvidenceRow(r)}>
                      <FileSearch className="h-3 w-3 mr-1.5" /> Evidência
                    </Button>
                    <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => openSpotify(r)}>
                      <ExternalLink className="h-3 w-3 mr-1.5" /> Spotify
                    </Button>
                    {r.recommendation_kind === "adicionar" && (
                      <Button
                        variant="default" size="sm" className="h-7 text-xs"
                        onClick={() => handleCreateDeal(r)}
                        disabled={fb === "converted_to_deal"}
                      >
                        <Plus className="h-3 w-3 mr-1.5" />
                        {fb === "converted_to_deal" ? "Deal criado" : "Criar deal"}
                      </Button>
                    )}
                    {r.recommendation_kind === "remover" && (
                      <Button
                        variant="default" size="sm" className="h-7 text-xs"
                        onClick={() => setRemovalRow(r)}
                        disabled={fb === "removal_requested"}
                      >
                        <Mail className="h-3 w-3 mr-1.5" />
                        {fb === "removal_requested" ? "Pedido enviado" : "Pedir remoção"}
                      </Button>
                    )}
                    <Button
                      variant="ghost" size="sm" className="h-7 text-xs"
                      onClick={() => handleFeedback(r, "visto")}
                      disabled={fb === "visto"}
                    >
                      <Check className="h-3 w-3 mr-1.5" /> {fb === "visto" ? "Vista" : "Vista"}
                    </Button>
                    <Button
                      variant="ghost" size="sm" className="h-7 text-xs ml-auto"
                      onClick={() => handleFeedback(r, "descartado")}
                      disabled={fb === "descartado"}
                    >
                      <EyeOff className="h-3 w-3 mr-1.5" /> Descartar
                    </Button>
                  </div>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      <Drawer open={!!evidenceRow} onOpenChange={(o) => !o && setEvidenceRow(null)}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>Evidência da sugestão</DrawerTitle>
            <DrawerDescription>Números crus que justificaram este fit. Tudo determinístico — nenhuma execução automática.</DrawerDescription>
          </DrawerHeader>
          {evidenceRow && (
            <div className="px-4 pb-6 grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card className="p-4">
                <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Faixa</div>
                <div className="font-medium">{evidenceRow.evidence?.track?.name ?? "—"}</div>
                <div className="text-xs text-muted-foreground mb-3">{evidenceRow.evidence?.track?.artist ?? "—"}</div>
                <dl className="text-sm space-y-1">
                  <div className="flex justify-between"><dt className="text-muted-foreground">momentum</dt><dd>{evidenceRow.evidence?.track?.momentum ?? "—"}</dd></div>
                  <div className="flex justify-between"><dt className="text-muted-foreground">streams 7d</dt><dd className="tabular-nums">{fmtNum(evidenceRow.evidence?.track?.streams_7d)}</dd></div>
                  <div className="flex justify-between"><dt className="text-muted-foreground">streams 28d</dt><dd className="tabular-nums">{fmtNum(evidenceRow.evidence?.track?.streams_28d)}</dd></div>
                  <div className="flex justify-between"><dt className="text-muted-foreground">growth 28d</dt><dd className="tabular-nums">{fmtPct(evidenceRow.evidence?.track?.growth_28d_pct)}</dd></div>
                  <div className="flex justify-between"><dt className="text-muted-foreground">confiança</dt><dd className="tabular-nums">{(evidenceRow.evidence?.track?.confidence ?? 0).toFixed(2)}</dd></div>
                </dl>
              </Card>
              <Card className="p-4">
                <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Playlist</div>
                <div className="font-medium">{evidenceRow.evidence?.playlist?.name ?? "—"}</div>
                <div className="text-xs text-muted-foreground mb-3">{evidenceRow.evidence?.playlist?.curator ?? "—"}</div>
                <dl className="text-sm space-y-1">
                  <div className="flex justify-between"><dt className="text-muted-foreground">saúde</dt><dd>{evidenceRow.evidence?.playlist?.health ?? "—"}</dd></div>
                  <div className="flex justify-between"><dt className="text-muted-foreground">followers</dt><dd className="tabular-nums">{fmtNum(evidenceRow.evidence?.playlist?.followers)}</dd></div>
                  <div className="flex justify-between"><dt className="text-muted-foreground">streams 28d</dt><dd className="tabular-nums">{fmtNum(evidenceRow.evidence?.playlist?.streams_28d)}</dd></div>
                  <div className="flex justify-between"><dt className="text-muted-foreground">confiança</dt><dd className="tabular-nums">{(evidenceRow.evidence?.playlist?.confidence ?? 0).toFixed(2)}</dd></div>
                </dl>
                {Array.isArray(evidenceRow.evidence?.shared_genres) && evidenceRow.evidence.shared_genres.length > 0 && (
                  <div className="mt-3 text-xs text-muted-foreground">
                    Gêneros em comum: <span className="text-foreground">{evidenceRow.evidence.shared_genres.length}</span>
                  </div>
                )}
              </Card>
              <Card className="p-4 md:col-span-2">
                <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Razões do fit</div>
                <div className="flex flex-wrap gap-1.5">
                  {(evidenceRow.fit_reason ?? []).map((tag) => (
                    <span key={tag} className="px-2 py-1 text-xs rounded bg-muted/60 text-muted-foreground border border-border">{tag}</span>
                  ))}
                </div>
              </Card>
            </div>
          )}
        </DrawerContent>
      </Drawer>

      <PedirRemocaoDialog
        open={!!removalRow}
        onOpenChange={(v) => !v && setRemovalRow(null)}
        curatorName={removalRow?.evidence?.playlist?.curator ?? null}
        trackName={removalRow?.evidence?.track?.name ?? null}
        trackArtist={removalRow?.evidence?.track?.artist ?? null}
        playlistName={removalRow?.evidence?.playlist?.name ?? null}
        reason={(removalRow?.fit_reason ?? []).join(", ")}
        onConfirm={async () => { if (removalRow) await handleFeedback(removalRow, "removal_requested"); }}
      />
    </div>
  );
}
