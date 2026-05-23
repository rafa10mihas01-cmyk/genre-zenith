import { useEffect, useState } from "react";
import { useParams, useSearchParams, Link, useNavigate } from "react-router-dom";
import { Loader2, ArrowLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageContainer } from "@/components/PageContainer";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { PlaylistTracksTab } from "@/components/playlists/PlaylistTracksTab";
import { PlaylistCockpit } from "@/components/playlists/cockpit/PlaylistCockpit";
import { usePlaylistBrain } from "@/hooks/usePlaylistBrain";

type PlaylistRow = {
  id: string;
  spotify_playlist_id: string;
  name: string | null;
  followers: number | null;
  cover_url: string | null;
  genre_id: string | null;
};

type ManagedRow = {
  id: string;
  name: string | null;
  followers: number | null;
  canonical_playlist_id: string | null;
  spotify_playlist_id: string;
  cover_url: string | null;
  description: string | null;
  tracks_count: number;
  spotify_url: string;
  genre_id: string | null;
};

export default function PlaylistDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [pl, setPl] = useState<PlaylistRow | null>(null);
  const [mgd, setMgd] = useState<ManagedRow | null>(null);
  const [genreName, setGenreName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchParams] = useSearchParams();
  const tab = searchParams.get("tab") === "faixas" ? "faixas" : "geral";

  const handleBack = () => {
    if (window.history.length > 1) navigate(-1);
    else navigate("/catalogo");
  };

  const { data: brain } = usePlaylistBrain(id);

  useEffect(() => {
    if (!id) return;
    (async () => {
      setLoading(true);
      const { data: p } = await supabase
        .from("playlists")
        .select("id, spotify_playlist_id, name, followers, cover_url, genre_id")
        .eq("id", id)
        .maybeSingle();
      let playlist = p as PlaylistRow | null;

      if (playlist?.spotify_playlist_id) {
        const { data: m } = await supabase
          .from("managed_playlists")
          .select("id, name, followers, canonical_playlist_id, spotify_playlist_id, cover_url, description, tracks_count, spotify_url, genre_id")
          .eq("spotify_playlist_id", playlist.spotify_playlist_id)
          .maybeSingle();
        setMgd(m as ManagedRow | null);

        const genreId = (m as any)?.genre_id ?? playlist?.genre_id;
        if (genreId) {
          const { data: g } = await supabase.from("genres").select("nome").eq("id", genreId).maybeSingle();
          setGenreName((g as any)?.nome ?? null);
        }
      } else {
        const { data: m } = await supabase
          .from("managed_playlists")
          .select("id, name, followers, canonical_playlist_id, spotify_playlist_id, cover_url, description, tracks_count, spotify_url, genre_id")
          .eq("id", id)
          .maybeSingle();
        setMgd(m as ManagedRow | null);
        if (m) {
          playlist = {
            id: (m as ManagedRow).canonical_playlist_id ?? (m as ManagedRow).id,
            spotify_playlist_id: (m as ManagedRow).spotify_playlist_id,
            name: (m as ManagedRow).name,
            followers: (m as ManagedRow).followers,
            cover_url: (m as ManagedRow).cover_url,
            genre_id: (m as ManagedRow).genre_id,
          };
          if ((m as ManagedRow).genre_id) {
            const { data: g } = await supabase.from("genres").select("nome").eq("id", (m as ManagedRow).genre_id).maybeSingle();
            setGenreName((g as any)?.nome ?? null);
          }
        }
      }
      setPl(playlist);
      setLoading(false);
    })();
  }, [id]);

  if (loading) {
    return (
      <PageContainer>
        <div className="h-64 grid place-items-center text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      </PageContainer>
    );
  }

  if (!pl) {
    return (
      <PageContainer>
        <PageHeader
        domain="playlists" title="Playlist não encontrada" subtitle="Voltar para o catálogo" />
        <Button asChild variant="outline">
          <Link to="/catalogo"><ArrowLeft className="h-4 w-4 mr-1" /> Catálogo</Link>
        </Button>
      </PageContainer>
    );
  }

  // Aba "Faixas" (rota auxiliar) — mantida
  if (tab === "faixas") {
    return (
      <PageContainer>
        <PageHeader
          title={pl.name ?? "Playlist"}
          subtitle="Faixas"
          actions={
            <Button asChild variant="outline">
              <Link to={`/playlists/${pl.id}`}><ArrowLeft className="h-4 w-4 mr-1" /> Cockpit</Link>
            </Button>
          }
        />
        <PlaylistTracksTab playlistId={pl.id} />
      </PageContainer>
    );
  }

  // Sem managed → não há diagnóstico possível
  if (!mgd) {
    return (
      <PageContainer>
        <PageHeader title={pl.name ?? "Playlist"} subtitle="Playlist externa — sem gestão direta" />
        <p className="text-sm text-muted-foreground">
          Esta playlist não está sob gestão (apenas monitorada). Importe-a no Catálogo para gerar diagnóstico.
        </p>
      </PageContainer>
    );
  }

  // Cockpit em modo fullscreen — o AppLayout detecta a rota e remove o nx-page.
  return (
    <PlaylistCockpit
      managedId={mgd.id}
      spotifyPlaylistId={pl.spotify_playlist_id}
      spotifyUrl={mgd.spotify_url}
      playlistName={pl.name ?? "Playlist"}
      coverUrl={mgd.cover_url ?? pl.cover_url}
      followers={pl.followers}
      tracksCount={mgd.tracks_count}
      genreName={genreName}
      brainScore={brain?.capacity_total ? Math.round(brain.confidence_score) : null}
      canonicalPlaylistId={pl.id}
      onBack={handleBack}
    />
  );
}
