import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Users, Shield, UserCog, Loader2, Trash2, Crown, Wrench, Copy, Link2, Check, X } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type AppRole = "admin" | "curador" | "operador";

interface Member {
  user_id: string;
  email: string;
  roles: AppRole[];
}

const ROLE_LABEL: Record<AppRole, string> = {
  admin: "Admin",
  curador: "Curador",
  operador: "Operador",
};

const ROLE_DESCRIPTION: Record<AppRole, string> = {
  admin: "Acesso total: pode mexer em configurações, conexões e gerenciar a equipe.",
  curador: "Trabalha em Cérebro, Criação, Operação e Performance. Não acessa Configurações.",
  operador: "Acessa o catálogo de playlists e edita posições/capas. Não mexe em campanhas, financeiro nem configurações.",
};

export function EquipeTab() {
  const { user } = useAuth();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<AppRole>("operador");
  const [creating, setCreating] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<{ userId: string; role: AppRole; email: string } | null>(null);
  const [lastCreated, setLastCreated] = useState<{ email: string; password: string; role: AppRole } | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const loginUrl = `${window.location.origin}/login`;

  async function copyToClipboard(text: string, field: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      toast.success("Copiado");
      setTimeout(() => setCopiedField((f) => (f === field ? null : f)), 1500);
    } catch {
      toast.error("Não foi possível copiar");
    }
  }

  function buildShareMessage(c: { email: string; password: string; role: AppRole }) {
    return `Olá! Seu acesso ao NexEngine está pronto.

Link: ${loginUrl}
Email: ${c.email}
Senha: ${c.password}
Papel: ${ROLE_LABEL[c.role]}

Entre direto pelo link acima. Você pode trocar a senha depois nas configurações da conta.`;
  }

  async function loadMembers() {
    setLoading(true);
    const { data: roles, error } = await supabase
      .from("user_roles")
      .select("user_id, role, created_at")
      .order("created_at", { ascending: true });

    if (error) {
      toast.error("Erro ao carregar equipe", { description: error.message });
      setLoading(false);
      return;
    }

    const grouped = new Map<string, AppRole[]>();
    (roles ?? []).forEach((r) => {
      const list = grouped.get(r.user_id) ?? [];
      list.push(r.role as AppRole);
      grouped.set(r.user_id, list);
    });

    const emailMap = new Map<string, string>();
    try {
      const { data: emailData } = await supabase.functions.invoke("list-team-emails");
      if (emailData?.users) {
        emailData.users.forEach((u: { id: string; email: string }) => emailMap.set(u.id, u.email));
      }
    } catch { /* sem edge function -> sem email */ }

    const list: Member[] = Array.from(grouped.entries()).map(([userId, userRoles]) => ({
      user_id: userId,
      email: emailMap.get(userId) ?? (userId === user?.id ? user.email ?? userId : userId.slice(0, 8) + "…"),
      roles: userRoles,
    }));

    setMembers(list);
    setLoading(false);
  }

  useEffect(() => { void loadMembers(); }, []);

  async function createAccess() {
    const email = newEmail.trim().toLowerCase();
    const password = newPassword;
    if (!email) {
      toast.error("Informe o email");
      return;
    }
    if (!password || password.length < 8) {
      toast.error("Senha precisa ter no mínimo 8 caracteres");
      return;
    }
    setCreating(true);
    try {
      const { data, error } = await supabase.functions.invoke("invite-team-member", {
        body: { email, password, role: newRole },
      });
      const backendError = (data as any)?.error;
      if (backendError || (error && !data?.ok)) {
        throw new Error(backendError ?? error?.message ?? "Falha ao criar acesso");
      }
      toast.success("Acesso criado", {
        description: `${email} já pode entrar em /login com a senha definida. Papel: ${ROLE_LABEL[newRole]}.`,
      });
      setLastCreated({ email, password, role: newRole });
      setNewEmail("");
      setNewPassword("");
      await loadMembers();
    } catch (e: any) {
      console.error("[invite-team-member] erro:", e);
      toast.error("Não foi possível criar acesso", { description: e?.message ?? String(e) });
    } finally {
      setCreating(false);
    }
  }

  async function removeRole() {
    if (!removeTarget) return;
    const { error } = await supabase
      .from("user_roles")
      .delete()
      .eq("user_id", removeTarget.userId)
      .eq("role", removeTarget.role);

    if (error) {
      toast.error("Erro ao remover", { description: error.message });
    } else {
      toast.success(`${ROLE_LABEL[removeTarget.role]} removido de ${removeTarget.email}`);
      await loadMembers();
    }
    setRemoveTarget(null);
  }

  return (
    <div className="space-y-6">
      <section className="nx-card p-5">
        <div className="flex items-center gap-2 mb-1">
          <Shield className="h-5 w-5 text-accent" />
          <h2 className="font-semibold">Níveis de acesso</h2>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Existem 3 papéis no sistema. Defina o nível certo na hora de criar o acesso.
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-border bg-elevated/40 p-4">
            <div className="flex items-center gap-2 mb-1">
              <Crown className="h-4 w-4 text-primary" />
              <span className="font-semibold text-sm">Admin</span>
            </div>
            <p className="text-xs text-muted-foreground">{ROLE_DESCRIPTION.admin}</p>
          </div>
          <div className="rounded-lg border border-border bg-elevated/40 p-4">
            <div className="flex items-center gap-2 mb-1">
              <UserCog className="h-4 w-4 text-accent" />
              <span className="font-semibold text-sm">Curador</span>
            </div>
            <p className="text-xs text-muted-foreground">{ROLE_DESCRIPTION.curador}</p>
          </div>
          <div className="rounded-lg border border-border bg-elevated/40 p-4">
            <div className="flex items-center gap-2 mb-1">
              <Wrench className="h-4 w-4 text-muted-foreground" />
              <span className="font-semibold text-sm">Operador</span>
            </div>
            <p className="text-xs text-muted-foreground">{ROLE_DESCRIPTION.operador}</p>
          </div>
        </div>
      </section>

      <section className="nx-card p-5">
        <div className="flex items-center gap-2 mb-1">
          <Users className="h-5 w-5 text-accent" />
          <h2 className="font-semibold">Criar acesso</h2>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Cria a conta na hora com email e senha. Sem email de confirmação — acesso imediato em <span className="font-mono">/login</span>.
        </p>
        <div className="grid gap-3 sm:grid-cols-[1fr,1fr,180px,auto]">
          <div className="space-y-1.5">
            <Label htmlFor="new-email" className="text-xs">Email</Label>
            <Input
              id="new-email"
              type="email"
              placeholder="email@exemplo.com"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              disabled={creating}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-password" className="text-xs">Senha (mín. 8 caracteres)</Label>
            <Input
              id="new-password"
              type="text"
              placeholder="senha inicial"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              disabled={creating}
              autoComplete="new-password"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-role" className="text-xs">Papel</Label>
            <Select value={newRole} onValueChange={(v) => setNewRole(v as AppRole)} disabled={creating}>
              <SelectTrigger id="new-role"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="operador">Operador</SelectItem>
                <SelectItem value="curador">Curador</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end">
            <Button onClick={createAccess} disabled={creating} className="w-full sm:w-auto">
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Users className="h-4 w-4" />}
              Criar acesso
            </Button>
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground mt-2">
          A pessoa entra direto com email e senha. Compartilhe a senha com segurança — ela pode trocar depois nas configurações da conta.
        </p>

        {lastCreated && (
          <div className="mt-4 rounded-lg border border-primary/40 bg-primary/5 p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <Link2 className="h-4 w-4 text-primary" />
                <div>
                  <div className="text-sm font-semibold">Acesso pronto pra enviar</div>
                  <div className="text-[11px] text-muted-foreground">
                    {lastCreated.email} · {ROLE_LABEL[lastCreated.role]}
                  </div>
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground"
                onClick={() => setLastCreated(null)}
                title="Fechar"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="grid gap-2 sm:grid-cols-[1fr,auto]">
              <div className="rounded-md border border-border bg-background/60 px-3 py-2 font-mono text-xs truncate" title={loginUrl}>
                {loginUrl}
              </div>
              <Button variant="outline" size="sm" onClick={() => copyToClipboard(loginUrl, "url")}>
                {copiedField === "url" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                Copiar link
              </Button>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <div className="flex items-center gap-2">
                <div className="flex-1 rounded-md border border-border bg-background/60 px-3 py-2 font-mono text-xs truncate" title={lastCreated.email}>
                  {lastCreated.email}
                </div>
                <Button variant="ghost" size="sm" onClick={() => copyToClipboard(lastCreated.email, "email")}>
                  {copiedField === "email" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                </Button>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex-1 rounded-md border border-border bg-background/60 px-3 py-2 font-mono text-xs truncate" title={lastCreated.password}>
                  {lastCreated.password}
                </div>
                <Button variant="ghost" size="sm" onClick={() => copyToClipboard(lastCreated.password, "password")}>
                  {copiedField === "password" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                </Button>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 pt-1">
              <Button
                size="sm"
                onClick={() => copyToClipboard(buildShareMessage(lastCreated), "message")}
              >
                {copiedField === "message" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                Copiar mensagem pronta
              </Button>
              <a
                href={`https://wa.me/?text=${encodeURIComponent(buildShareMessage(lastCreated))}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Button size="sm" variant="outline">Abrir no WhatsApp</Button>
              </a>
            </div>

            <p className="text-[11px] text-muted-foreground">
              Esses dados só ficam visíveis aqui agora — depois que você fechar, a senha não pode ser recuperada (só redefinida).
            </p>
          </div>
        )}
      </section>

      <section className="nx-card p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="font-semibold">Membros da equipe</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {members.length} {members.length === 1 ? "pessoa" : "pessoas"} com acesso ao sistema
            </p>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin mr-2" /> Carregando equipe…
          </div>
        ) : members.length === 0 ? (
          <div className="text-center py-8 text-sm text-muted-foreground">
            Nenhum membro ainda. Crie um acesso acima.
          </div>
        ) : (
          <div className="space-y-2">
            {members.map((m) => (
              <div
                key={m.user_id}
                className="flex items-center justify-between gap-3 p-3 rounded-lg border border-border bg-elevated/30"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="h-9 w-9 rounded-full bg-elevated border border-border flex items-center justify-center text-xs font-bold shrink-0">
                    {m.email.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">
                      {m.email}
                      {m.user_id === user?.id && (
                        <span className="ml-2 text-[10px] text-muted-foreground">(você)</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      {m.roles.map((r) => (
                        <Badge
                          key={r}
                          variant="outline"
                          className={
                            r === "admin"
                              ? "border-primary/40 text-primary bg-primary/10"
                              : r === "curador"
                              ? "border-accent/40 text-accent bg-accent/10"
                              : "border-muted-foreground/40 text-muted-foreground bg-muted/20"
                          }
                        >
                          {r === "admin" ? <Crown className="h-3 w-3 mr-1" />
                            : r === "curador" ? <UserCog className="h-3 w-3 mr-1" />
                            : <Wrench className="h-3 w-3 mr-1" />}
                          {ROLE_LABEL[r]}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground hover:text-primary"
                    title="Copiar link de login para enviar"
                    onClick={() =>
                      copyToClipboard(
                        `Olá! Acesse o NexEngine em ${loginUrl} com seu email: ${m.email}`,
                        `link-${m.user_id}`
                      )
                    }
                  >
                    {copiedField === `link-${m.user_id}` ? (
                      <Check className="h-3.5 w-3.5" />
                    ) : (
                      <Link2 className="h-3.5 w-3.5" />
                    )}
                  </Button>
                  {m.roles.map((r) => (
                    <Button
                      key={r}
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground hover:text-destructive"
                      disabled={m.user_id === user?.id}
                      title={m.user_id === user?.id ? "Você não pode remover seus próprios papéis" : `Remover ${ROLE_LABEL[r]}`}
                      onClick={() => setRemoveTarget({ userId: m.user_id, role: r, email: m.email })}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <AlertDialog open={!!removeTarget} onOpenChange={(o) => !o && setRemoveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover {removeTarget && ROLE_LABEL[removeTarget.role]}?</AlertDialogTitle>
            <AlertDialogDescription>
              {removeTarget?.email} perderá esse papel imediatamente. Se for o único papel da pessoa, ela perde o acesso ao sistema.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={removeRole} className="bg-destructive hover:bg-destructive/90">
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
