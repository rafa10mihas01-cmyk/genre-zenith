/* eslint-disable react-refresh/only-export-components -- co-located helpers/variants/hooks; split would force a large refactor with no runtime benefit (HMR only) */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { NexEngineLogo } from "@/components/NexEngineLogo";
import { Loader2, Mail, KeyRound, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { isLocalStorageAvailable, logPortalAuth, portalStorageKey } from "@/lib/portalSession";

interface Props {
  token: string;
  onAuthed: (jwt: string, email: string) => void;
}

// Mantido por compat — outros arquivos importam essa função.
export const accessStorageKey = (token: string) => portalStorageKey(token);

export function CampaignAccessGate({ token, onAuthed }: Props) {
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [storageOk, setStorageOk] = useState(true);

  useEffect(() => {
    const ok = isLocalStorageAvailable();
    setStorageOk(ok);
    if (!ok) {
      logPortalAuth({
        endpoint: "gate.mount",
        auth_status: "localstorage_blocked",
        jwt_present: false,
        localstorage_available: false,
        token,
      });
    }
  }, [token]);


  async function requestCode() {
    if (!storageOk) {
      toast.error("Abra o link no Chrome ou Safari antes de pedir o código.");
      return;
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) {
      toast.error("E-mail inválido");
      return;
    }
    setLoading(true);
    const { data, error } = await supabase.functions.invoke("request-campaign-otp", {
      body: { token, email: email.trim().toLowerCase() },
    });
    setLoading(false);
    // Quando edge retorna não-2xx, supabase-js coloca o body em error.context
    let e: string | undefined = (data as any)?.error;
    if (!e && error) {
      try {
        const ctx: any = (error as any).context;
        if (ctx && typeof ctx.json === "function") {
          const body = await ctx.json();
          e = body?.error;
        }
      } catch { /* ignore */ }
      if (!e) e = error.message;
    }
    if (e) {
      if (e === "rate_limited") toast.error("Muitas tentativas. Tente novamente mais tarde.");
      else if (e === "campaign_closed") toast.error("Esta campanha foi encerrada.");
      else toast.error("Não foi possível enviar o código.");
      return;
    }
    toast.success("Se o e-mail estiver autorizado, o código foi enviado.");
    setStep("code");
  }

  async function verifyCode() {
    if (!/^\d{6}$/.test(code.trim())) {
      toast.error("Código deve ter 6 dígitos");
      return;
    }
    setLoading(true);
    const { data, error } = await supabase.functions.invoke("verify-campaign-otp", {
      body: { token, email: email.trim().toLowerCase(), code: code.trim() },
    });
    setLoading(false);
    let e: string | undefined = (data as any)?.error;
    if (!e && error) {
      try {
        const ctx: any = (error as any).context;
        if (ctx && typeof ctx.json === "function") {
          const body = await ctx.json();
          e = body?.error;
        }
      } catch { /* ignore */ }
      if (!e) e = error.message;
    }
    if (e) {
      if (e === "invalid_or_expired") toast.error("Código inválido ou expirado.");
      else if (e === "too_many_attempts") toast.error("Muitas tentativas. Tente novamente em 1 hora.");
      else toast.error("Este e-mail não tem acesso a esta campanha.");
      return;
    }
    const jwt = (data as any)?.jwt as string;
    if (!jwt) { toast.error("Erro inesperado."); return; }
    // Antes de liberar, garante que o JWT VAI persistir. Sem isso o usuário
    // entra agora, dá refresh, perde sessão, pede OTP de novo → loop.
    let persisted = false;
    try {
      localStorage.setItem(
        accessStorageKey(token),
        JSON.stringify({ jwt, email: email.trim().toLowerCase(), exp: Date.now() + 86400_000 }),
      );
      persisted = true;
    } catch { /* ignore */ }
    logPortalAuth({
      email: email.trim().toLowerCase(),
      endpoint: "verify-campaign-otp",
      auth_status: persisted ? "ok" : "ok_no_persistence",
      jwt_present: true,
      localstorage_available: persisted,
      token,
    });
    if (!persisted) {
      setStorageOk(false);
      toast.error("Não foi possível salvar sua sessão neste navegador. Abra o link no Chrome ou Safari.");
      return;
    }
    onAuthed(jwt, email.trim().toLowerCase());
  }


  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="flex justify-center mb-6">
          <NexEngineLogo variant="auto" className="h-8 w-auto" />
        </div>
        <Card>
          <CardContent className="p-6 space-y-5">
            {!storageOk && (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-200 flex gap-2">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <div className="space-y-2">
                  <p>
                    <strong>Seu navegador está bloqueando o armazenamento necessário para manter sua sessão.</strong>
                  </p>
                  <p className="text-amber-100/80">
                    Por isso, mesmo após digitar o código, a página vai pedir tudo de novo no próximo refresh.
                    Abra este link diretamente no <strong>Chrome</strong> ou <strong>Safari</strong> — saia do
                    navegador interno do WhatsApp, Instagram ou Gmail antes de continuar.
                  </p>
                </div>
              </div>
            )}
            {step === "email" ? (

              <>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Mail className="h-4 w-4" /> Acesso ao portal da campanha
                </div>
                <div>
                  <h1 className="text-xl font-semibold">Digite seu e-mail para acessar</h1>
                  <p className="text-sm text-muted-foreground mt-1">
                    Você receberá um código de 6 dígitos válido por 10 minutos.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label>E-mail</Label>
                  <Input
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="voce@exemplo.com"
                    onKeyDown={(e) => e.key === "Enter" && !loading && requestCode()}
                    autoFocus
                  />
                </div>
                <Button onClick={requestCode} disabled={loading} className="w-full">
                  {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Enviar código
                </Button>
              </>
            ) : (
              <>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <KeyRound className="h-4 w-4" /> Verificação em 2 etapas
                </div>
                <div>
                  <h1 className="text-xl font-semibold">Digite o código enviado para seu e-mail</h1>
                  <p className="text-sm text-muted-foreground mt-1">
                    Enviado para <span className="text-foreground">{email}</span>. Expira em 10 minutos.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label>Código de 6 dígitos</Label>
                  <Input
                    inputMode="numeric"
                    maxLength={6}
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                    placeholder="000000"
                    className="text-center text-2xl tracking-[0.5em] font-mono"
                    onKeyDown={(e) => e.key === "Enter" && !loading && verifyCode()}
                    autoFocus
                  />
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => { setStep("email"); setCode(""); }} disabled={loading}>
                    Voltar
                  </Button>
                  <Button onClick={verifyCode} disabled={loading} className="flex-1">
                    {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    Entrar
                  </Button>
                </div>
                <button
                  type="button"
                  onClick={requestCode}
                  disabled={loading}
                  className="text-xs text-muted-foreground hover:text-foreground w-full text-center"
                >
                  Não recebeu? Reenviar código
                </button>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}