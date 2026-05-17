import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Sparkles, Music2, Users, AlertCircle, CheckCircle2 } from "lucide-react";

type DiagnosisRow = {
  id: string;
  created_at: string;
  name_score: number | null;
  name_current: string | null;
  name_suggestion: string | null;
  name_reasons: any;
  tracks_suggestions: any;
  competitors: any;
};

function fmtNum(n: number | null | undefined) {
  if (n == null) return "—";
  return new Intl.NumberFormat("pt-BR").format(n);
}

function scoreTone(score: number | null) {
  if (score == null) return "text-muted-foreground";
  if (score >= 60) return "text-primary";
  if (score >= 30) return "text-warning";
  return "text-destructive";
}

export function PlaylistDiagnosisCard({ managedId }: { managedId: string }) {
  const [diag, setDiag] = useState<DiagnosisRow | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!managedId) return;
    let active = true;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("playlist_diagnoses")
        .select("id, created_at, name_score, name_current, name_suggestion, name_reasons, tracks_suggestions, competitors")
        .eq("playlist_id", managedId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (active) {
        setDiag(data as DiagnosisRow | null);
        setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [managedId]);

  if (loading) {
    return (
      <Card className="p-5 h-32 grid place-items-center">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </Card>
    );
  }

  if (!diag) {
    return (
      <Card className="p-5 text-sm text-muted-foreground">
        Ainda não há diagnóstico. Clique em <span className="text-foreground font-medium">Diagnosticar agora</span> para gerar.
      </Card>
    );
  }

  const reasons: any[] = Array.isArray(diag.name_reasons) ? diag.name_reasons : [];
  const missingKeywords = reasons.filter((r) => r?.type === "missing_keyword").map((r) => r.value).filter(Boolean);
  const sizeReasons = reasons.filter((r) => r?.type === "too_many_tracks" || r?.type === "too_few_tracks");
  const tracks: any[] = Array.isArray(diag.tracks_suggestions) ? diag.tracks_suggestions : [];
  const competitors: any[] = Array.isArray(diag.competitors) ? diag.competitors : [];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {/* Análise de nome */}
      <Card className="p-5 space-y-3 lg:col-span-1">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold">Análise do nome</h2>
          </div>
          <span className={`text-lg font-semibold tabular-nums ${scoreTone(diag.name_score)}`}>
            {diag.name_score ?? "—"}<span className="text-xs text-muted-foreground">/100</span>
          </span>
        </div>

        {diag.name_suggestion && (
          <div className="text-xs space-y-1">
            <div className="text-muted-foreground uppercase tracking-wider">Sugestão</div>
            <div className="text-foreground/90 leading-snug">{diag.name_suggestion}</div>
          </div>
        )}

        {missingKeywords.length > 0 && (
          <div className="space-y-1.5">
            <div className="text-[11px] text-muted-foreground uppercase tracking-wider">
              Palavras-chave faltando
            </div>
            <div className="flex flex-wrap gap-1">
              {missingKeywords.slice(0, 10).map((k: string) => (
                <Badge key={k} variant="outline" className="text-[10px] border-warning/40 text-warning">
                  {k}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {sizeReasons.map((r, i) => (
          <div key={i} className="flex gap-2 items-start text-xs text-warning bg-warning/5 border border-warning/30 rounded-md p-2">
            <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <div>
              {r.type === "too_many_tracks"
                ? `Playlist com ${fmtNum(r.value)} faixas (acima do p90 do gênero: ${fmtNum(r.benchmark_p90)})`
                : `Playlist com ${fmtNum(r.value)} faixas (abaixo da metade do p50: ${fmtNum(r.benchmark_p50)})`}
            </div>
          </div>
        ))}

        {missingKeywords.length === 0 && sizeReasons.length === 0 && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
            Nenhum ajuste sugerido.
          </div>
        )}
      </Card>

      {/* Sugestões de faixas */}
      <Card className="p-5 space-y-3 lg:col-span-1">
        <div className="flex items-center gap-2">
          <Music2 className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">Faixas para adicionar</h2>
          <span className="text-xs text-muted-foreground">{tracks.length}</span>
        </div>
        {tracks.length === 0 ? (
          <div className="text-xs text-muted-foreground">Sem sugestões de faixas.</div>
        ) : (
          <ol className="space-y-2">
            {tracks.slice(0, 10).map((t, i) => (
              <li key={i} className="flex gap-2 items-start text-xs">
                <span className="w-5 text-right text-muted-foreground tabular-nums shrink-0">{i + 1}.</span>
                <div className="min-w-0 flex-1">
                  <div className="text-foreground/90 font-medium truncate">{t.nome ?? t.name ?? "—"}</div>
                  <div className="text-muted-foreground truncate">{t.artista ?? t.artist ?? "—"}</div>
                </div>
                {t.count != null && (
                  <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
                    {t.count}× nos concorrentes
                  </span>
                )}
              </li>
            ))}
          </ol>
        )}
      </Card>

      {/* Concorrentes */}
      <Card className="p-5 space-y-3 lg:col-span-1">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">Concorrentes no nicho</h2>
          <span className="text-xs text-muted-foreground">{competitors.length}</span>
        </div>
        {competitors.length === 0 ? (
          <div className="text-xs text-muted-foreground">Sem concorrentes mapeados.</div>
        ) : (
          <ul className="space-y-2">
            {competitors.slice(0, 8).map((c, i) => (
              <li key={i} className="flex gap-2 items-center text-xs">
                <div className="w-8 h-8 rounded bg-muted overflow-hidden shrink-0 border border-border">
                  {c.cover_url ? <img src={c.cover_url} alt="" className="w-full h-full object-cover" /> : null}
                </div>
                <div className="min-w-0 flex-1">
                  <a
                    href={`https://open.spotify.com/playlist/${c.spotify_playlist_id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-foreground/90 font-medium truncate block hover:text-primary"
                  >
                    {c.name ?? "—"}
                  </a>
                  <div className="text-muted-foreground tabular-nums">{fmtNum(c.followers)} seguidores</div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
