import { useEffect, useMemo, useState } from "react";
import { Sparkles, ListChecks, Pencil, Image as ImageIcon, Send, Loader2, RefreshCw, Check, Music2, Globe, Lock, ExternalLink, AlertCircle } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

type Template = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  replication_score: number;
  cover_brief: string | null;
  cover_image_url: string | null;
  cover_variations: Array<{ index: number; url: string }> | null;
  cover_selected_index: number | null;
  cover_generated_at: string | null;
  spotify_playlist_id: string | null;
  spotify_url: string | null;
  spotify_owner_id: string | null;
  track_seeds: Array<{ nome: string; artista: string; spotify_track_id?: string }> | null;
  tracks_added: number;
  tracks_failed: number;
  genre_id: string;
  blueprint_id: string;
};

type Account = {
  id: string;
  display_name: string | null;
  spotify_user_id: string;
  current_playlists: number;
  max_playlists: number;
  status: string;
};

type Step = "fila" | "editor" | "capa" | "publicacao";

const STEPS: { id: Step; label: string; icon: any }[] = [
  { id: "fila",        label: "Fila",        icon: ListChecks },
  { id: "editor",      label: "Editor",      icon: Pencil },
  { id: "capa",        label: "Capa",        icon: ImageIcon },
  { id: "publicacao",  label: "Publicação",  icon: Send },
];

export default function Criacao() {
  const { toast } = useToast();
  const [step, setStep] = useState<Step>("fila");
  const [templates, setTemplates] = useState<Template[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // editor state
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editTracks, setEditTracks] = useState<Array<{ nome: string; artista: string; spotify_track_id?: string }>>([]);
  const [savingEdit, setSavingEdit] = useState(false);

  // capa state
  const [coverPrompt, setCoverPrompt] = useState("");
  const [generatingCover, setGeneratingCover] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);

  // publicação state
  const [pubAccount, setPubAccount] = useState<string>("");
  const [pubPublic, setPubPublic] = useState(true);
  const [publishing, setPublishing] = useState(false);

  const selected = useMemo(
    () => templates.find((t) => t.id === selectedId) ?? null,
    [templates, selectedId],
  );

  async function load() {
    setLoading(true);
    const [tplRes, accRes] = await Promise.all([
      supabase.from("playlist_templates")
        .select("id,name,description,status,replication_score,cover_brief,cover_image_url,cover_variations,cover_selected_index,cover_generated_at,spotify_playlist_id,spotify_url,spotify_owner_id,track_seeds,tracks_added,tracks_failed,genre_id,blueprint_id")
        .in("status", ["approved", "created"])
        .order("replication_score", { ascending: false })
        .limit(100),
      supabase.from("accounts")
        .select("id,display_name,spotify_user_id,current_playlists,max_playlists,status")
        .eq("status", "ativa")
        .order("current_playlists", { ascending: true }),
    ]);
    if (tplRes.data) setTemplates(tplRes.data as any);
    if (accRes.data) setAccounts(accRes.data as any);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  function openTemplate(t: Template, jumpTo: Step = "editor") {
    setSelectedId(t.id);
    setEditName(t.name);
    setEditDesc(t.description ?? "");
    setEditTracks(Array.isArray(t.track_seeds) ? [...t.track_seeds] : []);
    setCoverPrompt(t.cover_brief ?? "");
    setPubAccount("");
    setPubPublic(true);
    setStep(jumpTo);
  }

  async function saveEdit() {
    if (!selected) return;
    setSavingEdit(true);
    const { error } = await supabase.from("playlist_templates")
      .update({
        name: editName.trim(),
        description: editDesc.trim().slice(0, 300),
        track_seeds: editTracks,
      })
      .eq("id", selected.id);
    setSavingEdit(false);
    if (error) {
      toast({ title: "Erro ao salvar", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Salvo" });
    await load();
  }

  function moveTrack(idx: number, dir: -1 | 1) {
    const next = [...editTracks];
    const target = idx + dir;
    if (target < 0 || target >= next.length) return;
    [next[idx], next[target]] = [next[target], next[idx]];
    setEditTracks(next);
  }
  function removeTrack(idx: number) {
    setEditTracks(editTracks.filter((_, i) => i !== idx));
  }
  function addTrack() {
    setEditTracks([...editTracks, { nome: "", artista: "" }]);
  }

  async function generateCovers() {
    if (!selected) return;
    setGeneratingCover(true);
    const { data, error } = await supabase.functions.invoke("generate-cover-variations", {
      body: { template_id: selected.id, custom_prompt: coverPrompt },
    });
    setGeneratingCover(false);
    if (error || !(data as any)?.ok) {
      toast({ title: "Falha ao gerar capas", description: error?.message || (data as any)?.error || "Erro desconhecido", variant: "destructive" });
      return;
    }
    toast({ title: `${(data as any).variations.length} capas geradas` });
    await load();
  }

  async function selectCover(index: number, url: string) {
    if (!selected) return;
    const { error } = await supabase.from("playlist_templates")
      .update({ cover_selected_index: index, cover_image_url: url })
      .eq("id", selected.id);
    if (error) {
      toast({ title: "Erro", description: error.message, variant: "destructive" });
      return;
    }
    await load();
  }

  async function pushCoverToSpotify() {
    if (!selected || !selected.cover_image_url) return;
    if (!selected.spotify_playlist_id) {
      toast({ title: "Publique a playlist primeiro", description: "A capa só pode ser enviada após a publicação no Spotify.", variant: "destructive" });
      return;
    }
    setUploadingCover(true);
    const { data, error } = await supabase.functions.invoke("upload-playlist-cover", {
      body: { template_id: selected.id, image_url: selected.cover_image_url },
    });
    setUploadingCover(false);
    if (error || !(data as any)?.ok) {
      toast({ title: "Falha ao enviar capa", description: error?.message || (data as any)?.error || "Erro", variant: "destructive" });
      return;
    }
    toast({ title: "Capa enviada ao Spotify" });
  }

  async function publishToSpotify() {
    if (!selected) return;
    setPublishing(true);
    const { data, error } = await supabase.functions.invoke("create-spotify-playlist", {
      body: {
        template_id: selected.id,
        spotify_user_id: pubAccount || undefined,
        public: pubPublic,
      },
    });
    setPublishing(false);
    if (error || !(data as any)?.ok) {
      toast({ title: "Falha ao publicar", description: error?.message || (data as any)?.error || "Erro", variant: "destructive" });
      return;
    }
    toast({ title: "Playlist publicada", description: `${(data as any).tracks_added} faixas adicionadas` });
    await load();
    // se já tem capa selecionada, oferece envio automático
    if (selected.cover_image_url) {
      // re-fetch atualizado
      const fresh = (await supabase.from("playlist_templates").select("*").eq("id", selected.id).maybeSingle()).data;
      if (fresh?.spotify_playlist_id) {
        await supabase.functions.invoke("upload-playlist-cover", {
          body: { template_id: selected.id, image_url: selected.cover_image_url },
        });
      }
    }
  }

  return (
    <div className="space-y-6 max-w-[1600px] mx-auto">
      <PageHeader
        kicker="Módulo de Criação"
        icon={Sparkles}
        title="Criação"
        subtitle="Refinar, vestir e publicar templates aprovados como playlists no Spotify."
        actions={
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={cn("h-4 w-4 mr-2", loading && "animate-spin")} />
            Atualizar
          </Button>
        }
      />

      <Tabs value={step} onValueChange={(v) => setStep(v as Step)}>
        <TabsList className="grid grid-cols-4 w-full max-w-2xl">
          {STEPS.map((s, i) => {
            const Icon = s.icon;
            const disabled = s.id !== "fila" && !selected;
            return (
              <TabsTrigger key={s.id} value={s.id} disabled={disabled} className="gap-2">
                <span className="text-xs text-muted-foreground">{i + 1}</span>
                <Icon className="h-4 w-4" />
                <span className="hidden sm:inline">{s.label}</span>
              </TabsTrigger>
            );
          })}
        </TabsList>

        {/* ─────────── FILA ─────────── */}
        <TabsContent value="fila" className="space-y-3 mt-6">
          {loading ? (
            <Card className="p-8 text-center text-muted-foreground">Carregando…</Card>
          ) : templates.length === 0 ? (
            <Card className="p-12 text-center">
              <ListChecks className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
              <h3 className="font-semibold mb-1">Nenhum template na fila</h3>
              <p className="text-sm text-muted-foreground">
                Aprove templates no Cérebro para que apareçam aqui.
              </p>
            </Card>
          ) : (
            <div className="grid gap-2">
              {templates.map((t) => {
                const isCreated = t.status === "created";
                return (
                  <Card
                    key={t.id}
                    className={cn(
                      "p-4 flex items-center gap-4 hover:bg-muted/30 cursor-pointer transition-colors",
                      selectedId === t.id && "ring-1 ring-primary",
                    )}
                    onClick={() => openTemplate(t)}
                  >
                    <div className="h-14 w-14 rounded-md bg-muted flex-shrink-0 overflow-hidden">
                      {t.cover_image_url ? (
                        <img src={t.cover_image_url} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <div className="h-full w-full flex items-center justify-center text-muted-foreground">
                          <Music2 className="h-5 w-5" />
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{t.name}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {t.tracks_added > 0 ? `${t.tracks_added} faixas` : `${(t.track_seeds?.length ?? 0)} seeds`} •
                        {" "}score {Math.round((t.replication_score ?? 0) * 100) / 100}
                      </div>
                    </div>
                    <Badge variant={isCreated ? "default" : "secondary"} className="flex-shrink-0">
                      {isCreated ? "Publicada" : "Aprovada"}
                    </Badge>
                    {isCreated && t.spotify_url && (
                      <a href={t.spotify_url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
                         className="text-muted-foreground hover:text-primary">
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    )}
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* ─────────── EDITOR ─────────── */}
        <TabsContent value="editor" className="mt-6">
          {!selected ? (
            <EmptySelection />
          ) : (
            <div className="grid lg:grid-cols-2 gap-6">
              <Card className="p-5 space-y-4">
                <div>
                  <Label htmlFor="name">Nome</Label>
                  <Input id="name" value={editName} onChange={(e) => setEditName(e.target.value)} className="mt-1" />
                </div>
                <div>
                  <Label htmlFor="desc">Descrição</Label>
                  <Textarea
                    id="desc"
                    value={editDesc}
                    onChange={(e) => setEditDesc(e.target.value)}
                    rows={4}
                    maxLength={300}
                    className="mt-1"
                  />
                  <div className="text-xs text-muted-foreground mt-1">{editDesc.length}/300</div>
                </div>
                <Button onClick={saveEdit} disabled={savingEdit} className="w-full">
                  {savingEdit ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Check className="h-4 w-4 mr-2" />}
                  Salvar nome e descrição
                </Button>
              </Card>

              <Card className="p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <Label>Tracklist ({editTracks.length})</Label>
                  <Button size="sm" variant="outline" onClick={addTrack}>+ Adicionar</Button>
                </div>
                <ScrollArea className="h-[420px] -mr-2 pr-2">
                  <div className="space-y-1.5">
                    {editTracks.map((t, i) => (
                      <div key={i} className="flex items-center gap-1.5 group">
                        <span className="text-xs text-muted-foreground w-6 text-right">{i + 1}</span>
                        <Input value={t.nome} onChange={(e) => { const n = [...editTracks]; n[i] = { ...n[i], nome: e.target.value }; setEditTracks(n); }} placeholder="Música" className="h-8 text-xs" />
                        <Input value={t.artista} onChange={(e) => { const n = [...editTracks]; n[i] = { ...n[i], artista: e.target.value }; setEditTracks(n); }} placeholder="Artista" className="h-8 text-xs" />
                        <div className="flex flex-col">
                          <button onClick={() => moveTrack(i, -1)} className="text-[10px] text-muted-foreground hover:text-foreground leading-none">▲</button>
                          <button onClick={() => moveTrack(i, 1)} className="text-[10px] text-muted-foreground hover:text-foreground leading-none">▼</button>
                        </div>
                        <button onClick={() => removeTrack(i)} className="text-xs text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100">✕</button>
                      </div>
                    ))}
                    {editTracks.length === 0 && (
                      <div className="text-sm text-muted-foreground text-center py-8">Sem faixas. Adicione pelo menos 1.</div>
                    )}
                  </div>
                </ScrollArea>
                <Button onClick={saveEdit} disabled={savingEdit} variant="secondary" className="w-full">
                  {savingEdit ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                  Salvar tracklist
                </Button>
              </Card>
            </div>
          )}
        </TabsContent>

        {/* ─────────── CAPA ─────────── */}
        <TabsContent value="capa" className="mt-6 space-y-5">
          {!selected ? (
            <EmptySelection />
          ) : (
            <>
              <Card className="p-5 space-y-3">
                <Label htmlFor="prompt">Prompt da capa</Label>
                <Textarea
                  id="prompt"
                  value={coverPrompt}
                  onChange={(e) => setCoverPrompt(e.target.value)}
                  rows={3}
                  placeholder="Descreva o estilo visual desejado…"
                />
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">
                    Nano Banana gera 4 variações em paralelo. Sem texto na imagem.
                  </p>
                  <Button onClick={generateCovers} disabled={generatingCover}>
                    {generatingCover ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
                    Gerar 4 variações
                  </Button>
                </div>
              </Card>

              {selected.cover_variations && selected.cover_variations.length > 0 ? (
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  {selected.cover_variations.map((v) => {
                    const isSelected = selected.cover_selected_index === v.index;
                    return (
                      <button
                        key={v.index}
                        onClick={() => selectCover(v.index, v.url)}
                        className={cn(
                          "relative aspect-square rounded-lg overflow-hidden border-2 transition-all",
                          isSelected ? "border-primary ring-2 ring-primary/30" : "border-border hover:border-muted-foreground",
                        )}
                      >
                        <img src={v.url} alt="" className="w-full h-full object-cover" />
                        {isSelected && (
                          <div className="absolute top-2 right-2 bg-primary text-primary-foreground rounded-full p-1">
                            <Check className="h-4 w-4" />
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <Card className="p-12 text-center text-muted-foreground">
                  <ImageIcon className="h-10 w-10 mx-auto mb-3" />
                  Ainda sem capas. Gere as 4 variações.
                </Card>
              )}

              {selected.spotify_playlist_id && selected.cover_image_url && (
                <Card className="p-4 flex items-center justify-between">
                  <div className="text-sm text-muted-foreground">
                    Capa selecionada pronta para envio ao Spotify.
                  </div>
                  <Button onClick={pushCoverToSpotify} disabled={uploadingCover} variant="secondary">
                    {uploadingCover ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                    Enviar capa ao Spotify
                  </Button>
                </Card>
              )}
            </>
          )}
        </TabsContent>

        {/* ─────────── PUBLICAÇÃO ─────────── */}
        <TabsContent value="publicacao" className="mt-6">
          {!selected ? (
            <EmptySelection />
          ) : selected.status === "created" ? (
            <Card className="p-8 text-center space-y-3">
              <Check className="h-10 w-10 mx-auto text-primary" />
              <h3 className="text-lg font-semibold">Playlist publicada</h3>
              <p className="text-sm text-muted-foreground">
                {selected.tracks_added} faixas adicionadas{selected.tracks_failed > 0 ? `, ${selected.tracks_failed} falharam` : ""}.
              </p>
              {selected.spotify_url && (
                <a href={selected.spotify_url} target="_blank" rel="noreferrer">
                  <Button variant="outline">
                    <ExternalLink className="h-4 w-4 mr-2" />
                    Abrir no Spotify
                  </Button>
                </a>
              )}
            </Card>
          ) : (
            <Card className="p-5 space-y-5 max-w-xl mx-auto">
              <div>
                <Label>Conta Spotify</Label>
                <select
                  value={pubAccount}
                  onChange={(e) => setPubAccount(e.target.value)}
                  className="w-full mt-1 h-10 rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">Padrão (conta default)</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.spotify_user_id}>
                      {a.display_name ?? a.spotify_user_id} ({a.current_playlists}/{a.max_playlists})
                    </option>
                  ))}
                </select>
                {accounts.length === 0 && (
                  <div className="flex items-center gap-1.5 text-xs text-warning mt-2">
                    <AlertCircle className="h-3 w-3" />
                    Nenhuma conta ativa. Conecte uma em Configurações.
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Visibilidade</Label>
                  <p className="text-xs text-muted-foreground">
                    {pubPublic ? "Pública — aparece nas buscas." : "Privada — só você vê."}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {pubPublic ? <Globe className="h-4 w-4 text-primary" /> : <Lock className="h-4 w-4 text-muted-foreground" />}
                  <Switch checked={pubPublic} onCheckedChange={setPubPublic} />
                </div>
              </div>

              <Separator />

              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Nome</span><span className="font-medium truncate ml-3">{selected.name}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Faixas</span><span>{(selected.track_seeds?.length ?? 0)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Capa</span><span>{selected.cover_image_url ? "Selecionada" : "Não definida"}</span></div>
              </div>

              <Button onClick={publishToSpotify} disabled={publishing} className="w-full" size="lg">
                {publishing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
                Publicar no Spotify
              </Button>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function EmptySelection() {
  return (
    <Card className="p-12 text-center">
      <ListChecks className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
      <h3 className="font-semibold mb-1">Nenhum template selecionado</h3>
      <p className="text-sm text-muted-foreground">Volte para a aba Fila e escolha um template.</p>
    </Card>
  );
}
