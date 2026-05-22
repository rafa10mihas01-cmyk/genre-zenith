// Página pública de convite para conectar uma conta Spotify a um app NexEngine.
// O admin gera o link em /sistema → Configurações e manda pro dono da conta.
// O dono abre, clica "Conectar com Spotify", autoriza no Spotify e a conta
// cai automaticamente vinculada ao app — sem expor senha pra ninguém.
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Loader2, Music2, ShieldCheck, AlertCircle, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PublicShell } from "@/components/public/PublicShell";
import { getSpotifyRedirectUri } from "@/lib/spotifyPublicAuth";

type InviteInfo = {
  ok: boolean;
  app_name?: string | null;
  app_slug?: string | null;
  label?: string | null;
  expires_at?: string;
  consumed_at?: string | null;
  consumed_email?: string | null;
  expired?: boolean;
  error?: string;
};

export default function SpotifyInvite() {
  const { token } = useParams<{ token: string }>();
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.title = "Conectar Spotify — NexEngine";
    if (!token) {
      setLoading(false);
      setInfo({ ok: false, error: "Link inválido." });
      return;
    }
    (async () => {
      try {
        const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/spotify-invite?mode=info&token=${encodeURIComponent(token)}`;
        const resp = await fetch(url, {
          headers: { apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY },
        });
        const json = await resp.json();
        setInfo(json);
      } catch (e) {
        setInfo({ ok: false, error: (e as Error).message });
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  async function startConnect() {
    if (!token || !info?.app_slug) return;
    setConnecting(true);
    setError(null);
    try {
      const redirect = getSpotifyRedirectUri(info.app_slug);
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/spotify-invite?mode=login&token=${encodeURIComponent(token)}&redirect=${encodeURIComponent(redirect)}`;
      const resp = await fetch(url, {
        headers: { apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY },
      });
      const json = await resp.json();
      if (!json.ok || !json.url) throw new Error(json.error || "Falha ao iniciar conexão.");
      window.location.href = json.url;
    } catch (e) {
      setError((e as Error).message);
      setConnecting(false);
    }
  }

  const expiresLabel = info?.expires_at
    ? new Date(info.expires_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })
    : null;

  return (
    <PublicShell>
      <section className="relative mx-auto flex min-h-[70vh] max-w-xl items-center justify-center px-6 py-20">
        <div className="nx-premium-card w-full p-10 text-center">
          {loading && (
            <>
              <Loader2 className="mx-auto mb-4 h-8 w-8 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Validando convite…</p>
            </>
          )}

          {!loading && info && !info.ok && (
            <>
              <div className="mx-auto mb-6 grid h-14 w-14 place-items-center rounded-full bg-destructive/10 border border-destructive/20">
                <AlertCircle className="h-7 w-7 text-destructive" />
              </div>
              <h1 className="text-2xl font-semibold tracking-tight mb-2">Convite inválido</h1>
              <p className="text-sm text-muted-foreground">
                Este link não é válido ou expirou. Peça um novo convite a quem te enviou.
              </p>
            </>
          )}

          {!loading && info?.ok && info.consumed_at && (
            <>
              <div className="mx-auto mb-6 grid h-14 w-14 place-items-center rounded-full bg-yellow-400/10 border border-yellow-400/20">
                <ShieldCheck className="h-7 w-7 text-yellow-400" />
              </div>
              <h1 className="text-2xl font-semibold tracking-tight mb-2">Convite já utilizado</h1>
              <p className="text-sm text-muted-foreground">
                Esta conta já foi conectada
                {info.consumed_email ? <> como <span className="text-foreground font-medium">{info.consumed_email}</span></> : null}.
                Você pode fechar esta aba.
              </p>
            </>
          )}

          {!loading && info?.ok && !info.consumed_at && info.expired && (
            <>
              <div className="mx-auto mb-6 grid h-14 w-14 place-items-center rounded-full bg-yellow-400/10 border border-yellow-400/20">
                <Clock className="h-7 w-7 text-yellow-400" />
              </div>
              <h1 className="text-2xl font-semibold tracking-tight mb-2">Convite expirado</h1>
              <p className="text-sm text-muted-foreground">
                Este link já passou da validade. Peça um novo convite a quem te enviou.
              </p>
            </>
          )}

          {!loading && info?.ok && !info.consumed_at && !info.expired && (
            <>
              <div className="mx-auto mb-6 grid h-14 w-14 place-items-center rounded-full bg-primary/10 border border-primary/20">
                <Music2 className="h-7 w-7 text-primary" />
              </div>
              <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight mb-3">
                Conectar sua conta Spotify
              </h1>
              <p className="text-sm text-muted-foreground mb-2 leading-relaxed">
                Você foi convidado a conectar sua conta Spotify ao app{" "}
                <span className="text-foreground font-medium">"{info.app_name}"</span> no NexEngine.
              </p>
              {info.label && (
                <p className="text-xs text-muted-foreground/80 mb-6">{info.label}</p>
              )}

              <div className="my-6 rounded-lg border border-white/10 bg-white/[0.03] p-4 text-left text-xs text-muted-foreground space-y-1.5">
                <p>• Você vai entrar com seu próprio e-mail e senha do Spotify.</p>
                <p>• Sua senha <span className="text-foreground">nunca</span> é vista por ninguém — vai direto pro Spotify.</p>
                <p>• Você pode desconectar a qualquer momento no seu painel do Spotify.</p>
              </div>

              <Button
                onClick={startConnect}
                disabled={connecting}
                size="lg"
                className="nx-cta-btn gap-2 min-w-[240px] h-11 text-sm"
              >
                {connecting ? (
                  <><Loader2 className="h-4 w-4 animate-spin" /> Abrindo Spotify…</>
                ) : (
                  <><Music2 className="h-4 w-4" /> Conectar com Spotify</>
                )}
              </Button>

              {expiresLabel && (
                <p className="mt-6 text-[11px] text-muted-foreground/60">
                  Convite válido até {expiresLabel}
                </p>
              )}

              {error && (
                <p className="mt-4 text-xs text-destructive">{error}</p>
              )}
            </>
          )}
        </div>
      </section>
    </PublicShell>
  );
}
