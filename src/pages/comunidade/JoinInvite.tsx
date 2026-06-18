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
  const [needsConfirm, setNeedsConfirm] = useState(false);
  const [resending, setResending] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // tick a cada 30s pra contagem regressiva
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  function translateRpcError(msg?: string | null): string {
    if (!msg) return "Não foi possível aceitar o convite.";
    const m = msg.toLowerCase();
    if (m.includes("invite_email_mismatch"))
      return "Este convite é para outro email. Entre com a conta correta ou peça um novo convite.";
    if (m.includes("invite_not_available") || m.includes("already") || m.includes("accepted"))
      return "Este convite já foi usado ou não está mais disponível.";
    if (m.includes("invite_invalid") || m.includes("not_found"))
      return "Convite inválido ou expirado.";
    if (m.includes("invite_expired") || m.includes("expired"))
      return "Convite expirado. Peça um novo a quem te indicou.";
    return msg;
  }

  function formatCountdown(iso: string): string {
    const ms = new Date(iso).getTime() - now;
    if (ms <= 0) return "expirado";
    const min = Math.floor(ms / 60_000);
    if (min < 60) return `expira em ${min} min`;
    const h = Math.floor(min / 60);
    if (h < 24) return `expira em ${h}h`;
    const d = Math.floor(h / 24);
    return `expira em ${d}d`;
  }

  async function resendConfirmation() {
    if (!email) return;
    setResending(true);
    const { error } = await supabase.auth.resend({
      type: "signup",
      email,
      options: { emailRedirectTo: `${window.location.origin}/comunidade/join/${code}` },
    });
    setResending(false);
    if (error) return toast.error("Falha ao reenviar", { description: error.message });
    toast.success("Email de confirmação reenviado", { description: "Verifique sua caixa de entrada." });
  }

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
      // Se o convite já foi aceito E o usuário logado é o dono daquele email,
      // não mostra erro — apenas leva pra área da comunidade.
      if (row.status === "accepted") {
        const inviteEmail = (row.email ?? "").toLowerCase();
        const currentEmail = (user?.email ?? "").toLowerCase();
        if (currentEmail && inviteEmail && currentEmail === inviteEmail) {
          nav("/comunidade", { replace: true });
          return;
        }
        setState({
          status: "error",
          message: inviteEmail
            ? `Convite já usado por ${inviteEmail}. Faça login com essa conta para entrar na comunidade.`
            : "Este convite já foi usado.",
        });
        return;
      }
      if (row.status !== "pending") {
        setState({
          status: "error",
          message:
            row.status === "expired"
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
    // nav/user.email não precisam reativar a busca do convite; reagimos só ao code.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  // NUNCA aceita o convite automaticamente. Sempre exige ação explícita
  // (caso contrário um admin logado consome o convite de outra pessoa por engano).

  async function acceptAsCurrentUser() {
    setSubmitting(true);
    const { error } = await supabase.rpc("accept_community_invite", { p_code: code });
    setSubmitting(false);
    if (error) {
      toast.error("Não foi possível aceitar o convite", { description: translateRpcError(error.message) });
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
    setNeedsConfirm(false);

    // Quando o convite tem email fixo, geralmente a conta JÁ existe (admin já convidou
    // pelo Supabase e a pessoa só precisa logar). Por isso tentamos signIn primeiro.
    const inviteHasEmail = state.status === "ok" && !!state.invite.email;

    async function tryLogin() {
      return supabase.auth.signInWithPassword({ email, password });
    }
    async function trySignup() {
      return supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: `${window.location.origin}/comunidade/join/${code}` },
      });
    }

    if (inviteHasEmail) {
      // 1) Login primeiro
      const { error: loginErr } = await tryLogin();
      if (!loginErr) { setSubmitting(false); return; }

      const lm = loginErr.message.toLowerCase();
      if (lm.includes("email not confirmed")) {
        setNeedsConfirm(true);
        setSubmitting(false);
        toast.error("Email ainda não confirmado", { description: "Reenvie o link de confirmação abaixo." });
        return;
      }
      if (lm.includes("invalid login")) {
        // Conta provavelmente não existe — cria
        const { error: signUpErr } = await trySignup();
        if (signUpErr && !/already/i.test(signUpErr.message)) {
          setSubmitting(false);
          toast.error("Falha ao criar conta", { description: signUpErr.message });
          return;
        }
        // tenta login de novo
        const { error: loginErr2 } = await tryLogin();
        setSubmitting(false);
        if (loginErr2) {
          if (loginErr2.message.toLowerCase().includes("email not confirmed")) {
            setNeedsConfirm(true);
            toast.error("Confirme seu email", { description: "Enviamos um link de confirmação." });
          } else {
            toast.error("Não foi possível entrar", { description: loginErr2.message });
          }
        }
        return;
      }
      setSubmitting(false);
      toast.error("Não foi possível entrar", { description: loginErr.message });
      return;
    }

    // Convite sem email fixo: comportamento antigo (signUp → signIn)
    const { error: signUpErr } = await trySignup();
    if (signUpErr && !/already/i.test(signUpErr.message)) {
      setSubmitting(false);
      toast.error("Falha ao criar conta", { description: signUpErr.message });
      return;
    }
    const { error: signInErr } = await tryLogin();
    setSubmitting(false);
    if (signInErr) {
      if (signInErr.message.toLowerCase().includes("email not confirmed")) {
        setNeedsConfirm(true);
        toast.error("Confirme seu email", { description: "Enviamos um link de confirmação." });
        return;
      }
      toast.error("Não foi possível entrar", { description: signInErr.message });
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2">
          <NexEngineLogo size={26} variant="mark" />
          <span className="text-[15px] font-semibold tracking-tight">NexEngine</span>
        </div>

        {state.status === "loading" && (
          <div className="rounded-2xl border border-border bg-card p-8 flex flex-col items-center gap-4">
            <div className="animate-nx-logo-pulse">
              <NexEngineLogo variant="mark" size={48} />
            </div>
            <div className="relative h-[3px] w-32 overflow-hidden rounded-full bg-elevated">
              <div
                className="absolute inset-y-0 left-0 w-full origin-left rounded-full bg-gradient-to-r from-transparent via-primary to-transparent animate-nx-indeterminate"
                style={{ boxShadow: "0 0 6px hsl(var(--primary) / 0.5)" }}
              />
            </div>
            <span className="text-xs text-muted-foreground">Verificando convite…</span>
          </div>
        )}

        {state.status === "error" && (
          <div className="rounded-2xl border border-border bg-card p-6 space-y-4">
            <h1 className="text-lg font-semibold">Convite indisponível</h1>
            <p className="text-sm text-muted-foreground">{state.message}</p>
            <Button asChild variant="outline" className="w-full">
              <Link to="/landing">Voltar para página pública</Link>
            </Button>
          </div>
        )}

        {state.status === "ok" && (() => {
          const inviteEmail = state.invite.email?.toLowerCase() ?? null;
          const currentEmail = user?.email?.toLowerCase() ?? null;
          const emailMismatch = !!user && !!inviteEmail && inviteEmail !== currentEmail;

          // Caso 1: já logado
          if (user) {
            return (
              <div className="rounded-2xl border border-border bg-card p-6 space-y-5">
                <div>
                  <h1 className="text-lg font-semibold leading-tight">Convite de {state.invite.invited_by_name}</h1>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Você está logado como <span className="font-medium text-foreground">{user.email}</span>.
                  </p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {formatCountdown(state.invite.expires_at)}
                  </p>
                </div>

                {emailMismatch ? (
                  <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                    Este convite é para <span className="font-medium">{inviteEmail}</span>. Saia da conta atual para aceitar.
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Aceitar agora vai vincular esta comunidade à sua conta atual. Tem certeza?
                  </p>
                )}

                <div className="space-y-2">
                  {!emailMismatch && (
                    <Button onClick={acceptAsCurrentUser} disabled={submitting} className="w-full">
                      {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : `Aceitar como ${user.email}`}
                    </Button>
                  )}
                  <Button onClick={signOutAndStay} variant="outline" className="w-full">
                    Sair e usar outra conta
                  </Button>
                </div>
              </div>
            );
          }

          // Caso 2: visitante — fluxo de signup/login
          const hasFixedEmail = !!state.invite.email;
          return (
          <div className="rounded-2xl border border-border bg-card p-6 space-y-5">
            <div>
              <h1 className="text-lg font-semibold leading-tight">Você foi convidado</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Por {state.invite.invited_by_name}.{" "}
                {hasFixedEmail ? "Entre com sua conta para acessar a comunidade." : "Crie sua conta para entrar na comunidade."}
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {formatCountdown(state.invite.expires_at)}
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
                  disabled={hasFixedEmail}
                  className="bg-elevated"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password" className="text-xs uppercase tracking-wider text-muted-foreground">
                  {hasFixedEmail ? "Senha" : "Crie uma senha"}
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

              {needsConfirm && (
                <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-3 space-y-2">
                  <p className="text-xs text-yellow-300">
                    Seu email ainda não foi confirmado. Verifique sua caixa de entrada ou reenvie o link.
                  </p>
                  <Button type="button" variant="outline" size="sm" className="w-full" disabled={resending} onClick={resendConfirmation}>
                    {resending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Reenviar email de confirmação"}
                  </Button>
                </div>
              )}

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
          );
        })()}
      </div>
    </div>
  );
}
