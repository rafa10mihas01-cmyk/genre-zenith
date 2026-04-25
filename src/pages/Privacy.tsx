// Política de Privacidade pública — exigida para aprovação do Spotify OAuth.
// Mesma identidade visual premium da landing (PublicShell).
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Lock,
  ShieldCheck,
  Database,
  KeyRound,
  UserMinus,
  FileText,
  ArrowRight,
  LayoutDashboard,
  Loader2,
} from "lucide-react";
import { PublicShell } from "@/components/public/PublicShell";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { handleSpotifyLogin } from "@/lib/spotifyPublicAuth";
import { toast } from "sonner";

function setMeta(name: string, content: string) {
  let tag = document.querySelector(`meta[name="${name}"]`);
  if (!tag) {
    tag = document.createElement("meta");
    tag.setAttribute("name", name);
    document.head.appendChild(tag);
  }
  tag.setAttribute("content", content);
}

const SECTIONS = [
  {
    icon: KeyRound,
    title: "Tokens de acesso do Spotify",
    text:
      "Armazenamos os tokens de acesso do Spotify de forma segura e os utilizamos exclusivamente para criar e gerenciar playlists em nome do usuário. Os tokens são criptografados em repouso e nunca são compartilhados com terceiros.",
  },
  {
    icon: Database,
    title: "Compartilhamento de dados",
    text:
      "Não vendemos nem compartilhamos dados de usuários. Todas as informações coletadas são utilizadas exclusivamente para alimentar os recursos de automação de playlists do NexEngine.",
  },
  {
    icon: UserMinus,
    title: "Revogação de acesso",
    text:
      "O usuário pode revogar o acesso a qualquer momento nas configurações da sua conta Spotify. Após a revogação, todos os tokens relacionados são invalidados e removidos dos nossos sistemas.",
  },
  {
    icon: ShieldCheck,
    title: "Escopo de permissões",
    text:
      "Solicitamos apenas as permissões estritamente necessárias para a criação e gestão de playlists. Nenhum escopo adicional é solicitado sem o consentimento explícito do usuário.",
  },
];

export default function Privacy() {
  const { user } = useAuth();
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    document.title = "Política de Privacidade — NexEngine";
    setMeta(
      "description",
      "Como o NexEngine trata os tokens de acesso do Spotify, dados do usuário e permissões.",
    );
  }, []);

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
    <PublicShell>
      {/* ── Hero ─────────────────────────────────────────────── */}
      <section className="relative">
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-0 h-[480px] w-[900px] -translate-x-1/2 -translate-y-[40%] rounded-full opacity-60 blur-3xl"
          style={{
            background:
              "radial-gradient(closest-side, hsl(141 76% 48% / 0.40), transparent 70%)",
          }}
        />
        <div className="relative mx-auto max-w-3xl px-6 pt-20 sm:pt-28 pb-10 text-center animate-fade-in">
          <div className="nx-conic-pill inline-flex items-center gap-2 bg-white/[0.03] backdrop-blur-md px-3.5 py-1.5 text-xs font-medium text-muted-foreground mb-7 shadow-[0_0_24px_-8px_hsl(141_76%_48%/0.4)]">
            <FileText className="h-3.5 w-3.5 text-primary" />
            Documento legal · Atualizado em abril de 2026
          </div>
          <h1 className="text-5xl sm:text-7xl font-bold tracking-tight leading-[1.15] pb-2 mb-5 bg-gradient-to-b from-white via-white to-white/60 bg-clip-text text-transparent">
            Política de Privacidade
          </h1>
          <p className="mx-auto max-w-2xl text-base sm:text-lg text-muted-foreground leading-relaxed">
            Como o NexEngine trata os tokens de acesso do Spotify, os dados do usuário e
            as permissões — com privacidade e consentimento no centro de tudo.
          </p>

          {/* Trust badges abaixo do hero */}
          <div className="mt-10 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-xs text-muted-foreground/80">
            <div className="inline-flex items-center gap-1.5">
              <Lock className="h-3.5 w-3.5 text-primary/80" /> Criptografado em repouso
            </div>
            <div className="inline-flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5 text-primary/80" /> Permissões mínimas
            </div>
            <div className="inline-flex items-center gap-1.5">
              <UserMinus className="h-3.5 w-3.5 text-primary/80" /> Revogável a qualquer momento
            </div>
          </div>
        </div>

        {/* Divider premium com fade nas pontas */}
        <div className="mx-auto max-w-3xl px-6">
          <div className="nx-divider-fade" />
        </div>
      </section>

      {/* ── Seções em cards ──────────────────────────────────── */}
      <section className="relative mx-auto max-w-4xl px-6 py-12 sm:py-16">
        <div className="text-center mb-12">
          <p className="text-xs font-mono uppercase tracking-[0.18em] text-primary/80 mb-3">
            Como tratamos seus dados
          </p>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
            Privacidade no centro de tudo
          </h2>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {SECTIONS.map((s) => (
            <article key={s.title} className="nx-premium-card group">
              <div className="grid h-11 w-11 place-items-center rounded-xl bg-primary/10 text-primary border border-primary/20 mb-5 transition-all duration-300 group-hover:bg-primary/20 group-hover:scale-110 group-hover:shadow-[0_0_24px_hsl(141_76%_48%/0.4)]">
                <s.icon className="h-5 w-5" />
              </div>
              <h2 className="text-lg font-semibold mb-2 tracking-tight">{s.title}</h2>
              <p className="text-sm text-muted-foreground leading-relaxed">{s.text}</p>
            </article>
          ))}
        </div>

        {/* Bloco de contato */}
        <div className="mt-10 nx-premium-card text-center">
          <div className="mx-auto grid h-11 w-11 place-items-center rounded-xl bg-primary/10 text-primary border border-primary/20 mb-5">
            <Lock className="h-5 w-5" />
          </div>
          <h2 className="text-lg font-semibold mb-2 tracking-tight">
            Dúvidas sobre seus dados?
          </h2>
          <p className="text-sm text-muted-foreground leading-relaxed max-w-lg mx-auto">
            Entre em contato pelas configurações da sua conta dentro do NexEngine.
            Respondemos a todas as solicitações relacionadas à privacidade de forma
            rápida e transparente.
          </p>
        </div>
      </section>

      {/* ── CTA Final (mesma identidade da Landing) ─────────── */}
      <section className="relative border-t border-white/5">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 opacity-60"
          style={{
            background:
              "radial-gradient(ellipse 60% 80% at 50% 100%, hsl(141 76% 48% / 0.18), transparent 70%)",
          }}
        />
        <div className="relative mx-auto max-w-3xl px-6 py-24 sm:py-32 text-center">
          <h2 className="text-3xl sm:text-5xl font-bold tracking-tight mb-5 leading-[1.1]">
            Pronto para conectar sua conta Spotify?
          </h2>
          <p className="text-muted-foreground mb-10 text-base sm:text-lg">
            Mesmos padrões de segurança. Mesmo design centrado em privacidade. Em menos de um minuto.
          </p>
          {user ? (
            <Button asChild size="lg" className="nx-cta-btn gap-2 min-w-[240px] h-12 text-sm">
              <Link to="/operacao">
                <LayoutDashboard className="h-4 w-4" />
                Entrar no painel
              </Link>
            </Button>
          ) : (
            <Button
              onClick={onConnectSpotify}
              disabled={connecting}
              size="lg"
              className="nx-cta-btn gap-2 min-w-[240px] h-12 text-sm"
            >
              {connecting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Redirecionando…
                </>
              ) : (
                <>
                  Conectar Spotify
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </Button>
          )}
        </div>
      </section>
    </PublicShell>
  );
}
