import { memo, useEffect, useMemo, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Activity, Pause, Pencil, RefreshCw, ArrowDownRight, ArrowUpRight,
  Music2, FlaskConical, History, ListMusic, Search, Users, ExternalLink,
  AlertCircle, Wrench, ChevronDown, ChevronUp, Server,
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
import { usePersistedState } from "@/hooks/usePersistedState";
import { useSetSidebarKpis } from "@/contexts/SidebarContext";

/**
 * OPERAÇÃO — painel de controle das playlists já publicadas.
 * 3 abas: Playlists · Ajustes · Contas. Histórico fica colapsável no rodapé das Playlists.
 */

type OpStatus = "ativa" | "crescimento" | "queda" | "teste" | "pausada";

const STATUS_META: Record<OpStatus, { label: string; cls: string; icon: any }> = {
  ativa:        { label: "Ativa",       cls: "text-primary bg-primary/10 border-primary/30",   icon: Activity },
  crescimento:  { label: "Crescendo",   cls: "text-primary bg-primary/15 border-primary/40",   icon: ArrowUpRight },
  queda:        { label: "Em queda",    cls: "text-destructive bg-destructive/10 border-destructive/30", icon: ArrowDownRight },
  teste:        { label: "Em teste",    cls: "text-warning bg-warning/10 border-warning/30",   icon: FlaskConical },
  pausada:      { label: "Pausada",     cls: "text-muted-foreground bg-muted/30 border-border", icon: Pause },
};

// rótulos amigáveis para tipos técnicos do histórico
const ACTION_LABEL: Record<string, string> = {
  swap_tracks: "Troca de músicas",
  swap: "Troca",
  track_change: "Mudança de faixa",
  pause: "Pausada",
  resume: "Retomada",
  rename: "Renomeada",
  description_update: "Descrição atualizada",
  cover_update: "Capa atualizada",
};
const labelAction = (a: string) => ACTION_LABEL[a] ?? a.replace(/_/g, " ");

const TABS = [
  { id: "playlists", label: "Playlists", icon: ListMusic },
  { id: "ajustes",   label: "Ajustes",   icon: Wrench },
  { id: "contas",    label: "Contas",    icon: Users },
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
  cover_image_url: string | null;
};

type Adjustment = {
  id: string;
  template_id: string;
  action_type: string;
  status: string;
  created_at: string;
  details: any;
};

type AccountSummary = {
  total: number;
  active: number;
  capacity_used: number;
  capacity_max: number;
};

export default function Operacao() {
  const [tab, setTab] = usePersistedState<TabId>("operacao:tab", "playlists");
  const [filter, setFilter] = usePersistedState<"todas" | OpStatus>("operacao:filter", "todas");
  const [search, setSearch] = usePersistedState<string>("operacao:search", "");
  const [loading, setLoading] = useState(true);
  const [playlistsAll, setPlaylistsAll] = useState<OpPlaylist[]>([]);
  const [adjustments, setAdjustments] = useState<Adjustment[]>([]);
  const [accountsSummary, setAccountsSummary] = useState<AccountSummary>({ total: 0, active: 0, capacity_used: 0, capacity_max: 0 });

  const load = async () => {
    setLoading(true);
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();

    const [{ data: tpls }, { data: snaps }, { data: adjs }, { data: genres }, { data: accs }] = await Promise.all([
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
      supabase.from("accounts").select("status,current_playlists,max_playlists"),
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

    // resumo das contas
    const accList = accs ?? [];
    setAccountsSummary({
      total: accList.length,
      active: accList.filter(a => a.status === "active").length,
      capacity_used: accList.reduce((s, a) => s + (a.current_playlists ?? 0), 0),
      capacity_max: accList.reduce((s, a) => s + (a.max_playlists ?? 0), 0),
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

  // Sidebar KPIs: publicadas / em teste / em queda
  useSetSidebarKpis(
    playlistsAll.length > 0
      ? [
          {
            label: "Publicadas",
            value: playlistsAll.filter((p) => p.status === "ativa" || p.status === "crescimento").length,
            intent: "success",
          },
          {
            label: "Em teste",
            value: playlistsAll.filter((p) => p.status === "teste").length,
            intent: "warning",
          },
          {
            label: "Em queda",
            value: playlistsAll.filter((p) => p.status === "queda").length,
            intent: "danger",
          },
        ]
      : [],
  );

  const playlists = useMemo(() => {
    return playlistsAll.filter(p => {
      if (filter !== "todas" && p.status !== filter) return false;
      if (search && !p.nome.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [playlistsAll, filter, search]);

  const kpi = useMemo(() => {
    const queda = playlistsAll.filter(p => p.status === "queda").length;
    const crescendo = playlistsAll.filter(p => p.status === "crescimento").length;
    return {
      total: playlistsAll.length,
      crescendo,
      atencao: queda,
      capacidade: accountsSummary.capacity_max > 0
        ? `${accountsSummary.capacity_used}/${accountsSummary.capacity_max}`
        : "—",
      capacidadePct: accountsSummary.capacity_max > 0
        ? (accountsSummary.capacity_used / accountsSummary.capacity_max) * 100
        : 0,
    };
  }, [playlistsAll, accountsSummary]);


  return (
    <PageContainer>
      <PageHeader
        title="Operação"
        subtitle="Executar e gerenciar playlists"
        actions={
          <Button variant="outline" className="rounded-full h-9 gap-1.5" onClick={load} disabled={loading}>
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} /> Atualizar
          </Button>
        }
      />

      {/* KPIs operacionais — focados em decisão */}
      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiBig icon={Activity}      label="Total ativas"  value={formatNumber(kpi.total)}     hint="Playlists em operação" loading={loading} />
        <KpiBig icon={ArrowUpRight}  label="Crescendo"     value={formatNumber(kpi.crescendo)} tone="primary"     hint="Variação positiva"     loading={loading} />
        <KpiBig icon={AlertCircle}   label="Precisa atenção" value={formatNumber(kpi.atencao)} tone={kpi.atencao > 0 ? "destructive" : "default"} hint="Playlists em queda" loading={loading} />
        <KpiBig icon={Server}        label="Capacidade"    value={kpi.capacidade}              tone={kpi.capacidadePct >= 80 ? "warning" : "default"} hint={`${accountsSummary.active} contas ativas`} loading={loading} />
      </section>

      {/* TABS — 3 abas operacionais */}
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

      {/* Container das tabs com altura mínima estável (evita layout shift) */}
      <div className="min-h-[640px]">
        {/* PLAYLISTS */}
        {tab === "playlists" && (
          <section key="tab-playlists" className="space-y-4 animate-tab-in">
            <div className="flex flex-col sm:flex-row sm:items-center gap-2">
              <div className="relative w-full sm:max-w-xs">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar playlist..."
                  className="pl-9 h-9 bg-elevated border-border rounded-full text-sm"
                />
              </div>
              {/* Mobile: chips em uma linha com scroll-x; Desktop: wrap normal à direita */}
              <div
                className={cn(
                  "flex items-center gap-1.5 sm:ml-auto sm:flex-wrap",
                  "-mx-4 px-4 sm:mx-0 sm:px-0 overflow-x-auto sm:overflow-visible",
                  "[&::-webkit-scrollbar]:hidden [scrollbar-width:none]",
                  "[&>*]:shrink-0",
                )}
              >
                <FilterChip active={filter === "todas"}       onClick={() => setFilter("todas")}>Todas</FilterChip>
                <FilterChip active={filter === "ativa"}       onClick={() => setFilter("ativa")}>Ativas</FilterChip>
                <FilterChip active={filter === "crescimento"} onClick={() => setFilter("crescimento")}>Crescendo</FilterChip>
                <FilterChip active={filter === "queda"}       onClick={() => setFilter("queda")}>Em queda</FilterChip>
                <FilterChip active={filter === "teste"}       onClick={() => setFilter("teste")}>Teste</FilterChip>
                <FilterChip active={filter === "pausada"}     onClick={() => setFilter("pausada")}>Pausadas</FilterChip>
              </div>
            </div>

            <div className="nx-card !p-0 overflow-hidden">
              {/* Header da tabela: só desktop. No mobile usamos cards. */}
              <div className="hidden md:grid grid-cols-12 gap-3 px-4 py-3 text-[10px] uppercase tracking-wider text-muted-foreground font-bold border-b border-border">
                <div className="col-span-4">Playlist</div>
                <div className="col-span-2">Status</div>
                <div className="col-span-2 text-right">Seguidores</div>
                <div className="col-span-1 text-right">Faixas</div>
                <div className="col-span-1 text-right">Trocas (7d)</div>
                <div className="col-span-2 text-right">Ações</div>
              </div>
              {loading && playlistsAll.length === 0 ? (
                <SkeletonRows />
              ) : playlists.length === 0 ? (
                <EmptyRow
                  title={playlistsAll.length === 0 ? "Nenhuma playlist em operação" : "Nada com esse filtro"}
                  msg={playlistsAll.length === 0
                    ? "Quando uma playlist for publicada no Spotify pelo módulo Criação, ela aparece aqui automaticamente."
                    : "Tente outro filtro ou limpe a busca."}
                />
              ) : (
                playlists.map((p) => <PlaylistRow key={p.id} p={p} />)
              )}
            </div>

            {/* Histórico colapsável no rodapé */}
            <HistoryDrawer adjustments={adjustments} playlistsAll={playlistsAll} />
          </section>
        )}

        {/* AJUSTES — manutenção do dia-a-dia */}
        {tab === "ajustes" && (
          <section key="tab-ajustes" className="space-y-4 animate-tab-in">
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

        {/* CONTAS — sem o card explicativo redundante */}
        {tab === "contas" && (
          <section key="tab-contas" className="animate-tab-in">
            <AccountsManager />
          </section>
        )}
      </div>
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

const PlaylistRow = memo(function PlaylistRow({ p }: { p: OpPlaylist }) {
  return (
    <>
      {/* MOBILE: card empilhado */}
      <div className="md:hidden px-4 py-3 border-b border-border last:border-0 hover:bg-elevated/40 transition-colors">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-10 w-10 rounded-md bg-elevated border border-border shrink-0 flex items-center justify-center">
            <Music2 className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium truncate">{p.nome}</div>
            <div className="text-[11px] text-muted-foreground truncate capitalize">
              {p.genero}
            </div>
          </div>
          <StatusPill status={p.status} />
        </div>
        <div className="mt-2.5 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <div className="flex items-center gap-3">
            <span><span className="text-foreground font-medium tabular-nums">{formatNumber(p.seguidores)}</span> seguidores</span>
            <span><span className="text-foreground font-medium tabular-nums">{p.faixas ?? "—"}</span> faixas</span>
            <span><span className="text-foreground font-medium tabular-nums">{p.trocas7d ?? 0}</span> trocas</span>
          </div>
          <div className="flex items-center gap-0.5 -mr-1.5">
            {p.spotify_url && (
              <a href={p.spotify_url} target="_blank" rel="noreferrer" className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:text-primary" title="Abrir no Spotify">
                <ExternalLink className="h-4 w-4" />
              </a>
            )}
            <Button variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground" title="Editar"><Pencil className="h-4 w-4" /></Button>
            <Button variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground" title="Pausar"><Pause className="h-4 w-4" /></Button>
          </div>
        </div>
      </div>

      {/* DESKTOP: linha em grid (mantida) */}
      <div className="hidden md:grid grid-cols-12 gap-3 px-4 py-3 items-center border-b border-border last:border-0 hover:bg-elevated/40 transition-colors">
        <div className="col-span-4 flex items-center gap-3 min-w-0">
          <div className="h-10 w-10 rounded-md bg-elevated border border-border shrink-0 flex items-center justify-center">
            <Music2 className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-medium truncate">{p.nome}</div>
            <div className="text-[11px] text-muted-foreground truncate capitalize">
              {p.genero}{p.created_on_spotify_at && ` · publicada ${timeAgo(p.created_on_spotify_at)}`}
            </div>
          </div>
        </div>
        <div className="col-span-2"><StatusPill status={p.status} /></div>
        <div className="col-span-2 text-right text-sm tabular-nums">{formatNumber(p.seguidores)}</div>
        <div className="col-span-1 text-right text-sm tabular-nums">{p.faixas ?? "—"}</div>
        <div className="col-span-1 text-right text-sm tabular-nums">{p.trocas7d ?? 0}</div>
        <div className="col-span-2 flex items-center justify-end gap-1">
          {p.spotify_url && (
            <a href={p.spotify_url} target="_blank" rel="noreferrer" className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:text-primary" title="Abrir no Spotify">
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" title="Editar"><Pencil className="h-3.5 w-3.5" /></Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" title="Trocar faixas"><RefreshCw className="h-3.5 w-3.5" /></Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" title="Pausar"><Pause className="h-3.5 w-3.5" /></Button>
        </div>
      </div>
    </>
  );
});

/** Skeleton de linhas — preserva altura do container e evita "salto" visual durante o load. */
function SkeletonRows() {
  return (
    <div>
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="grid grid-cols-12 gap-3 px-4 py-3 items-center border-b border-border last:border-0">
          <div className="col-span-4 flex items-center gap-3">
            <Skeleton className="h-10 w-10 rounded-md bg-muted/60" />
            <div className="space-y-1.5 flex-1 min-w-0">
              <Skeleton className="h-3.5 w-3/4 bg-muted/60" />
              <Skeleton className="h-2.5 w-1/2 bg-muted/40" />
            </div>
          </div>
          <div className="col-span-2"><Skeleton className="h-5 w-20 rounded-full bg-muted/50" /></div>
          <div className="col-span-2 flex justify-end"><Skeleton className="h-3.5 w-14 bg-muted/50" /></div>
          <div className="col-span-1 flex justify-end"><Skeleton className="h-3.5 w-8 bg-muted/40" /></div>
          <div className="col-span-1 flex justify-end"><Skeleton className="h-3.5 w-6 bg-muted/40" /></div>
          <div className="col-span-2 flex justify-end gap-1">
            <Skeleton className="h-8 w-8 rounded-md bg-muted/40" />
            <Skeleton className="h-8 w-8 rounded-md bg-muted/40" />
          </div>
        </div>
      ))}
    </div>
  );
}

function HistoryDrawer({
  adjustments, playlistsAll,
}: { adjustments: Adjustment[]; playlistsAll: OpPlaylist[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="nx-card !p-0 overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 p-4 hover:bg-elevated/40 transition-colors"
      >
        <div className="h-9 w-9 rounded-full bg-elevated border border-border flex items-center justify-center shrink-0">
          <History className="h-4 w-4 text-primary" />
        </div>
        <div className="text-left flex-1 min-w-0">
          <h3 className="font-semibold text-sm">Histórico de alterações (7d)</h3>
          <p className="text-xs text-muted-foreground">
            {adjustments.length === 0 ? "Sem alterações nos últimos 7 dias." : `${adjustments.length} alteração(ões) registrada(s)`}
          </p>
        </div>
        {open ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
      </button>
      {open && (
        adjustments.length === 0 ? (
          <div className="p-6 border-t border-border">
            <EmptyInline msg="Sem alterações registradas nos últimos 7 dias." />
          </div>
        ) : (
          <div className="divide-y divide-border border-t border-border">
            {adjustments.map(a => {
              const tpl = playlistsAll.find(p => p.id === a.template_id);
              return (
                <div key={a.id} className="px-5 py-3 text-sm flex items-center gap-3">
                  <span className={cn(
                    "h-2 w-2 rounded-full shrink-0",
                    a.status === "success" ? "bg-primary" : a.status === "error" ? "bg-destructive" : "bg-warning",
                  )} />
                  <span className="font-medium text-xs capitalize">{labelAction(a.action_type)}</span>
                  <span className="text-muted-foreground text-xs truncate">{tpl?.nome ?? "Playlist removida"}</span>
                  <span className="ml-auto text-[11px] text-muted-foreground shrink-0">{timeAgo(a.created_at)}</span>
                </div>
              );
            })}
          </div>
        )
      )}
    </div>
  );
}

function EmptyRow({ title, msg }: { title: string; msg: string }) {
  return (
    <div className="px-6 py-12 text-center">
      <div className="h-10 w-10 rounded-full bg-elevated border border-border mx-auto flex items-center justify-center">
        <ListMusic className="h-4 w-4 text-muted-foreground" />
      </div>
      <h4 className="mt-3 font-semibold text-sm">{title}</h4>
      <p className="text-xs text-muted-foreground mt-1.5 max-w-md mx-auto">{msg}</p>
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
