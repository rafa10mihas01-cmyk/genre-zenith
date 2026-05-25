import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Trash2, ShieldCheck, Plus, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface Props {
  campaignId: string;
}

interface AccessEmail { id: string; email: string; added_at: string; }
interface AccessLog { id: string; email: string; ip: string | null; accessed_at: string; }

export function CampaignAccessManager({ campaignId }: Props) {
  const [open, setOpen] = useState(false);
  const [emails, setEmails] = useState<AccessEmail[]>([]);
  const [logs, setLogs] = useState<AccessLog[]>([]);
  const [newEmail, setNewEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);

  async function load() {
    setLoading(true);
    const [e, l] = await Promise.all([
      supabase.from("campaign_access_emails")
        .select("id, email, added_at")
        .eq("campaign_id", campaignId)
        .order("added_at", { ascending: false }),
      supabase.from("campaign_access_logs")
        .select("id, email, ip, accessed_at")
        .eq("campaign_id", campaignId)
        .order("accessed_at", { ascending: false })
        .limit(200),
    ]);
    setEmails((e.data as AccessEmail[]) ?? []);
    setLogs((l.data as AccessLog[]) ?? []);
    setLoading(false);
  }

  useEffect(() => { if (open) load(); /* eslint-disable-next-line */ }, [open, campaignId]);

  async function add() {
    const em = newEmail.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) { toast.error("E-mail inválido"); return; }
    setAdding(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from("campaign_access_emails").insert({
      campaign_id: campaignId, email: em, added_by: user?.id ?? null,
    });
    setAdding(false);
    if (error) {
      if (error.code === "23505") toast.error("E-mail já autorizado");
      else toast.error(error.message);
      return;
    }
    setNewEmail("");
    toast.success("E-mail autorizado");
    load();
  }

  async function remove(id: string) {
    const { error } = await supabase.from("campaign_access_emails").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Removido");
    load();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <ShieldCheck className="h-4 w-4 mr-1.5" /> Acessos
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Acessos do portal do cliente</DialogTitle>
          <DialogDescription>
            Somente e-mails autorizados podem entrar. Cada acesso usa código OTP enviado por e-mail.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="emails" className="mt-2">
          <TabsList>
            <TabsTrigger value="emails">E-mails autorizados ({emails.length})</TabsTrigger>
            <TabsTrigger value="logs">Histórico ({logs.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="emails" className="space-y-3 mt-4">
            <div className="flex gap-2">
              <Input
                type="email"
                placeholder="email@exemplo.com"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !adding && add()}
              />
              <Button onClick={add} disabled={adding}>
                {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              </Button>
            </div>
            <div className="border rounded-lg divide-y max-h-[320px] overflow-auto">
              {loading ? (
                <div className="p-4 text-sm text-muted-foreground">Carregando…</div>
              ) : emails.length === 0 ? (
                <div className="p-4 text-sm text-muted-foreground">Nenhum e-mail autorizado.</div>
              ) : emails.map(e => (
                <div key={e.id} className="flex items-center justify-between p-3 text-sm">
                  <div>
                    <div className="font-medium">{e.email}</div>
                    <div className="text-xs text-muted-foreground">
                      Adicionado em {new Date(e.added_at).toLocaleString("pt-BR")}
                    </div>
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => remove(e.id)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="logs" className="mt-4">
            <div className="border rounded-lg divide-y max-h-[420px] overflow-auto">
              {loading ? (
                <div className="p-4 text-sm text-muted-foreground">Carregando…</div>
              ) : logs.length === 0 ? (
                <div className="p-4 text-sm text-muted-foreground">Nenhum acesso registrado ainda.</div>
              ) : logs.map(l => (
                <div key={l.id} className="flex items-center justify-between p-3 text-sm">
                  <div>
                    <div className="font-medium">{l.email}</div>
                    <div className="text-xs text-muted-foreground">IP: {l.ip ?? "—"}</div>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(l.accessed_at).toLocaleString("pt-BR")}
                  </div>
                </div>
              ))}
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
