import { useParams, useSearchParams, Link, useNavigate } from "react-router-dom";
import { Loader2, ArrowLeft } from "lucide-react";
import { PageContainer } from "@/components/PageContainer";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { PlaylistTracksTab } from "@/components/playlists/PlaylistTracksTab";
import { PlaylistCockpit } from "@/components/playlists/cockpit/PlaylistCockpit";
import { usePlaylistBrain } from "@/hooks/usePlaylistBrain";
import {
  usePlaylistById,
  useManagedByPlaylistId,
  useManagedById,
  useGenreName,
  type PlaylistRow,
  type ManagedRow,
} from "@/hooks/useCockpitQueries";

export default function PlaylistDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const tab = searchParams.get("tab") === "faixas" ? "faixas" : "geral";

  const handleBack = () => {
    if (window.history.length > 1) navigate(-1);
    else navigate("/catalogo");
  };

  const { data: brain } = usePlaylistBrain(id);

  // 1) tenta como playlist canonical
  const playlistQ = usePlaylistById(id);
  const p = playlistQ.data ?? null;

  // 2) managed: por spotify_playlist_id quando há playlist; senão pelo próprio id
  const managedBySpotifyQ = useManagedByPlaylistId(p?.spotify_playlist_id);
  const managedByIdQ = useManagedById(!playlistQ.isLoading && !p ? id : null);
  const mgd: ManagedRow | null =
    (managedBySpotifyQ.data as ManagedRow | null) ??
    (managedByIdQ.data as ManagedRow | null) ??
    null;

  // 3) derive playlist quando só existe managed
  const derivedPl: PlaylistRow | null =
    p ??
    (mgd
      ? {
          id: mgd.canonical_playlist_id ?? mgd.id,
          spotify_playlist_id: mgd.spotify_playlist_id,
          name: mgd.name,
          followers: mgd.followers,
          cover_url: mgd.cover_url,
          genre_id: mgd.genre_id,
        }
      : null);

  // 4) gênero — usa managed.genre_id (fonte primária do cockpit) com fallback
  const genreId = mgd?.genre_id ?? derivedPl?.genre_id ?? null;
  const genreNameQ = useGenreName(genreId);

  const loading =
    playlistQ.isLoading ||
    managedBySpotifyQ.isLoading ||
    managedByIdQ.isLoading ||
    (!!genreId && genreNameQ.isLoading);

  if (loading) {
    return (
      <PageContainer>
        <div className="h-64 grid place-items-center text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      </PageContainer>
    );
  }

  if (!derivedPl) {
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
          title={derivedPl.name ?? "Playlist"}
          subtitle="Faixas"
          actions={
            <Button asChild variant="outline">
              <Link to={`/playlists/${derivedPl.id}`}><ArrowLeft className="h-4 w-4 mr-1" /> Cockpit</Link>
            </Button>
          }
        />
        <PlaylistTracksTab playlistId={derivedPl.id} />
      </PageContainer>
    );
  }

  // Sem managed → não há diagnóstico possível
  if (!mgd) {
    return (
      <PageContainer>
        <PageHeader title={derivedPl.name ?? "Playlist"} subtitle="Playlist externa — sem gestão direta" />
        <p className="text-sm text-muted-foreground">
          Esta playlist não está sob gestão (apenas monitorada). Importe-a no Catálogo para gerar diagnóstico.
        </p>
      </PageContainer>
    );
  }

  return (
    <PlaylistCockpit
      managedId={mgd.id}
      spotifyPlaylistId={derivedPl.spotify_playlist_id}
      spotifyUrl={mgd.spotify_url}
      playlistName={derivedPl.name ?? "Playlist"}
      coverUrl={mgd.cover_url ?? derivedPl.cover_url}
      followers={derivedPl.followers}
      tracksCount={mgd.tracks_count}
      genreId={genreId}
      genreName={genreNameQ.data ?? null}
      brainScore={brain?.capacity_total ? Math.round(brain.confidence_score) : null}
      canonicalPlaylistId={derivedPl.id}
      onBack={handleBack}
    />
  );
}
