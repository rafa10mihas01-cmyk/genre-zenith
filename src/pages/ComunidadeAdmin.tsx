// /comunidade-admin — Painel admin da Comunidade. Padrão visual igual a PlaylistDeals/Operação.
import { useEffect, useMemo, useState } from "react";
import {
  Check, ChevronDown, Copy, Loader2, Plus, X,
  Mail, Megaphone, Users as UsersIcon, ClipboardCheck, ShieldCheck,
  UserPlus, Sparkles,
} from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import { useExternalSplash } from "@/hooks/useExternalSplash";
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader } from "@/components/PageHeader";
import { PageContainer } from "@/components/PageContainer";
import { KpiBig } from "@/components/KpiBig";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useScreenField } from "@/lib/screen-state";
import { formatNumber } from "@/lib/format";

type Invite = {
  id: string; code: string; slug: string | null; email: string | null; status: string;
  expires_at: string; created_at: string; note: string | null;
};
type Member = {
  id: string; user_id: string; display_name: string;
  instagram_handle: string | null; playlist_name: string | null; playlist_url: string | null;
  status: string; tier: string; points: number; joined_at: string;
};
type Participation = {
  id: string; member_id: string; status: string; proof_url: string | null;
  points_offered: number; created_at: string; proof_submitted_at: string | null;
  community_members: { display_name: string; playlist_name: string | null } | null;
  curator_deals: { song_name: string; song_artist: string | null } | null;
};

const baseUrl = typeof window !== "undefined" ? window.location.origin : "";

type AdminTab = "convites" | "campanhas" | "membros" | "aprovacoes" | "auditoria";

const TABS: { id: AdminTab; label: string; icon: typeof Mail }[] = [
  { id: "convites",   label: "Convites",    icon: Mail },
  { id: "campanhas",  label: "Campanhas",   icon: Megaphone },
  { id: "membros",    label: "Membros",     icon: UsersIcon },
  { id: "aprovacoes", label: "Aprovações",  icon: ClipboardCheck },
  { id: "auditoria",  label: "Auditoria",   icon: ShieldCheck },
];

export default function ComunidadeAdmin() {
  const { user } = useAuth();
  const [tab, setTab] = useScreenField<AdminTab>("/comunidade-admin", "tab", "convites");
  const [counts, setCounts] = useState({
    convites: 0, campanhas: 0, membros: 0, aprovacoes: 0,
    convitesPendentes: 0, campanhasAbertas: 0,
  });

  async function loadCounts() {
    const [inv, camp, mem, part, invP, campO] = await Promise.all([
      supabase.from("community_invites").select("id", { count: "exact", head: true }),
      supabase.from("community_campaigns").select("id", { count: "exact", head: true }),
      supabase.from("community_members").select("id", { count: "exact", head: true }),
      supabase.from("community_participations").select("id", { count: "exact", head: true }).eq("status", "submitted"),
      supabase.from("community_invites").select("id", { count: "exact", head: true }).eq("status", "pending"),
      supabase.from("community_campaigns").select("id", { count: "exact", head: true }).eq("status", "open"),
    ]);
    setCounts({
      convites: inv.count ?? 0,
      campanhas: camp.count ?? 0,
      membros: mem.count ?? 0,
      aprovacoes: part.count ?? 0,
      convitesPendentes: invP.count ?? 0,
      campanhasAbertas: campO.count ?? 0,
    });
  }
  useEffect(() => {
    loadCounts();
    const h = () => loadCounts();
    window.addEventListener("comunidade-admin:refresh", h);
    return () => window.removeEventListener("comunidade-admin:refresh", h);
  }, []);

  const fire = (name: string) => window.dispatchEvent(new CustomEvent(name));

  return (
    <PageContainer>
      <PageHeader
        title="Comunidade"
        subtitle="Convites e membros"
        domain="community"
        manualKey="comunidade"

        actions={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button className="rounded-full h-9 gap-1.5 max-w-full" aria-label="Criar novo">
                <Plus className="h-4 w-4" /> <span className="truncate">Novo</span>
                <ChevronDown className="h-3.5 w-3.5 opacity-80" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56 rounded-xl p-1.5">
              <DropdownMenuItem
                className="gap-2 rounded-lg items-start py-2"
                onClick={() => { setTab("convites"); setTimeout(() => fire("comunidade-admin:new-invite"), 50); }}
              >
                <UserPlus className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
                <div className="flex flex-col">
                  <span className="text-sm font-medium leading-tight">Novo convite</span>
                  <span className="text-[11px] text-muted-foreground leading-tight">Liberar acesso à comunidade</span>
                </div>
              </DropdownMenuItem>
              <DropdownMenuItem
                className="gap-2 rounded-lg items-start py-2"
                onClick={() => { setTab("campanhas"); setTimeout(() => fire("comunidade-admin:new-campaign"), 50); }}
              >
                <Sparkles className="h-4 w-4 mt-0.5 shrink-0" />
                <div className="flex flex-col">
                  <span className="text-sm font-medium leading-tight">Nova campanha</span>
                  <span className="text-[11px] text-muted-foreground leading-tight">A partir de um deal aberto</span>
                </div>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />

      {/* KPIs — hierarquia cockpit: hero (Membros) + ação + ação + quiet */}
      <section className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <KpiBig
          tier="hero"
          icon={UsersIcon}
          label="Membros"
          value={formatNumber(counts.membros)}
          hint="Total ativo na comunidade"
          domain="community"
        />
        <KpiBig
          icon={Megaphone}
          label="Campanhas abertas"
          value={formatNumber(counts.campanhasAbertas)}
          hint={`${counts.campanhas} no total`}
          domain="campaigns"
        />
        <KpiBig
          icon={ClipboardCheck}
          label="Aguardando revisão"
          value={formatNumber(counts.aprovacoes)}
          hint="Provas para validar"
          domain="curators"
        />
        <KpiBig
          tier="quiet"
          icon={Mail}
          label="Convites pendentes"
          value={formatNumber(counts.convitesPendentes)}
          hint={`${counts.convites} no total`}
          domain="community"
        />
      </section>


      {/* TABS — mesmo padrão visual de Operação */}
      <div className="sticky top-0 z-30 -mt-px bg-background/95 supports-[backdrop-filter]:bg-background/80 backdrop-blur-md border-b border-border -mx-4 md:-mx-6">
        <div className="nx-tab-rail items-center gap-1 px-4 md:px-6">
          {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          const count =
            t.id === "convites" ? counts.convites :
            t.id === "campanhas" ? counts.campanhas :
            t.id === "membros" ? counts.membros :
            t.id === "aprovacoes" ? counts.aprovacoes :
            0;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "px-4 h-10 inline-flex items-center gap-2 text-sm font-medium border-b-2 transition-colors -mb-px shrink-0 whitespace-nowrap",
                active
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {t.label}
              {t.id !== "auditoria" && (
                <span
                  className={cn(
                    "ml-1 inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[10px] font-bold tabular-nums",
                    active ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
                  )}
                >
                  {count}
                </span>
              )}
            </button>
          );
          })}
        </div>
      </div>

      <div className="min-h-[480px] animate-tab-in">
        {tab === "convites" && <ConvitesTab adminId={user?.id ?? ""} onChange={loadCounts} />}
        {tab === "campanhas" && <CampanhasTab adminId={user?.id ?? ""} onChange={loadCounts} />}
        {tab === "membros" && <MembrosTab onChange={loadCounts} />}
        {tab === "aprovacoes" && <AprovacoesTab onChange={loadCounts} />}
        {tab === "auditoria" && <AuditoriaTab />}
      </div>
    </PageContainer>
  );
}


/* ============ AUDITORIA ============ */
function AuditoriaTab() {
  const [report, setReport] = useState<{ generated_at: string; checks: Array<{ check: string; count: number; level: string }> } | null>(null);
  const [loading, setLoading] = useState(false);

  async function run() {
    setLoading(true);
    const { data, error } = await supabase.rpc("community_audit_report" as never);
    setLoading(false);
    if (error) return toast.error("Falha", { description: error.message });
    setReport(data as never);
  }
  useEffect(() => { run(); }, []);

  const LABELS: Record<string, string> = {
    orphan_participations: "Participações órfãs",
    consumed_invites_no_member: "Convites consumidos sem membro",
    campaign_slot_invariant: "Slots de campanha inválidos",
    duplicate_playlists: "Playlists duplicadas",
    points_vs_ledger: "Pontos divergentes do ledger",
    stale_active_participations: "Participações expiradas ainda ativas",
    accept_after_close: "Aceites após fechamento",
    community_open_rls: "RLS abertas (USING true)",
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-sm text-muted-foreground">
          {report ? `Última auditoria: ${format(new Date(report.generated_at), "dd MMM HH:mm", { locale: ptBR })}` : "—"}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={async () => {
            const { data, error } = await supabase.rpc("community_expire_stale" as never);
            if (error) return toast.error("Falha", { description: error.message });
            toast.success(`${data ?? 0} participações expiradas`);
            run();
          }}>Expirar vencidas</Button>
          <Button size="sm" onClick={run} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Reexecutar"}
          </Button>
        </div>
      </div>
      {!report ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {[0,1,2,3,4,5,6,7].map((i) => (
            <div key={i} className="nx-card h-32 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {report.checks.map((c) => (
            <div
              key={c.check}
              className="rounded-2xl border border-border/50 border-l-2 border-l-domain-system/60 bg-card p-4 flex flex-col gap-3 h-full hover:border-foreground/20 hover:bg-[hsl(var(--elevated))] transition-colors"
            >
              <div className="text-[13px] font-medium text-foreground leading-snug">
                {LABELS[c.check] ?? c.check}
              </div>
              <div className="mt-auto flex items-center justify-between gap-2">
                <span className="text-[22px] font-semibold tabular-nums text-foreground">{c.count}</span>
                <Badge
                  variant="outline"
                  className={`text-[10px] ${
                    c.level === "critical" ? "border-destructive/30 text-destructive"
                    : c.level === "warning" ? "border-yellow-500/30 text-yellow-400"
                    : "border-primary/30 text-primary"
                  }`}
                >
                  {c.level.toUpperCase()}
                </Badge>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ============ CAMPANHAS (admin) ============ */
type AdminCampaign = {
  id: string;
  deal_id: string;
  title: string;
  brief: string | null;
  points_per_member: number;
  max_slots: number;
  used_slots: number;
  proof_window_hours: number;
  status: string;
  created_at: string;
};
type DealLite = { id: string; song_name: string; song_artist: string | null };

function CampanhasTab({ adminId, onChange }: { adminId: string; onChange?: () => void }) {
  const [list, setList] = useState<AdminCampaign[]>([]);
  const [deals, setDeals] = useState<DealLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    deal_id: "",
    title: "",
    brief: "",
    points: 100,
    slots: 10,
    window: 72,
  });

  async function load() {
    setLoading(true);
    const [c, d] = await Promise.all([
      supabase.from("community_campaigns").select("*").order("created_at", { ascending: false }).limit(100),
      supabase.from("curator_deals").select("id, song_name, song_artist").is("closed_at", null).order("created_at", { ascending: false }).limit(50),
    ]);
    setList((c.data as AdminCampaign[]) ?? []);
    setDeals((d.data as DealLite[]) ?? []);
    setLoading(false);
  }
  useEffect(() => {
    load();
    const h = () => setOpen(true);
    window.addEventListener("comunidade-admin:new-campaign", h);
    return () => window.removeEventListener("comunidade-admin:new-campaign", h);
  }, []);

  async function create() {
    if (!form.deal_id || !form.title.trim()) return;
    setCreating(true);
    const { error } = await supabase.from("community_campaigns").insert({
      deal_id: form.deal_id,
      title: form.title.trim(),
      brief: form.brief.trim() || null,
      points_per_member: form.points,
      max_slots: form.slots,
      proof_window_hours: form.window,
      status: "open",
      opened_at: new Date().toISOString(),
      created_by: adminId,
    });
    setCreating(false);
    if (error) return toast.error("Falha", { description: error.message });
    setOpen(false);
    setForm({ deal_id: "", title: "", brief: "", points: 100, slots: 10, window: 72 });
    toast.success("Campanha publicada");
    load(); onChange?.();
  }

  async function setStatus(id: string, status: string) {
    const patch = status === "closed"
      ? { status, closed_at: new Date().toISOString() }
      : { status };
    const { error } = await supabase.from("community_campaigns").update(patch).eq("id", id);
    if (error) return toast.error("Falha", { description: error.message });
    load(); onChange?.();
  }

  return (
    <>
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {[0,1,2,3,4,5,6,7].map((i) => (
            <div key={i} className="nx-card h-40 animate-pulse" />
          ))}
        </div>
      ) : list.length === 0 ? (
        <div className="nx-card py-12 text-center text-sm text-muted-foreground">Sem campanhas.</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {list.map((c) => {
            const pct = c.max_slots > 0 ? Math.min(100, Math.round((c.used_slots / c.max_slots) * 100)) : 0;
            return (
              <div
                key={c.id}
                className="rounded-2xl border border-border/50 border-l-2 border-l-domain-campaigns/60 bg-card p-4 flex flex-col gap-3 h-full hover:border-foreground/20 hover:bg-[hsl(var(--elevated))] transition-colors"
              >
                <div className="flex items-start justify-between gap-2 min-w-0">
                  <span className="font-medium text-sm leading-snug line-clamp-2 min-w-0">{c.title}</span>
                  <StatusBadge status={c.status} />
                </div>
                <div className="text-[11.5px] text-muted-foreground">
                  {c.used_slots}/{c.max_slots} vagas · {c.points_per_member} pts · prazo {c.proof_window_hours}h
                </div>
                <div className="h-1 rounded-full bg-muted overflow-hidden">
                  <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
                </div>
                <div className="mt-auto flex gap-2">
                  {c.status === "open" && (
                    <Button variant="outline" size="sm" className="flex-1" onClick={() => setStatus(c.id, "closed")}>Fechar</Button>
                  )}
                  {c.status === "closed" && (
                    <Button variant="outline" size="sm" className="flex-1" onClick={() => setStatus(c.id, "archived")}>Arquivar</Button>
                  )}
                  {c.status === "draft" && (
                    <Button size="sm" className="flex-1" onClick={() => setStatus(c.id, "open")}>Abrir</Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Nova campanha</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Deal</Label>
              <select
                value={form.deal_id}
                onChange={(e) => {
                  const d = deals.find((x) => x.id === e.target.value);
                  setForm((f) => ({ ...f, deal_id: e.target.value, title: f.title || (d ? `${d.song_name}${d.song_artist ? " — " + d.song_artist : ""}` : "") }));
                }}
                className="w-full h-10 rounded-md border border-border bg-elevated px-3 text-sm"
              >
                <option value="">Selecionar…</option>
                {deals.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.song_name}{d.song_artist ? ` — ${d.song_artist}` : ""}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Título</Label>
              <Input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Briefing curto (opcional)</Label>
              <Textarea value={form.brief} onChange={(e) => setForm((f) => ({ ...f, brief: e.target.value }))} rows={3} placeholder="Instruções para o membro…" />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Pontos</Label>
                <Input type="number" min={1} value={form.points} onChange={(e) => setForm((f) => ({ ...f, points: Math.max(1, +e.target.value || 0) }))} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Vagas</Label>
                <Input type="number" min={1} value={form.slots} onChange={(e) => setForm((f) => ({ ...f, slots: Math.max(1, +e.target.value || 0) }))} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Prazo (h)</Label>
                <Input type="number" min={1} value={form.window} onChange={(e) => setForm((f) => ({ ...f, window: Math.max(1, +e.target.value || 0) }))} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={create} disabled={creating || !form.deal_id || !form.title.trim()}>
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : "Publicar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/* ============ CONVITES ============ */
function ConvitesTab({ adminId, onChange }: { adminId: string; onChange?: () => void }) {
  const [list, setList] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [validityDays, setValidityDays] = useState<number>(14);
  const [creating, setCreating] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // tick a cada minuto pra manter contagem regressiva fresca
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  function countdown(iso: string): string {
    const ms = new Date(iso).getTime() - now;
    if (ms <= 0) return "expirado";
    const min = Math.floor(ms / 60_000);
    if (min < 60) return `expira em ${min} min`;
    const h = Math.floor(min / 60);
    if (h < 24) return `expira em ${h}h`;
    const d = Math.floor(h / 24);
    return `expira em ${d}d`;
  }

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from("community_invites")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);
    setList((data as Invite[]) ?? []);
    setLoading(false);
  }
  useEffect(() => {
    load();
    const h = () => setOpen(true);
    window.addEventListener("comunidade-admin:new-invite", h);
    return () => window.removeEventListener("comunidade-admin:new-invite", h);
  }, []);

  async function create() {
    if (!adminId) return;
    setCreating(true);
    const expiresAt = new Date(Date.now() + validityDays * 24 * 60 * 60 * 1000).toISOString();
    const { error, data } = await supabase
      .from("community_invites")
      .insert({
        invited_by: adminId,
        email: email.trim() || null,
        note: note.trim() || null,
        expires_at: expiresAt,
      })
      .select()
      .single();
    setCreating(false);
    if (error) {
      toast.error("Falha", { description: error.message });
      return;
    }
    setOpen(false);
    setEmail("");
    setNote("");
    setValidityDays(14);
    toast.success("Convite gerado");
    const id = (data as Invite | null)?.slug || data!.code;
    const link = `${baseUrl}/comunidade/join/${id}`;
    await navigator.clipboard?.writeText(link).catch(() => {});
    toast.message("Link copiado", { description: link });
    load(); onChange?.();
  }

  async function revoke(id: string) {
    const { error } = await supabase
      .from("community_invites")
      .update({ status: "revoked" })
      .eq("id", id);
    if (error) return toast.error("Falha", { description: error.message });
    load(); onChange?.();
  }

  async function copyLink(invite: Invite) {
    const id = invite.slug || invite.code;
    const link = `${baseUrl}/comunidade/join/${id}`;
    await navigator.clipboard?.writeText(link);
    toast.success("Link copiado");
  }

  return (
    <>
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {[0,1,2,3,4,5,6,7].map((i) => (
            <div key={i} className="nx-card h-36 animate-pulse" />
          ))}
        </div>
      ) : list.length === 0 ? (
        <div className="nx-card py-12 text-center text-sm text-muted-foreground">Sem convites.</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {list.map((i) => {
            const expired = i.status === "pending" && new Date(i.expires_at) < new Date();
            const realStatus = expired ? "expired" : i.status;
            return (
              <div
                key={i.id}
                className="rounded-2xl border border-border/50 border-l-2 border-l-domain-community/60 bg-card p-4 flex flex-col gap-3 h-full hover:border-foreground/20 hover:bg-[hsl(var(--elevated))] transition-colors"
              >
                <div className="flex items-start justify-between gap-2 min-w-0">
                  <code className="text-[11px] bg-elevated px-1.5 py-0.5 rounded truncate min-w-0">{i.slug || i.code}</code>
                  <StatusBadge status={realStatus} />
                </div>
                <div className="text-[11.5px] text-muted-foreground space-y-0.5 min-w-0">
                  <div className="truncate text-foreground/80">{i.email ?? "sem email"}</div>
                  {realStatus === "pending" && <div>{countdown(i.expires_at)}</div>}
                  {i.note && <div className="truncate" title={i.note}>{i.note}</div>}
                </div>
                <div className="mt-auto flex items-center gap-2">
                  <Button variant="outline" size="sm" className="flex-1 gap-1.5" onClick={() => copyLink(i)}>
                    <Copy className="h-3.5 w-3.5" /> Copiar
                  </Button>
                  {i.status === "pending" && (
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => revoke(i.id)} title="Revogar">
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Novo convite</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Email (opcional)</Label>
              <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="convidado@email.com" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Validade</Label>
              <div className="grid grid-cols-4 gap-2">
                {[1, 7, 14, 30].map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setValidityDays(d)}
                    className={cn(
                      "h-9 rounded-md border text-sm font-medium transition-colors",
                      validityDays === d
                        ? "border-primary bg-primary/15 text-primary"
                        : "border-border bg-elevated text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {d}d
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Nota interna (opcional)</Label>
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Quem é, contexto…" rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={create} disabled={creating}>
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : "Gerar e copiar link"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/* ============ MEMBROS ============ */
function MembrosTab({ onChange }: { onChange?: () => void }) {
  const onExternal = useExternalSplash();
  const [list, setList] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from("community_members")
      .select("*")
      .order("joined_at", { ascending: false });
    setList((data as Member[]) ?? []);
    setLoading(false);
  }
  useEffect(() => {
    load();
  }, []);

  async function setStatus(id: string, status: string) {
    const { error } = await supabase
      .from("community_members")
      .update({ status, suspended_at: status === "suspended" ? new Date().toISOString() : null })
      .eq("id", id);
    if (error) return toast.error("Falha", { description: error.message });
    load(); onChange?.();
  }

  return (
    <>
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {[0,1,2,3,4,5,6,7].map((i) => (
            <div key={i} className="nx-card h-44 animate-pulse" />
          ))}
        </div>
      ) : list.length === 0 ? (
        <div className="nx-card py-12 text-center text-sm text-muted-foreground">Sem membros.</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {list.map((m) => (
            <div
              key={m.id}
              className="rounded-2xl border border-border/50 border-l-2 border-l-domain-community/60 bg-card p-4 flex flex-col gap-3 h-full hover:border-foreground/20 hover:bg-[hsl(var(--elevated))] transition-colors"
            >
              <div className="flex items-start justify-between gap-2 min-w-0">
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-sm truncate">{m.display_name}</div>
                  <div className="flex items-center gap-1.5 mt-1">
                    <Badge variant="outline" className="capitalize text-[10px]">{m.tier}</Badge>
                    <StatusBadge status={m.status} />
                  </div>
                </div>
              </div>
              <div className="text-[11.5px] text-muted-foreground space-y-1 min-w-0">
                {m.playlist_url ? (
                  <a
                    href={m.playlist_url}
                    target="_blank"
                    rel="noreferrer"
                    onClick={() => onExternal()}
                    className="text-primary hover:underline truncate block"
                    title={m.playlist_url}
                  >
                    {m.playlist_name ?? "abrir playlist"}
                  </a>
                ) : (
                  <div className="truncate">{m.playlist_name ?? "sem playlist"}</div>
                )}
                {m.instagram_handle && (
                  <a
                    href={`https://instagram.com/${m.instagram_handle.replace(/^@/, "")}`}
                    target="_blank"
                    rel="noreferrer"
                    onClick={() => onExternal()}
                    className="text-primary hover:underline block truncate"
                  >
                    @{m.instagram_handle.replace(/^@/, "")}
                  </a>
                )}
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <span className="tabular-nums">{m.points} pts</span>
                  <span>·</span>
                  <span>entrou {format(new Date(m.joined_at), "dd MMM", { locale: ptBR })}</span>
                </div>
              </div>
              <div className="mt-auto">
                {m.status === "active" ? (
                  <Button variant="outline" size="sm" className="w-full" onClick={() => setStatus(m.id, "suspended")}>
                    Suspender
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" className="w-full" onClick={() => setStatus(m.id, "active")}>
                    Reativar
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/* ============ APROVAÇÕES ============ */
function AprovacoesTab({ onChange }: { onChange?: () => void }) {
  const [list, setList] = useState<Participation[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from("community_participations")
      .select(
        "id, member_id, status, proof_url, points_offered, created_at, proof_submitted_at, community_members(display_name, playlist_name), curator_deals(song_name, song_artist)",
      )
      .in("status", ["submitted", "accepted"])
      .order("proof_submitted_at", { ascending: false, nullsFirst: false });
    setList((data as unknown as Participation[]) ?? []);
    setLoading(false);
  }
  useEffect(() => {
    load();
  }, []);

  async function review(p: Participation, action: "approve" | "reject") {
    setBusyId(p.id);
    const { error } = await supabase.rpc("community_review_participation" as never, {
      p_participation_id: p.id,
      p_action: action,
      p_note: null,
    } as never);
    setBusyId(null);
    if (error) return toast.error("Falha", { description: error.message });
    toast.success(action === "approve" ? "Aprovada" : "Recusada");
    load(); onChange?.();
  }

  const pending = list.filter((p) => p.status === "submitted");

  return (
    <>
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {[0,1,2,3,4,5,6,7].map((i) => (
            <div key={i} className="nx-card h-40 animate-pulse" />
          ))}
        </div>
      ) : list.length === 0 ? (
        <div className="nx-card py-12 text-center text-sm text-muted-foreground">Sem aprovações pendentes.</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {list.map((p) => (
            <div
              key={p.id}
              className="rounded-2xl border border-border/50 border-l-2 border-l-domain-curators/60 bg-card p-4 flex flex-col gap-3 h-full hover:border-foreground/20 hover:bg-[hsl(var(--elevated))] transition-colors"
            >
              <div className="flex items-start justify-between gap-2 min-w-0">
                <span className="font-medium text-sm truncate min-w-0">
                  {p.community_members?.display_name ?? "—"}
                </span>
                <StatusBadge status={p.status} />
              </div>
              <div className="text-[11.5px] text-muted-foreground space-y-1 min-w-0">
                <div className="truncate text-foreground/80" title={p.curator_deals?.song_name ?? ""}>
                  {p.curator_deals?.song_name ?? "—"}
                </div>
                <div>
                  {p.proof_url ? (
                    <a href={p.proof_url} target="_blank" rel="noreferrer" className="text-primary underline hover:text-foreground">
                      ver prova
                    </a>
                  ) : (
                    <span>sem prova ainda</span>
                  )}
                  <span> · {p.points_offered} pts</span>
                </div>
              </div>
              {p.status === "submitted" && (
                <div className="mt-auto flex items-center gap-2">
                  <Button variant="outline" size="sm" className="flex-1" disabled={busyId === p.id} onClick={() => review(p, "reject")}>
                    <X className="h-4 w-4" />
                  </Button>
                  <Button size="sm" className="flex-1" disabled={busyId === p.id} onClick={() => review(p, "approve")}>
                    {busyId === p.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/* ============ shared ============ */
function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    pending: { label: "pendente", cls: "border-primary/30 text-primary" },
    accepted: { label: "aceito", cls: "border-primary/30 text-primary" },
    submitted: { label: "aguardando", cls: "border-yellow-500/30 text-yellow-400" },
    approved: { label: "aprovado", cls: "border-primary/30 text-primary" },
    rejected: { label: "recusado", cls: "border-destructive/30 text-destructive" },
    expired: { label: "expirado", cls: "border-border text-muted-foreground" },
    revoked: { label: "revogado", cls: "border-border text-muted-foreground" },
    active: { label: "ativo", cls: "border-primary/30 text-primary" },
    suspended: { label: "suspenso", cls: "border-destructive/30 text-destructive" },
    paused: { label: "pausado", cls: "border-border text-muted-foreground" },
  };
  const it = map[status] ?? { label: status, cls: "border-border" };
  return (
    <Badge variant="outline" className={`text-[10px] ${it.cls}`}>
      {it.label}
    </Badge>
  );
}
