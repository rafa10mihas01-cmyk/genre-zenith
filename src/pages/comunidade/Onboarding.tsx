// /comunidade/onboarding — 3 passos: dados / playlist / confirmar.
// Cria registro em community_members.
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight, Check, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NexEngineLogo } from "@/components/NexEngineLogo";
import { useFlowField } from "@/lib/screen-state";
import { toast } from "sonner";
import { getErrorMessage } from "@/lib/errors";

const TOTAL = 3;

export default function Onboarding() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [step, setStep] = useFlowField<number>("/comunidade/onboarding", "step", 1);
  const [name, setName] = useFlowField<string>("/comunidade/onboarding", "name", "");
  const [instagram, setInstagram] = useFlowField<string>("/comunidade/onboarding", "instagram", "");
  const [playlistUrl, setPlaylistUrl] = useFlowField<string>("/comunidade/onboarding", "playlistUrl", "");
  const [meta, setMeta] = useState<{ name: string; followers: number; spotify_id?: string } | null>(null);
  const [validating, setValidating] = useState(false);
  const [saving, setSaving] = useState(false);

  // Se já tem perfil, manda pra dashboard
  useEffect(() => {
    if (!user) return;
    supabase
      .from("community_members")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data) nav("/comunidade", { replace: true });
      });
  }, [user, nav]);

  async function validatePlaylist() {
    if (!playlistUrl.trim()) return;
    setValidating(true);
    setMeta(null);
    try {
      const { data, error } = await supabase.functions.invoke("fetch-spotify-meta", {
        body: { url: playlistUrl },
      });
      if (error) throw error;
      if (!data?.ok || data?.type !== "playlist") {
        throw new Error(data?.type ? "Cole o link de uma playlist (não de música/álbum)." : "Link não reconhecido");
      }
      setMeta({
        name: data.title ?? "Sua playlist",
        followers: 0,
        spotify_id: data.id,
      });
    } catch (err: unknown) {
      toast.error("Link inválido", { description: getErrorMessage(err) ?? "Cole o link de uma playlist Spotify." });
    } finally {
      setValidating(false);
    }
  }

  async function finish() {
    if (!user) return;
    setSaving(true);
    const { error } = await supabase.from("community_members").insert({
      user_id: user.id,
      display_name: name.trim(),
      instagram_handle: instagram.trim() || null,
      playlist_url: playlistUrl.trim() || null,
      spotify_playlist_id: meta?.spotify_id ?? null,
      playlist_name: meta?.name ?? null,
      playlist_followers: meta?.followers ?? null,
    });
    setSaving(false);
    if (error) {
      const dup = /duplicate key|unique/i.test(error.message);
      toast.error("Não foi possível concluir", {
        description: dup
          ? "Esta playlist já está cadastrada por outro membro."
          : error.message,
      });
      return;
    }
    toast.success("Bem-vindo à comunidade");
    nav("/comunidade", { replace: true });
  }

  const canNext = step === 1 ? name.trim().length >= 2 : step === 2 ? !!meta : true;

  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-5 flex items-center gap-2">
          <NexEngineLogo size={24} variant="mark" />
          <span className="text-[14px] font-semibold tracking-tight">Comunidade</span>
        </div>

        <div className="rounded-2xl border border-border bg-card p-6 space-y-5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Passo {step} de {TOTAL}
            </span>
            <div className="flex gap-1">
              {Array.from({ length: TOTAL }).map((_, i) => (
                <span
                  key={i}
                  className={`h-1 w-6 rounded-full ${i < step ? "bg-primary" : "bg-border"}`}
                />
              ))}
            </div>
          </div>

          {step === 1 && (
            <div className="space-y-3">
              <h1 className="text-lg font-semibold">Quem é você</h1>
              <div className="space-y-1.5">
                <Label htmlFor="name" className="text-xs uppercase tracking-wider text-muted-foreground">
                  Nome
                </Label>
                <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Seu nome" className="bg-elevated" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ig" className="text-xs uppercase tracking-wider text-muted-foreground">
                  Instagram (opcional)
                </Label>
                <Input id="ig" value={instagram} onChange={(e) => setInstagram(e.target.value)} placeholder="@seuuser" className="bg-elevated" />
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-3">
              <h1 className="text-lg font-semibold">Sua playlist</h1>
              <p className="text-sm text-muted-foreground">Cole o link da sua playlist no Spotify.</p>
              <div className="flex gap-2">
                <Input
                  value={playlistUrl}
                  onChange={(e) => {
                    setPlaylistUrl(e.target.value);
                    setMeta(null);
                  }}
                  placeholder="https://open.spotify.com/playlist/..."
                  className="bg-elevated"
                />
                <Button onClick={validatePlaylist} disabled={validating || !playlistUrl.trim()} variant="outline">
                  {validating ? <Loader2 className="h-4 w-4 animate-spin" /> : "Validar"}
                </Button>
              </div>
              {meta && (
                <div className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">
                  <Check className="h-4 w-4 text-primary shrink-0" />
                  <div className="min-w-0">
                    <div className="font-medium truncate">{meta.name}</div>
                    <div className="text-xs text-muted-foreground">Playlist validada</div>
                  </div>
                </div>
              )}
            </div>
          )}

          {step === 3 && (
            <div className="space-y-3">
              <h1 className="text-lg font-semibold">Tudo certo?</h1>
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Nome</dt>
                  <dd className="font-medium truncate">{name}</dd>
                </div>
                {instagram && (
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">Instagram</dt>
                    <dd className="font-medium truncate">{instagram}</dd>
                  </div>
                )}
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Playlist</dt>
                  <dd className="font-medium truncate">{meta?.name ?? "—"}</dd>
                </div>
              </dl>
            </div>
          )}

          <div className="flex items-center justify-between gap-2 pt-2">
            <Button
              variant="ghost"
              onClick={() => setStep((s) => Math.max(1, s - 1))}
              disabled={step === 1}
            >
              <ArrowLeft className="h-4 w-4" /> Voltar
            </Button>
            {step < TOTAL ? (
              <Button onClick={() => setStep((s) => s + 1)} disabled={!canNext}>
                Continuar <ArrowRight className="h-4 w-4" />
              </Button>
            ) : (
              <Button onClick={finish} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Entrar"}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
