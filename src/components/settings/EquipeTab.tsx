import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Users, Shield, UserCog, Loader2, Trash2, Crown } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type AppRole = "admin" | "curador";

interface Member {
  user_id: string;
  email: string;
  roles: AppRole[];
}

const ROLE_LABEL: Record<AppRole, string> = {
  admin: "Admin",
  curador: "Curador",
};

const ROLE_DESCRIPTION: Record<AppRole, string> = {
  admin: "Acesso total: pode mexer em configurações, conexões e gerenciar a equipe.",
  curador: "Trabalha em Cérebro, Criação, Operação e Performance. Não acessa Configurações.",
};

export function EquipeTab() {
  const { user } = useAuth();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<AppRole>("curador");
  const [inviting, setInviting] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<{ userId: string; role: AppRole; email: string } | null>(null);

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

    // Agrupa papéis por usuário
    const grouped = new Map<string, AppRole[]>();
    (roles ?? []).forEach((r) => {
      const list = grouped.get(r.user_id) ?? [];
      list.push(r.role as AppRole);
      grouped.set(r.user_id, list);
    });

    // Tenta buscar emails via edge function (admin API). Se falhar, exibe só o ID.
    let emailMap = new Map<string, string>();
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

  async function inviteMember() {
    const email = inviteEmail.trim().toLowerCase();
    if (!email) {
      toast.error("Informe o email do convidado");
      return;
    }
    setInviting(true);
    try {
      const { data, error } = await supabase.functions.invoke("invite-team-member", {
        body: { email, role: inviteRole },
      });
      // Quando o edge function retorna 4xx/5xx, supabase-js seta `error` E `data` vem com o JSON do erro.
      // Tentamos extrair a mensagem real do backend antes de cair no fallback genérico do "Edge Function...".
      const backendError = (data as any)?.error;
      if (backendError || (error && !data?.ok)) {
        throw new Error(backendError ?? error?.message ?? "Falha ao convidar");
      }
      toast.success("Convite enviado", {
        description: `${email} receberá um email para criar a senha. Papel: ${ROLE_LABEL[inviteRole]}.`,
      });
      setInviteEmail("");
      await loadMembers();
    } catch (e: any) {
      console.error("[invite-team-member] erro:", e);
      toast.error("Não foi possível convidar", { description: e?.message ?? String(e) });
    } finally {
      setInviting(false);
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
      {/* Resumo dos papéis */}
      <section className="nx-card p-5">
        <div className="flex items-center gap-2 mb-1">
          <Shield className="h-5 w-5 text-accent" />
          <h2 className="font-semibold">Níveis de acesso</h2>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Existem 2 papéis no sistema. Defina o nível certo na hora de convidar alguém.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
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
        </div>
      </section>

      {/* Convidar */}
      <section className="nx-card p-5">
        <div className="flex items-center gap-2 mb-1">
          <Users className="h-5 w-5 text-accent" />
          <h2 className="font-semibold">Convidar pessoa</h2>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          A pessoa receberá um email para criar a senha e entrar na equipe com o papel definido.
        </p>
        <div className="grid gap-3 sm:grid-cols-[1fr,200px,auto]">
          <div className="space-y-1.5">
            <Label htmlFor="invite-email" className="text-xs">Email</Label>
            <Input
              id="invite-email"
              type="email"
              placeholder="email@exemplo.com"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              disabled={inviting}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="invite-role" className="text-xs">Papel</Label>
            <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as AppRole)} disabled={inviting}>
              <SelectTrigger id="invite-role"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="curador">Curador</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end">
            <Button onClick={inviteMember} disabled={inviting} className="w-full sm:w-auto">
              {inviting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Users className="h-4 w-4" />}
              Enviar convite
            </Button>
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground mt-2">
          Dica: se o convite por email não estiver disponível, peça para a pessoa criar conta em <span className="font-mono">/login</span> e depois atribua o papel aqui.
        </p>
      </section>

      {/* Lista de membros */}
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
            Nenhum membro ainda. Convide alguém acima.
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
                          className={r === "admin"
                            ? "border-primary/40 text-primary bg-primary/10"
                            : "border-accent/40 text-accent bg-accent/10"}
                        >
                          {r === "admin" ? <Crown className="h-3 w-3 mr-1" /> : <UserCog className="h-3 w-3 mr-1" />}
                          {ROLE_LABEL[r]}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0">
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
