import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { PageContainer } from "@/components/PageContainer";
import { StatusDot } from "@/components/ui/status-dot";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { RefreshCw, Server, KeyRound, Pencil } from "lucide-react";
import { timeAgo } from "@/lib/format";

type VpsNode = {
  id: string;
  hostname: string;
  ip: string;
  status: "active" | "inactive";
  max_concurrent_sessions: number;
  last_heartbeat_at: string | null;
  notes: string | null;
};

type SpotifyAccount = {
  id: string;
  account_id: string;
  vps_node_id: string | null;
  email: string | null;
  display_name: string | null;
  status: "active" | "expired" | "inactive";
  last_login_at: string | null;
  session_file_path: string | null;
};

type Assignment = {
  vps_node_id: string | null;
  hostname: string | null;
  account_id: string;
  account_name: string;
  playlist_count: number;
};

const ACCOUNT_TONE: Record<string, "success" | "warning" | "danger" | "neutral"> = {
  active: "success",
  expired: "warning",
  inactive: "neutral",
};

export default function Infraestrutura({ embedded = false }: { embedded?: boolean } = {}) {
  const [vps, setVps] = useState<VpsNode[]>([]);
  const [accounts, setAccounts] = useState<SpotifyAccount[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [editVps, setEditVps] = useState<VpsNode | null>(null);
  const [editAcc, setEditAcc] = useState<SpotifyAccount | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [vpsRes, accRes, assignRes] = await Promise.all([
      supabase.from("vps_nodes").select("*").order("hostname"),
      supabase.from("spotify_accounts").select("*").order("display_name"),
      supabase.from("v_playlist_vps_assignment")
        .select("vps_node_id, hostname, account_id, account_name"),
    ]);
    setVps((vpsRes.data ?? []) as any);
    setAccounts((accRes.data ?? []) as any);
    // group assignments
    const grouped = new Map<string, Assignment>();
    (assignRes.data ?? []).forEach((r) => {
      const key = `${r.account_id}::${r.vps_node_id ?? ""}`;
      const cur = grouped.get(key);
      if (cur) cur.playlist_count++;
      else grouped.set(key, {
        vps_node_id: r.vps_node_id, hostname: r.hostname,
        account_id: r.account_id, account_name: r.account_name,
        playlist_count: 1,
      });
    });
    setAssignments(Array.from(grouped.values()));
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const Wrapper: any = embedded ? "div" : PageContainer;

  return (
    <Wrapper>
      {!embedded && (
        <PageHeader
        domain="system"
          kicker="Módulo de Sistema"
          title="Infraestrutura"
          subtitle="VPS, sessões e contas"
          actions={
            <Button variant="outline" onClick={load} disabled={loading} className="gap-1.5">
              <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
              Atualizar
            </Button>
          }
        />
      )}
      {embedded && (
        <div className="flex justify-end mb-3">
          <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-1.5">
            <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
            Atualizar
          </Button>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* VPS Nodes */}
        <section className="nx-card">
          <header className="flex items-center justify-between gap-2 mb-3 min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <Server className="h-4 w-4 text-muted-foreground shrink-0" />
              <h2 className="text-sm font-semibold truncate">Servidores</h2>
            </div>
            <span className="text-[11px] text-muted-foreground whitespace-nowrap shrink-0">{vps.length} nó(s)</span>
          </header>
          {loading && !vps.length ? (
            <Skeleton className="h-16 w-full" />
          ) : vps.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">Sem VPS.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {vps.map((v) => {
                const assigned = accounts.filter(a => a.vps_node_id === v.id && a.status === "active").length;
                return (
                  <li key={v.id} className="rounded-xl border border-border bg-elevated px-3 py-2.5 flex items-center gap-2 min-w-0">
                    <StatusDot variant={v.status === "active" ? "success" : "neutral"} pulse={v.status === "active"} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold leading-tight truncate">{v.hostname}</div>
                      <div className="text-[11px] text-muted-foreground tabular-nums truncate">{v.ip}</div>
                    </div>
                    <div className="text-right text-[11px] text-muted-foreground tabular-nums whitespace-nowrap shrink-0">
                      <div><span className="text-foreground font-semibold">{assigned}</span>/{v.max_concurrent_sessions} sessões</div>
                      <div className="truncate max-w-[110px]">{v.last_heartbeat_at ? `hb ${timeAgo(v.last_heartbeat_at)}` : "sem heartbeat"}</div>
                    </div>
                    <Button size="icon" variant="ghost" className="shrink-0 h-8 w-8" onClick={() => setEditVps(v)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Spotify Accounts */}
        <section className="nx-card">
          <header className="flex items-center justify-between gap-2 mb-3 min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <KeyRound className="h-4 w-4 text-muted-foreground shrink-0" />
              <h2 className="text-sm font-semibold truncate">Contas Spotify</h2>
            </div>
            <span className="text-[11px] text-muted-foreground whitespace-nowrap shrink-0">{accounts.length} conta(s)</span>
          </header>
          {loading && !accounts.length ? (
            <Skeleton className="h-16 w-full" />
          ) : accounts.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">Sem contas.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {accounts.map((a) => {
                const node = vps.find(v => v.id === a.vps_node_id);
                return (
                  <li key={a.id} className="rounded-xl border border-border bg-elevated px-3 py-2.5 flex items-center gap-2 min-w-0">
                    <StatusDot variant={ACCOUNT_TONE[a.status]} pulse={a.status === "active"} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold leading-tight truncate">{a.display_name ?? "—"}</div>
                      <div className="text-[11px] text-muted-foreground truncate">{a.email ?? "—"}</div>
                    </div>
                    <div className="text-right text-[11px] text-muted-foreground tabular-nums whitespace-nowrap shrink-0">
                      <div className="truncate max-w-[110px]">{node?.hostname ?? "sem VPS"}</div>
                      <div className="truncate max-w-[110px]">{a.last_login_at ? `login ${timeAgo(a.last_login_at)}` : "nunca logou"}</div>
                    </div>
                    <Button size="icon" variant="ghost" className="shrink-0 h-8 w-8" onClick={() => setEditAcc(a)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      {/* Mapa de atribuição */}
      <section className="nx-card mt-6">
        <header className="mb-3">
          <h2 className="text-sm font-semibold">Mapa de atribuição</h2>
          <p className="text-[11px] text-muted-foreground">Quantas playlists cada conta opera em cada servidor</p>
        </header>
        {loading && !assignments.length ? (
          <Skeleton className="h-16 w-full" />
        ) : assignments.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">Sem playlists.</p>
        ) : (
          <div className="-mx-2 overflow-x-auto">
            <table className="w-full text-sm min-w-[420px]">
              <thead>
                <tr className="text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border">
                  <th className="text-left font-medium py-2 px-2">Conta</th>
                  <th className="text-left font-medium py-2 px-2">VPS</th>
                  <th className="text-right font-medium py-2 px-2">Playlists</th>
                </tr>
              </thead>
              <tbody>
                {assignments.map((a, i) => (
                  <tr key={i} className="border-b border-border/60 last:border-0">
                    <td className="py-2 px-2 truncate">{a.account_name}</td>
                    <td className="py-2 px-2 text-muted-foreground">{a.hostname ?? <span className="text-warning">não atribuído</span>}</td>
                    <td className="py-2 px-2 text-right font-semibold tabular-nums">{a.playlist_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <EditVpsDialog vps={editVps} onClose={() => setEditVps(null)} onSaved={load} />
      <EditAccountDialog account={editAcc} vps={vps} onClose={() => setEditAcc(null)} onSaved={load} />
    </Wrapper>
  );
}

function EditVpsDialog({ vps, onClose, onSaved }: { vps: VpsNode | null; onClose: () => void; onSaved: () => void; }) {
  const [maxSessions, setMaxSessions] = useState(1);
  const [status, setStatus] = useState<"active" | "inactive">("active");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (vps) {
      setMaxSessions(vps.max_concurrent_sessions);
      setStatus(vps.status);
      setNotes(vps.notes ?? "");
    }
  }, [vps]);

  if (!vps) return null;

  async function save() {
    setSaving(true);
    const { error } = await supabase
      .from("vps_nodes")
      .update({ max_concurrent_sessions: maxSessions, status, notes: notes || null })
      .eq("id", vps!.id);
    setSaving(false);
    if (error) {
      toast({ title: "Erro ao salvar", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Servidor atualizado" });
    onSaved(); onClose();
  }

  return (
    <Dialog open={!!vps} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{vps.hostname}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="text-xs text-muted-foreground">IP: <span className="font-mono">{vps.ip}</span></div>
          <div>
            <Label>Sessões simultâneas</Label>
            <Input type="number" min={1} max={20} value={maxSessions} onChange={(e) => setMaxSessions(parseInt(e.target.value) || 1)} />
          </div>
          <div>
            <Label>Status</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as any)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Ativo</SelectItem>
                <SelectItem value="inactive">Inativo</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Notas</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Observações internas" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Salvando..." : "Salvar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditAccountDialog({ account, vps, onClose, onSaved }: { account: SpotifyAccount | null; vps: VpsNode[]; onClose: () => void; onSaved: () => void; }) {
  const [vpsId, setVpsId] = useState<string | null>(null);
  const [status, setStatus] = useState<"active" | "expired" | "inactive">("inactive");
  const [sessionPath, setSessionPath] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (account) {
      setVpsId(account.vps_node_id);
      setStatus(account.status);
      setSessionPath(account.session_file_path ?? "");
    }
  }, [account]);

  if (!account) return null;

  async function save() {
    setSaving(true);
    const { error } = await supabase
      .from("spotify_accounts")
      .update({
        vps_node_id: vpsId,
        status,
        session_file_path: sessionPath || null,
      })
      .eq("id", account!.id);
    setSaving(false);
    if (error) {
      toast({ title: "Erro ao salvar", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Conta atualizada" });
    onSaved(); onClose();
  }

  return (
    <Dialog open={!!account} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{account.display_name ?? account.email ?? "Conta"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>VPS atribuído</Label>
            <Select value={vpsId ?? "_none"} onValueChange={(v) => setVpsId(v === "_none" ? null : v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="_none">Nenhum</SelectItem>
                {vps.map((v) => (
                  <SelectItem key={v.id} value={v.id}>{v.hostname}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Status da sessão</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as any)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Ativa</SelectItem>
                <SelectItem value="expired">Expirada</SelectItem>
                <SelectItem value="inactive">Inativa</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Caminho do arquivo de sessão</Label>
            <Input value={sessionPath} onChange={(e) => setSessionPath(e.target.value)} placeholder="/opt/bot/sessions/abc.json" className="font-mono text-xs" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Salvando..." : "Salvar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
