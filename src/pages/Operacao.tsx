import { useEffect, useMemo, useState } from "react";
import {
  Activity, Pause, Pencil, RefreshCw, ArrowDownRight, ArrowUpRight,
  Music2, FlaskConical, History, ListMusic, Plus, Search, Users, ExternalLink,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/PageHeader";
import { KpiBig } from "@/components/KpiBig";
import { AccountsManager } from "@/components/operacao/AccountsManager";
import { PageContainer } from "@/components/PageContainer";
import { supabase } from "@/integrations/supabase/client";
import { formatNumber, timeAgo } from "@/lib/format";

/**
 * OPERAÇÃO — painel de controle contínuo das playlists já publicadas.
 * Fonte de verdade: `playlist_templates` (status='created' + spotify_playlist_id)
 * + último snapshot em `playlist_metrics_snapshots` p/ derivar status.
 */

type OpStatus = "ativa" | "crescimento" | "queda" | "teste" | "pausada";

const STATUS_META: Record<OpStatus, { label: string; cls: string; icon: any }> = {
  ativa:        { label: "Ativa",       cls: "text-primary bg-primary/10 border-primary/30",   icon: Activity },
  crescimento:  { label: "Crescendo",   cls: "text-primary bg-primary/15 border-primary/40",   icon: ArrowUpRight },
  queda:        { label: "Em queda",    cls: "text-destructive bg-destructive/10 border-destructive/30", icon: ArrowDownRight },
  teste:        { label: "Em teste",    cls: "text-warning bg-warning/10 border-warning/30",   icon: FlaskConical },
  pausada:      { label: "Pausada",     cls: "text-muted-foreground bg-muted/30 border-border", icon: Pause },
};

const TABS = [
  { id: "playlists", label: "Playlists",      icon: ListMusic },
  { id: "musicas",   label: "Músicas",        icon: Music2 },
  { id: "contas",    label: "Contas",         icon: Users },
  { id: "manut",     label: "Manutenção",     icon: RefreshCw },
  { id: "historico", label: "Histórico",      icon: History },
] as const;

type TabId = typeof TABS[number]["id"];

type OpPlaylist = {
  id: string;
  nome: string;
  genero: string;
  status: OpStatus;
  seguidores: number;
  faixas: number;
  trocas7d: number;
  spotify_url: string | null;
  spotify_playlist_id: string | null;
  created_on_spotify_at: string | null;
};

type Adjustment = {
  id: string;
  template_id: string;
  action_type: string;
  status: string;
  created_at: string;
  details: any;
};

export default function Operacao() {
  const [tab, setTab] = useState<TabId>("playlists");
  const [filter, setFilter] = useState<"todas" | OpStatus>("todas");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [playlistsAll, setPlaylistsAll] = useState<OpPlaylist[]>([]);
  const [adjustments, setAdjustments] = useState<Adjustment[]>([]);

  const load = async () => {
    setLoading(true);
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();

    const [{ data: tpls }, { data: snaps }, { data: adjs }, { data: genres }] = await Promise.all([
      supabase
        .from("playlist_templates")
        .select("id,name,genre_id,status,spotify_playlist_id,spotify_url,created_on_spotify_at,followers_at_creation,tracks_added,performance_class")
        .not("spotify_playlist_id", "is", null)
        .order("created_on_spotify_at", { ascending: false, nullsFirst: false }),
      supabase
        .from("playlist_metrics_snapshots")
        .select("template_id,followers,total_tracks,collected_at")
        .order("collected_at", { ascending: false }),
      supabase
        .from("playlist_adjustments")
        .select("id,template_id,action_type,status,created_at,details")
        .gte("created_at", sevenDaysAgo)
        .order("created_at", { ascending: false }),
      supabase.from("genres").select("id,nome"),
    ]);

    // último snapshot por template
    const lastSnap = new Map<string, { followers: number; total_tracks: number | null }>();
    for (const s of snaps ?? []) {
      if (!lastSnap.has(s.template_id)) {
        lastSnap.set(s.template_id, { followers: s.followers, total_tracks: s.total_tracks });
      }
    }
    const genreMap = new Map((genres ?? []).map(g => [g.id, g.nome]));
    const trocasPorTpl = new Map<string, number>();
    for (const a of adjs ?? []) {
      if (a.action_type === "swap_tracks" || a.action_type === "swap" || a.action_type === "track_change") {
        trocasPorTpl.set(a.template_id, (trocasPorTpl.get(a.template_id) ?? 0) + 1);
      }
    }

    const list: OpPlaylist[] = (tpls ?? []).map(t => {
      const snap = lastSnap.get(t.id);
      const followersNow = snap?.followers ?? t.followers_at_creation ?? 0;
      const followersStart = t.followers_at_creation ?? 0;
      const delta = followersNow - followersStart;

      let status: OpStatus = "ativa";
      if (t.performance_class === "alta" || delta > 5) status = "crescimento";
      else if (t.performance_class === "baixa" || delta < -5) status = "queda";
      else if (!t.created_on_spotify_at || (Date.now() - new Date(t.created_on_spotify_at).getTime()) < 48 * 3600 * 1000) status = "teste";

      return {
        id: t.id,
        nome: t.name,
        genero: genreMap.get(t.genre_id) ?? "—",
        status,
        seguidores: followersNow,
        faixas: snap?.total_tracks ?? t.tracks_added ?? 0,
        trocas7d: trocasPorTpl.get(t.id) ?? 0,
        spotify_url: t.spotify_url,
        spotify_playlist_id: t.spotify_playlist_id,
        created_on_spotify_at: t.created_on_spotify_at,
      };
    });

    setPlaylistsAll(list);
    setAdjustments((adjs ?? []) as Adjustment[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, []);

  const playlists = useMemo(() => {
    return playlistsAll.filter(p => {
      if (filter !== "todas" && p.status !== filter) return false;
      if (search && !p.nome.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [playlistsAll, filter, search]);

  const kpi = useMemo(() => {
    return {
      total: playlistsAll.length,
      crescendo: playlistsAll.filter(p => p.status === "crescimento").length,
      queda: playlistsAll.filter(p => p.status === "queda").length,
      trocas: playlistsAll.reduce((s, p) => s + p.trocas7d, 0),
    };
  }, [playlistsAll]);


  return (
    <PageContainer>
      <PageHeader
        kicker="Módulo de Operação"
        icon={Activity}
        title="Operação"
        subtitle="Controlar playlists já publicadas: monitorar status, executar trocas e ajustes do dia-a-dia."
        actions={
          <Button variant="premium" className="rounded-full h-9 gap-1.5">
            <Plus className="h-4 w-4" /> Adicionar playlist
          </Button>
        }
      />

      {/* KPIs operacionais (zerados — sem mentir) */}
      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiBig icon={Activity}       label="Total ativas" value="0" hint="Playlists em operação" />
        <KpiBig icon={ArrowUpRight}   label="Crescendo"    value="0" tone="primary"     hint="Variação positiva" />
        <KpiBig icon={ArrowDownRight} label="Em queda"     value="0" tone="destructive" hint="Precisa atenção" />
        <KpiBig icon={RefreshCw}      label="Trocas (7d)"  value="0"                    hint="Músicas movimentadas" />
      </section>

      {/* TABS */}
      <div className="flex items-center gap-1 border-b border-border">
        {TABS.map(t => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "px-4 h-10 inline-flex items-center gap-2 text-sm font-medium border-b-2 transition-colors -mb-px",
                active
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* CONTEÚDO POR TAB */}
      {tab === "playlists" && (
        <section className="space-y-4">
          {/* Filtros + busca */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar playlist..."
                className="pl-9 h-9 bg-elevated border-border rounded-full text-sm"
              />
            </div>
            <div className="flex items-center gap-1.5 ml-auto">
              <FilterChip active={filter === "todas"}       onClick={() => setFilter("todas")}>Todas</FilterChip>
              <FilterChip active={filter === "ativa"}       onClick={() => setFilter("ativa")}>Ativas</FilterChip>
              <FilterChip active={filter === "crescimento"} onClick={() => setFilter("crescimento")}>Crescendo</FilterChip>
              <FilterChip active={filter === "queda"}       onClick={() => setFilter("queda")}>Em queda</FilterChip>
              <FilterChip active={filter === "teste"}       onClick={() => setFilter("teste")}>Teste</FilterChip>
              <FilterChip active={filter === "pausada"}     onClick={() => setFilter("pausada")}>Pausadas</FilterChip>
            </div>
          </div>

          {/* Tabela / lista */}
          <div className="nx-card !p-0 overflow-hidden">
            <div className="grid grid-cols-12 gap-3 px-4 py-3 text-[10px] uppercase tracking-wider text-muted-foreground font-bold border-b border-border">
              <div className="col-span-4">Playlist</div>
              <div className="col-span-2">Status</div>
              <div className="col-span-2 text-right">Seguidores</div>
              <div className="col-span-1 text-right">Faixas</div>
              <div className="col-span-1 text-right">Trocas (7d)</div>
              <div className="col-span-2 text-right">Ações</div>
            </div>
            {playlists.length === 0 ? (
              <EmptyRow
                title="Nenhuma playlist em operação"
                msg="Quando você adicionar uma playlist criada para o sistema operar, ela aparecerá aqui com status, métricas e controles."
                cta="Adicionar primeira playlist"
              />
            ) : (
              playlists.map((p, i) => <PlaylistRow key={i} p={p} />)
            )}
          </div>
        </section>
      )}

      {tab === "musicas" && (
        <section className="grid lg:grid-cols-2 gap-4">
          <PanelEmpty
            icon={ArrowUpRight}
            title="Entrando esta semana"
            msg="Músicas adicionadas nas playlists nos últimos 7 dias aparecerão aqui."
          />
          <PanelEmpty
            icon={ArrowDownRight}
            title="Saindo esta semana"
            msg="Músicas removidas das playlists nos últimos 7 dias aparecerão aqui."
          />
        </section>
      )}

      {tab === "contas" && (
        <section className="space-y-4">
          <div className="nx-card">
            <div className="flex items-center gap-3 mb-1">
              <div className="h-9 w-9 rounded-full bg-elevated border border-border flex items-center justify-center">
                <Users className="h-4 w-4 text-primary" />
              </div>
              <div>
                <h3 className="font-semibold">Contas Spotify em operação</h3>
                <p className="text-xs text-muted-foreground">
                  Gerencie status, capacidade e limites das contas usadas pra publicar playlists. Conexão de novas contas é feita em <strong>Configurações</strong>.
                </p>
              </div>
            </div>
          </div>
          <AccountsManager />
        </section>
      )}

      {tab === "manut" && (
        <section className="space-y-4">
          <div className="nx-card">
            <div className="flex items-center gap-3 mb-4">
              <div className="h-9 w-9 rounded-full bg-elevated border border-border flex items-center justify-center">
                <RefreshCw className="h-4 w-4 text-primary" />
              </div>
              <div>
                <h3 className="font-semibold">Trocas pendentes</h3>
                <p className="text-xs text-muted-foreground">Sugestões de troca baseadas em performance</p>
              </div>
            </div>
            <EmptyInline msg="Nenhuma troca sugerida no momento. Rode uma análise no Cérebro para gerar recomendações." />
          </div>

          <div className="nx-card">
            <div className="flex items-center gap-3 mb-4">
              <div className="h-9 w-9 rounded-full bg-elevated border border-border flex items-center justify-center">
                <FlaskConical className="h-4 w-4 text-warning" />
              </div>
              <div>
                <h3 className="font-semibold">Ajustes em teste</h3>
                <p className="text-xs text-muted-foreground">Mudanças em validação antes de promover</p>
              </div>
            </div>
            <EmptyInline msg="Nenhum teste ativo." />
          </div>
        </section>
      )}

      {tab === "historico" && (
        <section className="nx-card">
          <div className="flex items-center gap-3 mb-4">
            <div className="h-9 w-9 rounded-full bg-elevated border border-border flex items-center justify-center">
              <History className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h3 className="font-semibold">Histórico de alterações</h3>
              <p className="text-xs text-muted-foreground">Toda mudança feita nas playlists fica registrada aqui</p>
            </div>
          </div>
          <EmptyInline msg="Sem alterações registradas ainda." />
        </section>
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

function StatusPill({ status }: { status: OpStatus }) {
  const m = STATUS_META[status];
  const Icon = m.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 px-2 h-6 rounded-full border text-[11px] font-medium", m.cls)}>
      <Icon className="h-3 w-3" /> {m.label}
    </span>
  );
}

function PlaylistRow({ p }: { p: any }) {
  return (
    <div className="grid grid-cols-12 gap-3 px-4 py-3 items-center border-b border-border last:border-0 hover:bg-elevated/40 transition-colors">
      <div className="col-span-4 flex items-center gap-3 min-w-0">
        <div className="h-10 w-10 rounded-md bg-elevated border border-border shrink-0" />
        <div className="min-w-0">
          <div className="text-sm font-medium truncate">{p.nome}</div>
          <div className="text-[11px] text-muted-foreground truncate">{p.genero}</div>
        </div>
      </div>
      <div className="col-span-2"><StatusPill status={p.status} /></div>
      <div className="col-span-2 text-right text-sm tabular-nums">{p.seguidores ?? "—"}</div>
      <div className="col-span-1 text-right text-sm tabular-nums">{p.faixas ?? "—"}</div>
      <div className="col-span-1 text-right text-sm tabular-nums">{p.trocas7d ?? 0}</div>
      <div className="col-span-2 flex items-center justify-end gap-1">
        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground"><Pencil className="h-3.5 w-3.5" /></Button>
        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground"><RefreshCw className="h-3.5 w-3.5" /></Button>
        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground"><Pause className="h-3.5 w-3.5" /></Button>
      </div>
    </div>
  );
}

function EmptyRow({ title, msg, cta }: { title: string; msg: string; cta?: string }) {
  return (
    <div className="px-6 py-12 text-center">
      <div className="h-10 w-10 rounded-full bg-elevated border border-border mx-auto flex items-center justify-center">
        <ListMusic className="h-4 w-4 text-muted-foreground" />
      </div>
      <h4 className="mt-3 font-semibold text-sm">{title}</h4>
      <p className="text-xs text-muted-foreground mt-1.5 max-w-md mx-auto">{msg}</p>
      {cta && (
        <Button variant="premium" size="sm" className="mt-4 rounded-full gap-1.5">
          <Plus className="h-3.5 w-3.5" /> {cta}
        </Button>
      )}
    </div>
  );
}

function PanelEmpty({ icon: Icon, title, msg }: { icon: any; title: string; msg: string }) {
  return (
    <div className="nx-card">
      <div className="flex items-center gap-3 mb-4">
        <div className="h-9 w-9 rounded-full bg-elevated border border-border flex items-center justify-center">
          <Icon className="h-4 w-4 text-primary" />
        </div>
        <h3 className="font-semibold">{title}</h3>
      </div>
      <EmptyInline msg={msg} />
    </div>
  );
}

function EmptyInline({ msg }: { msg: string }) {
  return (
    <div className="py-8 text-center text-xs text-muted-foreground border border-dashed border-border rounded-xl">
      {msg}
    </div>
  );
}
