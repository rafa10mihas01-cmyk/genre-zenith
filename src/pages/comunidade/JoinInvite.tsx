// /comunidade/join/:code — Aceitar convite (PÚBLICO, sem login).
// Mostra estado do convite e leva pra criar conta / fazer login.
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NexEngineLogo } from "@/components/NexEngineLogo";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

type InviteState =
  | { status: "loading" }
  | { status: "ok"; invite: { id: string; email: string | null; expires_at: string; invited_by_name: string } }
  | { status: "error"; message: string };

export default function JoinInvite() {
  const { code = "" } = useParams();
  const nav = useNavigate();
  const { user } = useAuth();
  const [state, setState] = useState<InviteState>({ status: "loading" });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data, error } = await supabase.rpc("get_community_invite_by_code", { p_code: code });
      if (!mounted) return;
      const row = Array.isArray(data) ? data[0] : null;
      if (error || !row) {
        setState({ status: "error", message: "Convite não encontrado." });
        return;
      }
      if (row.status !== "pending") {
        setState({
          status: "error",
          message:
            row.status === "accepted"
              ? "Este convite já foi usado."
              : row.status === "expired"
              ? "Convite expirado. Peça outro a quem te indicou."
              : "Convite revogado.",
        });
        return;
      }
      setState({ status: "ok", invite: row });
      if (row.email) setEmail(row.email);
    })();
    return () => {
      mounted = false;
    };
  }, [code]);

  // NUNCA aceita o convite automaticamente. Sempre exige ação explícita
  // (caso contrário um admin logado consome o convite de outra pessoa por engano).

  async function acceptAsCurrentUser() {
    setSubmitting(true);
    const { error } = await supabase.rpc("accept_community_invite", { p_code: code });
    setSubmitting(false);
    if (error) {
      toast.error("Não foi possível aceitar o convite", { description: error.message });
      return;
    }
    nav("/comunidade/onboarding", { replace: true });
  }

  async function signOutAndStay() {
    await supabase.auth.signOut();
    // permanece na mesma rota — o componente vai re-renderizar sem user
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !password) return;
    setSubmitting(true);
    // Tenta criar conta. Se já existir, faz login.
    const { error: signUpErr } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${window.location.origin}/comunidade/join/${code}` },
    });

    if (signUpErr && !/already/i.test(signUpErr.message)) {
      setSubmitting(false);
      toast.error("Falha ao criar conta", { description: signUpErr.message });
      return;
    }

    // signIn (cobre o caso de conta já existente)
    const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password });
    setSubmitting(false);
    if (signInErr) {
      toast.error("Não foi possível entrar", { description: signInErr.message });
      return;
    }
    // useEffect acima cuida do accept + redirect
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2">
          <NexEngineLogo size={26} variant="mark" />
          <span className="text-[15px] font-semibold tracking-tight">NexEngine</span>
        </div>

        {state.status === "loading" && (
          <div className="rounded-2xl border border-border bg-card p-6 flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Verificando convite…
          </div>
        )}

        {state.status === "error" && (
          <div className="rounded-2xl border border-border bg-card p-6 space-y-4">
            <h1 className="text-lg font-semibold">Convite indisponível</h1>
            <p className="text-sm text-muted-foreground">{state.message}</p>
            <Button asChild variant="outline" className="w-full">
              <Link to="/">Voltar ao início</Link>
            </Button>
          </div>
        )}

        {state.status === "ok" && (
          <div className="rounded-2xl border border-border bg-card p-6 space-y-5">
            <div>
              <h1 className="text-lg font-semibold leading-tight">Você foi convidado</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Por {state.invite.invited_by_name}. Crie sua conta para entrar na comunidade.
              </p>
            </div>

            <form onSubmit={onSubmit} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="email" className="text-xs uppercase tracking-wider text-muted-foreground">
                  Email
                </Label>
                <Input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={!!state.invite.email}
                  className="bg-elevated"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password" className="text-xs uppercase tracking-wider text-muted-foreground">
                  Crie uma senha
                </Label>
                <Input
                  id="password"
                  type="password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="bg-elevated"
                />
              </div>
              <Button type="submit" disabled={submitting} className="w-full">
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Entrar na comunidade"}
              </Button>
              <p className="text-[11px] text-muted-foreground text-center">
                Já tem conta?{" "}
                <Link to="/login" className="underline hover:text-foreground">
                  Entrar
                </Link>
              </p>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
