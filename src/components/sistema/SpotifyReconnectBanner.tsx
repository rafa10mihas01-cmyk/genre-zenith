// Aviso compacto: contas Spotify que precisam ser reconectadas.
// Critério: app_id IS NULL no spotify_user_tokens — significa que o token
// foi emitido por um app Spotify que não está mais cadastrado (refresh falha).
import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

export function SpotifyReconnectBanner() {
  const [stale, setStale] = useState<Array<{ display_name: string | null; spotify_user_id: string }>>([]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data } = await supabase
        .from("spotify_user_tokens_public" as any)
        .select("display_name, spotify_user_id")
        .is("app_id", null);
      if (alive && data) setStale(data as any);
    })();
    return () => { alive = false; };
  }, []);

  if (stale.length === 0) return null;

  return (
    <div className="mb-4 rounded-2xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 flex items-start gap-3">
      <AlertTriangle className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0 text-sm">
        <div className="font-medium text-foreground">
          {stale.length} {stale.length === 1 ? "conta Spotify precisa reconectar" : "contas Spotify precisam reconectar"}
        </div>
        <div className="text-muted-foreground text-[13px] mt-0.5 leading-snug">
          {stale.map((s) => s.display_name || s.spotify_user_id).join(" · ")}
        </div>
      </div>
      <Link
        to="/settings"
        className="shrink-0 text-xs font-medium text-amber-400 hover:text-amber-300 underline-offset-2 hover:underline"
      >
        Reconectar
      </Link>
    </div>
  );
}
