import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, ExternalLink, Loader2, Check, Music2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { useGenreModelInsights } from "@/hooks/useCockpitQueries";

export type CoverReference = {
  id: string;
  name: string;
  subtitle?: string;
  cover_url: string | null;
  external_url?: string | null;
};

export function CoverCard({ managedId, currentCover, references, spotifyPlaylistId, genreName, genreId }: {
  managedId: string;
  currentCover: string | null;
  references: CoverReference[];
  spotifyPlaylistId: string;
  genreName: string | null;
  genreId: string | null;
}) {
  const [uploading, setUploading] = useState(false);
  const [applyingLeader, setApplyingLeader] = useState<string | null>(null);
  const [localCover, setLocalCover] = useState<string | null>(currentCover);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingPreview, setPendingPreview] = useState<string | null>(null);
  const [selectedLeader, setSelectedLeader] = useState<CoverReference | null>(null);

  useEffect(() => { setLocalCover(currentCover); }, [currentCover]);

  // Gap 21: verifica se o gênero tem DNA visual analisado (genre_models.insights.ln).
  // Fase 4B.3A: genreId vem do contexto (sem nova query a managed_playlists);
  // genre_models passa por React Query (dedup com outros consumidores).
  const { data: insights } = useGenreModelInsights(genreId);
  const ln = (insights as any)?.ln;
  const hasDnaVisual = Boolean(ln && (ln.estilo_dominante || ln.atmosfera || ln.capas_analisadas?.length));



  const applyLeaderCover = async (ref: CoverReference) => {
    if (!ref.cover_url) return;
    setApplyingLeader(ref.id);
    try {
      const { data, error } = await supabase.functions.invoke("apply-managed-cover", {
        body: { playlist_id: managedId, image_url: ref.cover_url },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "falha ao aplicar capa");
      setLocalCover(data.cover_url ?? ref.cover_url);
      setSelectedLeader(null);
      toast({
        title: data.unchanged ? "Capa já aplicada" : data.confirmed ? "Capa aplicada no Spotify" : "Capa enviada ao Spotify",
        description: data.unchanged ? "Essa referência já é visualmente igual à capa atual." : data.confirmed ? `Usando a capa de "${ref.name}".` : "O Spotify aceitou a capa, mas a CDN ainda pode levar alguns segundos para exibir.",
      });
    } catch (e: any) {
      toast({ title: "Erro ao aplicar capa", description: e?.message ?? String(e), variant: "destructive" });
    } finally {
      setApplyingLeader(null);
    }
  };

  const selectFile = (file: File) => {
    if (!file) return;
    if (!/^image\/(png|jpe?g|webp)$/i.test(file.type)) {
      toast({ title: "Formato inválido", description: "Use PNG, JPG ou WEBP.", variant: "destructive" });
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      toast({ title: "Arquivo grande", description: "Máximo 8MB (será comprimido).", variant: "destructive" });
      return;
    }
    if (pendingPreview) URL.revokeObjectURL(pendingPreview);
    setSelectedLeader(null);
    setPendingFile(file);
    setPendingPreview(URL.createObjectURL(file));
  };

  const clearPending = () => {
    if (pendingPreview) URL.revokeObjectURL(pendingPreview);
    setPendingFile(null);
    setPendingPreview(null);
    setSelectedLeader(null);
  };

  const selectLeaderCover = (ref: CoverReference) => {
    if (!ref.cover_url) return;
    if (pendingPreview) URL.revokeObjectURL(pendingPreview);
    setPendingFile(null);
    setPendingPreview(null);
    setSelectedLeader(ref);
  };

  const applyPending = async () => {
    if (!pendingFile) return;
    setUploading(true);
    try {
      const ext = pendingFile.name.split(".").pop()?.toLowerCase() || "png";
      const path = `${managedId}/${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("playlist-covers")
        .upload(path, pendingFile, { contentType: pendingFile.type, upsert: false });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from("playlist-covers").getPublicUrl(path);
      const imageUrl = pub.publicUrl;

      const { data, error } = await supabase.functions.invoke("apply-managed-cover", {
        body: { playlist_id: managedId, image_url: imageUrl },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "falha ao aplicar capa");
      setLocalCover(data.cover_url ?? imageUrl);
      clearPending();
      toast({
        title: data.unchanged ? "Capa já aplicada" : data.confirmed ? "Capa aplicada no Spotify" : "Capa enviada ao Spotify",
        description: data.unchanged ? "A imagem enviada já é visualmente igual à capa atual." : data.confirmed ? "A nova capa já foi confirmada no Spotify." : "O Spotify aceitou a capa, mas a CDN ainda pode levar alguns segundos para exibir.",
      });
    } catch (e: any) {
      toast({ title: "Erro ao enviar capa", description: e?.message ?? String(e), variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const isCoverApplying = uploading || applyingLeader !== null;
  const selectedCoverPreview = pendingPreview ?? selectedLeader?.cover_url ?? null;
  const selectedCoverName = pendingFile?.name ?? selectedLeader?.name ?? "";
  const selectedCoverHint = pendingFile ? "Imagem escolhida do seu computador." : "Capa selecionada das faixas do nicho.";

  return (
    <Card className="p-4 md:p-5">
      <div className="flex items-center gap-4 md:gap-5">
        {/* Capa atual — herói grande à esquerda */}
        <div className="relative shrink-0">
          {localCover ? (
            <img
              src={localCover}
              alt="capa atual"
              className="w-20 h-20 md:w-24 md:h-24 rounded-xl object-cover ring-1 ring-border shadow-md"
            />
          ) : (
            <div className="w-20 h-20 md:w-24 md:h-24 rounded-xl bg-elevated grid place-items-center ring-1 ring-border">
              <Music2 className="h-7 w-7 text-muted-foreground/40" />
            </div>
          )}
        </div>

        {/* Linha única: ações + referências, tudo alinhado verticalmente com a capa */}
        <div className="flex-1 min-w-0 flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2 shrink-0">
            <label className={cn(
              "inline-flex items-center gap-1.5 h-8 px-3.5 text-xs rounded-full cursor-pointer",
              "bg-primary text-primary-foreground hover:bg-primary/90 font-medium transition-colors",
              isCoverApplying && "opacity-60 pointer-events-none",
            )}>
              <Plus className="h-3.5 w-3.5" />
              Trocar capa
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                disabled={isCoverApplying}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) selectFile(f); e.currentTarget.value = ""; }}
              />
            </label>
            <Button asChild size="sm" variant="ghost" className="h-8 w-8 p-0 rounded-full text-muted-foreground hover:text-foreground">
              <a href={`https://open.spotify.com/playlist/${spotifyPlaylistId}`} target="_blank" rel="noreferrer" aria-label="Abrir no Spotify" title="Abrir no Spotify">
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </Button>
          </div>

          {references.length > 0 && (
            <div className="flex items-center gap-2 min-w-0">
              <div className="text-[10px] uppercase tracking-wider text-subtle-foreground font-medium shrink-0">
                Referências
              </div>
              <div className="flex items-center gap-1.5 min-w-0">
                {references.slice(0, 6).map((l) => {
                  const busy = applyingLeader === l.id;
                  return (
                    <button
                      key={l.id}
                      type="button"
                      disabled={!l.cover_url || isCoverApplying}
                      onClick={() => selectLeaderCover(l)}
                      title={`Usar capa de "${l.name}"`}
                      className="relative group rounded-lg overflow-hidden ring-1 ring-border hover:ring-primary/60 transition-all disabled:opacity-50 shrink-0"
                    >
                      {l.cover_url ? (
                        <img src={l.cover_url} alt={l.name} className="w-14 h-14 md:w-16 md:h-16 object-cover" />
                      ) : (
                        <div className="w-14 h-14 md:w-16 md:h-16 bg-elevated" />
                      )}
                      <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity grid place-items-center">
                        {busy ? (
                          <Loader2 className="h-3 w-3 animate-spin text-primary" />
                        ) : (
                          <Plus className="h-3.5 w-3.5 text-primary-foreground" />
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
      {hasDnaVisual && genreName && references.length > 0 && (
        <div className="mt-2 text-[10px] text-subtle-foreground italic">
          Baseado no DNA visual do gênero {genreName}
        </div>
      )}

      {/* Preview seleção pendente */}
      {selectedCoverPreview && (pendingFile || selectedLeader) && (
        <div className="mt-4 flex items-center gap-3 rounded-xl border border-primary/40 bg-primary/5 p-3">
          <img src={selectedCoverPreview} alt="capa selecionada" className="w-12 h-12 rounded-md object-cover ring-1 ring-border shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-xs font-medium truncate">{selectedCoverName}</div>
            <div className="text-[10px] text-muted-foreground truncate">{selectedCoverHint}</div>
          </div>
          <Button size="sm" variant="ghost" onClick={clearPending} disabled={isCoverApplying} className="h-7 text-xs shrink-0">
            Cancelar
          </Button>
          <Button
            size="sm"
            onClick={() => pendingFile ? applyPending() : selectedLeader && applyLeaderCover(selectedLeader)}
            disabled={isCoverApplying}
            className="h-7 text-xs gap-1.5 shrink-0"
          >
            {isCoverApplying ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
            {isCoverApplying ? "Aplicando..." : "Aplicar"}
          </Button>
        </div>
      )}
    </Card>
  );
}
