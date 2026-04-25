// Página de callback do OAuth público do Spotify.
// Recebe ?code=…&state=… do Spotify, chama a edge function pra trocar
// o code por token e mostra o resultado da conexão. NÃO loga o usuário
// no sistema — é um fluxo demonstrativo conforme exigido pela revisão Spotify.
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CheckCircle2, AlertCircle, Loader2, ArrowRight, Home } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PublicShell } from "@/components/public/PublicShell";
import { consumeStoredState, getSpotifyRedirectUri } from "@/lib/spotifyPublicAuth";

type Status = "loading" | "success" | "error";

interface Result {
  display_name?: string | null;
  email?: string | null;
  spotify_user_id?: string;
}

export default function SpotifyCallback() {
  const [params] = useSearchParams();
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string>("");
  const [result, setResult] = useState<Result>({});

  useEffect(() => {
    document.title = "Conectando ao Spotify — NexEngine";

    const code = params.get("code");
    const state = params.get("state");
    const errParam = params.get("error");

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

    const stored = consumeStoredState();
    if (!stored || stored !== state) {
      setStatus("error");
      setError("Sessão de autorização expirou. Tente conectar novamente.");
      return;
    }

    const redirect = getSpotifyRedirectUri();
    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/spotify-public-auth?mode=callback&code=${encodeURIComponent(
      code,
    )}&state=${encodeURIComponent(state)}&redirect=${encodeURIComponent(redirect)}`;

    fetch(url, {
      headers: {
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      },
    })
      .then((r) => r.json())
      .then((json) => {
        if (!json.ok) {
          setStatus("error");
          setError(json.error || "Falha ao concluir a conexão.");
          return;
        }
        setResult({
          display_name: json.display_name,
          email: json.email,
          spotify_user_id: json.spotify_user_id,
        });
        setStatus("success");
      })
      .catch((e) => {
        setStatus("error");
        setError(e?.message ?? "Erro de rede ao concluir a conexão.");
      });
  }, [params]);

  return (
    <PublicShell>
      <section className="relative mx-auto flex min-h-[70vh] max-w-2xl items-center justify-center px-6 py-20">
        <div className="nx-premium-card w-full p-10 text-center">
          {status === "loading" && (
            <>
              <div className="mx-auto mb-6 grid h-14 w-14 place-items-center rounded-full bg-primary/10 border border-primary/20">
                <Loader2 className="h-6 w-6 text-primary animate-spin" />
              </div>
              <h1 className="text-2xl font-semibold tracking-tight mb-2">
                Concluindo conexão com o Spotify…
              </h1>
              <p className="text-sm text-muted-foreground">
                Validando autorização e buscando dados da sua conta.
              </p>
            </>
          )}

          {status === "success" && (
            <>
              <div className="mx-auto mb-6 grid h-14 w-14 place-items-center rounded-full bg-primary/10 border border-primary/20 shadow-[0_0_28px_-8px_hsl(141_76%_48%/0.6)]">
                <CheckCircle2 className="h-7 w-7 text-primary" />
              </div>
              <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight mb-3">
                Conta Spotify conectada com sucesso
              </h1>
              <p className="text-muted-foreground mb-6 leading-relaxed">
                {result.display_name ? (
                  <>
                    Olá, <span className="text-foreground font-medium">{result.display_name}</span>! Recebemos
                    sua autorização. Agora sua conexão entrará em <span className="text-foreground">análise</span> pela
                    nossa equipe antes de liberar o painel.
                  </>
                ) : (
                  <>
                    Recebemos sua autorização. Agora sua conexão entrará em análise pela nossa equipe antes de
                    liberar o painel.
                  </>
                )}
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

          {status === "error" && (
            <>
              <div className="mx-auto mb-6 grid h-14 w-14 place-items-center rounded-full bg-destructive/10 border border-destructive/20">
                <AlertCircle className="h-7 w-7 text-destructive" />
              </div>
              <h1 className="text-2xl font-semibold tracking-tight mb-3">
                Não conseguimos concluir a conexão
              </h1>
              <p className="text-sm text-muted-foreground mb-8 leading-relaxed">
                {error}
              </p>
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
