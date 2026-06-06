// Distribuição manual da campanha atual.
// Mostra itens em manual_distribution_queue filtrados por campaign_id e
// permite o operador marcar como feito sem sair da página da campanha.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Loader2, CheckCircle2, RefreshCw, Hand, ExternalLink } from "lucide-react";

type Item = {
  id: string;
  spotify_playlist_id: string | null;
  playlist_name: string | null;
  spotify_track_id: string | null;
  job_type: string | null;
  planned_position: number | null;
  executed_position: number | null;
  motivo: string;
  status: string;
  created_at: string;
};

const reasonLabel: Record<string, string> = {
  spotify_401: "Token inválido",
  spotify_403: "Sem permissão",
  spotify_429: "Rate-limit",
  no_account_connected: "Sem conta conectada",
  owner_without_token: "Owner sem OAuth",
  playlist_collaborative: "Playlist colaborativa",
};

export function CampaignManualQueue({ campaignId, onChanged }: { campaignId: string; onChanged?: () => void }) {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [pos, setPos] = useState<Record<string, string>>({});

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("manual_distribution_queue")
      .select("id, spotify_playlist_id, playlist_name, spotify_track_id, job_type, planned_position, executed_position, motivo, status, created_at")
      .eq("campaign_id", campaignId)
      .in("status", ["MANUAL_PENDING", "AUTO_FAILED_FALLBACK_MANUAL"])
      .order("created_at", { ascending: false });
    setLoading(false);
    if (error) {
      toast.error("Falha ao carregar fila manual");
      return;
    }
    setItems((data ?? []) as Item[]);
  }

  useEffect(() => {
    load();
    const channel = supabase
      .channel(`manual-queue-${campaignId}-${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "manual_distribution_queue", filter: `campaign_id=eq.${campaignId}` },
        () => load(),
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId]);

  async function markDone(it: Item) {
    setBusy(it.id);
    const raw = pos[it.id]?.trim();
    const executed = raw ? Number(raw) : it.planned_position ?? null;
    const { error } = await supabase.functions.invoke("mark-manual-distribution-done", {
      body: { id: it.id, executed_position: executed, observacao: null },
    });
    setBusy(null);
    if (error) {
      toast.error("Não foi possível marcar como distribuído");
      return;
    }
    toast.success("Distribuição manual concluída");
    setItems((prev) => prev.filter((x) => x.id !== it.id));
    onChanged?.();
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="py-6 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando fila manual…
        </CardContent>
      </Card>
    );
  }

  if (items.length === 0) {
    return null; // some quando não há nada pra fazer manual
  }

  return (
    <Card className="border-amber-500/30">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Hand className="h-4 w-4 text-amber-400" />
            <h3 className="text-sm font-semibold text-foreground">Distribuição manual pendente</h3>
            <Badge variant="outline" className="border-amber-500/40 text-amber-400">{items.length}</Badge>
          </div>
          <Button variant="ghost" size="sm" onClick={load} className="h-7 px-2">
            <RefreshCw className="h-3 w-3 mr-1" /> Atualizar
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Playlists que o bot não consegue executar (sem token, colaborativa, rate-limit). Faça o ADD à mão no Spotify e marque aqui.
        </p>

        <div className="divide-y divide-border/40">
          {items.map((it) => {
            const trackUrl = it.spotify_track_id ? `https://open.spotify.com/track/${it.spotify_track_id}` : null;
            const plUrl = it.spotify_playlist_id ? `https://open.spotify.com/playlist/${it.spotify_playlist_id}` : null;
            return (
              <div key={it.id} className="flex items-center gap-3 py-2.5">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate flex items-center gap-1.5">
                    {plUrl ? (
                      <a href={plUrl} target="_blank" rel="noreferrer" className="hover:underline truncate">
                        {it.playlist_name ?? it.spotify_playlist_id}
                      </a>
                    ) : (
                      <span className="truncate">{it.playlist_name ?? "—"}</span>
                    )}
                    {plUrl && <ExternalLink className="h-3 w-3 text-muted-foreground/60 shrink-0" />}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-2 flex-wrap">
                    <span>Pos. planejada: <span className="text-foreground font-medium">{it.planned_position ?? "—"}</span></span>
                    <span>· {reasonLabel[it.motivo] ?? it.motivo}</span>
                    {trackUrl && (
                      <a href={trackUrl} target="_blank" rel="noreferrer" className="hover:underline text-primary/80 inline-flex items-center gap-0.5">
                        abrir faixa <ExternalLink className="h-2.5 w-2.5" />
                      </a>
                    )}
                  </div>
                </div>
                <Input
                  type="number"
                  placeholder={String(it.planned_position ?? "pos")}
                  className="h-8 w-20 text-xs"
                  value={pos[it.id] ?? ""}
                  onChange={(e) => setPos((p) => ({ ...p, [it.id]: e.target.value }))}
                />
                <Button size="sm" onClick={() => markDone(it)} disabled={busy === it.id} className="h-8">
                  {busy === it.id ? (
                    <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-3 w-3 mr-1" />
                  )}
                  Feito
                </Button>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
