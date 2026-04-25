// Privacy Policy pública — exigida para aprovação do Spotify OAuth.
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
    title: "Spotify Access Tokens",
    text:
      "We store Spotify access tokens securely and use them only to create and manage playlists on behalf of the user. Tokens are encrypted at rest and never exposed to third parties.",
  },
  {
    icon: Database,
    title: "Data Sharing",
    text:
      "We do not sell or share user data. All information collected is used exclusively to power the playlist automation features inside NexEngine.",
  },
  {
    icon: UserMinus,
    title: "Revoking Access",
    text:
      "Users can revoke access at any time via their Spotify account settings. Once revoked, all related tokens are invalidated and removed from our systems.",
  },
  {
    icon: ShieldCheck,
    title: "Permission Scope",
    text:
      "We only request permissions strictly necessary for playlist creation and management. No additional scopes are requested without explicit user consent.",
  },
];

export default function Privacy() {
  const { user } = useAuth();
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    document.title = "Privacy Policy — NexEngine";
    setMeta(
      "description",
      "How NexEngine handles Spotify access tokens, user data, and permissions.",
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
            Legal · Updated April 2026
          </div>
          <h1 className="text-5xl sm:text-7xl font-bold tracking-tight leading-[1.0] mb-5 bg-gradient-to-b from-white via-white to-white/60 bg-clip-text text-transparent">
            Privacy Policy
          </h1>
          <p className="mx-auto max-w-2xl text-base sm:text-lg text-muted-foreground leading-relaxed">
            How NexEngine handles Spotify access tokens, user data and permissions —
            with privacy and consent at the center.
          </p>

          {/* Trust badges abaixo do hero */}
          <div className="mt-10 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-xs text-muted-foreground/80">
            <div className="inline-flex items-center gap-1.5">
              <Lock className="h-3.5 w-3.5 text-primary/80" /> Encrypted at rest
            </div>
            <div className="inline-flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5 text-primary/80" /> Minimum scopes
            </div>
            <div className="inline-flex items-center gap-1.5">
              <UserMinus className="h-3.5 w-3.5 text-primary/80" /> Revocable anytime
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
            How we handle your data
          </p>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
            Privacy at the core
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
            Questions about your data?
          </h2>
          <p className="text-sm text-muted-foreground leading-relaxed max-w-lg mx-auto">
            Reach out through your account settings inside NexEngine. We respond to all
            privacy-related inquiries promptly and transparently.
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
            Ready to connect your Spotify?
          </h2>
          <p className="text-muted-foreground mb-10 text-base sm:text-lg">
            Same security standards. Same privacy-first design. Less than a minute.
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
