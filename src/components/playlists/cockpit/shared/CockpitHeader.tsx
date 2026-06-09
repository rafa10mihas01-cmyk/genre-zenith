// CockpitHeader — header sticky com capa/título/KPIs.
// Extraído 1:1 do PlaylistCockpit.tsx (Fase 2 / Commit 6 — cleanup).
// JSX e Tailwind copiados sem alteração.
import { Button } from "@/components/ui/button";
import {
  ArrowLeft, Crown, ExternalLink, Loader2, Music2, Sparkles, Timer,
  Trash2, Users, ShieldCheck,
} from "lucide-react";
import { KpiBig } from "@/components/KpiBig";
import { GenrePicker } from "@/components/playlists/cockpit/GenrePicker";
import { fmtNum } from "../helpers";
import { useCockpit } from "../context/CockpitContext";
import { DiagnoseProgress } from "./DiagnoseProgress";

export function CockpitHeader() {
  const {
    onBack, coverUrl, playlistName, managedId, genreName,
    diag, runDiagnose, running,
    spotifyUrl, handleArchive, archiving,
    followers, liveTracksCount, idealRange, brainScore, health,
  } = useCockpit();

  return (
    <header className="space-y-4 md:space-y-5 pt-1">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          {onBack && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onBack}
              aria-label="Voltar"
              title="Voltar"
              className="h-9 w-9 -ml-2 rounded-full text-muted-foreground hover:text-foreground hover:bg-elevated shrink-0"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
          )}
          {coverUrl ? (
            <img
              src={coverUrl}
              alt={playlistName}
              className="w-10 h-10 rounded-md object-cover ring-1 ring-white/5 shrink-0"
            />
          ) : (
            <div className="w-10 h-10 rounded-md bg-elevated grid place-items-center shrink-0">
              <Music2 className="h-4 w-4 text-muted-foreground/40" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <h1 className="text-base md:text-lg font-semibold tracking-tight leading-tight truncate">
              {playlistName}
            </h1>
            <div className="flex flex-wrap items-center gap-1.5 mt-1">
              <GenrePicker
                managedId={managedId}
                currentGenreName={genreName ?? null}
              />
              {diag?.raw?.niche_rank && (
                <span className="text-muted-foreground/40 text-[10px]">·</span>
              )}

              {diag?.raw?.niche_rank && diag.raw.niche_total && (
                <span className="inline-flex items-center gap-1 text-[10px] text-primary font-medium">
                  <Crown className="h-3 w-3" /> #{diag.raw.niche_rank} de {diag.raw.niche_total}
                </span>
              )}
              {diag && (() => {
                const ageMs = Date.now() - new Date(diag.created_at).getTime();
                const ageDays = Math.floor(ageMs / 86_400_000);
                const stale = ageDays > 30;
                const warn = ageDays > 7;
                const cls = stale
                  ? "text-destructive"
                  : warn
                    ? "text-amber-500"
                    : "text-muted-foreground";
                const label =
                  ageDays <= 0
                    ? "Análise de hoje"
                    : ageDays === 1
                      ? "Análise de 1 dia atrás"
                      : `Análise de ${ageDays} dias atrás`;
                return (
                  <>
                    <span className="text-muted-foreground/40 text-[10px]">·</span>
                    <span
                      className={`inline-flex items-center gap-1 text-[10px] tabular-nums ${cls}`}
                      title={new Date(diag.created_at).toLocaleString("pt-BR")}
                    >
                      <Timer className="h-3 w-3" />
                      {label}
                    </span>
                    {stale && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={runDiagnose}
                        disabled={running}
                        className="h-6 px-2 text-[10px] gap-1 border-destructive/40 text-destructive hover:bg-destructive/10"
                      >
                        {running ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                        Atualizar análise
                      </Button>
                    )}
                  </>
                );
              })()}
            </div>
          </div>
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:flex gap-2 shrink-0 w-full sm:w-auto min-w-0">
          <Button onClick={runDiagnose} disabled={running} size="sm" className="gap-1.5 h-8 min-w-0 px-2 sm:px-3">
            {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            <span className="truncate">{diag ? "Rodar análise" : "Rodar análise"}</span>
          </Button>
          <Button variant="outline" size="sm" asChild className="h-8 min-w-0 px-2 sm:px-3">
            <a href={spotifyUrl} target="_blank" rel="noreferrer" className="gap-1.5 justify-center min-w-0">
              <ExternalLink className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">Spotify</span>
            </a>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleArchive}
            disabled={archiving}
            className="h-8 w-8 px-0 gap-1.5 text-muted-foreground hover:text-destructive hover:border-destructive/40"
            title="Mover para lixeira"
            aria-label="Mover para lixeira"
          >
            {archiving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            <span className="hidden sm:inline">Lixeira</span>
          </Button>
        </div>
      </div>


      {/* KPI row — esconde Faixas e Saúde quando rolar; mantém Seguidores + Score curatorial */}
      <div className="grid gap-2 grid-cols-2 md:grid-cols-4">
        <KpiBig
          label="Seguidores"
          value={fmtNum(followers)}
          icon={Users}
          tier="hero"
          tone="primary"
          domain="playlists"
        />
        <KpiBig
          label="Faixas"
          value={fmtNum(liveTracksCount)}
          icon={Music2}
          domain="playlists"
          hint={idealRange ? `ideal ${idealRange[0]}–${idealRange[1]}` : undefined}
        />
        <KpiBig
          label="Score curatorial"
          value={brainScore != null ? `${brainScore}` : "—"}
          icon={ShieldCheck}
          tone={brainScore == null ? "default" : brainScore >= 75 ? "success" : brainScore >= 50 ? "primary" : "default"}
          hint={brainScore == null ? "sem análise" : "saúde editorial 0–100"}
        />
        <KpiBig
          label="Saúde"
          value={health.label}
          icon={health.Icon}
          tier="quiet"
          tone={
            (diag?.raw?.health_status ?? "saudavel") === "aquecido" ? "primary"
            : (diag?.raw?.health_status ?? "saudavel") === "frio" ? "destructive"
            : "default"
          }
        />
      </div>
      <DiagnoseProgress running={running} />
    </header>
  );
}
