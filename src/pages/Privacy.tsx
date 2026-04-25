// Privacy Policy pública — exigida para aprovação do Spotify OAuth.
// Mesma identidade visual premium da landing (PublicShell).
import { useEffect } from "react";
import { Lock, ShieldCheck, Database, KeyRound, UserMinus, FileText } from "lucide-react";
import { PublicShell } from "@/components/public/PublicShell";

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
  useEffect(() => {
    document.title = "Privacy Policy — NexEngine";
    setMeta(
      "description",
      "How NexEngine handles Spotify access tokens, user data, and permissions.",
    );
  }, []);

  return (
    <PublicShell>
      {/* ── Hero ─────────────────────────────────────────────── */}
      <section className="relative">
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-0 h-[420px] w-[820px] -translate-x-1/2 -translate-y-[40%] rounded-full opacity-50 blur-3xl"
          style={{
            background:
              "radial-gradient(closest-side, hsl(141 76% 48% / 0.35), transparent 70%)",
          }}
        />
        <div className="relative mx-auto max-w-3xl px-6 pt-20 sm:pt-28 pb-10 text-center animate-fade-in">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] backdrop-blur-md px-3.5 py-1.5 text-xs font-medium text-muted-foreground mb-7">
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
        </div>
      </section>

      {/* ── Seções em cards ──────────────────────────────────── */}
      <section className="relative mx-auto max-w-4xl px-6 py-12 sm:py-16">
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
    </PublicShell>
  );
}
