// Landing pública do NexEngine — exibida em "/" para visitantes não autenticados.
// Página institucional voltada para a aprovação do Spotify OAuth.
import { Link } from "react-router-dom";
import { ArrowRight, Music2, Sparkles, BarChart3, Plug, Wand2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useEffect } from "react";

const SPOTIFY_GREEN = "hsl(var(--primary))";

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
  useEffect(() => {
    document.title = "NexEngine — Automação inteligente de playlists no Spotify";
    setMeta(
      "description",
      "Conecte sua conta Spotify e crie playlists automaticamente com base em dados reais, tendências e comportamento de audiência.",
    );
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground antialiased">
      {/* ── Top nav ─────────────────────────────────────── */}
      <header className="sticky top-0 z-40 border-b border-border/50 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link to="/" className="flex items-center gap-2 group">
            <div
              className="grid h-8 w-8 place-items-center rounded-lg transition-transform group-hover:scale-105"
              style={{ background: SPOTIFY_GREEN }}
            >
              <Music2 className="h-4 w-4 text-primary-foreground" />
            </div>
            <span className="text-base font-semibold tracking-tight">NexEngine</span>
          </Link>
          <nav className="flex items-center gap-2">
            <Link to="/privacy" className="hidden sm:inline-block text-sm text-muted-foreground hover:text-foreground transition-colors px-3 py-2">
              Privacy
            </Link>
            <Button asChild variant="ghost" size="sm">
              <Link to="/login">Acessar painel</Link>
            </Button>
            <Button asChild size="sm" variant="premium" className="gap-1.5">
              <Link to="/login">
                Conectar Spotify <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
          </nav>
        </div>
      </header>

      {/* ── Hero ────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        {/* Glow decorativo */}
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-0 h-[520px] w-[820px] -translate-x-1/2 -translate-y-1/3 rounded-full opacity-30 blur-3xl"
          style={{ background: "radial-gradient(closest-side, hsl(var(--primary)/0.45), transparent 70%)" }}
        />
        <div className="relative mx-auto max-w-4xl px-6 py-24 sm:py-32 text-center animate-fade-in">
          <div className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-card/40 px-3 py-1 text-xs text-muted-foreground mb-8">
            <Sparkles className="h-3 w-3 text-primary" />
            Automação inteligente de catálogo musical
          </div>

          <h1 className="text-5xl sm:text-7xl font-semibold tracking-tight leading-[1.05] mb-6">
            NexEngine
          </h1>

          <p className="text-xl sm:text-2xl text-foreground/90 font-medium mb-5">
            Automação inteligente de playlists no Spotify
          </p>

          <p className="mx-auto max-w-2xl text-base sm:text-lg text-muted-foreground leading-relaxed mb-10">
            Conecte sua conta Spotify e crie playlists automaticamente com base em dados reais,
            tendências e comportamento de audiência.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Button asChild size="lg" variant="premium" className="gap-2 min-w-[200px]">
              <Link to="/login">
                Conectar Spotify
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="min-w-[200px]">
              <Link to="/login">Acessar painel</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* ── Como funciona ──────────────────────────────── */}
      <section className="mx-auto max-w-6xl px-6 py-20 sm:py-28">
        <div className="text-center mb-14">
          <h2 className="text-3xl sm:text-4xl font-semibold tracking-tight mb-3">Como funciona</h2>
          <p className="text-muted-foreground">Três passos simples, do primeiro clique à playlist no ar.</p>
        </div>

        <div className="grid gap-5 sm:grid-cols-3">
          {[
            { step: "01", icon: Plug, title: "Conecte sua conta Spotify", text: "Autorização segura via OAuth oficial. Você mantém controle total — pode revogar a qualquer momento." },
            { step: "02", icon: BarChart3, title: "O sistema analisa dados e tendências", text: "Coletamos sinais públicos do Spotify para entender padrões de consumo e oportunidades por gênero." },
            { step: "03", icon: Wand2, title: "Playlists são criadas automaticamente", text: "Templates aprovados são publicados na sua conta com curadoria contínua e otimização baseada em performance." },
          ].map((b) => (
            <div
              key={b.step}
              className="group relative rounded-2xl border border-border/60 bg-card p-6 transition-all hover:border-primary/40 hover:bg-elevated"
            >
              <div className="flex items-center justify-between mb-5">
                <span className="text-xs font-mono text-muted-foreground/70">{b.step}</span>
                <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary/10 text-primary transition-transform group-hover:scale-110">
                  <b.icon className="h-4 w-4" />
                </div>
              </div>
              <h3 className="text-base font-semibold mb-2">{b.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{b.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Funcionalidades ────────────────────────────── */}
      <section className="border-t border-border/50 bg-card/30">
        <div className="mx-auto max-w-6xl px-6 py-20 sm:py-28">
          <div className="grid gap-12 lg:grid-cols-[1fr_1.2fr] items-start">
            <div>
              <h2 className="text-3xl sm:text-4xl font-semibold tracking-tight mb-4">
                Funcionalidades
              </h2>
              <p className="text-muted-foreground leading-relaxed">
                Tudo o que você precisa para escalar curadoria sem perder qualidade. Sem planilhas,
                sem replicação manual, sem adivinhação.
              </p>
            </div>

            <ul className="space-y-3">
              {[
                "Criação automática de playlists",
                "Organização inteligente de catálogo",
                "Otimização contínua baseada em dados",
                "Integração direta com Spotify",
              ].map((f) => (
                <li
                  key={f}
                  className="flex items-center gap-4 rounded-xl border border-border/50 bg-background/50 px-5 py-4 transition-colors hover:border-primary/30 hover:bg-elevated"
                >
                  <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                    <Sparkles className="h-4 w-4" />
                  </div>
                  <span className="text-sm sm:text-base font-medium">{f}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ── Sobre ──────────────────────────────────────── */}
      <section className="mx-auto max-w-3xl px-6 py-20 sm:py-28 text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-card/40 px-3 py-1 text-xs text-muted-foreground mb-6">
          <ShieldCheck className="h-3 w-3 text-primary" />
          Sobre o NexEngine
        </div>
        <h2 className="text-3xl sm:text-4xl font-semibold tracking-tight mb-6">
          Construído com privacidade e consentimento no centro.
        </h2>
        <div className="space-y-4 text-base sm:text-lg text-muted-foreground leading-relaxed">
          <p>
            NexEngine é uma plataforma que permite aos usuários conectar suas contas Spotify e
            automatizar a criação e gestão de playlists.
          </p>
          <p>
            Todas as ações são realizadas apenas com autorização do usuário via Spotify OAuth.
          </p>
        </div>
      </section>

      {/* ── CTA Final ──────────────────────────────────── */}
      <section className="border-t border-border/50">
        <div className="mx-auto max-w-3xl px-6 py-24 text-center">
          <h2 className="text-3xl sm:text-4xl font-semibold tracking-tight mb-4">
            Comece agora conectando sua conta Spotify.
          </h2>
          <p className="text-muted-foreground mb-10">
            Leva menos de um minuto. Sem cartão de crédito, sem instalação.
          </p>
          <Button asChild size="lg" variant="premium" className="gap-2 min-w-[220px]">
            <Link to="/login">
              Conectar Spotify
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </section>

      {/* ── Footer ─────────────────────────────────────── */}
      <footer className="border-t border-border/50">
        <div className="mx-auto flex max-w-6xl flex-col sm:flex-row items-center justify-between gap-4 px-6 py-8">
          <div className="flex items-center gap-2">
            <div className="grid h-6 w-6 place-items-center rounded-md" style={{ background: SPOTIFY_GREEN }}>
              <Music2 className="h-3 w-3 text-primary-foreground" />
            </div>
            <span className="text-sm text-muted-foreground">© NexEngine</span>
          </div>
          <Link to="/privacy" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            Privacy Policy
          </Link>
        </div>
      </footer>
    </div>
  );
}
