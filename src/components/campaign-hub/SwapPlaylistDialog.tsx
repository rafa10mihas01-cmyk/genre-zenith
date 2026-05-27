import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Music, Loader2, ArrowRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { formatInt } from "@/lib/campaignEngine";
import type { EcoAllocation } from "./types";

type Candidate = {
  managed_playlist_id: string;
  name: string;
  cover_url: string | null;
  followers: number;
  genre_id: string | null;
  free_capacity: number;
  affinity_score: number;
  tier: "primary" | "neighbor";
};

type Suggestions = {
  target: number;
  old_playlist_id: string;
  singles: Candidate[];
  combos: { items: Candidate[]; total_capacity: number; split: { managed_playlist_id: string; planned_streams: number }[] }[];
};

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  campaignId: string;
  allocation: EcoAllocation;
  onSwapped: () => void;
};

export function SwapPlaylistDialog({ open, onOpenChange, campaignId, allocation, onSwapped }: Props) {
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [data, setData] = useState<Suggestions | null>(null);

  useEffect(() => {
    if (!open) return;
    setData(null);
    setLoading(true);
    (async () => {
      const { data: res, error } = await supabase.functions.invoke("suggest-playlist-swap", {
        body: { campaign_id: campaignId, old_allocation_id: allocation.id },
      });
      setLoading(false);
      if (error || (res as any)?.error) {
        toast({ title: "Erro ao buscar sugestões", description: (res as any)?.error ?? error?.message, variant: "destructive" });
        return;
      }
      setData(res as Suggestions);
    })();
  }, [open, campaignId, allocation.id]);

  async function applySwap(newAllocs: { managed_playlist_id: string; planned_streams: number }[]) {
    setSubmitting(true);
    const { data: res, error } = await supabase.functions.invoke("swap-campaign-playlist", {
      body: { campaign_id: campaignId, old_allocation_id: allocation.id, new_allocations: newAllocs },
    });
    setSubmitting(false);
    if (error || (res as any)?.error) {
      toast({ title: "Falha ao substituir", description: (res as any)?.error ?? error?.message, variant: "destructive" });
      return;
    }
    toast({ title: "Playlist substituída", description: `${newAllocs.length} nova(s) playlist(s) com ${formatInt(allocation.planned_streams)} plays redistribuídos.` });
    onSwapped();
    onOpenChange(false);
  }

  const oldName = allocation.managed_playlists?.name ?? "—";
  const target = allocation.planned_streams;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Substituir playlist</DialogTitle>
          <DialogDescription>
            Removendo <span className="font-medium text-foreground">{oldName}</span> · meta a redistribuir:{" "}
            <span className="font-medium text-foreground tabular-nums">{formatInt(target)} plays</span>
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="py-10 grid place-items-center text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        )}

        {!loading && data && (
          <Tabs defaultValue={data.singles.length > 0 ? "single" : "combo"}>
            <TabsList>
              <TabsTrigger value="single">Substituição única ({data.singles.length})</TabsTrigger>
              <TabsTrigger value="combo">Combinação ({data.combos.length})</TabsTrigger>
            </TabsList>

            <TabsContent value="single" className="mt-3 space-y-2">
              {data.singles.length === 0 && (
                <p className="text-sm text-muted-foreground py-6 text-center">
                  Nenhuma playlist sozinha cobre a meta. Veja a aba "Combinação".
                </p>
              )}
              {data.singles.map((c) => (
                <CandidateRow
                  key={c.managed_playlist_id}
                  c={c}
                  badge={c.tier === "primary" ? "mesmo gênero" : `vizinho · ${(c.affinity_score * 100).toFixed(0)}%`}
                  trailing={
                    <Button
                      size="sm"
                      disabled={submitting}
                      onClick={() => applySwap([{ managed_playlist_id: c.managed_playlist_id, planned_streams: target }])}
                    >
                      Escolher <ArrowRight className="h-3 w-3 ml-1" />
                    </Button>
                  }
                />
              ))}
            </TabsContent>

            <TabsContent value="combo" className="mt-3 space-y-3">
              {data.combos.length === 0 && (
                <p className="text-sm text-muted-foreground py-6 text-center">
                  Sem combinações viáveis encontradas.
                </p>
              )}
              {data.combos.map((combo, idx) => (
                <div key={idx} className="border border-border rounded-lg p-3 space-y-2">
                  <div className="text-xs text-muted-foreground">
                    Combinação {idx + 1} · {combo.items.length} playlists · capacidade {formatInt(combo.total_capacity)}
                  </div>
                  {combo.items.map((c, i) => (
                    <CandidateRow
                      key={c.managed_playlist_id}
                      c={c}
                      badge={`recebe ${formatInt(combo.split[i].planned_streams)}`}
                    />
                  ))}
                  <div className="flex justify-end pt-1">
                    <Button size="sm" disabled={submitting} onClick={() => applySwap(combo.split)}>
                      Aplicar combinação <ArrowRight className="h-3 w-3 ml-1" />
                    </Button>
                  </div>
                </div>
              ))}
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}

function CandidateRow({ c, badge, trailing }: { c: Candidate; badge: string; trailing?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 p-2 rounded-md hover:bg-elevated/40">
      {c.cover_url ? (
        <img src={c.cover_url} alt="" className="w-10 h-10 rounded object-cover shrink-0" />
      ) : (
        <div className="w-10 h-10 rounded bg-muted grid place-items-center shrink-0">
          <Music className="h-4 w-4 text-muted-foreground" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium truncate">{c.name}</div>
        <div className="text-[11px] text-muted-foreground tabular-nums">
          {formatInt(c.followers)} saves · livre {formatInt(c.free_capacity)} · {badge}
        </div>
      </div>
      {trailing}
    </div>
  );
}
