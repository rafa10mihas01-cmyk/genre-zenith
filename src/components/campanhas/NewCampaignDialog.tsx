import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { FormModal } from "@/components/ui/form-modal";
import { Megaphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { Loader2, ChevronLeft, ChevronRight, Search } from "lucide-react";
import { useFormDraft } from "@/hooks/useFormDraft";
import { DraftBanner, DraftIndicator } from "@/components/forms/DraftBanner";
import { usePricingSettings } from "@/hooks/usePricingSettings";
import { TrackPresencePanel } from "@/components/campanhas/TrackPresencePanel";
import { extractSpotifyTrackId } from "@/hooks/useTrackPresence";

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

function formatCurrencyBRL(raw: string): string {
  if (!raw) return "";
  const cents = parseInt(raw, 10);
  if (Number.isNaN(cents)) return "";
  return (cents / 100).toLocaleString("pt-BR", {
    style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
}
function currencyDigitsToNumber(raw: string): number | undefined {
  if (!raw) return undefined;
  const cents = parseInt(raw, 10);
  if (Number.isNaN(cents)) return undefined;
  return cents / 100;
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
  const { settings: pricing, costs: pricingCosts } = usePricingSettings();

  // step 1
  const [trackName, setTrackName] = useState("");
  const [artist, setArtist] = useState("");
  const [trackUrl, setTrackUrl] = useState("");
  const [goal, setGoal] = useState<number>(50000);
  const [startDate, setStartDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [deadline, setDeadline] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [clientId, setClientId] = useState<string>("");
  const [curatorId, setCuratorId] = useState<string>("");
  const [campaignType, setCampaignType] = useState<"ecosystem" | "external" | "hybrid">("hybrid");
  const [collectionMode, setCollectionMode] = useState<"bot" | "spreadsheet">("bot");

  // Cobrança do cliente
  const [valorCobradoDigits, setValorCobradoDigits] = useState<string>("");
  const [formaRecebimento, setFormaRecebimento] = useState<string>("");
  const [jaRecebido, setJaRecebido] = useState<boolean>(false);
  const [recebidoEm, setRecebidoEm] = useState<string>("");

  // listas (carregadas ao abrir)
  const [clientsList, setClientsList] = useState<{ id: string; name: string }[]>([]);
  const [curatorsList, setCuratorsList] = useState<{ id: string; name: string }[]>([]);

  const [fetchingMeta, setFetchingMeta] = useState(false);

  // step 2
  const [loadingSugg, setLoadingSugg] = useState(false);
  const [items, setItems] = useState<Selection[]>([]);

  // step 3 — default rascunho (não ativa direto; usuário aprova na lista)
  const [activate, setActivate] = useState(false);

  const reset = () => {
    setStep(1); setBusy(false);
    setTrackName(""); setArtist(""); setTrackUrl(""); setGoal(50000); setNotes("");
    setStartDate(new Date().toISOString().slice(0, 10));
    setDeadline("");
    setClientId(""); setCuratorId("");
    setValorCobradoDigits(""); setFormaRecebimento(""); setJaRecebido(false); setRecebidoEm("");
    setItems([]); setActivate(false);
  };

  // Carrega clientes + curadores quando abre
  useEffect(() => {
    if (!open) return;
    void (async () => {
      const [{ data: cls }, { data: crs }] = await Promise.all([
        supabase.from("clients").select("id, name").is("archived_at", null).order("name"),
        supabase.from("curators").select("id, name").order("name"),
      ]);
      setClientsList((cls ?? []) as { id: string; name: string }[]);
      setCuratorsList((crs ?? []) as { id: string; name: string }[]);
    })();
  }, [open]);


  // ─── Rascunho persistente ─────────────────────────────────────────────────
  // Mantém os campos preenchidos mesmo se o usuário fechar o dialog ou recarregar a página.
  const draftSnapshot = useMemo(() => ({
    step, trackName, artist, trackUrl, goal, startDate, deadline, notes,
    clientId, curatorId, campaignType, collectionMode,
    valorCobradoDigits, formaRecebimento, jaRecebido, recebidoEm,
    items: items.map(i => ({
      playlist_id: i.playlist_id, selected: i.selected, target_override: i.target_override,
    })),
    activate,
  }), [step, trackName, artist, trackUrl, goal, startDate, deadline, notes, clientId, curatorId, campaignType, collectionMode,
       valorCobradoDigits, formaRecebimento, jaRecebido, recebidoEm, items, activate]);

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
    setClientId((d as any).clientId ?? "");
    setCuratorId((d as any).curatorId ?? "");
    setCampaignType(((d as any).campaignType as "ecosystem" | "external" | "hybrid") ?? "hybrid");
    setCollectionMode(((d as any).collectionMode as "bot" | "spreadsheet") ?? "bot");
    setValorCobradoDigits((d as any).valorCobradoDigits ?? "");
    setFormaRecebimento((d as any).formaRecebimento ?? "");
    setJaRecebido(Boolean((d as any).jaRecebido));
    setRecebidoEm((d as any).recebidoEm ?? "");
    setActivate(d.activate ?? false);
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
        status: "draft", // toda campanha nasce rascunho; vira "active" só quando o plano interno for aprovado.
        created_by: user?.id ?? null,
        client_id: clientId || null,
        curator_id: curatorId || null,
        campaign_type: campaignType,
        collection_mode: collectionMode,
        valor_cobrado: currencyDigitsToNumber(valorCobradoDigits) ?? null,
        forma_recebimento: formaRecebimento || null,
        valor_recebido: jaRecebido ? (currencyDigitsToNumber(valorCobradoDigits) ?? null) : null,
        recebido_em: jaRecebido && recebidoEm ? recebidoEm : null,
      } as any)
      .select("id")
      .single();

    if (error || !camp) {
      setBusy(false);
      toast({ title: "Erro ao criar campanha", description: error?.message, variant: "destructive" });
      return;
    }

    // Família B (campaign_allocations) aposentada na Fase 2.A.2.
    // O plano canônico de playlists vive em campaign_eco_allocations e é gerado
    // pelo fluxo de aprovação do plano interno (approve-campaign-plan).
    setBusy(false);
    toast({ title: "Campanha criada" });
    clearDraft();
    reset();
    onCreated(camp.id);
    onOpenChange(false);
  }

  return (
    <FormModal
      open={open}
      onOpenChange={close}
      title={`Nova campanha · ${step}/3`}
      description={
        <span className="flex items-center justify-between gap-3">
          <span>
            {step === 1 && "Música, meta e prazo."}
            {step === 2 && "Revisar distribuição."}
            {step === 3 && "Ativar."}
          </span>
          <DraftIndicator lastSavedAt={lastSavedAt} />
        </span>
      }
      icon={<Megaphone className="h-4 w-4" />}
      iconTone="campanhas"
      size="xl"
      preventClose={busy}
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          <Button variant="ghost" onClick={() => step > 1 ? setStep((step - 1) as any) : close(false)} disabled={busy}>
            {step > 1 ? <><ChevronLeft className="h-4 w-4 mr-1" /> Voltar</> : "Cancelar"}
          </Button>
          {step < 3 ? (
            <Button onClick={goNext} disabled={busy || loadingSugg}>
              Avançar <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          ) : (
            <Button onClick={submit} disabled={busy}>
              {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Salvar rascunho
            </Button>
          )}
        </div>
      }
    >


        {showDraftBanner && (
          <DraftBanner onRestore={handleRestore} onDiscard={handleDiscardDraft} />
        )}

        {step === 1 && (
          <div className="space-y-4">
            {/* Tipo da campanha */}
            <div className="space-y-1.5">
              <Label>Tipo da campanha</Label>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                {([
                  { id: "ecosystem", title: "Ecossistema", desc: "Só playlists internas." },
                  { id: "external",  title: "Externa",     desc: "Só curadores externos." },
                  { id: "hybrid",    title: "Híbrida",     desc: "Ecossistema + curadores." },
                ] as const).map(opt => {
                  const active = campaignType === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setCampaignType(opt.id)}
                      className={`text-left rounded-lg border px-3 py-2 transition ${
                        active
                          ? "border-primary bg-primary/5"
                          : "border-border/60 hover:border-border bg-muted/10"
                      }`}
                    >
                      <div className="text-sm font-semibold text-foreground leading-tight">{opt.title}</div>
                      <div className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{opt.desc}</div>
                    </button>
                  );
                })}
              </div>
              <p className="text-[11px] text-muted-foreground">
                Externa/Híbrida exigem curador.
              </p>
            </div>

            {/* Fonte de coleta — decide se o bot do Spotify roda ou se cliente manda planilha */}
            <div className="space-y-1.5">
              <Label>Fonte de coleta</Label>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {([
                  { id: "bot",         title: "Spotify (bot)",   desc: "Temos acesso ao Spotify for Artists. Bot coleta automaticamente." },
                  { id: "spreadsheet", title: "Planilha (Nielsen)", desc: "Sem acesso ao Spotify. Cliente envia planilha — não gasta crédito do bot." },
                ] as const).map(opt => {
                  const active = collectionMode === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setCollectionMode(opt.id)}
                      className={`text-left rounded-lg border px-3 py-2 transition ${
                        active
                          ? "border-primary bg-primary/5"
                          : "border-border/60 hover:border-border bg-muted/10"
                      }`}
                    >
                      <div className="text-sm font-semibold text-foreground leading-tight">{opt.title}</div>
                      <div className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{opt.desc}</div>
                    </button>
                  );
                })}
              </div>
            </div>


            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Cliente <span className="text-muted-foreground font-normal">(dono da campanha)</span></Label>
                <Select value={clientId || "__none__"} onValueChange={v => setClientId(v === "__none__" ? "" : v)}>
                  <SelectTrigger><SelectValue placeholder="Selecione um cliente" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— Sem cliente —</SelectItem>
                    {clientsList.map(c => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Curador <span className="text-muted-foreground font-normal">(dono das playlists)</span></Label>
                <Select value={curatorId || "__none__"} onValueChange={v => setCuratorId(v === "__none__" ? "" : v)}>
                  <SelectTrigger><SelectValue placeholder="Selecione um curador" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— Sem curador (modo legado) —</SelectItem>
                    {curatorsList.map(c => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Com curador definido, ao aprovar a campanha vira um deal real ligado a ele.
                </p>
              </div>
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
              <div className="md:col-span-2">
                <TrackPresencePanel spotifyTrackId={extractSpotifyTrackId(trackUrl)} />
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

            {/* Cobrança do cliente */}
            <div className="mt-6 space-y-3 rounded-lg border border-border/60 bg-muted/10 p-4">
              <div className="flex items-baseline justify-between">
                <h4 className="text-sm font-semibold text-foreground">Cobrança do cliente</h4>
                <span className="text-[11px] text-muted-foreground">Entrada · opcional</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Valor cobrado</Label>
                  <Input
                    inputMode="numeric"
                    placeholder="R$ 0,00"
                    value={formatCurrencyBRL(valorCobradoDigits)}
                    onChange={e => setValorCobradoDigits(e.target.value.replace(/\D/g, ""))}
                  />
                  {goal > 0 && (() => {
                    const custoEstimado = (goal * 0.6 * pricingCosts.eco) + (goal * 0.4 * pricingCosts.ext);
                    const margem = Math.max(0, Math.min(99, pricing.target_margin_pct));
                    const sugeridoPorMargem = margem < 100 ? custoEstimado / (1 - margem / 100) : custoEstimado;
                    const sugeridoPorTabela = goal * pricing.price_per_stream_sell;
                    const sugerido = Math.max(sugeridoPorMargem, sugeridoPorTabela);
                    const aplicar = () => setValorCobradoDigits(String(Math.round(sugerido * 100)));
                    return (
                      <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                        <span>
                          Sugerido: <strong className="text-foreground">{sugerido.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 })}</strong>
                          {" "}· custo {custoEstimado.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 })} · margem alvo {margem.toFixed(0)}%
                        </span>
                        <button
                          type="button"
                          onClick={aplicar}
                          className="text-primary hover:underline font-medium whitespace-nowrap"
                        >
                          Aplicar
                        </button>
                      </div>
                    );
                  })()}
                </div>
                <div className="space-y-2">
                  <Label>Forma de recebimento</Label>
                  <Select value={formaRecebimento || "__none__"} onValueChange={v => setFormaRecebimento(v === "__none__" ? "" : v)}>
                    <SelectTrigger><SelectValue placeholder="Selecionar" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">A definir</SelectItem>
                      <SelectItem value="pix">PIX</SelectItem>
                      <SelectItem value="boleto">Boleto</SelectItem>
                      <SelectItem value="cartao">Cartão</SelectItem>
                      <SelectItem value="transferencia">Transferência</SelectItem>
                      <SelectItem value="outro">Outro</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="md:col-span-2 flex items-center gap-2 pt-1">
                  <Checkbox
                    id="ja-recebido"
                    checked={jaRecebido}
                    onCheckedChange={(v) => {
                      const checked = v === true;
                      setJaRecebido(checked);
                      if (checked && !recebidoEm) setRecebidoEm(new Date().toISOString().slice(0, 10));
                    }}
                  />
                  <Label htmlFor="ja-recebido" className="cursor-pointer text-sm">
                    Já recebi este valor
                  </Label>
                </div>
                {jaRecebido && (
                  <div className="space-y-2 md:col-span-2">
                    <Label>Data do recebimento</Label>
                    <Input type="date" value={recebidoEm} onChange={e => setRecebidoEm(e.target.value)} />
                  </div>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground">
                Se ficar em branco, o lançamento entra como "a receber" no Financeiro.
              </p>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/20 px-3 py-2">
              <p className="text-xs text-muted-foreground">
                Sugestões consideram apenas <span className="text-foreground font-medium">suas playlists</span> (ownership próprio). Playlists de curadores não entram em campanhas internas.
              </p>
              <Button type="button" variant="ghost" size="sm" onClick={() => fetchSuggestions()} disabled={loadingSugg}>
                {loadingSugg && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}
                Atualizar
              </Button>
            </div>
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
                  <div className="text-muted-foreground text-xs">Cliente</div>
                  <div className="font-medium truncate">{clientsList.find(c => c.id === clientId)?.name ?? "—"}</div>
                </div>
                <div>
                  <div className="text-muted-foreground text-xs">Curador</div>
                  <div className="font-medium truncate">{curatorsList.find(c => c.id === curatorId)?.name ?? "—"}</div>
                </div>
                <div>
                  <div className="text-muted-foreground text-xs">Meta</div>
                  <div className="font-medium tabular-nums">{goal.toLocaleString("pt-BR")}</div>
                </div>
                <div><div className="text-muted-foreground text-xs">Playlists</div><div className="font-medium">{items.filter(i => i.selected).length}</div></div>
                <div><div className="text-muted-foreground text-xs">Início</div><div className="font-medium">{startDate}</div></div>
                <div><div className="text-muted-foreground text-xs">Término</div><div className="font-medium">{deadline || "—"}</div></div>
              </div>
            </div>
            <div className="rounded-lg border border-border bg-muted/20 p-3 text-xs text-muted-foreground">
              A campanha será criada como <span className="text-foreground font-medium">rascunho</span>. Ela só vira <span className="text-foreground font-medium">ativa</span> depois que o cliente aprovar o plano público e você aprovar o plano interno na tela de execução.
            </div>
          </div>
        )}

    </FormModal>
  );
}
