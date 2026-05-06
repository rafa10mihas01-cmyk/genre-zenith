import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Loader2,
  Search,
  Music2,
  Plus,
  X,
  CalendarIcon,
  Check,
  ChevronLeft,
  ChevronRight,
  UserPlus,
  Users,
  AlertTriangle,
  PlusCircle,
  Pencil,
} from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import {
  useCuratorDeals,
  type Curator,
  type CuratorBalance,
  type DealSongInput,
} from "@/hooks/useCuratorDeals";
import type { CuratorDeal, CuratorDealSong } from "@/lib/curatorDealsUtils";
import { curatorPublicUrl } from "@/lib/curatorPublicUrl";
import { formatNumber } from "@/lib/format";
import { useFormDraft } from "@/hooks/useFormDraft";
import { DraftBanner, DraftIndicator } from "@/components/forms/DraftBanner";

// ============================================================
// Tipos locais
// ============================================================
type SongRow = {
  url: string;
  daily_goal: string;       // string pra input numérico
  duration_days: string;    // string pra input numérico
  started_at: Date | undefined;
  ramp_up_days: string;
  meta: {
    title: string;
    artist: string | null;
    artist_candidates: string[];
    thumbnail_url: string | null;
  } | null;
  searching: boolean;
  error?: string;
};

export interface NewDealDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Quando passado, o diálogo entra em modo edição. */
  editDeal?: CuratorDeal | null;
  /** Músicas associadas ao deal (somente em modo edição). */
  editSongs?: CuratorDealSong[];
  /** Callback para a página recarregar a lista após salvar. */
  onSaved?: () => void | Promise<void>;
}

// ============================================================
// Helpers
// ============================================================
function parseTitle(raw: string): { title: string; artist: string | null } {
  const parts = raw.split(" - ");
  if (parts.length >= 2) {
    return { title: parts[0].trim(), artist: parts.slice(1).join(" - ").trim() };
  }
  return { title: raw.trim(), artist: null };
}

function extractSpotifyTrackId(url: string): string | null {
  if (!url) return null;
  const m = url.match(/track[/:]([a-zA-Z0-9]{10,})/);
  return m ? m[1] : null;
}

function emptySong(): SongRow {
  return {
    url: "",
    daily_goal: "",
    duration_days: "30",
    started_at: new Date(),
    ramp_up_days: "5",
    meta: null,
    searching: false,
  };
}

function digitsOnly(v: string): string {
  return v.replace(/\D/g, "");
}
function formatCurrencyBRL(rawDigits: string): string {
  if (!rawDigits) return "";
  const cents = parseInt(rawDigits, 10);
  if (Number.isNaN(cents)) return "";
  const value = cents / 100;
  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
function currencyDigitsToNumber(rawDigits: string): number | undefined {
  if (!rawDigits) return undefined;
  const cents = parseInt(rawDigits, 10);
  if (Number.isNaN(cents)) return undefined;
  return cents / 100;
}
function formatPlaysHint(n: number | undefined | null): string {
  if (n == null || !Number.isFinite(n) || n <= 0) return "";
  const fmt = (val: number) => {
    const s = val.toFixed(1);
    return s.endsWith(".0") ? s.slice(0, -2) : s.replace(".", ",");
  };
  if (n >= 1_000_000_000) {
    const v = n / 1_000_000_000;
    return `${fmt(v)} ${v === 1 ? "bilhão" : "bilhões"}`;
  }
  if (n >= 1_000_000) {
    const v = n / 1_000_000;
    return `${fmt(v)} ${v === 1 ? "milhão" : "milhões"}`;
  }
  if (n >= 1_000) {
    const v = n / 1_000;
    return `${fmt(v)} mil`;
  }
  return n.toLocaleString("pt-BR");
}

function songTarget(s: SongRow): number {
  const dg = Number(s.daily_goal);
  const dd = Number(s.duration_days);
  if (!Number.isFinite(dg) || !Number.isFinite(dd) || dg <= 0 || dd <= 0) return 0;
  return Math.round(dg * dd);
}

// ============================================================
// Range picker (início → fim) num único calendário
// ============================================================
function DealRangePicker({
  startedAt,
  durationDays,
  onChange,
}: {
  startedAt: Date | undefined;
  durationDays: number;
  onChange: (start: Date, days: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const from = startedAt;
  const to =
    startedAt && durationDays > 0
      ? new Date(startedAt.getTime() + durationDays * 86400000)
      : undefined;

  const label =
    from && to
      ? `${format(from, "dd MMM", { locale: ptBR })} → ${format(to, "dd MMM, yyyy", { locale: ptBR })} · ${durationDays}d`
      : from
      ? `${format(from, "dd 'de' MMM, yyyy", { locale: ptBR })} — escolha o fim`
      : "Escolher período";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn(
            "h-9 pl-3 text-left font-normal justify-start",
            !from && "text-muted-foreground",
          )}
        >
          {label}
          <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="range"
          selected={{ from, to }}
          onSelect={(range) => {
            if (!range?.from) return;
            const start = range.from;
            if (range.to) {
              const days = Math.max(
                1,
                Math.round((range.to.getTime() - start.getTime()) / 86400000),
              );
              onChange(start, days);
              setOpen(false);
            } else {
              // Só clicou no início — mantém duração atual (mínimo 1)
              onChange(start, Math.max(1, durationDays));
            }
          }}
          numberOfMonths={1}
          initialFocus
          className={cn("p-3 pointer-events-auto")}
          locale={ptBR}
        />
      </PopoverContent>
    </Popover>
  );
}

// ============================================================
// Componente
// ============================================================
export function NewDealDialog({ open, onOpenChange, editDeal, editSongs, onSaved }: NewDealDialogProps) {
  const { addDeal, updateDeal, addCurator, updateCurator, curators, balances } = useCuratorDeals();
  const isEdit = Boolean(editDeal);

  const [step, setStep] = useState<1 | 2>(1);
  const [submitting, setSubmitting] = useState(false);
  const [songs, setSongs] = useState<SongRow[]>([emptySong()]);

  // Passo 1 — curador
  const [curatorMode, setCuratorMode] = useState<"select" | "new">("select");
  const [selectedCuratorId, setSelectedCuratorId] = useState<string | null>(null);
  const [curatorSearch, setCuratorSearch] = useState("");
  // Novo curador
  const [newCuratorName, setNewCuratorName] = useState("");
  const [newCuratorContact, setNewCuratorContact] = useState("");
  const [newCuratorPlaysDigits, setNewCuratorPlaysDigits] = useState("");
  const [newCuratorCostDigits, setNewCuratorCostDigits] = useState("");

  // Ajuste de saldo do curador existente (inline no passo 1)
  // null = nenhum, "add" = comprar mais plays (soma), "edit" = editar saldo direto
  const [balanceAction, setBalanceAction] = useState<null | "add" | "edit">(null);
  const [balancePlaysDigits, setBalancePlaysDigits] = useState("");
  const [balanceCostDigits, setBalanceCostDigits] = useState("");
  const [savingBalance, setSavingBalance] = useState(false);

  const balanceById = useMemo(() => {
    const map = new Map<string, CuratorBalance>();
    balances.forEach((b) => {
      if (b.curator_id) map.set(b.curator_id, b);
    });
    return map;
  }, [balances]);

  const visibleCurators = useMemo(() => {
    const term = curatorSearch.trim().toLowerCase();
    return curators
      .filter((c) => !c.archived_at)
      .filter((c) => (term ? c.name.toLowerCase().includes(term) : true));
  }, [curators, curatorSearch]);

  const selectedCurator: Curator | null = useMemo(
    () => curators.find((c) => c.id === selectedCuratorId) ?? null,
    [curators, selectedCuratorId],
  );
  const selectedBalance: CuratorBalance | null = useMemo(
    () => (selectedCuratorId ? balanceById.get(selectedCuratorId) ?? null : null),
    [balanceById, selectedCuratorId],
  );

  // ============================================================
  // Persistência de rascunho (autosave + restore)
  // Só ativa em modo "novo deal" (edição não cria rascunho)
  // ============================================================
  // Snapshot serializável dos campos. Memoizado pra não causar saves desnecessários.
  const draftSnapshot = useMemo(
    () => ({
      step,
      curatorMode,
      selectedCuratorId,
      newCuratorName,
      newCuratorContact,
      newCuratorPlaysDigits,
      newCuratorCostDigits,
      songs: songs.map((s) => ({
        url: s.url,
        daily_goal: s.daily_goal,
        duration_days: s.duration_days,
        started_at: s.started_at ? s.started_at.toISOString() : null,
        ramp_up_days: s.ramp_up_days,
        meta: s.meta,
      })),
    }),
    [
      step,
      curatorMode,
      selectedCuratorId,
      newCuratorName,
      newCuratorContact,
      newCuratorPlaysDigits,
      newCuratorCostDigits,
      songs,
    ],
  );

  const isDraftEmpty = useMemo(() => {
    if (selectedCuratorId) return false;
    if (newCuratorName.trim() || newCuratorContact.trim()) return false;
    if (newCuratorPlaysDigits || newCuratorCostDigits) return false;
    return songs.every(
      (s) => !s.url.trim() && !s.daily_goal && !s.meta,
    );
  }, [
    selectedCuratorId,
    newCuratorName,
    newCuratorContact,
    newCuratorPlaysDigits,
    newCuratorCostDigits,
    songs,
  ]);

  const draft = useFormDraft(
    "new-deal",
    { enabled: open && !isEdit, isEmpty: isDraftEmpty },
    draftSnapshot,
  );

  // Estado: já tomou decisão sobre o draft (continuar/descartar) nesta sessão?
  const [draftDecided, setDraftDecided] = useState(false);

  const handleRestoreDraft = () => {
    const data = draft.restoreDraft();
    if (!data) {
      setDraftDecided(true);
      return;
    }
    setStep((data.step as 1 | 2) ?? 1);
    setCuratorMode((data.curatorMode as "select" | "new") ?? "select");
    setSelectedCuratorId((data.selectedCuratorId as string | null) ?? null);
    setNewCuratorName((data.newCuratorName as string) ?? "");
    setNewCuratorContact((data.newCuratorContact as string) ?? "");
    setNewCuratorPlaysDigits((data.newCuratorPlaysDigits as string) ?? "");
    setNewCuratorCostDigits((data.newCuratorCostDigits as string) ?? "");
    const restoredSongs = (data.songs as Array<{
      url: string;
      daily_goal: string;
      duration_days: string;
      started_at: string | null;
      ramp_up_days: string;
      meta: SongRow["meta"];
    }>) ?? [];
    if (restoredSongs.length > 0) {
      setSongs(
        restoredSongs.map((s) => ({
          url: s.url ?? "",
          daily_goal: s.daily_goal ?? "",
          duration_days: s.duration_days ?? "30",
          started_at: s.started_at ? new Date(s.started_at) : new Date(),
          ramp_up_days: s.ramp_up_days ?? "5",
          meta: s.meta ?? null,
          searching: false,
        })),
      );
    }
    setDraftDecided(true);
  };

  const handleDiscardDraft = () => {
    draft.clearDraft();
    setDraftDecided(true);
  };

  // ============================================================
  // Hidratação (modo edição) e reset (abertura)
  // ============================================================
  useEffect(() => {
    if (!open) {
      // Reset da decisão sobre o draft sempre que fecha
      setDraftDecided(false);
      return;
    }

    if (isEdit && editDeal) {
      // Edição: pula direto pro passo 2, mantém curador atual
      setStep(2);
      setCuratorMode("select");
      setSelectedCuratorId(editDeal.curator_id ?? null);

      const sourceSongs =
        editSongs && editSongs.length > 0
          ? [...editSongs].sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
          : null;

      if (sourceSongs && sourceSongs.length > 0) {
        setSongs(
          sourceSongs.map((s) => {
            const dd = (s as unknown as { duration_days?: number }).duration_days ?? 30;
            return {
              url: s.song_spotify_url ?? "",
              daily_goal: s.daily_goal ? String(s.daily_goal) : "",
              duration_days: String(dd),
              started_at: s.started_at ? new Date(s.started_at) : new Date(editDeal.started_at),
              ramp_up_days: String(
                (s as unknown as { ramp_up_days?: number }).ramp_up_days ??
                  (editDeal as unknown as { ramp_up_days?: number }).ramp_up_days ??
                  5,
              ),
              meta: {
                title: s.song_name ?? "Música",
                artist: s.song_artist ?? null,
                artist_candidates: ((s as unknown as { artist_candidates?: string[] }).artist_candidates) ?? (s.song_artist ? [s.song_artist] : []),
                thumbnail_url: s.song_cover_url ?? null,
              },
              searching: false,
            };
          }),
        );
      } else {
        setSongs([
          {
            url: editDeal.song_spotify_url ?? "",
            daily_goal: editDeal.daily_goal ? String(editDeal.daily_goal) : "",
            duration_days: "30",
            started_at: new Date(editDeal.started_at),
            ramp_up_days: String(
              (editDeal as unknown as { ramp_up_days?: number }).ramp_up_days ?? 5,
            ),
            meta: {
              title: editDeal.song_name ?? "Música",
              artist: editDeal.song_artist ?? null,
              artist_candidates: editDeal.song_artist ? [editDeal.song_artist] : [],
              thumbnail_url: editDeal.song_cover_url ?? null,
            },
            searching: false,
          },
        ]);
      }
    } else {
      // Novo deal
      // Se existe rascunho, não zera os campos — espera decisão do user
      if (draft.hasDraft) {
        // Mostra banner; campos ficam no estado vazio inicial até restaurar/descartar
        return;
      }
      setStep(1);
      setCuratorMode(curators.length > 0 ? "select" : "new");
      setSelectedCuratorId(null);
      setCuratorSearch("");
      setNewCuratorName("");
      setNewCuratorContact("");
      setNewCuratorPlaysDigits("");
      setNewCuratorCostDigits("");
      setBalanceAction(null);
      setBalancePlaysDigits("");
      setBalanceCostDigits("");
      setSongs([emptySong()]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isEdit, editDeal?.id]);

  // ============================================================
  // Songs handlers
  // ============================================================
  const updateSong = (idx: number, patch: Partial<SongRow>) => {
    setSongs((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  };

  const handleSearchSong = async (idx: number) => {
    const url = songs[idx].url.trim();
    if (!url) {
      updateSong(idx, { error: "Cole o link primeiro" });
      return;
    }
    updateSong(idx, { searching: true, error: undefined, meta: null });
    try {
      const { data, error } = await supabase.functions.invoke(
        "fetch-spotify-meta",
        { body: { url } },
      );
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "Não foi possível buscar");
      // Prioriza campos estruturados retornados pelo backend (artist explícito).
      // Fallback no parse "Title - Artist" pra compat com respostas antigas.
      let title: string | null = data.title ?? null;
      let artist: string | null = data.artist ?? null;
      if (!artist && data.raw_title) {
        const parsed = parseTitle(data.raw_title);
        title = title || parsed.title;
        artist = parsed.artist;
      } else if (!artist && title) {
        const parsed = parseTitle(title);
        title = parsed.title;
        artist = parsed.artist;
      }
      if (!artist) {
        updateSong(idx, {
          searching: false,
          error: "Não consegui identificar o artista — preencha manualmente ou tente outro link",
        });
        toast.error("Artista não identificado", {
          description: "O bot precisa do nome do artista pra buscar no Spotify for Artists.",
        });
        return;
      }
      const candidates: string[] = Array.isArray(data.artist_candidates)
        ? data.artist_candidates.filter((x: unknown) => typeof x === "string" && x.trim().length > 0)
        : (artist ? [artist] : []);
      updateSong(idx, {
        meta: {
          title: title || "Música",
          artist,
          artist_candidates: candidates,
          thumbnail_url: data.thumbnail_url ?? null,
        },
        searching: false,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      updateSong(idx, { searching: false, error: msg });
      toast.error("Não foi possível buscar a música", { description: msg });
    }
  };

  const addSongRow = () => setSongs((prev) => [...prev, emptySong()]);
  const removeSongRow = (idx: number) =>
    setSongs((prev) => (prev.length === 1 ? prev : prev.filter((_, i) => i !== idx)));

  // ============================================================
  // Saldo derivado em tempo real (passo 2)
  // ============================================================
  const songsTotalTarget = useMemo(
    () => songs.reduce((acc, s) => acc + songTarget(s), 0),
    [songs],
  );
  const purchased = selectedBalance?.purchased_plays ?? selectedCurator?.purchased_plays ?? 0;
  const consumedOther = (selectedBalance?.consumed_plays ?? 0) - (isEdit
    ? // Em edição: subtrai a contribuição atual do deal pra recalcular limpo
      (editSongs ?? []).reduce((acc, s) => acc + Number(s.target_plays ?? 0), 0)
    : 0);
  const consumedNow = Math.max(0, consumedOther) + songsTotalTarget;
  const remaining = purchased - consumedNow;
  const overbooked = remaining < 0;

  // ============================================================
  // Submissão
  // ============================================================
  const handleCreateCuratorAndAdvance = async () => {
    const name = newCuratorName.trim();
    if (!name) {
      toast.error("Informe o nome do curador");
      return;
    }
    setSubmitting(true);
    try {
      const playsRaw = newCuratorPlaysDigits ? Number(newCuratorPlaysDigits) : 0;
      const costRaw = currencyDigitsToNumber(newCuratorCostDigits);
      const created = await addCurator({
        name,
        contact: newCuratorContact.trim() || null,
        purchased_plays: playsRaw,
        total_cost: typeof costRaw === "number" ? costRaw : 0,
      });
      setSelectedCuratorId(created.id);
      setCuratorMode("select");
      setStep(2);
      toast.success("Curador cadastrado");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error("Não foi possível cadastrar o curador", { description: msg });
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveBalanceChange = async () => {
    if (!selectedCuratorId || !selectedCurator) return;
    const playsRaw = balancePlaysDigits ? Number(balancePlaysDigits) : 0;
    const costRaw = currencyDigitsToNumber(balanceCostDigits) ?? 0;
    if (playsRaw <= 0 && costRaw <= 0) {
      toast.error("Informe plays e/ou custo");
      return;
    }
    setSavingBalance(true);
    try {
      if (balanceAction === "add") {
        // Soma ao saldo existente
        await updateCurator(selectedCuratorId, {
          purchased_plays: (selectedCurator.purchased_plays ?? 0) + playsRaw,
          total_cost: Number(selectedCurator.total_cost ?? 0) + costRaw,
        });
        toast.success("Plays adicionados", {
          description: `+${formatNumber(playsRaw)} plays`,
        });
      } else if (balanceAction === "edit") {
        // Substitui valores
        await updateCurator(selectedCuratorId, {
          purchased_plays: playsRaw,
          total_cost: costRaw,
        });
        toast.success("Saldo atualizado");
      }
      setBalanceAction(null);
      setBalancePlaysDigits("");
      setBalanceCostDigits("");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error("Não foi possível atualizar saldo", { description: msg });
    } finally {
      setSavingBalance(false);
    }
  };

  const handleAdvanceToStep2 = async () => {
    if (curatorMode === "new") {
      await handleCreateCuratorAndAdvance();
      return;
    }
    if (!selectedCuratorId) {
      toast.error("Selecione um curador ou cadastre um novo");
      return;
    }
    setStep(2);
  };

  const onSubmit = async () => {
    const validSongs = songs.filter((s) => s.url.trim() && s.meta);
    if (validSongs.length === 0) {
      toast.error("Adicione pelo menos uma música", {
        description: "Cole o link e clique em Buscar antes de salvar",
      });
      return;
    }
    if (validSongs.length !== songs.filter((s) => s.url.trim()).length) {
      toast.error("Algumas músicas não foram buscadas", {
        description: "Clique em Buscar em todas antes de salvar",
      });
      return;
    }
    for (let i = 0; i < validSongs.length; i++) {
      const s = validSongs[i];
      if (!s.started_at) {
        toast.error(`Defina a data de início da música ${i + 1}`);
        return;
      }
      const dg = Number(s.daily_goal);
      const dd = Number(s.duration_days);
      if (!dg || dg <= 0) {
        toast.error(`Defina a meta diária da música ${i + 1}`);
        return;
      }
      if (!dd || dd <= 0) {
        toast.error(`Defina a duração (dias) da música ${i + 1}`);
        return;
      }
    }

    const curatorName = selectedCurator?.name ?? "—";

    setSubmitting(true);
    try {
      const [primary, ...rest] = validSongs;
      const extras: DealSongInput[] = rest.map((s, i) => {
        const startMs = s.started_at!.getTime();
        const endMs = startMs + Number(s.duration_days) * 86400000;
        return {
          song_spotify_url: s.url.trim(),
          spotify_track_id: extractSpotifyTrackId(s.url),
          song_name: s.meta!.title,
          song_artist: s.meta!.artist,
          artist_candidates: s.meta!.artist_candidates,
          song_cover_url: s.meta!.thumbnail_url,
          daily_goal: Number(s.daily_goal),
          duration_days: Number(s.duration_days),
          target_plays: songTarget(s),
          position: i + 1,
          started_at: s.started_at ? s.started_at.toISOString() : null,
          ends_at: new Date(endMs).toISOString(),
          ramp_up_days: s.ramp_up_days ? Math.max(0, Number(s.ramp_up_days)) : 5,
        };
      });

      // Janela do deal = menor início e maior fim entre as músicas
      const allStarts = validSongs.map((s) => s.started_at!).filter(Boolean);
      const allEnds = validSongs.map((s) => {
        const startMs = s.started_at!.getTime();
        return new Date(startMs + Number(s.duration_days) * 86400000);
      });
      const dealStart = allStarts.reduce((min, d) => (d < min ? d : min), allStarts[0]);
      const dealEnd = allEnds.reduce((max, d) => (d > max ? d : max), allEnds[0]);

      const primaryTarget = songTarget(primary);

      const payload = {
        curator_id: selectedCuratorId ?? null,
        curator_name: curatorName,
        song_spotify_url: primary.url.trim(),
        song_name: primary.meta!.title,
        song_artist: primary.meta!.artist,
        artist_candidates: primary.meta!.artist_candidates,
        song_cover_url: primary.meta!.thumbnail_url,
        target_plays: songsTotalTarget,
        daily_goal: Number(primary.daily_goal),
        duration_days: Number(primary.duration_days),
        baseline_plays: 0,
        cost: null,
        started_at: dealStart.toISOString(),
        ends_at: dealEnd.toISOString(),
        ramp_up_days: primary.ramp_up_days ? Math.max(0, Number(primary.ramp_up_days)) : 5,
        extra_songs: extras,
      };

      // Garante coerência: payload.target_plays é a soma. Se primary tiver target=0 (edge), usa total.
      if (primaryTarget === 0) {
        payload.target_plays = songsTotalTarget;
      }

      if (isEdit && editDeal) {
        await updateDeal(editDeal.id, payload);
        toast.success("Deal atualizado", {
          description: `${validSongs.length} música${validSongs.length > 1 ? "s" : ""}`,
        });
      } else {
        const deal = await addDeal(payload);
        const link = curatorPublicUrl({ slug: deal.slug, public_token: deal.public_token });
        try {
          await navigator.clipboard.writeText(link);
        } catch {
          // ignora
        }
        toast.success("Deal criado", {
          description: `${validSongs.length} música${validSongs.length > 1 ? "s" : ""} • link copiado`,
        });
      }
      // Submit OK: limpa rascunho persistido
      draft.clearDraft();
      // Notifica a página para recarregar a lista (instâncias do hook são independentes)
      try {
        await onSaved?.();
      } catch (e) {
        console.error("[NewDealDialog] onSaved error", e);
      }
      onOpenChange(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error("Não foi possível salvar o deal", { description: msg });
    } finally {
      setSubmitting(false);
    }
  };

  const handleOpenChange = (next: boolean) => {
    onOpenChange(next);
  };

  // ============================================================
  // Render
  // ============================================================
  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto bg-card border-border/60 rounded-2xl shadow-2xl p-6">
        <DialogHeader>
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1.5 flex-1 min-w-0">
              <DialogTitle>{isEdit ? "Editar deal" : "Novo Deal"}</DialogTitle>
              <DialogDescription>
                {isEdit
                  ? "Atualize as músicas, metas diárias e durações."
                  : step === 1
                    ? "Selecione ou cadastre o curador (saldo de plays comprado)."
                    : "Adicione as músicas — meta = combinado/dia × dias."}
              </DialogDescription>
            </div>
            {!isEdit && (
              <DraftIndicator lastSavedAt={draft.lastSavedAt} className="mt-1 mr-6 shrink-0" />
            )}
          </div>
        </DialogHeader>

        {/* Banner: rascunho disponível ao reabrir */}
        {!isEdit && draft.hasDraft && !draftDecided && (
          <DraftBanner
            onRestore={handleRestoreDraft}
            onDiscard={handleDiscardDraft}
          />
        )}

        {/* Stepper (só em criação) */}
        {!isEdit && (
          <div className="flex items-center gap-2 text-xs">
            <div
              className={cn(
                "flex items-center gap-1.5 px-2.5 h-7 rounded-full border",
                step === 1
                  ? "border-primary text-primary bg-primary/10"
                  : "border-border text-muted-foreground",
              )}
            >
              <span className="font-bold tabular-nums">1</span> Curador
            </div>
            <div className="h-px flex-1 bg-border" />
            <div
              className={cn(
                "flex items-center gap-1.5 px-2.5 h-7 rounded-full border",
                step === 2
                  ? "border-primary text-primary bg-primary/10"
                  : "border-border text-muted-foreground",
              )}
            >
              <span className="font-bold tabular-nums">2</span> Músicas
            </div>
          </div>
        )}

        {/* ========= PASSO 1 — CURADOR ========= */}
        {step === 1 && !isEdit && (
          <div className="space-y-4">
            {/* Toggle modo */}
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant={curatorMode === "select" ? "default" : "outline"}
                size="sm"
                className="gap-2"
                onClick={() => setCuratorMode("select")}
                disabled={curators.length === 0}
              >
                <Users className="h-3.5 w-3.5" /> Existente
              </Button>
              <Button
                type="button"
                variant={curatorMode === "new" ? "default" : "outline"}
                size="sm"
                className="gap-2"
                onClick={() => setCuratorMode("new")}
              >
                <UserPlus className="h-3.5 w-3.5" /> Novo curador
              </Button>
            </div>

            {curatorMode === "select" ? (
              <div className="space-y-3">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Buscar curador…"
                    value={curatorSearch}
                    onChange={(e) => setCuratorSearch(e.target.value)}
                    className="pl-9"
                  />
                </div>

                <div className="max-h-72 overflow-y-auto space-y-1.5 -mx-1 px-1">
                  {visibleCurators.length === 0 ? (
                    <div className="text-center text-sm text-muted-foreground py-8">
                      {curators.length === 0
                        ? "Nenhum curador cadastrado ainda"
                        : "Nenhum curador encontrado"}
                    </div>
                  ) : (
                    visibleCurators.map((c) => {
                      const bal = balanceById.get(c.id);
                      const sel = selectedCuratorId === c.id;
                      const purchasedC = bal?.purchased_plays ?? c.purchased_plays;
                      const remainingC = bal?.remaining_plays ?? purchasedC;
                      const overC = (bal?.overbooked_plays ?? 0) > 0;
                      return (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => {
                            setSelectedCuratorId(c.id);
                            setBalanceAction(null);
                            setBalancePlaysDigits("");
                            setBalanceCostDigits("");
                          }}
                          className={cn(
                            "w-full text-left rounded-xl border p-3.5 transition-all",
                            sel
                              ? "border-primary/60 bg-primary/10 ring-1 ring-primary/30 shadow-[0_0_0_1px_hsl(var(--primary)/0.15)]"
                              : "border-border/60 bg-[hsl(var(--card))] hover:bg-[hsl(var(--elevated))] hover:border-border",
                          )}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <div className="text-sm font-medium text-foreground truncate flex items-center gap-1.5">
                                {sel && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
                                {c.name}
                              </div>
                              <div className="text-xs text-muted-foreground tabular-nums">
                                {formatNumber(purchasedC)} comprado •{" "}
                                <span className={cn(remainingC < 0 && "text-destructive")}>
                                  {formatNumber(remainingC)} restante
                                </span>
                              </div>
                            </div>
                            {overC && (
                              <span className="text-[10px] uppercase tracking-wide font-bold text-destructive bg-destructive/10 ring-1 ring-destructive/30 px-1.5 py-0.5 rounded shrink-0">
                                Estourado
                              </span>
                            )}
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>

                {/* Painel de ajuste de saldo (curador selecionado) */}
                {selectedCurator && (
                  <div className="rounded-xl border border-border/60 bg-[hsl(var(--elevated))] p-4 space-y-3 shadow-sm">
                    <div className="flex items-start justify-between gap-2">
                      <div className="text-xs text-muted-foreground">
                        Saldo atual de <span className="font-medium text-foreground">{selectedCurator.name}</span>:{" "}
                        <span className="tabular-nums text-foreground font-medium">
                          {formatNumber(selectedCurator.purchased_plays ?? 0)}
                        </span>{" "}
                        plays comprados
                        {Number(selectedCurator.total_cost ?? 0) > 0 && (
                          <>
                            {" • "}
                            <span className="tabular-nums">
                              {Number(selectedCurator.total_cost).toLocaleString("pt-BR", {
                                style: "currency",
                                currency: "BRL",
                                maximumFractionDigits: 0,
                              })}
                            </span>
                          </>
                        )}
                      </div>
                    </div>

                    {balanceAction === null ? (
                      <div className="grid grid-cols-2 gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="gap-1.5"
                          onClick={() => setBalanceAction("add")}
                        >
                          <PlusCircle className="h-3.5 w-3.5" /> Comprar mais plays
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="gap-1.5"
                          onClick={() => {
                            setBalanceAction("edit");
                            setBalancePlaysDigits(String(selectedCurator.purchased_plays ?? 0));
                            const cost = Number(selectedCurator.total_cost ?? 0);
                            setBalanceCostDigits(cost > 0 ? String(Math.round(cost * 100)) : "");
                          }}
                        >
                          <Pencil className="h-3.5 w-3.5" /> Ajustar saldo
                        </Button>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div className="text-xs font-medium text-foreground">
                          {balanceAction === "add"
                            ? "Adicionar pacote ao saldo (soma)"
                            : "Substituir saldo (sobrescreve)"}
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div className="space-y-1.5">
                            <Label className="text-xs">
                              {balanceAction === "add" ? "Plays a adicionar" : "Plays comprados"}
                            </Label>
                            <Input
                              inputMode="numeric"
                              placeholder="ex: 1000000"
                              value={balancePlaysDigits}
                              onChange={(e) => setBalancePlaysDigits(digitsOnly(e.target.value))}
                            />
                            {balancePlaysDigits && (
                              <p className="text-[11px] text-muted-foreground">
                                ≈{" "}
                                <span className="text-foreground font-medium">
                                  {formatPlaysHint(Number(balancePlaysDigits))}
                                </span>{" "}
                                plays
                              </p>
                            )}
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs">
                              {balanceAction === "add" ? "Custo do pacote" : "Custo total"}
                            </Label>
                            <div className="relative">
                              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground pointer-events-none">
                                R$
                              </span>
                              <Input
                                inputMode="numeric"
                                placeholder="0,00"
                                value={
                                  balanceCostDigits
                                    ? formatCurrencyBRL(balanceCostDigits).replace("R$", "").trim()
                                    : ""
                                }
                                onChange={(e) => setBalanceCostDigits(digitsOnly(e.target.value))}
                                className="pl-9"
                              />
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setBalanceAction(null);
                              setBalancePlaysDigits("");
                              setBalanceCostDigits("");
                            }}
                          >
                            Cancelar
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            onClick={handleSaveBalanceChange}
                            disabled={savingBalance || (!balancePlaysDigits && !balanceCostDigits)}
                            className="gap-1.5"
                          >
                            {savingBalance && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                            {balanceAction === "add" ? "Adicionar" : "Salvar"}
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Nome do curador</Label>
                    <Input
                      placeholder="@curador ou nome"
                      maxLength={120}
                      value={newCuratorName}
                      onChange={(e) => setNewCuratorName(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Contato (opcional)</Label>
                    <Input
                      placeholder="WhatsApp, e-mail…"
                      value={newCuratorContact}
                      onChange={(e) => setNewCuratorContact(e.target.value)}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Plays comprados</Label>
                    <Input
                      inputMode="numeric"
                      placeholder="ex: 3000000"
                      value={newCuratorPlaysDigits}
                      onChange={(e) =>
                        setNewCuratorPlaysDigits(digitsOnly(e.target.value))
                      }
                    />
                    {newCuratorPlaysDigits && (
                      <p className="text-xs text-muted-foreground">
                        ≈{" "}
                        <span className="text-foreground font-medium">
                          {formatPlaysHint(Number(newCuratorPlaysDigits))}
                        </span>{" "}
                        plays
                      </p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label>Custo total</Label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground pointer-events-none">
                        R$
                      </span>
                      <Input
                        inputMode="numeric"
                        placeholder="0,00"
                        value={
                          newCuratorCostDigits
                            ? formatCurrencyBRL(newCuratorCostDigits).replace("R$", "").trim()
                            : ""
                        }
                        onChange={(e) =>
                          setNewCuratorCostDigits(digitsOnly(e.target.value))
                        }
                        className="pl-9"
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}

            <DialogFooter className="gap-2 sm:gap-2">
              <Button type="button" variant="ghost" onClick={() => handleOpenChange(false)}>
                Cancelar
              </Button>
              <Button
                type="button"
                onClick={handleAdvanceToStep2}
                disabled={
                  submitting ||
                  (curatorMode === "select" && !selectedCuratorId) ||
                  (curatorMode === "new" && !newCuratorName.trim())
                }
                className="gap-1.5"
              >
                {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                Avançar
                <ChevronRight className="h-4 w-4" />
              </Button>
            </DialogFooter>
          </div>
        )}

        {/* ========= PASSO 2 — MÚSICAS ========= */}
        {step === 2 && (
          <div className="space-y-4">
            {/* Resumo do curador + saldo */}
            {selectedCurator && (
              <div
                className={cn(
                  "rounded-xl border p-4 flex items-center justify-between gap-3 shadow-sm",
                  overbooked
                    ? "border-destructive/40 bg-destructive/5"
                    : "border-border/60 bg-[hsl(var(--elevated))]",
                )}
              >
                <div className="min-w-0">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    Saldo do curador
                  </div>
                  <div className="text-sm font-semibold text-foreground truncate">
                    {selectedCurator.name}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    Meta deste deal = soma das músicas
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3 text-right">
                  <div>
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      Comprado
                    </div>
                    <div className="text-sm font-bold tabular-nums">
                      {formatNumber(purchased)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      Já em deals
                    </div>
                    <div className="text-sm font-bold tabular-nums">
                      {formatNumber(consumedNow)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      Restante
                    </div>
                    <div
                      className={cn(
                        "text-sm font-bold tabular-nums",
                        overbooked ? "text-destructive" : "text-primary",
                      )}
                    >
                      {formatNumber(remaining)}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {overbooked && (
              <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2.5 flex items-start gap-2 text-xs">
                <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-px" />
                <div className="text-destructive">
                  Saldo estourado em{" "}
                  <span className="font-bold tabular-nums">
                    {formatNumber(Math.abs(remaining))}
                  </span>{" "}
                  plays. O deal pode ser salvo mesmo assim — admins serão alertados.
                </div>
              </div>
            )}

            {/* Lista de músicas */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="mb-0">
                  Músicas do deal{" "}
                  <span className="text-xs text-muted-foreground font-normal">
                    ({songs.length})
                  </span>
                </Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addSongRow}
                  className="gap-1.5 h-8 border-border/60 hover:border-primary/50 hover:text-primary"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Adicionar música
                </Button>
              </div>

              <div className="space-y-3">
                {songs.map((song, idx) => {
                  const target = songTarget(song);
                  return (
                    <div
                      key={idx}
                      className="rounded-xl border border-border/60 bg-[hsl(var(--elevated))] p-4 space-y-3 shadow-sm hover:border-border/80 transition-colors"
                    >
                      <div className="flex items-start gap-2">
                        <div className="flex-1 grid grid-cols-1 sm:grid-cols-[1fr_140px] gap-2">
                          <Input
                            type="url"
                            placeholder="https://open.spotify.com/track/..."
                            value={song.url}
                            maxLength={500}
                            onChange={(e) =>
                              updateSong(idx, {
                                url: e.target.value,
                                meta: null,
                                error: undefined,
                              })
                            }
                          />
                          <Input
                            type="number"
                            inputMode="numeric"
                            min={0}
                            placeholder="Plays/dia"
                            value={song.daily_goal}
                            onChange={(e) =>
                              updateSong(idx, { daily_goal: e.target.value })
                            }
                          />
                        </div>
                        {songs.length > 1 && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-9 w-9 text-muted-foreground hover:text-destructive shrink-0"
                            onClick={() => removeSongRow(idx)}
                            aria-label="Remover música"
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        )}
                      </div>

                      {/* Meta calculada (preview) */}
                      {target > 0 && (
                        <div className="text-xs text-muted-foreground flex items-center gap-1.5 flex-wrap">
                          <span>Meta total da música:</span>
                          <span className="text-foreground font-bold tabular-nums">
                            {formatNumber(target)}
                          </span>
                          <span>plays</span>
                          <span className="text-muted-foreground/60">
                            ({formatPlaysHint(target)})
                          </span>
                        </div>
                      )}

                      {/* Período (início → fim) + ramp-up */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <div className="flex flex-col gap-1">
                          <span className="text-xs text-muted-foreground">Período (início → fim)</span>
                          <DealRangePicker
                            startedAt={song.started_at}
                            durationDays={Number(song.duration_days) || 0}
                            onChange={(start, days) =>
                              updateSong(idx, {
                                started_at: start,
                                duration_days: String(days),
                              })
                            }
                          />
                        </div>

                        <div className="flex flex-col gap-1">
                          <span className="text-xs text-muted-foreground">
                            Aquecimento (dias)
                          </span>
                          <Input
                            type="number"
                            inputMode="numeric"
                            min={0}
                            max={30}
                            className="h-9"
                            value={song.ramp_up_days}
                            onChange={(e) =>
                              updateSong(idx, { ramp_up_days: e.target.value })
                            }
                          />
                        </div>
                      </div>

                      {/* Buscar / preview */}
                      <div className="flex items-center gap-2">
                        {!song.meta ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="gap-1.5"
                            onClick={() => handleSearchSong(idx)}
                            disabled={song.searching || !song.url.trim()}
                          >
                            {song.searching ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Search className="h-3.5 w-3.5" />
                            )}
                            Buscar música
                          </Button>
                        ) : (
                          <div className="flex items-center gap-2 flex-1 min-w-0">
                            {song.meta.thumbnail_url ? (
                              <img
                                src={song.meta.thumbnail_url}
                                alt={song.meta.title}
                                className="h-9 w-9 rounded-md object-cover shrink-0"
                              />
                            ) : (
                              <div className="h-9 w-9 rounded-md bg-muted flex items-center justify-center shrink-0">
                                <Music2 className="h-4 w-4 text-muted-foreground" />
                              </div>
                            )}
                            <div className="min-w-0 flex-1">
                              <div className="text-sm font-medium text-foreground truncate flex items-center gap-1.5">
                                <Check className="h-3.5 w-3.5 text-success shrink-0" />
                                {song.meta.title}
                              </div>
                              {song.meta.artist && (
                                <div className="text-xs text-muted-foreground truncate">
                                  {song.meta.artist}
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>

                      {song.error && (
                        <div className="text-xs text-destructive">{song.error}</div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <DialogFooter className="gap-2 sm:gap-2 sm:justify-between">
              {!isEdit ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setStep(1)}
                  disabled={submitting}
                  className="gap-1.5"
                >
                  <ChevronLeft className="h-4 w-4" /> Voltar
                </Button>
              ) : (
                <span />
              )}
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => handleOpenChange(false)}
                  disabled={submitting}
                >
                  Cancelar
                </Button>
                <Button type="button" onClick={onSubmit} disabled={submitting}>
                  {submitting && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
                  {isEdit ? "Salvar alterações" : "Salvar deal"}
                </Button>
              </div>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
