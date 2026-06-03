// Painel: Distribuições Manuais Pendentes.
// Lista itens em manual_distribution_queue (MANUAL_PENDING / AUTO_FAILED_FALLBACK_MANUAL)
// e permite ao admin marcar como distribuído (posição + observação opcionais).
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Loader2, CheckCircle2, RefreshCw } from "lucide-react";

type Item = {
  id: string;
  campaign_id: string | null;
  playlist_id: string | null;
  spotify_playlist_id: string | null;
  playlist_name: string | null;
  spotify_track_id: string | null;
  job_type: string | null;
  position: number | null;
  motivo: string;
  status: string;
  created_at: string;
};

const reasonLabel: Record<string, string> = {
  spotify_401: "Spotify 401 (token inválido)",
  spotify_403: "Spotify 403 (sem permissão)",
  spotify_429: "Spotify 429 (rate-limit)",
  no_account_connected: "Nenhuma conta conectada",
  owner_without_token: "Owner sem token",
  playlist_collaborative: "Playlist colaborativa",
};

export function ManualDistribuicoesPanel() {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, { position?: string; observacao?: string }>>({});

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("manual_distribution_queue")
      .select("id, campaign_id, playlist_id, spotify_playlist_id, playlist_name, spotify_track_id, job_type, position, motivo, status, created_at")
      .in("status", ["MANUAL_PENDING", "AUTO_FAILED_FALLBACK_MANUAL"])
      .order("created_at", { ascending: false })
      .limit(200);
    setLoading(false);
    if (error) {
      toast.error("Falha ao carregar fila manual");
      return;
    }
    setItems((data ?? []) as Item[]);
  }

  useEffect(() => { load(); }, []);

  async function markDone(item: Item) {
    setBusy(item.id);
    const local = edits[item.id] ?? {};
    const positionNum = local.position && local.position.trim() ? Number(local.position) : null;
    const { error } = await supabase.functions.invoke("mark-manual-distribution-done", {
      body: { id: item.id, position: positionNum, observacao: local.observacao ?? null },
    });
    setBusy(null);
    if (error) {
      toast.error("Não foi possível marcar como distribuído");
      return;
    }
    toast.success("Distribuição marcada como concluída");
    setItems((prev) => prev.filter((x) => x.id !== item.id));
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-foreground">Distribuições manuais pendentes</h2>
          <p className="text-xs text-muted-foreground">Itens que caíram em modo manual por falha de Spotify (401/403/429), token ausente ou playlist colaborativa.</p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`h-3.5 w-3.5 mr-2 ${loading ? "animate-spin" : ""}`} /> Recarregar
        </Button>
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</div>
      ) : items.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">Nenhuma distribuição manual pendente.</CardContent></Card>
      ) : (
        <div className="grid gap-3">
          {items.map((it) => {
            const e = edits[it.id] ?? {};
            return (
              <Card key={it.id}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center justify-between gap-2">
                    <span className="truncate">{it.playlist_name ?? it.spotify_playlist_id ?? "Playlist desconhecida"}</span>
                    <Badge variant={it.status === "AUTO_FAILED_FALLBACK_MANUAL" ? "destructive" : "secondary"} className="shrink-0">
                      {it.status}
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs text-muted-foreground">
                    <div><span className="text-foreground/70">Campanha:</span> <span className="font-mono">{it.campaign_id ?? "—"}</span></div>
                    <div><span className="text-foreground/70">Faixa:</span> <span className="font-mono">{it.spotify_track_id ?? "—"}</span></div>
                    <div><span className="text-foreground/70">Tipo:</span> {it.job_type ?? "—"}</div>
                    <div><span className="text-foreground/70">Motivo:</span> {reasonLabel[it.motivo] ?? it.motivo}</div>
                    <div><span className="text-foreground/70">Posição planejada:</span> {it.position ?? "—"}</div>
                    <div><span className="text-foreground/70">Criado:</span> {new Date(it.created_at).toLocaleString()}</div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-[140px_1fr_auto] gap-2 items-start">
                    <Input
                      type="number"
                      placeholder="posição"
                      value={e.position ?? (it.position?.toString() ?? "")}
                      onChange={(ev) => setEdits((p) => ({ ...p, [it.id]: { ...p[it.id], position: ev.target.value } }))}
                    />
                    <Textarea
                      placeholder="observação (opcional)"
                      rows={1}
                      value={e.observacao ?? ""}
                      onChange={(ev) => setEdits((p) => ({ ...p, [it.id]: { ...p[it.id], observacao: ev.target.value } }))}
                    />
                    <Button size="sm" onClick={() => markDone(it)} disabled={busy === it.id}>
                      {busy === it.id ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" /> : <CheckCircle2 className="h-3.5 w-3.5 mr-2" />}
                      Marcar como distribuído
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
