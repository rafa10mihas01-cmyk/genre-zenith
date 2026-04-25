// Landing pública do NexEngine — exibida em "/" para visitantes não autenticados.
// Página institucional voltada para a aprovação do Spotify OAuth.
// Identidade visual SaaS premium (Stripe / Linear / Vercel).
import { Link } from "react-router-dom";
import { ArrowRight, Sparkles, BarChart3, Plug, Wand2, ShieldCheck, Zap, Lock, LineChart, LayoutDashboard, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";
import { PublicShell } from "@/components/public/PublicShell";
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

export default function Landing() {
  const { user } = useAuth();
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    document.title = "NexEngine — Automação inteligente de playlists no Spotify";
    setMeta(
      "description",
      "Conecte sua conta Spotify e crie playlists automaticamente com base em dados reais, tendências e comportamento de audiência.",
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
        {/* Glow radial central */}
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-0 h-[640px] w-[1100px] -translate-x-1/2 -translate-y-[35%] rounded-full opacity-60"
          style={{
            background:
              "radial-gradient(closest-side, hsl(141 76% 48% / 0.45), hsl(141 76% 48% / 0.12) 45%, transparent 75%)",
            filter: "blur(40px)",
          }}
        />
        {/* Halo lateral esquerdo */}
        <div
          aria-hidden
          className="pointer-events-none absolute -left-32 top-40 h-[420px] w-[420px] rounded-full opacity-40 blur-3xl"
          style={{ background: "radial-gradient(closest-side, hsl(141 76% 48% / 0.30), transparent 70%)" }}
        />

        <div className="relative mx-auto max-w-5xl px-6 py-24 sm:py-36 text-center animate-fade-in">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] backdrop-blur-md px-3.5 py-1.5 text-xs font-medium text-muted-foreground mb-8 shadow-[0_0_24px_-8px_hsl(141_76%_48%/0.4)]">
            <span className="relative flex h-2 w-2">
              <span className="absolute inset-0 animate-ping rounded-full bg-primary/60" />
              <span className="relative h-2 w-2 rounded-full bg-primary" />
            </span>
            Automação inteligente de catálogo musical
          </div>

          <h1 className="text-6xl sm:text-8xl font-bold tracking-tight leading-[1.0] mb-6 bg-gradient-to-b from-white via-white to-white/60 bg-clip-text text-transparent">
            NexEngine
          </h1>

          <p className="text-xl sm:text-3xl text-foreground/95 font-semibold tracking-tight mb-5">
            Automação inteligente de playlists no Spotify
          </p>

          <p className="mx-auto max-w-2xl text-base sm:text-lg text-muted-foreground leading-relaxed mb-12">
            Conecte sua conta Spotify e crie playlists automaticamente com base em dados reais,
            tendências e comportamento de audiência.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            {user ? (
              <Button asChild size="lg" className="nx-cta-btn gap-2 min-w-[240px] h-12 text-sm">
                <Link to="/operacao">
                  <LayoutDashboard className="h-4 w-4" />
                  Entrar no painel
                </Link>
              </Button>
            ) : (
              <Button asChild size="lg" className="nx-cta-btn gap-2 min-w-[240px] h-12 text-sm">
                <Link to="/login">
                  Conectar Spotify
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            )}
          </div>

          {/* Trust badges abaixo do CTA */}
          <div className="mt-14 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-xs text-muted-foreground/80">
            <div className="inline-flex items-center gap-1.5">
              <Lock className="h-3.5 w-3.5 text-primary/80" /> OAuth oficial do Spotify
            </div>
            <div className="inline-flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5 text-primary/80" /> Sem armazenar credenciais
            </div>
            <div className="inline-flex items-center gap-1.5">
              <Zap className="h-3.5 w-3.5 text-primary/80" /> Conecta em menos de 1 minuto
            </div>
          </div>
        </div>
      </section>

      {/* ── Como funciona ─────────────────────────────────────── */}
      <section className="relative mx-auto max-w-6xl px-6 py-20 sm:py-28">
        <div className="text-center mb-14">
          <p className="text-xs font-mono uppercase tracking-[0.18em] text-primary/80 mb-3">
            Workflow
          </p>
          <h2 className="text-3xl sm:text-5xl font-bold tracking-tight mb-4">Como funciona</h2>
          <p className="text-muted-foreground text-base sm:text-lg">
            Três passos simples, do primeiro clique à playlist no ar.
          </p>
        </div>

        <div className="grid gap-5 sm:grid-cols-3">
          {[
            {
              step: "01",
              icon: Plug,
              title: "Conecte sua conta Spotify",
              text: "Autorização segura via OAuth oficial. Você mantém controle total — pode revogar a qualquer momento.",
            },
            {
              step: "02",
              icon: BarChart3,
              title: "O sistema analisa dados e tendências",
              text: "Coletamos sinais públicos do Spotify para entender padrões de consumo e oportunidades por gênero.",
            },
            {
              step: "03",
              icon: Wand2,
              title: "Playlists são criadas automaticamente",
              text: "Templates aprovados são publicados na sua conta com curadoria contínua e otimização baseada em performance.",
            },
          ].map((b) => (
            <div key={b.step} className="nx-premium-card group">
              <div className="flex items-center justify-between mb-6">
                <span className="text-xs font-mono text-muted-foreground/60 tracking-widest">{b.step}</span>
                <div className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary border border-primary/20 transition-all duration-300 group-hover:bg-primary/20 group-hover:scale-110 group-hover:shadow-[0_0_24px_hsl(141_76%_48%/0.4)]">
                  <b.icon className="h-4 w-4" />
                </div>
              </div>
              <h3 className="text-lg font-semibold mb-2 tracking-tight">{b.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{b.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Funcionalidades ───────────────────────────────────── */}
      <section className="relative border-t border-white/5">
        {/* Glow de fundo da seção */}
        <div
          aria-hidden
          className="pointer-events-none absolute right-0 top-1/2 h-[400px] w-[400px] -translate-y-1/2 rounded-full opacity-30 blur-3xl"
          style={{ background: "radial-gradient(closest-side, hsl(141 76% 48% / 0.35), transparent 70%)" }}
        />
        <div className="relative mx-auto max-w-6xl px-6 py-20 sm:py-28">
          <div className="grid gap-12 lg:grid-cols-[1fr_1.2fr] items-start">
            <div className="lg:sticky lg:top-28">
              <p className="text-xs font-mono uppercase tracking-[0.18em] text-primary/80 mb-3">
                Capabilities
              </p>
              <h2 className="text-3xl sm:text-5xl font-bold tracking-tight mb-5">
                Funcionalidades
              </h2>
              <p className="text-muted-foreground leading-relaxed text-base sm:text-lg">
                Tudo o que você precisa para escalar curadoria sem perder qualidade. Sem planilhas,
                sem replicação manual, sem adivinhação.
              </p>
            </div>

            <ul className="space-y-3">
              {[
                { icon: Wand2, title: "Criação automática de playlists", text: "Templates inteligentes aplicados ao seu catálogo." },
                { icon: Sparkles, title: "Organização inteligente de catálogo", text: "Estrutura por gênero, mood e contexto." },
                { icon: LineChart, title: "Otimização contínua baseada em dados", text: "Reordenação e renovação a partir de performance." },
                { icon: Plug, title: "Integração direta com Spotify", text: "Publicação nativa via API oficial." },
              ].map((f) => (
                <li key={f.title} className="nx-feature-row group">
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary border border-primary/20 transition-all duration-300 group-hover:bg-primary/20 group-hover:shadow-[0_0_20px_hsl(141_76%_48%/0.35)]">
                    <f.icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm sm:text-base font-semibold tracking-tight">{f.title}</p>
                    <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">{f.text}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ── Sobre ─────────────────────────────────────────────── */}
      <section className="relative mx-auto max-w-3xl px-6 py-20 sm:py-28 text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] backdrop-blur-md px-3.5 py-1.5 text-xs text-muted-foreground mb-6">
          <ShieldCheck className="h-3.5 w-3.5 text-primary" />
          Sobre o NexEngine
        </div>
        <h2 className="text-3xl sm:text-5xl font-bold tracking-tight mb-8 leading-[1.1]">
          Construído com privacidade e consentimento no centro.
        </h2>
        <div className="space-y-5 text-base sm:text-lg text-muted-foreground leading-relaxed max-w-2xl mx-auto">
          <p>
            NexEngine é uma plataforma que permite aos usuários conectar suas contas Spotify e
            automatizar a criação e gestão de playlists.
          </p>
          <p>
            Todas as ações são realizadas apenas com autorização do usuário via Spotify OAuth.
          </p>
        </div>
      </section>

      {/* ── CTA Final ─────────────────────────────────────────── */}
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
            Comece agora conectando sua conta Spotify.
          </h2>
          <p className="text-muted-foreground mb-10 text-base sm:text-lg">
            Leva menos de um minuto. Sem cartão de crédito, sem instalação.
          </p>
          {user ? (
            <Button asChild size="lg" className="nx-cta-btn gap-2 min-w-[240px] h-12 text-sm">
              <Link to="/operacao">
                <LayoutDashboard className="h-4 w-4" />
                Entrar no painel
              </Link>
            </Button>
          ) : (
            <Button asChild size="lg" className="nx-cta-btn gap-2 min-w-[240px] h-12 text-sm">
              <Link to="/login">
                Conectar Spotify
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          )}
        </div>
      </section>
    </PublicShell>
  );
}
