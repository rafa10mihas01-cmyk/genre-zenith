// AccountsManager — painel de contas Spotify conectadas (status, capacidade, edição).
// Usado no módulo OPERAÇÃO (gestão do dia-a-dia das contas).
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Users, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type Account = {
  id: string;
  spotify_user_id: string;
  display_name: string | null;
  email: string | null;
  status: string;
  max_playlists: number;
  current_playlists: number;
  last_sync_at: string | null;
  last_sync_found: number | null;
  last_sync_imported: number | null;
  last_sync_pending: number | null;
  last_sync_already_existed: number | null;
  last_sync_auto_archived: number | null;
};

export function AccountsManager() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("accounts")
      .select("*")
      .order("current_playlists", { ascending: true });
    setAccounts((data ?? []) as Account[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="nx-card h-40 animate-pulse" />
        ))}
      </div>
    );
  }

  if (accounts.length === 0) {
    return (
      <div className="nx-card text-center py-10 space-y-2">
        <Users className="h-8 w-8 mx-auto text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Nenhuma conta Spotify conectada ainda.</p>
        <p className="text-xs text-muted-foreground">
          Conecte em <strong>Configurações → Spotify</strong>. As contas aparecem aqui automaticamente.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold flex items-center gap-2">
          <Users className="h-4 w-4 text-primary" /> {accounts.length} conta{accounts.length > 1 ? "s" : ""} conectada{accounts.length > 1 ? "s" : ""}
        </h3>
        <Button variant="ghost" size="sm" onClick={load} className="h-7 text-xs">
          <RefreshCw className="h-3 w-3" /> Atualizar
        </Button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {accounts.map((a) => <AccountCard key={a.id} a={a} onChange={load} />)}
      </div>
    </div>
  );
}

function AccountCard({ a, onChange }: { a: Account; onChange: () => void }) {
  const [editing, setEditing] = useState(false);
  const [maxP, setMaxP] = useState(a.max_playlists);
  const [status, setStatus] = useState(a.status);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    const { error } = await supabase
      .from("accounts")
      .update({ max_playlists: maxP, status })
      .eq("id", a.id);
    setSaving(false);
    if (error) { toast.error("Erro", { description: error.message }); return; }
    toast.success("Conta atualizada");
    setEditing(false);
    onChange();
  };

  const usagePct = a.max_playlists > 0 ? (a.current_playlists / a.max_playlists) * 100 : 0;
  const statusCls =
    a.status === "active" ? "bg-primary/15 text-primary border-primary/30"
    : a.status === "paused" ? "bg-warning/15 text-warning border-warning/30"
    : "bg-destructive/15 text-destructive border-destructive/30";

  return (
    <div className="nx-card">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold truncate">{a.display_name ?? a.spotify_user_id}</div>
          <div className="text-[11px] text-muted-foreground truncate">{a.email ?? a.spotify_user_id}</div>
        </div>
        <span className={cn("text-[10px] uppercase font-bold px-2 py-0.5 rounded-full border", statusCls)}>
          {a.status}
        </span>
      </div>
      <div className="mt-3 space-y-1.5">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Uso</span>
          <span className="font-mono tabular-nums">{a.current_playlists}/{a.max_playlists}</span>
        </div>
        <div className="h-1.5 bg-elevated rounded-full overflow-hidden">
          <div
            className={cn("h-full rounded-full transition-[width,background-color] duration-300", usagePct > 80 ? "bg-destructive" : "bg-primary")}
            style={{ width: `${Math.min(100, usagePct)}%` }}
          />
        </div>
      </div>
      {a.last_sync_at && (
        <SyncStatusBlock a={a} />
      )}
      {editing ? (
        <div className="mt-3 space-y-2">
          <div className="flex items-center gap-2">
            <label className="text-[11px] text-muted-foreground w-16">Max</label>
            <Input type="number" value={maxP} onChange={(e) => setMaxP(Number(e.target.value))} className="h-7 text-xs" />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-[11px] text-muted-foreground w-16">Status</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="h-7 text-xs flex-1 rounded-md border border-border bg-background px-2"
            >
              <option value="active">active</option>
              <option value="paused">paused</option>
              <option value="limited">limited</option>
              <option value="banned">banned</option>
            </select>
          </div>
          <div className="flex items-center gap-1.5 justify-end">
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)} className="h-7 text-xs">Cancelar</Button>
            <Button size="sm" onClick={save} disabled={saving} className="h-7 text-xs">
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : null} Salvar
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="ghost" size="sm" onClick={() => setEditing(true)} className="mt-3 h-7 text-xs w-full">
          Editar limites
        </Button>
      )}
    </div>
  );
}

function SyncStatusBlock({ a }: { a: Account }) {
  const found = a.last_sync_found ?? 0;
  const imported = a.last_sync_imported ?? 0;
  const pending = a.last_sync_pending ?? 0;
  const fully = pending === 0 && found > 0;
  const when = a.last_sync_at ? new Date(a.last_sync_at).toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  }) : null;
  return (
    <div className={cn(
      "mt-3 rounded-md border px-2.5 py-2 text-[11px] space-y-1.5",
      fully ? "border-primary/30 bg-primary/5" : "border-warning/30 bg-warning/5",
    )}>
      <div className="flex items-center justify-between gap-2">
        <span className={cn("font-bold uppercase tracking-wide", fully ? "text-primary" : "text-warning")}>
          {fully ? "✅ Totalmente sincronizada" : "⚠️ Sincronização parcial"}
        </span>
        {when && <span className="text-muted-foreground">{when}</span>}
      </div>
      <div className="grid grid-cols-3 gap-1.5 font-mono tabular-nums">
        <div>
          <div className="text-muted-foreground">Encontradas</div>
          <div className="font-bold text-foreground">{found}</div>
        </div>
        <div>
          <div className="text-muted-foreground">Importadas</div>
          <div className="font-bold text-foreground">{imported}</div>
        </div>
        <div>
          <div className="text-muted-foreground">Pendentes</div>
          <div className={cn("font-bold", pending > 0 ? "text-warning" : "text-foreground")}>{pending}</div>
        </div>
      </div>
    </div>
  );
}