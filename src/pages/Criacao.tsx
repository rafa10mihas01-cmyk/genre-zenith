import { useEffect, useMemo, useState } from "react";
import {
  Sparkles, ListChecks, Pencil, Image as ImageIcon, Send, Loader2,
  RefreshCw, Check, Music2, Globe, Lock, ExternalLink, AlertCircle,
  Search, Play, Plus,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/PageHeader";
import { PageContainer } from "@/components/PageContainer";
import { KpiBig } from "@/components/KpiBig";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

/**
 * CRIAÇÃO — pipeline de produção: pega templates aprovados pelo Cérebro,
 * passa por edição → capa → publicação no Spotify.
 *
 * Estrutura visual idêntica à OPERAÇÃO: PageHeader + KPIs + tabs underline
 * + busca/filtros pílula + tabela. Cada aba = uma etapa do pipeline.
 */

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
  creation_error: string | null;
  created_on_spotify_at: string | null;
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

type FilterId = "todas" | "sem_capa" | "com_capa" | "publicadas" | "falhas";

const TABS = [
  { id: "fila",       label: "Fila",        icon: ListChecks },
  { id: "editor",     label: "Editor",      icon: Pencil },
  { id: "capa",       label: "Capa",        icon: ImageIcon },
  { id: "publicacao", label: "Publicação",  icon: Send },
] as const;
type TabId = typeof TABS[number]["id"];

export default function Criacao() {
  const { toast } = useToast();
  const [tab, setTab] = useState<TabId>("fila");
  const [filter, setFilter] = useState<FilterId>("todas");
  const [search, setSearch] = useState("");
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
        .select("id,name,description,status,replication_score,cover_brief,cover_image_url,cover_variations,cover_selected_index,cover_generated_at,spotify_playlist_id,spotify_url,spotify_owner_id,track_seeds,tracks_added,tracks_failed,creation_error,created_on_spotify_at,genre_id,blueprint_id")
        .in("status", ["approved", "created"])
        .order("replication_score", { ascending: false })
        .limit(200),
      supabase.from("accounts")
        .select("id,display_name,spotify_user_id,current_playlists,max_playlists,status")
        .eq("status", "active")
        .order("current_playlists", { ascending: true }),
    ]);
    if (tplRes.data) setTemplates(tplRes.data as any);
    if (accRes.data) setAccounts(accRes.data as any);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  // ---- KPIs derivados ----
  const kpi = useMemo(() => {
    const naFila = templates.filter(t => t.status === "approved" && !t.spotify_playlist_id).length;
    const comCapa = templates.filter(t => !!t.cover_image_url).length;
    const semCapa = templates.filter(t => !t.cover_image_url).length;
    const sevenDaysAgo = Date.now() - 7 * 86400_000;
    const publicadas7d = templates.filter(t =>
      t.status === "created" &&
      t.created_on_spotify_at &&
      new Date(t.created_on_spotify_at).getTime() > sevenDaysAgo
    ).length;
    const falhas = templates.filter(t => !!t.creation_error).length;
    return { naFila, comCapa, semCapa, publicadas7d, falhas };
  }, [templates]);

  // ---- lista filtrada ----
  const visible = useMemo(() => {
    return templates.filter(t => {
      if (filter === "sem_capa" && t.cover_image_url) return false;
      if (filter === "com_capa" && !t.cover_image_url) return false;
      if (filter === "publicadas" && t.status !== "created") return false;
      if (filter === "falhas" && !t.creation_error) return false;
      if (search.trim() && !t.name.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [templates, filter, search]);

  function openTemplate(t: Template, jumpTo: TabId = "editor") {
    setSelectedId(t.id);
    setEditName(t.name);
    setEditDesc(t.description ?? "");
    setEditTracks(Array.isArray(t.track_seeds) ? [...t.track_seeds] : []);
    setCoverPrompt(t.cover_brief ?? "");
    setPubAccount("");
    setPubPublic(true);
    setTab(jumpTo);
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
  function removeTrack(idx: number) { setEditTracks(editTracks.filter((_, i) => i !== idx)); }
  function addTrack() { setEditTracks([...editTracks, { nome: "", artista: "" }]); }

  async function generateCovers() {
    if (!selected) return;
    setGeneratingCover(true);
    const { data, error } = await supabase.functions.invoke("generate-cover-variations", {
      body: { template_id: selected.id, custom_prompt: coverPrompt },
    });
    setGeneratingCover(false);
    if (error || !(data as any)?.ok) {
      toast({ title: "Falha ao gerar capas", description: error?.message || (data as any)?.error || "Erro", variant: "destructive" });
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
      toast({ title: "Publique primeiro", description: "A capa só vai pro Spotify após a playlist existir lá.", variant: "destructive" });
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
    if (selected.cover_image_url) {
      await supabase.functions.invoke("upload-playlist-cover", {
        body: { template_id: selected.id, image_url: selected.cover_image_url },
      });
    }
  }

  return (
    <PageContainer>
      <PageHeader
        kicker="Módulo de Criação"
        icon={Sparkles}
        title="Criação"
        subtitle="Refinar, vestir e publicar templates aprovados como playlists no Spotify."
        actions={
          <Button
            variant="premium"
            className="rounded-full h-9 gap-1.5"
            onClick={load}
            disabled={loading}
          >
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            Atualizar fila
          </Button>
        }
      />

      {/* KPIs */}
      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiBig icon={ListChecks}  label="Na fila"         value={kpi.naFila}       hint="Aguardando edição" />
        <KpiBig icon={ImageIcon}   label="Sem capa"        value={kpi.semCapa}      tone="warning"     hint="Faltam capas" />
        <KpiBig icon={Check}       label="Com capa"        value={kpi.comCapa}      tone="primary"     hint="Prontas pra publicar" />
        <KpiBig icon={Send}        label="Publicadas (7d)" value={kpi.publicadas7d} tone="primary"     hint="Foram pro Spotify" />
      </section>

      {/* TABS */}
      <div className="flex items-center gap-1 border-b border-border">
        {TABS.map((t, i) => {
          const Icon = t.icon;
          const active = tab === t.id;
          const disabled = t.id !== "fila" && !selected;
          return (
            <button
              key={t.id}
              onClick={() => !disabled && setTab(t.id)}
              disabled={disabled}
              className={cn(
                "px-4 h-10 inline-flex items-center gap-2 text-sm font-medium border-b-2 transition-colors -mb-px",
                active
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
                disabled && "opacity-40 cursor-not-allowed hover:text-muted-foreground",
              )}
            >
              <span className="text-[10px] font-bold tabular-nums">{i + 1}</span>
              <Icon className="h-3.5 w-3.5" />
              {t.label}
            </button>
          );
        })}
        {selected && (
          <div className="ml-auto flex items-center gap-2 pb-2 text-[11px] text-muted-foreground">
            Selecionada: <span className="font-medium text-foreground truncate max-w-[200px]">{selected.name}</span>
            <button onClick={() => setSelectedId(null)} className="text-muted-foreground hover:text-destructive">×</button>
          </div>
        )}
      </div>

      {/* ─────────── FILA ─────────── */}
      {tab === "fila" && (
        <section className="space-y-4">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar template..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 h-9 bg-elevated border-border rounded-full text-sm"
              />
            </div>
            <div className="flex items-center gap-1.5 ml-auto flex-wrap">
              <FilterChip active={filter === "todas"}      onClick={() => setFilter("todas")}>Todas</FilterChip>
              <FilterChip active={filter === "sem_capa"}   onClick={() => setFilter("sem_capa")}>Sem capa</FilterChip>
              <FilterChip active={filter === "com_capa"}   onClick={() => setFilter("com_capa")}>Com capa</FilterChip>
              <FilterChip active={filter === "publicadas"} onClick={() => setFilter("publicadas")}>Publicadas</FilterChip>
              <FilterChip active={filter === "falhas"}     onClick={() => setFilter("falhas")}>Falhas</FilterChip>
            </div>
          </div>

          <div className="nx-card !p-0 overflow-hidden">
            <div className="grid grid-cols-12 gap-3 px-4 py-3 text-[10px] uppercase tracking-wider text-muted-foreground font-bold border-b border-border">
              <div className="col-span-5">Template</div>
              <div className="col-span-2">Status</div>
              <div className="col-span-1 text-right">Faixas</div>
              <div className="col-span-1 text-right">Score</div>
              <div className="col-span-1 text-center">Capa</div>
              <div className="col-span-2 text-right">Ações</div>
            </div>
            {loading ? (
              <div className="px-6 py-12 text-center text-xs text-muted-foreground">Carregando…</div>
            ) : visible.length === 0 ? (
              <EmptyRow
                title={templates.length === 0 ? "Nenhum template na fila" : "Nada combina com o filtro"}
                msg={templates.length === 0
                  ? "Aprove templates no Cérebro para que apareçam aqui prontos pra serem refinados, vestidos e publicados."
                  : "Ajuste o filtro ou a busca pra ver mais templates."}
              />
            ) : (
              visible.map((t) => (
                <TemplateRow
                  key={t.id}
                  t={t}
                  selected={selectedId === t.id}
                  onOpen={(jump) => openTemplate(t, jump)}
                />
              ))
            )}
          </div>
        </section>
      )}

      {/* ─────────── EDITOR ─────────── */}
      {tab === "editor" && (
        selected ? (
          <section className="grid lg:grid-cols-2 gap-4">
            <div className="nx-card space-y-4">
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-full bg-elevated border border-border flex items-center justify-center">
                  <Pencil className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <h3 className="font-semibold">Identidade</h3>
                  <p className="text-xs text-muted-foreground">Nome e descrição que vão aparecer no Spotify.</p>
                </div>
              </div>
              <div>
                <Label htmlFor="name" className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">Nome</Label>
                <Input id="name" value={editName} onChange={(e) => setEditName(e.target.value)} className="mt-1.5 h-10" />
              </div>
              <div>
                <Label htmlFor="desc" className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">Descrição</Label>
                <Textarea id="desc" value={editDesc} onChange={(e) => setEditDesc(e.target.value)} rows={4} maxLength={300} className="mt-1.5" />
                <div className="text-[11px] text-muted-foreground mt-1 tabular-nums">{editDesc.length}/300</div>
              </div>
              <Button onClick={saveEdit} disabled={savingEdit} className="w-full">
                {savingEdit ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Check className="h-4 w-4 mr-2" />}
                Salvar identidade
              </Button>
            </div>

            <div className="nx-card space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-full bg-elevated border border-border flex items-center justify-center">
                    <Music2 className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-semibold">Tracklist</h3>
                    <p className="text-xs text-muted-foreground">{editTracks.length} faixa{editTracks.length === 1 ? "" : "s"}</p>
                  </div>
                </div>
                <Button size="sm" variant="outline" onClick={addTrack} className="rounded-full gap-1.5 h-8">
                  <Plus className="h-3.5 w-3.5" /> Adicionar
                </Button>
              </div>
              <ScrollArea className="h-[380px] -mr-2 pr-2">
                <div className="space-y-1.5">
                  {editTracks.map((t, i) => (
                    <div key={i} className="flex items-center gap-1.5 group">
                      <span className="text-[11px] text-muted-foreground w-6 text-right tabular-nums">{i + 1}</span>
                      <Input value={t.nome} onChange={(e) => { const n = [...editTracks]; n[i] = { ...n[i], nome: e.target.value }; setEditTracks(n); }} placeholder="Música" className="h-8 text-xs" />
                      <Input value={t.artista} onChange={(e) => { const n = [...editTracks]; n[i] = { ...n[i], artista: e.target.value }; setEditTracks(n); }} placeholder="Artista" className="h-8 text-xs" />
                      <div className="flex flex-col leading-none">
                        <button onClick={() => moveTrack(i, -1)} className="text-[10px] text-muted-foreground hover:text-foreground">▲</button>
                        <button onClick={() => moveTrack(i, 1)} className="text-[10px] text-muted-foreground hover:text-foreground">▼</button>
                      </div>
                      <button onClick={() => removeTrack(i)} className="text-xs text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 w-5">✕</button>
                    </div>
                  ))}
                  {editTracks.length === 0 && (
                    <div className="py-8 text-center text-xs text-muted-foreground border border-dashed border-border rounded-xl">
                      Sem faixas. Adicione pelo menos uma.
                    </div>
                  )}
                </div>
              </ScrollArea>
              <Button onClick={saveEdit} disabled={savingEdit} variant="secondary" className="w-full">
                {savingEdit ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                Salvar tracklist
              </Button>
            </div>
          </section>
        ) : <EmptySelection onBack={() => setTab("fila")} />
      )}

      {/* ─────────── CAPA ─────────── */}
      {tab === "capa" && (
        selected ? (
          <section className="space-y-4">
            <div className="nx-card space-y-3">
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-full bg-elevated border border-border flex items-center justify-center">
                  <Sparkles className="h-4 w-4 text-primary" />
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold">Geração de capa (Nano Banana)</h3>
                  <p className="text-xs text-muted-foreground">4 variações em paralelo. Sem texto na imagem.</p>
                </div>
                <Button onClick={generateCovers} disabled={generatingCover} variant="premium" className="rounded-full h-9 gap-1.5">
                  {generatingCover ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  Gerar 4 variações
                </Button>
              </div>
              <Textarea
                value={coverPrompt}
                onChange={(e) => setCoverPrompt(e.target.value)}
                rows={3}
                placeholder="Descreva o estilo visual desejado…"
              />
            </div>

            <div className="nx-card !p-0 overflow-hidden">
              <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">Variações</div>
                {selected.spotify_playlist_id && selected.cover_image_url && (
                  <Button onClick={pushCoverToSpotify} disabled={uploadingCover} size="sm" variant="outline" className="rounded-full h-8 gap-1.5">
                    {uploadingCover ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                    Enviar ao Spotify
                  </Button>
                )}
              </div>
              {selected.cover_variations && selected.cover_variations.length > 0 ? (
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 p-4">
                  {selected.cover_variations.map((v) => {
                    const isSelected = selected.cover_selected_index === v.index;
                    return (
                      <button
                        key={v.index}
                        onClick={() => selectCover(v.index, v.url)}
                        className={cn(
                          "relative aspect-square rounded-xl overflow-hidden border-2 transition-all",
                          isSelected
                            ? "border-primary ring-2 ring-primary/30"
                            : "border-border hover:border-muted-foreground",
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
                <div className="px-6 py-12 text-center">
                  <div className="h-10 w-10 rounded-full bg-elevated border border-border mx-auto flex items-center justify-center">
                    <ImageIcon className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <h4 className="mt-3 font-semibold text-sm">Sem capas geradas ainda</h4>
                  <p className="text-xs text-muted-foreground mt-1.5 max-w-md mx-auto">
                    Ajuste o prompt acima e clique em Gerar 4 variações.
                  </p>
                </div>
              )}
            </div>
          </section>
        ) : <EmptySelection onBack={() => setTab("fila")} />
      )}

      {/* ─────────── PUBLICAÇÃO ─────────── */}
      {tab === "publicacao" && (
        selected ? (
          selected.status === "created" ? (
            <section className="nx-card text-center space-y-3 max-w-xl mx-auto py-10">
              <div className="h-12 w-12 rounded-full bg-primary/15 border border-primary/40 mx-auto flex items-center justify-center">
                <Check className="h-5 w-5 text-primary" />
              </div>
              <h3 className="text-lg font-semibold">Playlist publicada</h3>
              <p className="text-sm text-muted-foreground">
                {selected.tracks_added} faixas adicionadas{selected.tracks_failed > 0 ? `, ${selected.tracks_failed} falharam` : ""}.
              </p>
              {selected.spotify_url && (
                <a href={selected.spotify_url} target="_blank" rel="noreferrer" className="inline-block">
                  <Button variant="outline" className="rounded-full gap-1.5">
                    <ExternalLink className="h-4 w-4" /> Abrir no Spotify
                  </Button>
                </a>
              )}
            </section>
          ) : (
            <section className="grid lg:grid-cols-2 gap-4">
              <div className="nx-card space-y-5">
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-full bg-elevated border border-border flex items-center justify-center">
                    <Send className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-semibold">Destino e visibilidade</h3>
                    <p className="text-xs text-muted-foreground">Conta Spotify e privacidade da playlist.</p>
                  </div>
                </div>

                <div>
                  <Label className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">Conta Spotify</Label>
                  <select
                    value={pubAccount}
                    onChange={(e) => setPubAccount(e.target.value)}
                    className="w-full mt-1.5 h-10 rounded-md border border-input bg-background px-3 text-sm"
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
                    <Label className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">Visibilidade</Label>
                    <p className="text-xs text-muted-foreground">
                      {pubPublic ? "Pública — aparece nas buscas." : "Privada — só você vê."}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {pubPublic ? <Globe className="h-4 w-4 text-primary" /> : <Lock className="h-4 w-4 text-muted-foreground" />}
                    <Switch checked={pubPublic} onCheckedChange={setPubPublic} />
                  </div>
                </div>
              </div>

              <div className="nx-card space-y-4">
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-full bg-elevated border border-border flex items-center justify-center">
                    <ListChecks className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-semibold">Resumo</h3>
                    <p className="text-xs text-muted-foreground">Confirme antes de publicar.</p>
                  </div>
                </div>

                <div className="space-y-2.5 text-sm">
                  <SummaryRow label="Nome" value={selected.name} />
                  <SummaryRow label="Descrição" value={(selected.description ?? "").slice(0, 60) + ((selected.description ?? "").length > 60 ? "…" : "") || "—"} />
                  <SummaryRow label="Faixas" value={String(selected.track_seeds?.length ?? 0)} />
                  <SummaryRow label="Capa" value={selected.cover_image_url ? "Selecionada" : "Não definida"} valueTone={selected.cover_image_url ? "primary" : "muted"} />
                  <SummaryRow label="Visibilidade" value={pubPublic ? "Pública" : "Privada"} />
                </div>

                {selected.creation_error && (
                  <div className="text-xs text-destructive bg-destructive/10 border border-destructive/30 rounded-md p-2">
                    Última falha: {selected.creation_error}
                  </div>
                )}

                <Button onClick={publishToSpotify} disabled={publishing} className="w-full" size="lg" variant="premium">
                  {publishing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />}
                  Publicar no Spotify
                </Button>
              </div>
            </section>
          )
        ) : <EmptySelection onBack={() => setTab("fila")} />
      )}
    </PageContainer>
  );
}

/* ---------------- helpers UI ---------------- */

function FilterChip({
  active, onClick, children,
}: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "h-8 px-3 rounded-full text-xs font-medium border transition-colors",
        active
          ? "bg-primary/15 border-primary/40 text-primary"
          : "bg-elevated border-border text-muted-foreground hover:text-foreground hover:border-border",
      )}
    >
      {children}
    </button>
  );
}

function StatusPill({ template }: { template: Template }) {
  if (template.creation_error) {
    return <span className="inline-flex items-center gap-1 px-2 h-6 rounded-full border text-[11px] font-medium text-destructive bg-destructive/10 border-destructive/30">
      <AlertCircle className="h-3 w-3" /> Falha
    </span>;
  }
  if (template.status === "created") {
    return <span className="inline-flex items-center gap-1 px-2 h-6 rounded-full border text-[11px] font-medium text-primary bg-primary/15 border-primary/40">
      <Check className="h-3 w-3" /> Publicada
    </span>;
  }
  return <span className="inline-flex items-center gap-1 px-2 h-6 rounded-full border text-[11px] font-medium text-muted-foreground bg-muted/30 border-border">
    <ListChecks className="h-3 w-3" /> Aprovada
  </span>;
}

function TemplateRow({
  t, selected, onOpen,
}: { t: Template; selected: boolean; onOpen: (jump?: TabId) => void }) {
  return (
    <div className={cn(
      "grid grid-cols-12 gap-3 px-4 py-3 items-center border-b border-border last:border-0 hover:bg-elevated/40 transition-colors",
      selected && "bg-elevated/60",
    )}>
      <div className="col-span-5 flex items-center gap-3 min-w-0">
        <div className="h-10 w-10 rounded-md bg-elevated border border-border shrink-0 overflow-hidden">
          {t.cover_image_url ? (
            <img src={t.cover_image_url} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="h-full w-full flex items-center justify-center text-muted-foreground">
              <Music2 className="h-4 w-4" />
            </div>
          )}
        </div>
        <div className="min-w-0">
          <div className="text-sm font-medium truncate">{t.name}</div>
          <div className="text-[11px] text-muted-foreground truncate">
            {t.spotify_url ? (
              <a href={t.spotify_url} target="_blank" rel="noreferrer" className="hover:text-primary inline-flex items-center gap-1">
                Spotify <ExternalLink className="h-2.5 w-2.5" />
              </a>
            ) : "Sem playlist no Spotify"}
          </div>
        </div>
      </div>
      <div className="col-span-2"><StatusPill template={t} /></div>
      <div className="col-span-1 text-right text-sm tabular-nums">{t.tracks_added > 0 ? t.tracks_added : (t.track_seeds?.length ?? 0)}</div>
      <div className="col-span-1 text-right text-sm tabular-nums">{(Math.round((t.replication_score ?? 0) * 100) / 100).toFixed(2)}</div>
      <div className="col-span-1 flex justify-center">
        <span className={cn(
          "h-2 w-2 rounded-full",
          t.cover_image_url ? "bg-primary" : "bg-muted-foreground/40",
        )} />
      </div>
      <div className="col-span-2 flex items-center justify-end gap-1">
        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" onClick={() => onOpen("editor")} title="Editor">
          <Pencil className="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" onClick={() => onOpen("capa")} title="Capa">
          <ImageIcon className="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" onClick={() => onOpen("publicacao")} title="Publicação">
          <Send className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

function SummaryRow({
  label, value, valueTone,
}: { label: string; value: string; valueTone?: "primary" | "muted" }) {
  const cls = valueTone === "primary" ? "text-primary" : valueTone === "muted" ? "text-muted-foreground" : "text-foreground";
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-muted-foreground text-xs uppercase tracking-wider font-bold">{label}</span>
      <span className={cn("font-medium truncate text-right", cls)}>{value}</span>
    </div>
  );
}

function EmptyRow({ title, msg }: { title: string; msg: string }) {
  return (
    <div className="px-6 py-12 text-center">
      <div className="h-10 w-10 rounded-full bg-elevated border border-border mx-auto flex items-center justify-center">
        <ListChecks className="h-4 w-4 text-muted-foreground" />
      </div>
      <h4 className="mt-3 font-semibold text-sm">{title}</h4>
      <p className="text-xs text-muted-foreground mt-1.5 max-w-md mx-auto">{msg}</p>
    </div>
  );
}

function EmptySelection({ onBack }: { onBack: () => void }) {
  return (
    <div className="nx-card text-center py-12">
      <div className="h-10 w-10 rounded-full bg-elevated border border-border mx-auto flex items-center justify-center">
        <ListChecks className="h-4 w-4 text-muted-foreground" />
      </div>
      <h4 className="mt-3 font-semibold text-sm">Nenhum template selecionado</h4>
      <p className="text-xs text-muted-foreground mt-1.5 max-w-md mx-auto">
        Volte à Fila e escolha um template pra começar.
      </p>
      <Button onClick={onBack} variant="outline" size="sm" className="mt-4 rounded-full gap-1.5">
        <ListChecks className="h-3.5 w-3.5" /> Ir pra Fila
      </Button>
    </div>
  );
}
