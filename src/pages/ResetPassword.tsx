import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { NexEngineLogo } from "@/components/NexEngineLogo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

/**
 * Página pública de redefinição de senha.
 * Recebe o link enviado por `resetPasswordForEmail` (type=recovery no hash)
 * e atualiza a senha do usuário autenticado pela sessão de recovery.
 */
export default function ResetPassword() {
  const nav = useNavigate();
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // Quando o usuário cai aqui via link de recovery, o supabase emite PASSWORD_RECOVERY.
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") setReady(true);
    });
    // Caso o evento já tenha disparado antes do listener
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setReady(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) {
      toast.error("Senha curta", { description: "Use pelo menos 8 caracteres." });
      return;
    }
    if (password !== confirm) {
      toast.error("As senhas não conferem");
      return;
    }
    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password });
    setSaving(false);
    if (error) {
      toast.error("Falha ao redefinir", { description: error.message });
    } else {
      toast.success("Senha atualizada");
      nav("/", { replace: true });
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4 relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0 opacity-40">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 h-96 w-96 rounded-full bg-primary/20 blur-[140px]" />
      </div>

      <div className="relative w-full max-w-sm nx-card p-8 animate-fade-in">
        <div className="flex items-center gap-3 mb-7">
          <div className="h-11 w-11 rounded-lg bg-primary/10 border border-primary/30 flex items-center justify-center nx-glow">
            <NexEngineLogo size={28} variant="mark" />
          </div>
          <div>
            <h1 className="text-lg font-bold leading-tight">Redefinir senha</h1>
            <p className="text-xs text-muted-foreground">Defina uma nova senha para entrar</p>
          </div>
        </div>

        {!ready ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
            <Loader2 className="h-4 w-4 animate-spin" /> Validando link…
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="pw" className="text-xs uppercase tracking-wider text-muted-foreground">Nova senha</Label>
              <Input id="pw" type="password" required autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className="bg-elevated border-border" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pw2" className="text-xs uppercase tracking-wider text-muted-foreground">Confirmar senha</Label>
              <Input id="pw2" type="password" required autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className="bg-elevated border-border" />
            </div>
            <Button type="submit" disabled={saving} className="w-full">
              {saving ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Salvando…</> : "Salvar nova senha"}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}