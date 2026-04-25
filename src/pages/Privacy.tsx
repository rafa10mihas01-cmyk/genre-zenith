// Privacy Policy pública — exigida para aprovação do Spotify OAuth.
import { Link } from "react-router-dom";
import { ArrowLeft, Music2 } from "lucide-react";
import { useEffect } from "react";

function setMeta(name: string, content: string) {
  let tag = document.querySelector(`meta[name="${name}"]`);
  if (!tag) {
    tag = document.createElement("meta");
    tag.setAttribute("name", name);
    document.head.appendChild(tag);
  }
  tag.setAttribute("content", content);
}

export default function Privacy() {
  useEffect(() => {
    document.title = "Privacy Policy — NexEngine";
    setMeta("description", "How NexEngine handles Spotify access tokens, user data, and permissions.");
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground antialiased">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-border/50 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <Link to="/" className="flex items-center gap-2 group">
            <div className="grid h-8 w-8 place-items-center rounded-lg bg-primary transition-transform group-hover:scale-105">
              <Music2 className="h-4 w-4 text-primary-foreground" />
            </div>
            <span className="text-base font-semibold tracking-tight">NexEngine</span>
          </Link>
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </Link>
        </div>
      </header>

      {/* Content */}
      <main className="mx-auto max-w-3xl px-6 py-16 sm:py-24 animate-fade-in">
        <p className="text-xs font-mono text-muted-foreground mb-3">LEGAL</p>
        <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight mb-4">Privacy Policy</h1>
        <p className="text-sm text-muted-foreground mb-12">Last updated: April 2026</p>

        <div className="space-y-6 text-base leading-relaxed">
          <p className="text-foreground/90">
            We store Spotify access tokens securely and use them only to create and manage
            playlists on behalf of the user.
          </p>

          <p className="text-foreground/90">
            We do not sell or share user data.
          </p>

          <p className="text-foreground/90">
            Users can revoke access at any time via their Spotify account settings.
          </p>

          <p className="text-foreground/90">
            We only request permissions necessary for playlist creation and management.
          </p>
        </div>

        <div className="mt-16 pt-8 border-t border-border/50 text-sm text-muted-foreground">
          Questions about how your data is handled? Reach out through your account settings inside
          NexEngine.
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-border/50">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-8">
          <span className="text-sm text-muted-foreground">© NexEngine</span>
          <Link to="/" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            Home
          </Link>
        </div>
      </footer>
    </div>
  );
}
