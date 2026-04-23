import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { NexEngineLogo } from "@/components/NexEngineLogo";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export default function Login() {
  const { signIn, user } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [resetting, setResetting] = useState(false);

  useEffect(() => { if (user) nav("/", { replace: true }); }, [user, nav]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await signIn(email, password);
    setLoading(false);
    if (error) {
      toast.error("Falha no login", { description: error });
    } else {
      toast.success("Bem-vindo ao NexEngine");
      nav("/", { replace: true });
    }
  };

  const handleReset = async () => {
    if (!email) {
      toast.error("Informe seu email", { description: "Digite o email da sua conta antes de pedir o reset." });
      return;
    }
    setResetting(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setResetting(false);
    if (error) {
      toast.error("Não foi possível enviar", { description: error.message });
    } else {
      toast.success("Email enviado", {
        description: "Cheque sua caixa (e spam) para redefinir a senha.",
      });
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4 relative overflow-hidden">
      {/* ambient glow */}
      <div className="pointer-events-none absolute inset-0 opacity-40">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 h-96 w-96 rounded-full bg-primary/20 blur-[140px]" />
      </div>

      <div className="relative w-full max-w-sm nx-card p-8 animate-fade-in">
        <div className="flex items-center gap-3 mb-7">
          <div className="h-11 w-11 rounded-lg bg-primary/10 border border-primary/30 flex items-center justify-center nx-glow">
            <NexEngineLogo size={28} />
          </div>
          <div>
            <h1 className="text-lg font-bold leading-tight">NexEngine</h1>
            <p className="text-xs text-muted-foreground">Motor de Inteligência de Playlists</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email" className="text-xs uppercase tracking-wider text-muted-foreground">Email</Label>
            <Input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className="bg-elevated border-border" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password" className="text-xs uppercase tracking-wider text-muted-foreground">Senha</Label>
            <Input id="password" type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className="bg-elevated border-border" />
          </div>
          <Button type="submit" disabled={loading} className="w-full">
            {loading ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Entrando…</> : "Entrar"}
          </Button>
          <button
            type="button"
            onClick={handleReset}
            disabled={resetting}
            className="w-full text-[11px] text-muted-foreground hover:text-foreground transition-colors text-center pt-1 disabled:opacity-50"
          >
            {resetting ? "Enviando…" : "Esqueci minha senha"}
          </button>
          <p className="text-[11px] text-muted-foreground text-center pt-2">
            Acesso interno. Usuários são adicionados pelo painel.
          </p>
        </form>
      </div>
    </div>
  );
}
