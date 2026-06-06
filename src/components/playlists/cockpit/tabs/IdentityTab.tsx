// IdentityTab — extraído 1:1 do PlaylistCockpit.tsx (Fase 2 / Commit 4).
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { OnboardingChecklist } from "@/components/playlists/cockpit/OnboardingChecklist";
import { CoverCard } from "../shared/CoverCard";
import { IdentityField } from "../shared/IdentityField";
import { useCockpit } from "../context/CockpitContext";

export function IdentityTab() {
  const {
    managedId, playlistName, coverUrl, spotifyPlaylistId, genreName, genreId,
    diag, runDiagnose,
  } = useCockpit();
  if (!diag) return null;
  return (
    <>
      <OnboardingChecklist managedId={managedId} />
      <CoverCard
        managedId={managedId}
        currentCover={coverUrl}
        genreId={genreId ?? null}
        genreName={genreName ?? null}
        references={(diag.raw?.market_insights?.top_recurring_tracks ?? [])
          .filter((t: any) => t?.cover_url)
          .map((t: any) => ({
            id: t.spotify_track_id,
            name: t.title ?? "—",
            subtitle: t.artist ?? "",
            cover_url: t.cover_url,
            external_url: t.spotify_track_id ? `https://open.spotify.com/track/${t.spotify_track_id}` : null,
          }))}
        spotifyPlaylistId={spotifyPlaylistId}
      />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <IdentityField
          label="Nome"
          field="name"
          managedId={managedId}
          current={diag.name_current ?? playlistName}
          suggestion={diag.name_suggestion}
          score={diag.name_score}
          onApplied={runDiagnose}
        />
        <IdentityField
          label="Descrição"
          field="description"
          managedId={managedId}
          current={diag.raw?.description_current || ""}
          suggestion={diag.raw?.suggested_description ?? null}
          onApplied={runDiagnose}
        />
      </div>
      {(diag.raw?.missing_keywords?.length ?? 0) > 0 && (
        <Card className="p-5">
          <div className="flex items-center justify-between mb-3 pb-3 border-b border-border/60">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
              Palavras fortes do nicho que faltam
            </div>
            <Badge variant="outline" className="h-5 px-1.5 text-[10px] tabular-nums text-muted-foreground">
              {diag.raw!.missing_keywords!.length}
            </Badge>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {[...diag.raw!.missing_keywords!]
              .sort((a, b) => a.localeCompare(b, "pt-BR"))
              .map((k) => (
                <Badge
                  key={k}
                  variant="outline"
                  className="h-6 px-2.5 rounded-full text-[11px] font-medium border-warning/40 text-warning bg-warning/5 hover:bg-warning/10 transition-colors"
                >
                  {k}
                </Badge>
              ))}
          </div>
        </Card>
      )}
    </>
  );
}
