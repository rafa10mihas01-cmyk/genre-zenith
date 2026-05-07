// /comunidade-admin — Painel admin da Comunidade (3 abas).
// Convites: gerar/listar/revogar. Membros: ver/suspender. Aprovações: validar provas.
import { useEffect, useState } from "react";
import { Check, Copy, Loader2, Plus, X } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader } from "@/components/PageHeader";
import { PageContainer } from "@/components/PageContainer";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

type Invite = {
  id: string;
  code: string;
  email: string | null;
  status: string;
  expires_at: string;
  created_at: string;
  note: string | null;
};

type Member = {
  id: string;
  user_id: string;
  display_name: string;
  instagram_handle: string | null;
  playlist_name: string | null;
  playlist_url: string | null;
  status: string;
  tier: string;
  points: number;
  joined_at: string;
};

type Participation = {
  id: string;
  member_id: string;
  status: string;
  proof_url: string | null;
  points_offered: number;
  created_at: string;
  proof_submitted_at: string | null;
  community_members: { display_name: string; playlist_name: string | null } | null;
  curator_deals: { song_name: string; song_artist: string | null } | null;
};

const baseUrl = typeof window !== "undefined" ? window.location.origin : "";

export default function ComunidadeAdmin() {
  const { user } = useAuth();
  const [tab, setTab] = useState("convites");

  return (
    <PageContainer>
      <PageHeader
        title="Comunidade"
        subtitle="Gerencie convites, membros e aprovações da comunidade beta"
        kicker="Módulo de Comunidade"
      />
      <Tabs value={tab} onValueChange={setTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="convites">Convites</TabsTrigger>
          <TabsTrigger value="campanhas">Campanhas</TabsTrigger>
          <TabsTrigger value="membros">Membros</TabsTrigger>
          <TabsTrigger value="aprovacoes">Aprovações</TabsTrigger>
          <TabsTrigger value="auditoria">Auditoria</TabsTrigger>
        </TabsList>
        <TabsContent value="convites"><ConvitesTab adminId={user?.id ?? ""} /></TabsContent>
        <TabsContent value="campanhas"><CampanhasTab adminId={user?.id ?? ""} /></TabsContent>
        <TabsContent value="membros"><MembrosTab /></TabsContent>
        <TabsContent value="aprovacoes"><AprovacoesTab /></TabsContent>
        <TabsContent value="auditoria"><AuditoriaTab /></TabsContent>
      </Tabs>
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
    <Card>
      <CardContent className="p-5 space-y-4">
        <div className="flex items-center justify-between">
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
          <div className="text-sm text-muted-foreground">Carregando…</div>
        ) : (
          <ul className="divide-y divide-border">
            {report.checks.map((c) => (
              <li key={c.check} className="flex items-center justify-between py-2.5">
                <div className="text-sm">{LABELS[c.check] ?? c.check}</div>
                <Badge
                  variant="outline"
                  className={`text-[10px] ${
                    c.level === "critical" ? "border-destructive/30 text-destructive"
                    : c.level === "warning" ? "border-yellow-500/30 text-yellow-400"
                    : "border-primary/30 text-primary"
                  }`}
                >
                  {c.level.toUpperCase()} · {c.count}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
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

function CampanhasTab({ adminId }: { adminId: string }) {
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
  useEffect(() => { load(); }, []);

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
    load();
  }

  async function setStatus(id: string, status: string) {
    const patch = status === "closed"
      ? { status, closed_at: new Date().toISOString() }
      : { status };
    const { error } = await supabase.from("community_campaigns").update(patch).eq("id", id);
    if (error) return toast.error("Falha", { description: error.message });
    load();
  }

  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="text-sm text-muted-foreground">{list.length} campanhas</div>
          <Button onClick={() => setOpen(true)} size="sm">
            <Plus className="h-4 w-4" /> Nova campanha
          </Button>
        </div>

        {loading ? (
          <div className="text-sm text-muted-foreground">Carregando…</div>
        ) : list.length === 0 ? (
          <div className="text-sm text-muted-foreground py-8 text-center">Nenhuma campanha ainda.</div>
        ) : (
          <ul className="divide-y divide-border">
            {list.map((c) => (
              <li key={c.id} className="flex items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm truncate">{c.title}</span>
                    <StatusBadge status={c.status} />
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground truncate">
                    {c.used_slots}/{c.max_slots} vagas · {c.points_per_member} pts · prazo {c.proof_window_hours}h
                  </div>
                </div>
                {c.status === "open" && (
                  <Button variant="outline" size="sm" onClick={() => setStatus(c.id, "closed")}>Fechar</Button>
                )}
                {c.status === "closed" && (
                  <Button variant="outline" size="sm" onClick={() => setStatus(c.id, "archived")}>Arquivar</Button>
                )}
                {c.status === "draft" && (
                  <Button size="sm" onClick={() => setStatus(c.id, "open")}>Abrir</Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>

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
    </Card>
  );
}

/* ============ CONVITES ============ */
function ConvitesTab({ adminId }: { adminId: string }) {
  const [list, setList] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [creating, setCreating] = useState(false);

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
  }, []);

  async function create() {
    if (!adminId) return;
    setCreating(true);
    const { error, data } = await supabase
      .from("community_invites")
      .insert({
        invited_by: adminId,
        email: email.trim() || null,
        note: note.trim() || null,
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
    toast.success("Convite gerado");
    const link = `${baseUrl}/comunidade/join/${data!.code}`;
    await navigator.clipboard?.writeText(link).catch(() => {});
    toast.message("Link copiado", { description: link });
    load();
  }

  async function revoke(id: string) {
    const { error } = await supabase
      .from("community_invites")
      .update({ status: "revoked" })
      .eq("id", id);
    if (error) return toast.error("Falha", { description: error.message });
    load();
  }

  async function copyLink(code: string) {
    const link = `${baseUrl}/comunidade/join/${code}`;
    await navigator.clipboard?.writeText(link);
    toast.success("Link copiado");
  }

  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="text-sm text-muted-foreground">{list.length} convites</div>
          <Button onClick={() => setOpen(true)} size="sm">
            <Plus className="h-4 w-4" /> Novo convite
          </Button>
        </div>

        {loading ? (
          <div className="text-sm text-muted-foreground">Carregando…</div>
        ) : list.length === 0 ? (
          <div className="text-sm text-muted-foreground py-8 text-center">Nenhum convite ainda.</div>
        ) : (
          <ul className="divide-y divide-border">
            {list.map((i) => {
              const expired = i.status === "pending" && new Date(i.expires_at) < new Date();
              const realStatus = expired ? "expired" : i.status;
              return (
                <li key={i.id} className="flex items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <code className="text-xs bg-elevated px-1.5 py-0.5 rounded">{i.code}</code>
                      <StatusBadge status={realStatus} />
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground truncate">
                      {i.email ?? "sem email"} · expira{" "}
                      {format(new Date(i.expires_at), "dd MMM", { locale: ptBR })}
                      {i.note ? ` · ${i.note}` : ""}
                    </div>
                  </div>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => copyLink(i.code)} title="Copiar link">
                    <Copy className="h-4 w-4" />
                  </Button>
                  {i.status === "pending" && (
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => revoke(i.id)} title="Revogar">
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>

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
    </Card>
  );
}

/* ============ MEMBROS ============ */
function MembrosTab() {
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
    load();
  }

  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <div className="text-sm text-muted-foreground">{list.length} membros</div>
        {loading ? (
          <div className="text-sm text-muted-foreground">Carregando…</div>
        ) : list.length === 0 ? (
          <div className="text-sm text-muted-foreground py-8 text-center">Nenhum membro ainda.</div>
        ) : (
          <ul className="divide-y divide-border">
            {list.map((m) => (
              <li key={m.id} className="flex items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm truncate">{m.display_name}</span>
                    <Badge variant="outline" className="capitalize text-[10px]">{m.tier}</Badge>
                    <StatusBadge status={m.status} />
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground truncate">
                    {m.playlist_name ?? "sem playlist"} · {m.points} pts · entrou{" "}
                    {format(new Date(m.joined_at), "dd MMM", { locale: ptBR })}
                  </div>
                </div>
                {m.status === "active" ? (
                  <Button variant="outline" size="sm" onClick={() => setStatus(m.id, "suspended")}>
                    Suspender
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" onClick={() => setStatus(m.id, "active")}>
                    Reativar
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/* ============ APROVAÇÕES ============ */
function AprovacoesTab() {
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
    load();
  }

  const pending = list.filter((p) => p.status === "submitted");

  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <div className="text-sm text-muted-foreground">{pending.length} aguardando revisão</div>
        {loading ? (
          <div className="text-sm text-muted-foreground">Carregando…</div>
        ) : list.length === 0 ? (
          <div className="text-sm text-muted-foreground py-8 text-center">Sem aprovações pendentes.</div>
        ) : (
          <ul className="divide-y divide-border">
            {list.map((p) => (
              <li key={p.id} className="flex items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm truncate">
                      {p.community_members?.display_name ?? "—"}
                    </span>
                    <StatusBadge status={p.status} />
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground truncate">
                    {p.curator_deals?.song_name ?? "—"} ·{" "}
                    {p.proof_url ? (
                      <a href={p.proof_url} target="_blank" rel="noreferrer" className="underline hover:text-foreground">
                        ver prova
                      </a>
                    ) : (
                      "sem prova ainda"
                    )}{" "}
                    · {p.points_offered} pts
                  </div>
                </div>
                {p.status === "submitted" && (
                  <>
                    <Button variant="outline" size="sm" disabled={busyId === p.id} onClick={() => review(p, "reject")}>
                      <X className="h-4 w-4" />
                    </Button>
                    <Button size="sm" disabled={busyId === p.id} onClick={() => review(p, "approve")}>
                      {busyId === p.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                    </Button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
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
