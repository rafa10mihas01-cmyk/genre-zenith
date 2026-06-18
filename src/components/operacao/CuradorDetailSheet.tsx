/* eslint-disable react-refresh/only-export-components -- co-located helpers/variants/hooks; split would force a large refactor with no runtime benefit (HMR only) */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Mail, Instagram, MessageCircle, ExternalLink, Copy, Loader2, Send, StickyNote, Activity, Star, Handshake } from "lucide-react";
import { toast } from "sonner";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Timeline, type TimelineItem } from "@/components/ui/timeline";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { PipelineStatusBadge, type PipelineStatus } from "./PipelineStatusBadge";
import {
  CommercialScoreEditor, type CommercialScore,
} from "./CommercialScoreEditor";
import { openInstagramWithMessage } from "./EmailPreviewDialog";
import { NewDealDialog } from "@/components/playlist-deals/NewDealDialog";

export const OPERATIONAL_TAGS = [
  "premium","whatsapp","aceita_trap","aceita_funk","caro","confiavel","demora_responder","top_conversao",
] as const;

const TAG_LABEL: Record<string, string> = {
  premium: "Premium",
  whatsapp: "WhatsApp",
  aceita_trap: "Aceita trap",
  aceita_funk: "Aceita funk",
  caro: "Caro",
  confiavel: "Confiável",
  demora_responder: "Demora responder",
  top_conversao: "Top conversão",
};

export type DetailCurator = {
  id: string;
  name: string;
  owner_name: string | null;
  email: string | null;
  instagram: string | null;
  whatsapp: string | null;
  spotify_url: string | null;
  pipeline_status: PipelineStatus;
  commercial_score: CommercialScore | null;
  operational_tags: string[];
  followup_count: number;
};

type LogRow = {
  id: string;
  channel: string | null;
  event_type: string;
  template_name: string | null;
  recipient_email: string | null;
  recipient_handle: string | null;
  subject: string | null;
  body_snippet: string | null;
  note: string | null;
  status: string | null;
  sent_at: string;
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

function eventLabel(e: LogRow): { primary: string; tone: TimelineItem["tone"] } {
  switch (e.event_type) {
    case "sent":
      return { primary: e.channel === "email" ? `Email enviado · ${e.subject ?? "—"}` : `Mensagem enviada`, tone: "primary" };
    case "opened":
      return { primary: "Email aberto", tone: "primary" };
    case "replied":
      return { primary: `Respondeu via ${e.channel ?? "—"}${e.note ? ` · ${e.note}` : ""}`, tone: "success" };
    case "followup_1":
      return { primary: "Follow-up #1 enviado", tone: "warning" };
    case "followup_2":
      return { primary: "Follow-up #2 enviado", tone: "warning" };
    case "note":
      return { primary: e.note ?? "Nota", tone: "neutral" };
    default:
      return { primary: e.event_type, tone: "neutral" };
  }
}

export function CuradorDetailSheet({
  open, onOpenChange, curator, onChanged, onSendEmail, onSendFollowup,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  curator: DetailCurator | null;
  onChanged: () => void;
  onSendEmail: (c: DetailCurator) => void;
  onSendFollowup: (c: DetailCurator) => void;
}) {
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [score, setScore] = useState<CommercialScore>({});
  const [tags, setTags] = useState<string[]>([]);
  const [whatsapp, setWhatsapp] = useState("");
  const [noteDraft, setNoteDraft] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [savingMeta, setSavingMeta] = useState(false);
  const [dealDialogOpen, setDealDialogOpen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (!curator || !open) return;
    setScore((curator.commercial_score ?? {}) as CommercialScore);
    setTags(curator.operational_tags ?? []);
    setWhatsapp(curator.whatsapp ?? "");
    setNoteDraft("");
    loadLogs(curator.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curator?.id, open]);

  const loadLogs = async (curatorId: string) => {
    setLoadingLogs(true);
    const { data, error } = await supabase
      .from("curator_outreach_log")
      .select("id, channel, event_type, template_name, recipient_email, recipient_handle, subject, body_snippet, note, status, sent_at")
      .eq("external_curator_id", curatorId)
      .order("sent_at", { ascending: false })
      .limit(80);
    if (error) toast.error("Erro ao carregar histórico");
    else setLogs((data ?? []) as LogRow[]);
    setLoadingLogs(false);
  };

  if (!curator) return null;

  const persistMeta = async (patch: Partial<DetailCurator>) => {
    setSavingMeta(true);
    const { error } = await supabase
      .from("external_curators")
      .update(patch as never)
      .eq("id", curator.id);
    setSavingMeta(false);
    if (error) { toast.error("Erro ao salvar"); return; }
    onChanged();
  };

  const handleStatus = (next: PipelineStatus) => persistMeta({ pipeline_status: next });
  const handleSaveScore = () => persistMeta({ commercial_score: score } as never);
  const handleSaveTags = () => persistMeta({ operational_tags: tags } as never);
  const handleSaveWhatsapp = () => persistMeta({ whatsapp: whatsapp.trim() || null } as never);

  const handleAddNote = async () => {
    const txt = noteDraft.trim();
    if (!txt) return;
    setSavingNote(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setSavingNote(false); toast.error("Sessão expirada"); return; }
    const { error } = await supabase.from("curator_outreach_log").insert({
      user_id: user.id,
      external_curator_id: curator.id,
      channel: "note",
      event_type: "note",
      note: txt,
      status: "logged",
    });
    setSavingNote(false);
    if (error) { toast.error("Erro ao salvar nota"); return; }
    setNoteDraft("");
    await loadLogs(curator.id);
    onChanged();
  };

  const markReplied = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from("curator_outreach_log").insert({
      user_id: user.id,
      external_curator_id: curator.id,
      channel: "manual",
      event_type: "replied",
      note: "Marcado manualmente como respondeu",
      status: "logged",
    });
    toast.success("Marcado como respondeu");
    await loadLogs(curator.id);
    onChanged();
  };

  const copy = (v: string, label: string) => {
    navigator.clipboard.writeText(v);
    toast.success(`${label} copiado`);
  };

  const igHandle = curator.instagram?.replace(/^@/, "");
  const waNumber = (curator.whatsapp ?? "").replace(/\D+/g, "");

  const timelineItems: TimelineItem[] = logs.map((l) => {
    const { primary, tone } = eventLabel(l);
    return {
      id: l.id,
      date: formatDate(l.sent_at),
      primary,
      secondary: l.channel ?? undefined,
      tone,
    };
  });

  const canFollowup = curator.followup_count < 2;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <SheetTitle className="truncate text-base">{curator.name}</SheetTitle>
              <SheetDescription className="truncate text-xs">
                {curator.owner_name ?? "—"}
              </SheetDescription>
            </div>
            <PipelineStatusBadge status={curator.pipeline_status} onChange={handleStatus} />
          </div>
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Activity className="h-3 w-3" />
            {curator.followup_count > 0
              ? `${curator.followup_count} follow-up${curator.followup_count > 1 ? "s" : ""} enviado${curator.followup_count > 1 ? "s" : ""}`
              : "Sem follow-up ainda"}
            <span className="mx-1 opacity-50">·</span>
            <button onClick={markReplied} className="text-primary hover:underline">
              Marcar como respondeu
            </button>
          </div>
          <Button
            size="sm"
            className="h-8 gap-1.5 w-full sm:w-auto"
            onClick={() => setDealDialogOpen(true)}
          >
            <Handshake className="h-3.5 w-3.5" />
            Criar deal
          </Button>
        </SheetHeader>

        <Tabs defaultValue="contato" className="mt-4">
          <TabsList className="w-full grid grid-cols-4 h-9">
            <TabsTrigger value="contato" className="text-xs">Contato</TabsTrigger>
            <TabsTrigger value="timeline" className="text-xs">Timeline</TabsTrigger>
            <TabsTrigger value="score" className="text-xs">Score</TabsTrigger>
            <TabsTrigger value="notas" className="text-xs">Notas</TabsTrigger>
          </TabsList>

          {/* CONTATO */}
          <TabsContent value="contato" className="space-y-3 mt-4">
            <ContactRow icon={<Mail className="h-4 w-4 text-primary" />} label="Email" value={curator.email}>
              {curator.email && (
                <>
                  <Button size="sm" variant="outline" className="h-8" onClick={() => copy(curator.email!, "Email")}>
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="sm" className="h-8 gap-1.5" onClick={() => onSendEmail(curator)}>
                    <Send className="h-3.5 w-3.5" /> Enviar
                  </Button>
                  {canFollowup && curator.followup_count > 0 && (
                    <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => onSendFollowup(curator)}>
                      Follow-up #{curator.followup_count + 1}
                    </Button>
                  )}
                </>
              )}
            </ContactRow>

            <ContactRow icon={<Instagram className="h-4 w-4 text-pink-500" />} label="Instagram" value={igHandle ? `@${igHandle}` : null}>
              {igHandle && (
                <>
                  <Button size="sm" variant="outline" className="h-8" onClick={() => copy(`@${igHandle}`, "Handle")}>
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="sm" className="h-8 gap-1.5"
                    onClick={() => openInstagramWithMessage(igHandle, curator.owner_name ?? curator.name, curator.name)}
                  >
                    <ExternalLink className="h-3.5 w-3.5" /> Abrir DM
                  </Button>
                </>
              )}
            </ContactRow>

            <div className="rounded-xl border border-border bg-card p-3">
              <div className="flex items-center gap-2 text-xs font-medium mb-2">
                <MessageCircle className="h-4 w-4 text-green-500" /> WhatsApp
              </div>
              <div className="flex items-center gap-2">
                <Input
                  value={whatsapp}
                  onChange={(e) => setWhatsapp(e.target.value)}
                  placeholder="+55 11 9 9999-9999"
                  className="h-9 text-sm"
                />
                <Button size="sm" variant="outline" className="h-9" onClick={handleSaveWhatsapp} disabled={savingMeta}>
                  Salvar
                </Button>
              </div>
              {waNumber && (
                <a
                  href={`https://wa.me/${waNumber}`}
                  target="_blank" rel="noreferrer"
                  className="inline-flex items-center gap-1.5 mt-2 text-xs text-primary hover:underline"
                >
                  <ExternalLink className="h-3 w-3" /> Abrir wa.me/{waNumber}
                </a>
              )}
            </div>

            {curator.spotify_url && (
              <a
                href={curator.spotify_url} target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline px-1"
              >
                <ExternalLink className="h-3 w-3" /> Abrir playlist no Spotify
              </a>
            )}
          </TabsContent>

          {/* TIMELINE */}
          <TabsContent value="timeline" className="mt-4">
            {loadingLogs ? (
              <div className="flex items-center justify-center py-10 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
              </div>
            ) : timelineItems.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-8">
                Nenhum contato registrado ainda
              </p>
            ) : (
              <Timeline items={timelineItems} />
            )}
          </TabsContent>

          {/* SCORE & TAGS */}
          <TabsContent value="score" className="mt-4 space-y-5">
            <div>
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground inline-flex items-center gap-1.5">
                  <Star className="h-3.5 w-3.5" /> Score comercial
                </h4>
                <Button size="sm" className="h-7" onClick={handleSaveScore} disabled={savingMeta}>
                  Salvar score
                </Button>
              </div>
              <CommercialScoreEditor value={score} onChange={setScore} />
            </div>
            <div>
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Tags operacionais
                </h4>
                <Button size="sm" className="h-7" onClick={handleSaveTags} disabled={savingMeta}>
                  Salvar tags
                </Button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {OPERATIONAL_TAGS.map((tag) => {
                  const active = tags.includes(tag);
                  return (
                    <button
                      key={tag}
                      onClick={() => setTags(active ? tags.filter((t) => t !== tag) : [...tags, tag])}
                      className={cn(
                        "h-7 px-3 rounded-full text-[11px] font-medium border transition-colors",
                        active
                          ? "bg-primary/15 border-primary/40 text-primary"
                          : "bg-elevated border-border text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {TAG_LABEL[tag]}
                    </button>
                  );
                })}
              </div>
            </div>
          </TabsContent>

          {/* NOTAS */}
          <TabsContent value="notas" className="mt-4 space-y-3">
            <div className="rounded-xl border border-border bg-card p-3">
              <label className="text-xs font-medium text-foreground inline-flex items-center gap-1.5 mb-2">
                <StickyNote className="h-3.5 w-3.5" /> Nova nota
              </label>
              <Textarea
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
                rows={3}
                placeholder="Ex: cobra R$300 por inclusão · prefere contato sexta-feira"
                className="text-sm"
              />
              <div className="flex justify-end mt-2">
                <Button size="sm" className="h-8" onClick={handleAddNote} disabled={savingNote || !noteDraft.trim()}>
                  {savingNote ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Adicionar"}
                </Button>
              </div>
            </div>
            <Timeline
              items={logs
                .filter((l) => l.event_type === "note")
                .map((l) => ({
                  id: l.id,
                  date: formatDate(l.sent_at),
                  primary: l.note ?? "—",
                  tone: "neutral" as const,
                }))}
            />
            {logs.filter((l) => l.event_type === "note").length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-4">
                Sem notas ainda
              </p>
            )}
          </TabsContent>
        </Tabs>
      </SheetContent>
      <NewDealDialog
        open={dealDialogOpen}
        onOpenChange={setDealDialogOpen}
        externalCuratorId={curator.id}
        externalCuratorPreview={{
          name: curator.name,
          email: curator.email,
          spotify_url: curator.spotify_url,
        }}
        onCreated={(deal) => {
          setDealDialogOpen(false);
          onOpenChange(false);
          onChanged();
          navigate(`/deals/${deal.id}`);
        }}
      />
    </Sheet>
  );
}

function ContactRow({
  icon, label, value, children,
}: { icon: React.ReactNode; label: string; value: string | null; children?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="flex items-center gap-2 text-xs font-medium mb-2">
        {icon} {label}
      </div>
      {value ? (
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm text-foreground truncate">{value}</span>
          <div className="flex items-center gap-1.5 shrink-0">{children}</div>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground italic">Sem {label.toLowerCase()} cadastrado</p>
      )}
    </div>
  );
}