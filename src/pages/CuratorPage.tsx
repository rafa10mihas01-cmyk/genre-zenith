import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type Deal = {
  id: string;
  curator_name: string;
  song_spotify_url: string;
  song_name: string;
  song_artist: string | null;
  song_cover_url: string | null;
  target_plays: number | null;
  baseline_plays: number | null;
  started_at: string | null;
  public_token: string;
  created_at: string;
};

type Playlist = {
  id: string;
  deal_id: string;
  spotify_url: string;
  playlist_name: string;
  followers: number | null;
  is_baseline: boolean;
  added_at: string;
};

export default function CuratorPage() {
  const { token } = useParams<{ token: string }>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deal, setDeal] = useState<Deal | null>(null);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [url, setUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    if (!token) return;
    const { data, error: fnErr } = await supabase.functions.invoke(
      "get-curator-deal-public",
      { body: { public_token: token } },
    );
    if (fnErr || !data?.ok) {
      setError(data?.error || fnErr?.message || "not found");
      setDeal(null);
      setPlaylists([]);
    } else {
      setDeal(data.deal as Deal);
      setPlaylists((data.playlists ?? []) as Playlist[]);
      setError(null);
    }
    setLoading(false);
  };

  useEffect(() => {
    setLoading(true);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const handleAdd = async () => {
    if (!token || !url.trim()) return;
    setSubmitting(true);
    const { data, error: fnErr } = await supabase.functions.invoke(
      "add-curator-playlist",
      { body: { public_token: token, spotify_url: url.trim() } },
    );
    setSubmitting(false);
    if (fnErr || !data?.ok) {
      toast.error(data?.error || fnErr?.message || "Erro ao adicionar playlist");
      return;
    }
    toast.success("Playlist adicionada");
    setUrl("");
    await load();
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !deal) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <Card className="max-w-md w-full">
          <CardContent className="p-6 text-center">
            <p className="text-base font-medium">Link inválido ou expirado</p>
            <p className="text-sm text-muted-foreground mt-2">
              Verifique o link com quem o enviou.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background px-4 py-8">
      <div className="max-w-md mx-auto space-y-6">
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-4">
              {deal.song_cover_url ? (
                <img
                  src={deal.song_cover_url}
                  alt={deal.song_name}
                  className="w-20 h-20 rounded-lg object-cover"
                />
              ) : (
                <div className="w-20 h-20 rounded-lg bg-muted" />
              )}
              <div className="flex-1 min-w-0">
                <h1 className="text-xl font-medium truncate">{deal.song_name}</h1>
                {deal.song_artist && (
                  <p className="text-muted-foreground truncate">{deal.song_artist}</p>
                )}
                <p className="text-sm mt-1">Curador: {deal.curator_name}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5 space-y-3">
            <h2 className="text-base font-semibold">Suas playlists</h2>
            {playlists.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nenhuma playlist adicionada ainda
              </p>
            ) : (
              <ul className="space-y-2">
                {playlists.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center justify-between gap-2 rounded-md border border-white/[0.04] p-3"
                  >
                    <a
                      href={p.spotify_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm truncate hover:underline"
                    >
                      {p.playlist_name}
                    </a>
                    {p.is_baseline ? (
                      <Badge variant="secondary">Inicial</Badge>
                    ) : (
                      <Badge className="bg-primary text-primary-foreground">Nova</Badge>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5 space-y-3">
            <h2 className="text-base font-semibold">Adicionar playlist</h2>
            <Input
              placeholder="Cole o link da playlist do Spotify"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={submitting}
            />
            <Button
              onClick={handleAdd}
              disabled={submitting || !url.trim()}
              className="w-full"
            >
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              Adicionar
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
