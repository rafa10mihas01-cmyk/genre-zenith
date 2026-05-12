import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/hooks/use-toast";
import { Loader2, ChevronLeft, ChevronRight, Search } from "lucide-react";
import { useFormDraft } from "@/hooks/useFormDraft";
import { DraftBanner, DraftIndicator } from "@/components/forms/DraftBanner";

function formatPlaysShort(n: number): string {
  if (!n || n < 1) return "0";
  if (n >= 1_000_000) {
    const v = n / 1_000_000;
    const s = v >= 10 ? Math.round(v).toString() : v.toFixed(1).replace(/\.0$/, "").replace(".", ",");
    return `${s} ${v >= 2 ? "milhões" : "milhão"}`;
  }
  if (n >= 1_000) {
    const v = n / 1_000;
    const s = v >= 10 ? Math.round(v).toString() : v.toFixed(1).replace(/\.0$/, "").replace(".", ",");
    return `${s} mil`;
  }
  return n.toLocaleString("pt-BR");
}

type Suggestion = {
  playlist_id: string;
  playlist_name: string;
  followers: number | null;
  cover_url: string | null;
  capacity_score: number;
  health_score: number;
  risk_score: number;
  delivery_score?: number;
  campaigns_count?: number;
  fulfillment_rate?: number | null;
  expected_delivery: number;
  suggested_target: number;
  suggested_weight: number;
  composite_score: number;
};

type Selection = Suggestion & { selected: boolean; target_override: number };

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: (id: string) => void;
}

export function NewCampaignDialog({ open, onOpenChange, onCreated }: Props) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [busy, setBusy] = useState(false);

  // step 1
  const [trackName, setTrackName] = useState("");
  const [artist, setArtist] = useState("");
  const [trackUrl, setTrackUrl] = useState("");
  const [goal, setGoal] = useState<number>(50000);
  const [startDate, setStartDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [deadline, setDeadline] = useState<string>("");
  const [notes, setNotes] = useState("");

  const [fetchingMeta, setFetchingMeta] = useState(false);

  // step 2
  const [loadingSugg, setLoadingSugg] = useState(false);
  const [items, setItems] = useState<Selection[]>([]);

  // step 3
  const [activate, setActivate] = useState(true);

  const reset = () => {
    setStep(1); setBusy(false);
    setTrackName(""); setArtist(""); setTrackUrl(""); setGoal(50000); setNotes("");
    setStartDate(new Date().toISOString().slice(0, 10));
    setDeadline("");
    setItems([]); setActivate(true);
  };

  // ─── Rascunho persistente ─────────────────────────────────────────────────
  // Mantém os campos preenchidos mesmo se o usuário fechar o dialog ou recarregar a página.
  const draftSnapshot = useMemo(() => ({
    step, trackName, artist, trackUrl, goal, startDate, deadline, notes,
    items: items.map(i => ({
      playlist_id: i.playlist_id, selected: i.selected, target_override: i.target_override,
    })),
    activate,
  }), [step, trackName, artist, trackUrl, goal, startDate, deadline, notes, items, activate]);

  const isDraftEmpty = !trackName.trim() && !artist.trim() && !trackUrl.trim() && !notes.trim()
    && step === 1 && goal === 50000 && !deadline;

  const { hasDraft, restoreDraft, clearDraft, lastSavedAt } = useFormDraft(
    "new-campaign",
    { enabled: open, isEmpty: isDraftEmpty },
    draftSnapshot,
  );

  const [draftDismissed, setDraftDismissed] = useState(false);
  const showDraftBanner = open && hasDraft && !draftDismissed && isDraftEmpty;

  const handleRestore = () => {
    const d = restoreDraft() as typeof draftSnapshot | null;
    if (!d) { setDraftDismissed(true); return; }
    setStep((d.step ?? 1) as 1 | 2 | 3);
    setTrackName(d.trackName ?? "");
    setArtist(d.artist ?? "");
    setTrackUrl(d.trackUrl ?? "");
    setGoal(d.goal ?? 50000);
    setStartDate(d.startDate ?? new Date().toISOString().slice(0, 10));
    setDeadline(d.deadline ?? "");
    setNotes(d.notes ?? "");
    setActivate(d.activate ?? true);
    setDraftDismissed(true);
    // Se o draft estava no passo 2, refaz a sugestão e reaplica seleções
    if ((d.step ?? 1) >= 2) {
      void (async () => {
        await fetchSuggestions();
        setItems(prev => prev.map(p => {
          const saved = d.items?.find(i => i.playlist_id === p.playlist_id);
          return saved ? { ...p, selected: saved.selected, target_override: saved.target_override } : p;
        }));
      })();
    }
    toast({ title: "Rascunho restaurado" });
  };

  const handleDiscardDraft = () => {
    clearDraft();
    setDraftDismissed(true);
    reset();
  };

  // Fechar SEM resetar — o rascunho fica salvo automaticamente.
  const close = (v: boolean) => {
    if (!v) setDraftDismissed(false);
    onOpenChange(v);
  };

  async function fetchMeta() {
    const url = trackUrl.trim();
    if (!url) {
      toast({ title: "Cole a URL do Spotify primeiro", variant: "destructive" });
      return;
    }
    setFetchingMeta(true);
    const { data, error } = await supabase.functions.invoke("fetch-spotify-meta", { body: { url } });
    setFetchingMeta(false);
    if (error || !data?.ok) {
      toast({ title: "Não consegui buscar a música", description: error?.message ?? data?.error, variant: "destructive" });
      return;
    }
    if (data.title) setTrackName(data.title);
    if (data.artist) setArtist(data.artist);
    toast({ title: "Música encontrada", description: `${data.title}${data.artist ? ` — ${data.artist}` : ""}` });
  }

  const allocatedSum = items.filter(i => i.selected).reduce((s, i) => s + (i.target_override || 0), 0);
  const coverage = goal > 0 ? Math.round((allocatedSum / goal) * 100) : 0;

  async function fetchSuggestions() {
    setLoadingSugg(true);
    // Para sugestão precisamos de um horizonte; se não houver término, usa 90 dias a partir do início.
    const horizon = deadline || new Date(new Date(startDate).getTime() + 90 * 86400_000).toISOString().slice(0, 10);
    const { data, error } = await (supabase.rpc as any)("suggest_campaign_playlists", {
      p_goal: goal,
      p_deadline: horizon,
      p_exclude_active: true,
    });
    setLoadingSugg(false);
    if (error) {
      toast({ title: "Erro ao sugerir playlists", description: error.message, variant: "destructive" });
      return;
    }
    const list = (data ?? []) as Suggestion[];
    setItems(list.map((s) => ({
      ...s,
      selected: s.suggested_target > 0,
      target_override: Number(s.suggested_target ?? 0),
    })));
  }

  async function goNext() {
    if (step === 1) {
      if (!trackName.trim() || !goal || !startDate) {
        toast({ title: "Preencha música, meta e data de início", variant: "destructive" });
        return;
      }
      if (deadline && deadline < startDate) {
        toast({ title: "Término precisa ser depois do início", variant: "destructive" });
        return;
      }
      setStep(2);
      await fetchSuggestions();
    } else if (step === 2) {
      const chosen = items.filter(i => i.selected && i.target_override > 0);
      if (chosen.length === 0) {
        toast({ title: "Selecione ao menos uma playlist", variant: "destructive" });
        return;
      }
      setStep(3);
    }
  }

  async function submit() {
    setBusy(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { data: camp, error } = await supabase
      .from("campaigns")
      .insert({
        track_name: trackName.trim(),
        artist: artist.trim() || null,
        spotify_track_url: trackUrl.trim() || null,
        goal_plays: goal,
        started_at: new Date(startDate).toISOString(),
        deadline: deadline || null,
        notes: notes.trim() || null,
        status: activate ? "active" : "draft",
        created_by: user?.id ?? null,
      })
      .select("id")
      .single();

    if (error || !camp) {
      setBusy(false);
      toast({ title: "Erro ao criar campanha", description: error?.message, variant: "destructive" });
      return;
    }

    const chosen = items.filter(i => i.selected && i.target_override > 0);
    const rows = chosen.map((i, idx) => ({
      campaign_id: camp.id,
      playlist_id: i.playlist_id,
      target_plays: i.target_override,
      weight: Number(i.suggested_weight ?? 1),
      position: idx,
      status: activate ? "approved" : "suggested",
    }));
    const { error: allocErr } = await supabase.from("campaign_allocations").insert(rows);
    setBusy(false);
    if (allocErr) {
      toast({ title: "Campanha criada, mas falhou alocação", description: allocErr.message, variant: "destructive" });
    } else {
      toast({ title: "Campanha criada" });
    }
    onCreated(camp.id);
    close(false);
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nova campanha — passo {step} de 3</DialogTitle>
          <DialogDescription>
            {step === 1 && "Defina a música, a meta de plays e o prazo."}
            {step === 2 && "Revise a sugestão de playlists e ajuste se necessário."}
            {step === 3 && "Confira e ative a campanha."}
          </DialogDescription>
        </DialogHeader>

        {step === 1 && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Nome da música *</Label>
                <Input value={trackName} onChange={e => setTrackName(e.target.value)} maxLength={200} />
              </div>
              <div className="space-y-2">
                <Label>Artista</Label>
                <Input value={artist} onChange={e => setArtist(e.target.value)} maxLength={200} />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label>URL Spotify (opcional)</Label>
                <div className="flex gap-2">
                  <Input
                    value={trackUrl}
                    onChange={e => setTrackUrl(e.target.value)}
                    placeholder="https://open.spotify.com/track/..."
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); fetchMeta(); } }}
                  />
                  <Button type="button" variant="secondary" onClick={fetchMeta} disabled={fetchingMeta || !trackUrl.trim()}>
                    {fetchingMeta ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                    <span className="ml-2 hidden sm:inline">Buscar</span>
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">Cole o link e clique em Buscar para preencher nome e artista automaticamente.</p>
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label>Meta de plays *</Label>
                <Input type="number" min={1} value={goal} onChange={e => setGoal(Number(e.target.value))} />
                <p className="text-xs text-muted-foreground tabular-nums">
                  {goal > 0
                    ? <>{goal.toLocaleString("pt-BR")} plays <span className="text-foreground/70">· {formatPlaysShort(goal)}</span></>
                    : "Informe a quantidade de plays desejada"}
                </p>
              </div>
              <div className="space-y-2">
                <Label>Início *</Label>
                <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Término <span className="text-muted-foreground font-normal">(opcional)</span></Label>
                <div className="flex gap-2">
                  <Input type="date" value={deadline} min={startDate} onChange={e => setDeadline(e.target.value)} />
                  {deadline && (
                    <Button type="button" variant="ghost" size="sm" onClick={() => setDeadline("")}>Limpar</Button>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {deadline ? "Campanha encerra na data definida." : "Sem término — campanha rotativa até você encerrar manualmente."}
                </p>
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label>Notas</Label>
                <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} maxLength={500} />
              </div>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                Meta: <span className="text-foreground font-medium">{goal.toLocaleString()}</span> plays
              </span>
              <span className={`font-medium ${coverage >= 100 ? "text-primary" : coverage >= 70 ? "text-foreground" : "text-destructive"}`}>
                Alocado: {allocatedSum.toLocaleString()} ({coverage}%)
              </span>
            </div>
            {loadingSugg ? (
              <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
            ) : items.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">Nenhuma playlist disponível.</p>
            ) : (
              <div className="border border-border rounded-md overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left w-8"></th>
                      <th className="px-3 py-2 text-left">Playlist</th>
                      <th className="px-3 py-2 text-right">Cap.</th>
                      <th className="px-3 py-2 text-right">Saúde</th>
                      <th className="px-3 py-2 text-right">Risco</th>
                      <th className="px-3 py-2 text-right" title="Histórico em campanhas">Hist.</th>
                      <th className="px-3 py-2 text-right" title="Taxa de cumprimento histórica">Cumpre</th>
                      <th className="px-3 py-2 text-right">Plays</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((it, idx) => {
                      const fr = it.fulfillment_rate;
                      const frPct = fr != null ? Math.round(Number(fr) * 100) : null;
                      const frTone =
                        frPct == null ? "text-muted-foreground" :
                        frPct >= 100 ? "text-primary" :
                        frPct >= 70 ? "text-foreground" : "text-destructive";
                      return (
                      <tr key={it.playlist_id} className="border-t border-border">
                        <td className="px-3 py-2">
                          <Checkbox
                            checked={it.selected}
                            onCheckedChange={(v) => {
                              setItems(prev => prev.map((p, i) => i === idx ? { ...p, selected: !!v } : p));
                            }}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <div className="font-medium truncate max-w-[240px]">{it.playlist_name}</div>
                          <div className="text-xs text-muted-foreground">{(it.followers ?? 0).toLocaleString()} seguidores</div>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{Math.round(Number(it.capacity_score))}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{Math.round(Number(it.health_score))}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{Math.round(Number(it.risk_score))}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-xs text-muted-foreground">
                          {it.campaigns_count ? `${it.campaigns_count}` : "—"}
                        </td>
                        <td className={`px-3 py-2 text-right tabular-nums text-xs font-medium ${frTone}`}>
                          {frPct != null ? `${frPct}%` : "—"}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Input
                            type="number"
                            min={0}
                            className="h-8 w-24 text-right tabular-nums"
                            value={it.target_override}
                            onChange={e => {
                              const v = Number(e.target.value);
                              setItems(prev => prev.map((p, i) => i === idx ? { ...p, target_override: v } : p));
                            }}
                          />
                        </td>
                      </tr>
                    );})}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <div className="rounded-lg border border-border p-4 space-y-2">
              <div className="text-sm text-muted-foreground">Música</div>
              <div className="text-lg font-semibold">{trackName} {artist && <span className="text-muted-foreground font-normal">— {artist}</span>}</div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-2 text-sm">
                <div>
                  <div className="text-muted-foreground text-xs">Meta</div>
                  <div className="font-medium tabular-nums">{goal.toLocaleString("pt-BR")}</div>
                  <div className="text-xs text-muted-foreground">{formatPlaysShort(goal)}</div>
                </div>
                <div><div className="text-muted-foreground text-xs">Início</div><div className="font-medium">{startDate}</div></div>
                <div><div className="text-muted-foreground text-xs">Término</div><div className="font-medium">{deadline || "—"}</div></div>
                <div><div className="text-muted-foreground text-xs">Playlists</div><div className="font-medium">{items.filter(i => i.selected).length}</div></div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id="act" checked={activate} onCheckedChange={v => setActivate(!!v)} />
              <Label htmlFor="act" className="cursor-pointer">Ativar campanha imediatamente</Label>
            </div>
          </div>
        )}

        <DialogFooter className="flex items-center justify-between gap-2">
          <Button variant="ghost" onClick={() => step > 1 ? setStep((step - 1) as any) : close(false)} disabled={busy}>
            {step > 1 ? <><ChevronLeft className="h-4 w-4 mr-1" /> Voltar</> : "Cancelar"}
          </Button>
          {step < 3 ? (
            <Button onClick={goNext} disabled={busy || loadingSugg}>
              Avançar <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          ) : (
            <Button onClick={submit} disabled={busy}>
              {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Criar campanha
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
