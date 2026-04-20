import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Zap, Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
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

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4 relative overflow-hidden">
      {/* ambient glow */}
      <div className="pointer-events-none absolute inset-0 opacity-40">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 h-96 w-96 rounded-full bg-primary/20 blur-[140px]" />
      </div>

      <div className="relative w-full max-w-sm nx-card p-8 animate-fade-in">
        <div className="flex items-center gap-3 mb-7">
          <div className="h-11 w-11 rounded-lg bg-primary/15 border border-primary/30 flex items-center justify-center nx-glow">
            <Zap className="h-6 w-6 text-primary" />
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
          <p className="text-[11px] text-muted-foreground text-center pt-2">
            Acesso interno. Usuários são adicionados pelo painel.
          </p>
        </form>
      </div>
    </div>
  );
}
