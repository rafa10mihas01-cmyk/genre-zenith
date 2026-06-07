// IdentityTab — refatorado Fase 7D / D5.
// Aplica TabShell: Banner → KPIs (SEO) → Primary (capa + campos) → Secondary (keywords).
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { OnboardingChecklist } from "@/components/playlists/cockpit/OnboardingChecklist";
import { CoverCard } from "../shared/CoverCard";
import { IdentityField } from "../shared/IdentityField";
import { TabShell } from "../shared/ds/TabShell";
import { TabContextBanner } from "../shared/ds/TabContextBanner";
import { TabKpiStrip } from "../shared/ds/TabKpiStrip";
import { KpiCard } from "../shared/ds/KpiCard";
import { SecondarySection } from "../shared/ds/SecondarySection";
import { useCockpit } from "../context/CockpitContext";

export function IdentityTab() {
  const {
    managedId, playlistName, coverUrl, spotifyPlaylistId, genreName, genreId,
    diag, setDiag,
  } = useCockpit();
  if (!diag) return null;

  // Patch local após aplicar identidade no Spotify.
  // NÃO dispara diagnose-managed-playlist — apenas reflete o novo nome/descrição
  // já publicados. Inteligência (plano, sugestões, IA, benchmarks) só é
  // recalculada quando o usuário clica explicitamente em "Diagnosticar".
  const handleIdentityApplied = (value: string, field: "name" | "description") => {
    setDiag((prev: any) => {
      if (!prev) return prev;
      if (field === "name") {
        return {
          ...prev,
          name_current: value,
          raw: { ...(prev.raw ?? {}), name_current: value },
        };
      }
      return {
        ...prev,
        raw: { ...(prev.raw ?? {}), description_current: value },
      };
    });
  };


  const nameScore = diag.name_score ?? null;
  const hasDescription = !!(diag.raw?.description_current && String(diag.raw.description_current).trim().length > 0);
  const missingKeywords = diag.raw?.missing_keywords ?? [];
  const missingCount = missingKeywords.length;
  const hasCover = !!coverUrl;

  const nameTone = nameScore == null ? "muted" : nameScore >= 75 ? "primary" : nameScore >= 50 ? "default" : "warning";
  const descTone = hasDescription ? "primary" : "warning";
  const kwTone = missingCount === 0 ? "primary" : missingCount > 5 ? "warning" : "default";
  const coverTone = hasCover ? "primary" : "warning";

  const sortedMissing = [...missingKeywords].sort((a, b) => a.localeCompare(b, "pt-BR"));

  return (
    <TabShell
      banner={
        <TabContextBanner
          title="Identidade editorial"
          subtitle="Otimize nome, descrição, capa e palavras-chave para o algoritmo do Spotify reconhecer o nicho."
        />
      }
      kpis={
        <TabKpiStrip>
          <KpiCard
            label="Score do nome"
            value={nameScore != null ? `${Math.round(nameScore)}` : "—"}
            hint={nameScore == null ? "sem avaliação" : nameScore >= 75 ? "ótimo" : nameScore >= 50 ? "aceitável" : "precisa melhorar"}
            tone={nameTone as any}
          />
          <KpiCard
            label="Descrição"
            value={hasDescription ? "OK" : "Vazia"}
            hint={hasDescription ? "preenchida" : "adicione 1–2 linhas com o nicho"}
            tone={descTone as any}
          />
          <KpiCard
            label="Keywords faltando"
            value={missingCount}
            hint={missingCount === 0 ? "cobertura completa" : "termos fortes do nicho ausentes"}
            tone={kwTone as any}
          />
          <KpiCard
            label="Capa"
            value={hasCover ? "Definida" : "Faltando"}
            hint={hasCover ? "imagem ativa" : "sem capa personalizada"}
            tone={coverTone as any}
          />
        </TabKpiStrip>
      }
      primary={
        <div className="space-y-4">
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
        </div>
      }
      secondary={
        missingCount > 0 ? (
          <SecondarySection
            title={`Palavras fortes do nicho que faltam · ${missingCount}`}
            defaultOpen={false}
          >
            <div className="flex flex-wrap gap-1.5">
              {sortedMissing.map((k) => (
                <Badge
                  key={k}
                  variant="outline"
                  className="h-6 px-2.5 rounded-full text-[11px] font-medium border-warning/40 text-warning bg-warning/5 hover:bg-warning/10 transition-colors"
                >
                  {k}
                </Badge>
              ))}
            </div>
          </SecondarySection>
        ) : undefined
      }
    />
  );
}
