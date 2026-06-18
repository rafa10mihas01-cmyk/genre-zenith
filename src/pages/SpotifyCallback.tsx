// Página de callback do OAuth público do Spotify.
// Recebe ?code=…&state=… do Spotify, troca pelo token via edge function e:
//   • se email estiver na allowlist → cria sessão Supabase via magic link e
//     redireciona para /operacao
//   • caso contrário → mostra tela "acesso pendente"
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { CheckCircle2, AlertCircle, Loader2, ArrowRight, Home, Clock, ShieldAlert, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PublicShell } from "@/components/public/PublicShell";
import { consumeStoredState, getSpotifyRedirectUri } from "@/lib/spotifyPublicAuth";
import { supabase } from "@/integrations/supabase/client";

type Status = "loading" | "signing_in" | "success" | "pending" | "unauthorized" | "error";
const SETTINGS_RETURN_KEY = "nx:spotify_settings_return";

interface Result {
  display_name?: string | null;
  email?: string | null;
  spotify_user_id?: string;
}

export default function SpotifyCallback() {
  const [params] = useSearchParams();
  const { slug } = useParams<{ slug?: string }>();
  const navigate = useNavigate();
  const ranRef = useRef(false);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string>("");
  const [result, setResult] = useState<Result>({});

  useEffect(() => {
    document.title = "Conectando ao Spotify — NexEngine";

    // 🛡️ React StrictMode dispara o efeito 2x em dev — guard
    if (ranRef.current) return;
    ranRef.current = true;

    const code = params.get("code");
    const state = params.get("state");
    const errParam = params.get("error");
    const settingsReturn = localStorage.getItem(SETTINGS_RETURN_KEY);

    if (errParam) {
      setStatus("error");
      setError(
        errParam === "access_denied"
          ? "Você cancelou a autorização. Pode tentar novamente quando quiser."
          : `Erro do Spotify: ${errParam}`,
      );
      return;
    }

    if (!code || !state) {
      setStatus("error");
      setError("Resposta inválida do Spotify (faltam parâmetros).");
      return;
    }

    // Apps com slug são SEMPRE conexão administrativa (gerenciada via Settings).
    // O state é validado no servidor (tabela spotify_oauth_states) — não precisamos
    // checar localStorage aqui. Isso replica o fluxo legado de /settings?spotify_callback=1
    // que já funciona para a NexEngine há semanas.
    const isAdminAppConnection = !!slug;
    const stored = consumeStoredState();
    const isSettingsConnection = isAdminAppConnection || !!settingsReturn;
    if (!isSettingsConnection && (!stored || stored !== state)) {
      setStatus("error");
      setError("Sessão de autorização expirou. Tente conectar novamente.");
      return;
    }

    // Reconstroi o redirect EXATAMENTE como foi enviado no /authorize
    // (precisa bater 100% com o que o Spotify recebeu).
    const redirect = getSpotifyRedirectUri(slug);
    // Convite por link público — state começa com "inv_"
    const isInvite = state.startsWith("inv_");
    const functionName = isInvite
      ? "spotify-invite"
      : isSettingsConnection ? "spotify-auth" : "spotify-public-auth";
    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${functionName}?mode=callback&code=${encodeURIComponent(
      code,
    )}&state=${encodeURIComponent(state)}&redirect=${encodeURIComponent(redirect)}`;

    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const resp = await fetch(url, {
          headers: (isSettingsConnection && !isInvite)
            ? { Authorization: `Bearer ${session?.access_token ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}` }
            : { apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY },
        });
        const json = await resp.json();
        if (!json.ok) {
          const raw = String(json.error || "");
           
          console.error("[spotify-callback] error from edge:", raw);
          // Spotify devolve 403 "User not registered in the Developer Dashboard"
          // quando o e-mail da conta Spotify (não o gmail de login!) não está nos testers do app
          if (/not registered/i.test(raw)) {
            setStatus("unauthorized");
            setError(raw);
            return;
          }
          setStatus("error");
          setError(raw || "Falha ao concluir a conexão.");
          return;
        }

        setResult({
          display_name: json.display_name,
          email: json.email,
          spotify_user_id: json.spotify_user_id,
        });

        if (isInvite) {
          setResult({
            display_name: json.display_name,
            email: json.email,
            spotify_user_id: json.spotify_user_id,
          });
          setStatus("success");
          return;
        }

        if (isSettingsConnection) {
          localStorage.removeItem(SETTINGS_RETURN_KEY);
          setStatus("success");
          setTimeout(() => navigate(settingsReturn || "/sistema?tab=configuracoes", { replace: true }), 900);
          return;
        }

        // Email não está na allowlist → tela "acesso pendente"
        if (json.allowed === false) {
          setStatus("pending");
          return;
        }

        // Allowlist OK → cria sessão a partir do magic link
        if (!json.magic_link) {
          setStatus("error");
          setError("Servidor não devolveu link de acesso.");
          return;
        }

        setStatus("signing_in");
        const ok = await consumeMagicLink(json.magic_link);
        if (!ok) {
          setStatus("error");
          setError("Não conseguimos criar a sessão. Tente novamente.");
          return;
        }

        setStatus("success");
        // Pequeno delay pra mostrar a tela de sucesso, depois entra no painel
        setTimeout(() => navigate("/catalogo", { replace: true }), 900);
      } catch (e) {
        setStatus("error");
        setError((e as Error)?.message ?? "Erro de rede ao concluir a conexão.");
      }
    })();
  }, [params, navigate]);

  return (
    <PublicShell>
      <section className="relative mx-auto flex min-h-[70vh] max-w-2xl items-center justify-center px-6 py-20">
        <div className="nx-premium-card w-full p-10 text-center">
          {(status === "loading" || status === "signing_in") && (
            <>
              <div className="mx-auto mb-6 grid h-14 w-14 place-items-center rounded-full bg-primary/10 border border-primary/20">
                <Loader2 className="h-6 w-6 text-primary animate-spin" />
              </div>
              <h1 className="text-2xl font-semibold tracking-tight mb-2">
                {status === "signing_in"
                  ? "Criando sua sessão…"
                  : "Concluindo conexão com o Spotify…"}
              </h1>
              <p className="text-sm text-muted-foreground">
                {status === "signing_in"
                  ? "Quase lá — preparando o painel."
                  : "Validando autorização e buscando dados da sua conta."}
              </p>
            </>
          )}

          {status === "success" && (
            <>
              <div className="mx-auto mb-6 grid h-14 w-14 place-items-center rounded-full bg-primary/10 border border-primary/20 shadow-[0_0_28px_-8px_hsl(141_76%_48%/0.6)]">
                <CheckCircle2 className="h-7 w-7 text-primary" />
              </div>
              <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight mb-3">
                Tudo pronto, {result.display_name ?? "bem-vindo"}!
              </h1>
              <p className="text-muted-foreground mb-2">
                {localStorage.getItem(SETTINGS_RETURN_KEY)
                  ? "Sua conta Spotify foi conectada ao sistema."
                  : "Sua conta Spotify foi conectada e você já está autenticado."}
              </p>
              <p className="text-xs text-muted-foreground/70">
                Redirecionando para o painel…
              </p>
            </>
          )}

          {status === "pending" && (
            <>
              <div className="mx-auto mb-6 grid h-14 w-14 place-items-center rounded-full bg-yellow-400/10 border border-yellow-400/20">
                <Clock className="h-7 w-7 text-yellow-400" />
              </div>
              <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight mb-3">
                Conexão recebida — aguardando aprovação
              </h1>
              <p className="text-muted-foreground mb-6 leading-relaxed">
                Recebemos sua autorização do Spotify
                {result.display_name ? (
                  <>
                    {" "}como <span className="text-foreground font-medium">{result.display_name}</span>
                  </>
                ) : null}
                . Sua conta entrou na fila de revisão. Você receberá acesso ao painel assim que
                for aprovado pela nossa equipe.
              </p>

              {(result.email || result.spotify_user_id) && (
                <div className="mb-8 inline-flex flex-col gap-1 rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3 text-left text-xs text-muted-foreground">
                  {result.email && <span>📧 {result.email}</span>}
                  {result.spotify_user_id && <span>🆔 {result.spotify_user_id}</span>}
                </div>
              )}

              <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                <Button asChild size="lg" className="nx-cta-btn gap-2 min-w-[200px] h-11 text-sm">
                  <Link to="/">
                    <Home className="h-4 w-4" />
                    Voltar para a página inicial
                  </Link>
                </Button>
              </div>
            </>
          )}

          {status === "unauthorized" && (
            <>
              <div className="mx-auto mb-6 grid h-14 w-14 place-items-center rounded-full bg-yellow-400/10 border border-yellow-400/20 shadow-[0_0_28px_-8px_hsl(48_96%_53%/0.5)]">
                <ShieldAlert className="h-7 w-7 text-yellow-400" />
              </div>
              <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight mb-3">
                Conta não autorizada
              </h1>
              <p className="text-muted-foreground mb-3 leading-relaxed">
                Este aplicativo está em <span className="text-foreground font-medium">fase de testes</span>.
              </p>
              <p className="text-sm text-muted-foreground mb-4 leading-relaxed">
                No momento, apenas usuários autorizados podem conectar.
                Se você precisa de acesso, entre em contato com o suporte.
              </p>
              {error && (
                <pre className="mb-6 mx-auto max-w-md whitespace-pre-wrap break-words rounded-md border border-white/10 bg-white/[0.03] p-3 text-left text-[11px] text-muted-foreground/80">
                  {error}
                </pre>
              )}
              <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                <Button asChild size="lg" className="nx-cta-btn gap-2 min-w-[200px] h-11 text-sm">
                  <a href="mailto:suporte@nexcreatorx.com?subject=Solicitação%20de%20acesso%20NexEngine">
                    <Mail className="h-4 w-4" />
                    Falar com o suporte
                  </a>
                </Button>
                <Button asChild variant="outline" size="lg" className="gap-2 min-w-[180px] h-11 text-sm border-white/10 bg-white/[0.03] hover:bg-white/[0.06]">
                  <Link to="/">
                    <Home className="h-4 w-4" />
                    Voltar ao início
                  </Link>
                </Button>
              </div>
            </>
          )}

          {status === "error" && (
            <>
              <div className="mx-auto mb-6 grid h-14 w-14 place-items-center rounded-full bg-destructive/10 border border-destructive/20">
                <AlertCircle className="h-7 w-7 text-destructive" />
              </div>
              <h1 className="text-2xl font-semibold tracking-tight mb-3">
                Não conseguimos concluir a conexão
              </h1>
              <p className="text-sm text-muted-foreground mb-8 leading-relaxed">{error}</p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                <Button asChild size="lg" className="nx-cta-btn gap-2 min-w-[200px] h-11 text-sm">
                  <Link to="/">
                    Tentar novamente
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
              </div>
            </>
          )}
        </div>
      </section>
    </PublicShell>
  );
}

/**
 * Recebe um magic link do Supabase (URL completa) e materializa a sessão
 * usando verifyOtp com o token_hash extraído da query string.
 */
async function consumeMagicLink(actionLink: string): Promise<boolean> {
  try {
    const u = new URL(actionLink);
    // Magic links usam ?token_hash=…&type=magiclink
    const tokenHash = u.searchParams.get("token_hash");
    const type = (u.searchParams.get("type") as "magiclink" | "email" | null) ?? "magiclink";
    if (!tokenHash) return false;

    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type,
    });
    return !error;
  } catch {
    return false;
  }
}
