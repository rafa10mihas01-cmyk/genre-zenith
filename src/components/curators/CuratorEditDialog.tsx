import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import type { Curator, NewCuratorInput } from "@/hooks/useCuratorDeals";

interface Props {
  curator: Curator | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (curatorId: string, input: Partial<NewCuratorInput>) => Promise<void>;
}

export function CuratorEditDialog({ curator, open, onOpenChange, onSave }: Props) {
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [spotifyUrl, setSpotifyUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (curator) {
      setName(curator.name ?? "");
      setContact(curator.contact ?? "");
      setSpotifyUrl(curator.spotify_owner_url ?? "");
      setNotes(curator.notes ?? "");
    }
  }, [curator]);

  const handleSave = async () => {
    if (!curator) return;
    if (!name.trim()) {
      toast.error("Nome é obrigatório");
      return;
    }
    setSaving(true);
    try {
      await onSave(curator.id, {
        name: name.trim(),
        contact: contact.trim() || null,
        spotify_owner_url: spotifyUrl.trim() || null,
        notes: notes.trim() || null,
      });
      toast.success("Curador atualizado");
      onOpenChange(false);
    } catch (e) {
      console.error(e);
      toast.error("Erro ao salvar");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Editar curador</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="cur-name">Nome</Label>
            <Input id="cur-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cur-contact">Contato</Label>
            <Input
              id="cur-contact"
              placeholder="WhatsApp, email…"
              value={contact}
              onChange={(e) => setContact(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cur-spotify">URL do Spotify</Label>
            <Input
              id="cur-spotify"
              placeholder="https://open.spotify.com/user/…"
              value={spotifyUrl}
              onChange={(e) => setSpotifyUrl(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cur-notes">Notas</Label>
            <Textarea
              id="cur-notes"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Salvando…" : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
