// Shell compartilhado pelas páginas públicas (Landing + Privacy).
// Garante identidade visual única: header global com logo oficial,
// fundo em camadas (base preta + radial glow + grid sutil), footer.
// Header é inteligente: visitante vê "Conectar Spotify"; logado vê "Entrar no painel".
import { Link, useLocation } from "react-router-dom";
import { ArrowRight, LayoutDashboard, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NexEngineLogo } from "@/components/NexEngineLogo";
import { ReactNode, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { handleSpotifyLogin } from "@/lib/spotifyPublicAuth";
import { toast } from "sonner";

export function PublicShell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const isPrivacy = pathname.startsWith("/privacy");
  const { user } = useAuth();
  const [connecting, setConnecting] = useState(false);

  async function onConnectSpotify() {
    if (connecting) return;
    setConnecting(true);
    try {
      await handleSpotifyLogin();
    } catch (err) {
      setConnecting(false);
      toast.error((err as Error)?.message ?? "Falha ao iniciar a conexão com o Spotify.");
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-background text-foreground antialiased">
      {/* ── Camada 1: gradiente base ─────────────────────────────── */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-40"
        style={{
          background:
            "radial-gradient(ellipse 90% 60% at 50% -10%, hsl(141 76% 48% / 0.10), transparent 60%), linear-gradient(180deg, #050505 0%, #0a0a0a 100%)",
        }}
      />
      {/* ── Camada 2: aurora animada (3 blobs verdes respirando) ── */}
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-30 overflow-hidden">
        <div
          className="nx-aurora-1 absolute -top-32 left-[10%] h-[520px] w-[520px] rounded-full blur-3xl"
          style={{ background: "radial-gradient(closest-side, hsl(141 76% 48% / 0.32), transparent 70%)" }}
        />
        <div
          className="nx-aurora-2 absolute top-[40%] -right-20 h-[480px] w-[480px] rounded-full blur-3xl"
          style={{ background: "radial-gradient(closest-side, hsl(141 76% 48% / 0.24), transparent 70%)" }}
        />
        <div
          className="nx-aurora-3 absolute bottom-0 left-[30%] h-[560px] w-[560px] rounded-full blur-3xl"
          style={{ background: "radial-gradient(closest-side, hsl(141 76% 48% / 0.20), transparent 70%)" }}
        />
      </div>
      {/* ── Camada 2: grid sutil ─────────────────────────────────── */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-20 opacity-[0.07]"
        style={{
          backgroundImage:
            "linear-gradient(to right, rgba(255,255,255,0.6) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.6) 1px, transparent 1px)",
          backgroundSize: "56px 56px",
          maskImage:
            "radial-gradient(ellipse 80% 70% at 50% 30%, black, transparent 75%)",
          WebkitMaskImage:
            "radial-gradient(ellipse 80% 70% at 50% 30%, black, transparent 75%)",
        }}
      />
      {/* ── Camada 3: noise leve ─────────────────────────────────── */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10 opacity-[0.025] mix-blend-overlay"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)' opacity='0.6'/></svg>\")",
        }}
      />

      {/* ── Header global ────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 border-b border-white/5 bg-background/70 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6 sm:py-4">
          <Link
            to="/"
            className="flex items-center gap-2 transition-opacity hover:opacity-90 shrink-0"
            aria-label="NexEngine — Home"
          >
            {/* Logo menor no mobile pra evitar quebra/aperto no header */}
            <span className="block sm:hidden">
              <NexEngineLogo variant="dark" size={22} />
            </span>
            <span className="hidden sm:block">
              <NexEngineLogo variant="dark" size={28} />
            </span>
          </Link>
          <nav className="flex items-center gap-1 sm:gap-2 shrink-0">
            <Link
              to="/privacy"
              className={`hidden sm:inline-block text-sm transition-colors px-3 py-2 rounded-md ${
                isPrivacy
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Privacidade
            </Link>
            {!user && (
              <Link
                to="/login"
                className="text-sm transition-colors px-2 sm:px-3 py-2 rounded-md text-muted-foreground hover:text-foreground"
              >
                Entrar
              </Link>
            )}
            {user ? (
              // Usuário logado → botão único para entrar no painel
              <Button asChild size="sm" className="nx-cta-btn gap-1.5 px-3 sm:px-4 text-xs sm:text-sm">
                <Link to="/catalogo">
                  <LayoutDashboard className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Entrar no painel</span>
                  <span className="sm:hidden">Painel</span>
                </Link>
              </Button>
            ) : (
              // Visitante → CTA público de conexão (OAuth Spotify direto)
              <Button
                onClick={onConnectSpotify}
                disabled={connecting}
                size="sm"
                className="nx-cta-btn gap-1.5 px-3 sm:px-4 text-xs sm:text-sm"
              >
                {connecting ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span className="hidden sm:inline">Redirecionando…</span>
                    <span className="sm:hidden">Aguarde…</span>
                  </>
                ) : (
                  <>
                    <span className="hidden sm:inline">Conectar Spotify</span>
                    <span className="sm:hidden">Conectar</span>
                    <ArrowRight className="h-3.5 w-3.5" />
                  </>
                )}
              </Button>
            )}
          </nav>
        </div>
      </header>

      {/* ── Conteúdo da página ───────────────────────────────────── */}
      <main className="relative">{children}</main>

      {/* ── Footer global ────────────────────────────────────────── */}
      <footer className="relative border-t border-white/5 mt-12">
        <div className="mx-auto flex max-w-6xl flex-col sm:flex-row items-center justify-between gap-4 px-6 py-10">
          <div className="flex items-center gap-3">
            <NexEngineLogo variant="dark" size={20} />
            <span className="text-xs text-muted-foreground">
              © {new Date().getFullYear()} NexEngine. Todos os direitos reservados.
            </span>
          </div>
          <div className="flex items-center gap-5 text-xs">
            <Link
              to="/privacy"
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              Política de Privacidade
            </Link>
            <Link
              to={user ? "/catalogo" : "/login"}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              {user ? "Entrar no painel" : "Conectar Spotify"}
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
