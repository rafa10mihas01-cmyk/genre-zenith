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

  useEffect(() => { if (open) load();   }, [open, campaignId]);

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
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 px-2 lg:px-3"
          aria-label="Acessos"
          title="Acessos"
        >
          <ShieldCheck className="h-4 w-4" />
          <span className="hidden lg:inline">Acessos</span>
        </Button>
      </DialogTrigger>

      <DialogContent className="max-w-2xl p-0 overflow-hidden">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center">
              <ShieldCheck className="h-4.5 w-4.5 text-primary" />
            </div>
            <div>
              <DialogTitle className="text-base">Acessos do portal do cliente</DialogTitle>
              <DialogDescription className="text-xs mt-0.5">
                Só e-mails autorizados entram. Acesso por código OTP enviado por e-mail.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <Tabs defaultValue="emails" className="px-6 pt-4 pb-6">
          <TabsList className="bg-muted/40">
            <TabsTrigger value="emails">Autorizados ({emails.length})</TabsTrigger>
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
              <Button onClick={add} disabled={adding} className="shrink-0">
                {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Plus className="h-4 w-4 mr-1" /> Adicionar</>}
              </Button>
            </div>
            <div className="rounded-lg border border-border bg-card/40 divide-y divide-border max-h-[340px] overflow-auto">
              {loading ? (
                <div className="p-6 text-sm text-muted-foreground text-center">Carregando…</div>
              ) : emails.length === 0 ? (
                <div className="p-8 text-sm text-muted-foreground text-center">
                  <ShieldCheck className="h-6 w-6 mx-auto mb-2 opacity-40" />
                  Nenhum e-mail autorizado ainda.
                </div>
              ) : emails.map(e => (
                <div key={e.id} className="flex items-center justify-between px-4 py-3 text-sm hover:bg-muted/30 transition-colors">
                  <div className="min-w-0">
                    <div className="font-medium truncate">{e.email}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      Adicionado em {new Date(e.added_at).toLocaleString("pt-BR")}
                    </div>
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => remove(e.id)} className="shrink-0 h-8 w-8">
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="logs" className="mt-4">
            <div className="rounded-lg border border-border bg-card/40 divide-y divide-border max-h-[420px] overflow-auto">
              {loading ? (
                <div className="p-6 text-sm text-muted-foreground text-center">Carregando…</div>
              ) : logs.length === 0 ? (
                <div className="p-8 text-sm text-muted-foreground text-center">
                  Nenhum acesso registrado ainda.
                </div>
              ) : logs.map(l => (
                <div key={l.id} className="flex items-center justify-between px-4 py-3 text-sm hover:bg-muted/30 transition-colors">
                  <div className="min-w-0">
                    <div className="font-medium truncate">{l.email}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">IP: {l.ip ?? "—"}</div>
                  </div>
                  <div className="text-xs text-muted-foreground shrink-0 ml-3">
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
