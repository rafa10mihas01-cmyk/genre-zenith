import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Layers, Plus, Star, Trash2, Pencil, Loader2, ExternalLink, AlertTriangle, LinkIcon } from "lucide-react";
import { toast } from "sonner";

export type SpotifyApp = {
  id: string;
  name: string;
  client_id: string;
  client_id_preview: string;
  max_accounts: number;
  is_default: boolean;
  status: string;
  notes: string | null;
  accounts_used: number;
  slots_remaining: number;
  created_at: string;
};

async function callAuth(qs: string, init?: RequestInit) {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/spotify-auth?${qs}`;
  const resp = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  return resp.json();
}

export function SpotifyAppsManager({ onChange, onConnectAccount }: { onChange?: (apps: SpotifyApp[]) => void; onConnectAccount?: (appId: string, forceLogin: boolean) => void }) {
  const [apps, setApps] = useState<SpotifyApp[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Partial<SpotifyApp> | null>(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    const j = await callAuth("mode=apps");
    setLoading(false);
    if (j?.ok) {
      setApps(j.apps);
      onChange?.(j.apps);
    } else if (j?.error) {
      toast.error("Falha ao carregar apps", { description: j.error });
    }
  }

  useEffect(() => { void load(); }, []);

  async function save() {
    if (!editing) return;
    const body: any = {
      id: editing.id,
      name: (editing.name ?? "").trim(),
      max_accounts: Number(editing.max_accounts ?? 5),
      is_default: !!editing.is_default,
      notes: editing.notes ?? null,
      status: editing.status ?? "active",
    };
    if ((editing as any).client_id) body.client_id = (editing as any).client_id;
    if ((editing as any).client_secret) body.client_secret = (editing as any).client_secret;

    if (!body.name) { toast.error("Informe o nome do app"); return; }
    if (!editing.id && (!body.client_id || !body.client_secret)) {
      toast.error("Client ID e Client Secret obrigatórios"); return;
    }

    setSaving(true);
    const j = await callAuth("mode=app_save", { method: "POST", body: JSON.stringify(body) });
    setSaving(false);
    if (!j?.ok) { toast.error("Falha ao salvar", { description: j?.error }); return; }
    toast.success(editing.id ? "App atualizado" : "App cadastrado");
    setEditing(null);
    await load();
  }

  async function del(id: string, name: string) {
    if (!confirm(`Remover app "${name}"? Só funciona se não houver contas vinculadas.`)) return;
    const j = await callAuth("mode=app_delete", { method: "POST", body: JSON.stringify({ id }) });
    if (!j?.ok) { toast.error("Falha ao remover", { description: j?.error }); return; }
    toast.success("App removido");
    await load();
  }

  return (
    <div className="mb-5">
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <div>
          <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-bold flex items-center gap-1.5">
            <Layers className="h-3 w-3" /> Apps Spotify (guarda-chuva)
          </h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Cada app do Spotify Developer aceita até 25 contas. Cadastre vários para distribuir.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setEditing({ name: "", max_accounts: 5, is_default: apps.length === 0, status: "active" })}
          className="h-8 text-xs gap-1.5"
        >
          <Plus className="h-3.5 w-3.5" /> Adicionar app
        </Button>
      </div>

      {loading ? (
        <div className="text-xs text-muted-foreground">Carregando…</div>
      ) : apps.length === 0 ? (
        <div className="p-3 rounded-lg border border-warning/30 bg-warning/5 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
          <div className="text-xs leading-relaxed">
            Nenhum app cadastrado. Hoje o sistema usa credenciais legadas do servidor.
            Cadastre seu primeiro app no <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noreferrer" className="underline inline-flex items-center gap-1">Spotify Developer <ExternalLink className="h-3 w-3" /></a> e cole o <span className="font-mono">Client ID</span> + <span className="font-mono">Client Secret</span> aqui.
          </div>
        </div>
      ) : (
        <div className="space-y-1.5">
          {apps.map((a) => {
            const full = a.slots_remaining <= 0;
            return (
              <div key={a.id} className="flex items-center justify-between gap-2 p-2.5 rounded-lg border border-border bg-muted/20">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm truncate">{a.name}</span>
                    {a.is_default && (
                      <span className="text-[10px] inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-primary/15 text-primary">
                        <Star className="h-2.5 w-2.5" /> padrão
                      </span>
                    )}
                    {a.status !== "active" && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{a.status}</span>
                    )}
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${full ? "bg-destructive/15 text-destructive" : "bg-success/15 text-success"}`}>
                      {a.accounts_used}/{a.max_accounts} contas
                    </span>
                  </div>
                  <div className="text-[11px] text-muted-foreground font-mono truncate mt-0.5">
                    {a.client_id_preview}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {onConnectAccount && a.status === "active" && !full && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onConnectAccount(a.id, true)}
                      className="h-8 text-xs gap-1.5 border-primary/40 text-primary hover:bg-primary/10 hover:text-primary"
                      title={`Conectar nova conta neste app (encerra a sessão Spotify atual e abre o login da próxima conta no app "${a.name}")`}
                    >
                      <LinkIcon className="h-3.5 w-3.5" /> Conectar conta
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => setEditing(a)} className="h-8 w-8 p-0" title="Editar">
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => del(a.id, a.name)} className="h-8 w-8 p-0 text-destructive hover:text-destructive" title="Remover">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-[560px] bg-card border-border/60 shadow-2xl">
          <DialogHeader className="space-y-2 pb-2 border-b border-border/40">
            <DialogTitle className="text-lg font-semibold text-foreground">
              {editing?.id ? "Editar app Spotify" : "Adicionar app Spotify"}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground leading-relaxed">
              Crie um app em{" "}
              <a
                href="https://developer.spotify.com/dashboard"
                target="_blank"
                rel="noreferrer"
                className="text-primary hover:underline font-medium"
              >
                developer.spotify.com/dashboard
              </a>{" "}
              e cole as credenciais aqui.
              <span className="block mt-2 p-2 rounded-md bg-muted/40 border border-border/40">
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground/80 block mb-1">
                  Redirect URI do app
                </span>
                <span className="font-mono text-[11px] text-foreground break-all">
                  {window.location.origin}/configuracoes?spotify_callback=1
                </span>
              </span>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-foreground">Nome interno</Label>
              <Input
                value={editing?.name ?? ""}
                onChange={(e) => setEditing((s) => ({ ...s!, name: e.target.value }))}
                placeholder='Ex: "App principal", "App 2 - rock"'
                className="h-10 text-sm bg-muted/30 border-border/60 focus-visible:border-primary/60 focus-visible:ring-primary/20"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-foreground">Client ID</Label>
              <Input
                value={(editing as any)?.client_id ?? ""}
                onChange={(e) => setEditing((s) => ({ ...s!, ...(editing as any), client_id: e.target.value } as any))}
                placeholder={editing?.id ? "Deixe vazio pra não alterar" : "32 caracteres hex"}
                className="h-10 text-sm font-mono bg-muted/30 border-border/60 focus-visible:border-primary/60 focus-visible:ring-primary/20"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-foreground">Client Secret</Label>
              <Input
                type="password"
                value={(editing as any)?.client_secret ?? ""}
                onChange={(e) => setEditing((s) => ({ ...s!, ...(editing as any), client_secret: e.target.value } as any))}
                placeholder={editing?.id ? "Deixe vazio pra não alterar" : "32 caracteres hex"}
                className="h-10 text-sm font-mono bg-muted/30 border-border/60 focus-visible:border-primary/60 focus-visible:ring-primary/20"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-foreground">Limite de contas</Label>
                <Input
                  type="number" min={1} max={25}
                  value={editing?.max_accounts ?? 5}
                  onChange={(e) => setEditing((s) => ({ ...s!, max_accounts: Number(e.target.value) || 5 }))}
                  className="h-10 text-sm bg-muted/30 border-border/60 focus-visible:border-primary/60 focus-visible:ring-primary/20"
                />
                <p className="text-[10px] text-muted-foreground">Spotify aceita até 25 em dev mode.</p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-foreground">Status</Label>
                <select
                  value={editing?.status ?? "active"}
                  onChange={(e) => setEditing((s) => ({ ...s!, status: e.target.value }))}
                  className="h-10 w-full rounded-md border border-border/60 bg-muted/30 px-3 text-sm text-foreground focus:outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20"
                >
                  <option value="active">Ativo</option>
                  <option value="paused">Pausado</option>
                </select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-foreground">Notas (opcional)</Label>
              <Textarea
                value={editing?.notes ?? ""}
                onChange={(e) => setEditing((s) => ({ ...s!, notes: e.target.value }))}
                rows={2}
                className="text-sm bg-muted/30 border-border/60 focus-visible:border-primary/60 focus-visible:ring-primary/20 resize-none"
              />
            </div>
            <label className="flex items-start gap-2.5 text-xs text-muted-foreground p-3 rounded-md bg-muted/20 border border-border/40 cursor-pointer hover:bg-muted/30 transition-colors">
              <input
                type="checkbox"
                checked={!!editing?.is_default}
                onChange={(e) => setEditing((s) => ({ ...s!, is_default: e.target.checked }))}
                className="mt-0.5 accent-primary"
              />
              <span className="leading-relaxed">
                <span className="text-foreground font-medium">Definir como app padrão</span>
                <span className="block text-[11px] mt-0.5">Usado quando nenhum app é escolhido explicitamente.</span>
              </span>
            </label>
          </div>
          <DialogFooter className="pt-3 border-t border-border/40">
            <Button variant="outline" size="sm" onClick={() => setEditing(null)} disabled={saving}>Cancelar</Button>
            <Button size="sm" onClick={save} disabled={saving} className="bg-primary text-primary-foreground hover:bg-primary/90">
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}
              {editing?.id ? "Salvar" : "Cadastrar app"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
