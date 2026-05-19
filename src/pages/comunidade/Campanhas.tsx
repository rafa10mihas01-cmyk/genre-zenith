// /comunidade/campanhas — Lista campanhas abertas + tela de envio de prova.
// Toda lógica sensível (pontos, vagas) é controlada por RPC server-side.
import { useEffect, useState } from "react";
import { Link2, Loader2, Music2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ComunidadeShell } from "@/components/comunidade/ComunidadeShell";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";

type OpenCampaign = {
  id: string;
  title: string;
  brief: string | null;
  points_per_member: number;
  remaining_slots: number;
  proof_window_hours: number;
  song_name: string | null;
  song_artist: string | null;
  song_cover_url: string | null;
  song_spotify_url: string | null;
  already_accepted: boolean;
};

type MyParticipation = {
  id: string;
  status: string;
  proof_url: string | null;
  proof_submitted_at: string | null;
  expires_at: string | null;
  campaign_id: string | null;
  points_offered: number;
  community_campaigns: { title: string; song_name?: string } | null;
  curator_deals: { song_name: string; song_artist: string | null; song_cover_url: string | null } | null;
};

const errMap: Record<string, string> = {
  not_active_member: "Sua conta ainda não está ativa.",
  member_not_active: "Sua conta foi suspensa.",
  campaign_full: "As vagas dessa campanha esgotaram.",
  campaign_not_open: "Essa campanha foi fechada.",
  already_accepted: "Você já aceitou essa campanha.",
  invalid_proof_url: "Cole um link válido da prova.",
  expired: "O prazo para enviar a prova venceu.",
  invalid_state: "Essa participação não aceita mais envio.",
  cooldown_active: "Aguarde alguns segundos antes de aceitar outra.",
  daily_limit_reached: "Limite diário atingido. Tente amanhã.",
  rate_limited: "Muitos envios seguidos. Tente em alguns minutos.",
  campaign_not_found: "Campanha não encontrada.",
};

export default function Campanhas() {
  const [open, setOpen] = useState<OpenCampaign[]>([]);
  const [mine, setMine] = useState<MyParticipation[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [proofFor, setProofFor] = useState<MyParticipation | null>(null);
  const [proofUrl, setProofUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    setLoading(true);
    const [openRes, mineRes] = await Promise.all([
      supabase.rpc("community_list_open_campaigns"),
      supabase
        .from("community_participations")
        .select(
          "id, status, proof_url, proof_submitted_at, expires_at, campaign_id, points_offered, community_campaigns(title), curator_deals(song_name, song_artist, song_cover_url)",
        )
        .order("created_at", { ascending: false })
        .limit(20),
    ]);
    setOpen((openRes.data as OpenCampaign[]) ?? []);
    setMine((mineRes.data as unknown as MyParticipation[]) ?? []);
    setLoading(false);
  }
  useEffect(() => {
    load();
  }, []);

  async function accept(c: OpenCampaign) {
    setBusyId(c.id);
    const { error } = await supabase.rpc("community_accept_campaign", { p_campaign_id: c.id });
    setBusyId(null);
    if (error) {
      const key = error.message.replace(/.*?:/, "").trim();
      toast.error("Não foi possível aceitar", { description: errMap[key] ?? error.message });
      return;
    }
    toast.success("Vaga reservada");
    load();
  }

  async function submitProof() {
    if (!proofFor) return;
    setSubmitting(true);
    const { error } = await supabase.rpc("community_submit_proof", {
      p_participation_id: proofFor.id,
      p_proof_url: proofUrl.trim(),
    });
    setSubmitting(false);
    if (error) {
      const key = error.message.replace(/.*?:/, "").trim();
      toast.error("Falha ao enviar", { description: errMap[key] ?? error.message });
      return;
    }
    toast.success("Prova enviada");
    setProofFor(null);
    setProofUrl("");
    load();
  }

  const pendingProof = mine.filter((p) => p.status === "accepted" && !!p.campaign_id);

  return (
    <ComunidadeShell>
      <div className="space-y-5">
        <h1 className="text-2xl font-semibold tracking-tight">Campanhas</h1>

        {/* Aguardando minha prova */}
        {pendingProof.length > 0 && (
          <section className="space-y-2">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Enviar prova</div>
            <div className="space-y-2">
              {pendingProof.map((p) => (
                <Card key={p.id} className="overflow-hidden">
                  <CardContent className="p-4 flex items-center gap-3">
                    {p.curator_deals?.song_cover_url ? (
                      <img src={p.curator_deals.song_cover_url} alt="" className="h-12 w-12 rounded-md object-cover" />
                    ) : (
                      <div className="h-12 w-12 rounded-md bg-elevated flex items-center justify-center">
                        <Music2 className="h-5 w-5 text-muted-foreground" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate">
                        {p.community_campaigns?.title ?? p.curator_deals?.song_name ?? "Campanha"}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {p.points_offered} pts ao aprovar
                        {p.expires_at ? ` · até ${new Date(p.expires_at).toLocaleDateString("pt-BR")}` : ""}
                      </div>
                    </div>
                    <Button size="sm" onClick={() => { setProofFor(p); setProofUrl(""); }}>
                      <Link2 className="h-4 w-4" /> Prova
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>
        )}

        {/* Abertas */}
        <section className="space-y-2">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Disponíveis</div>
          {loading ? (
            <Card><CardContent className="p-6 text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</CardContent></Card>
          ) : open.length === 0 ? (
            <Card>
              <CardContent className="p-8 flex flex-col items-center text-center gap-3">
                <Music2 className="h-7 w-7 text-muted-foreground" />
                <p className="text-sm text-muted-foreground max-w-xs">
                  Sem campanhas no momento.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {open.map((c) => (
                <Card key={c.id} className="overflow-hidden">
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-center gap-3">
                      {c.song_cover_url ? (
                        <img src={c.song_cover_url} alt="" className="h-12 w-12 rounded-md object-cover" />
                      ) : (
                        <div className="h-12 w-12 rounded-md bg-elevated flex items-center justify-center">
                          <Music2 className="h-5 w-5 text-muted-foreground" />
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium truncate">{c.title}</div>
                        <div className="text-xs text-muted-foreground truncate">
                          {c.song_name ?? "—"}{c.song_artist ? ` · ${c.song_artist}` : ""}
                        </div>
                      </div>
                      <Badge variant="outline" className="text-[10px] border-primary/30 text-primary">
                        +{c.points_per_member} pts
                      </Badge>
                    </div>
                    {c.brief && <p className="text-xs text-muted-foreground line-clamp-3">{c.brief}</p>}
                    <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                      <span>{c.remaining_slots} vaga{c.remaining_slots === 1 ? "" : "s"} · prazo {c.proof_window_hours}h</span>
                      {c.already_accepted ? (
                        <Badge variant="outline" className="text-[10px]">Já aceita</Badge>
                      ) : (
                        <Button size="sm" disabled={busyId === c.id || c.remaining_slots <= 0} onClick={() => accept(c)}>
                          {busyId === c.id ? <Loader2 className="h-4 w-4 animate-spin" /> : "Aceitar"}
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Diálogo de envio de prova */}
      <Dialog open={!!proofFor} onOpenChange={(o) => !o && setProofFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Enviar prova</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Cole o link da playlist do Spotify onde a faixa foi adicionada.
            </p>
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Link da playlist</Label>
              <Input
                value={proofUrl}
                onChange={(e) => setProofUrl(e.target.value)}
                placeholder="https://open.spotify.com/playlist/..."
                className="bg-elevated"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setProofFor(null)}>Cancelar</Button>
            <Button onClick={submitProof} disabled={submitting || proofUrl.trim().length < 8}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Enviar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ComunidadeShell>
  );
}
