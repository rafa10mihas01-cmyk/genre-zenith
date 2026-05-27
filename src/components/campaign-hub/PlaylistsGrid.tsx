import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronRight, Music, TrendingUp, TrendingDown, Minus, ExternalLink, Camera, Replace } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatInt } from "@/lib/campaignEngine";
import type { EcoAllocation } from "./types";
import { SwapPlaylistDialog } from "./SwapPlaylistDialog";


type EcoSnap = {
  managed_playlist_id: string;
  plays_24h: number | null;
  plays_7d: number | null;
  plays_28d: number | null;
  captured_at: string;
};

type ProofThumb = {
  playlist_id: string;
  screenshot_url: string | null;
  captured_at: string;
};

type Props = {
  allocations: EcoAllocation[];
  snapshots: EcoSnap[];
  proofThumbs?: ProofThumb[];
  positions?: Map<string, number>;
  mode: "internal" | "client";
  flat?: boolean;
  campaignId?: string;
  snapshotLocked?: boolean;
  onSwapped?: () => void;
};


type Group = "active" | "pending" | "paused";

const GROUP_LABEL: Record<Group, string> = {
  active: "No ar",
  pending: "Aguardando",
  paused: "Pausadas",
};

export function PlaylistsGrid({ allocations, snapshots, proofThumbs = [], positions, mode, flat = false, campaignId, snapshotLocked = false, onSwapped }: Props) {
  const latestSnap = useMemo(() => {
    const m = new Map<string, EcoSnap>();
    for (const s of snapshots) {
      if (!m.has(s.managed_playlist_id)) m.set(s.managed_playlist_id, s);
    }
    return m;
  }, [snapshots]);

  const latestThumb = useMemo(() => {
    const m = new Map<string, ProofThumb>();
    for (const t of proofThumbs) {
      if (!t.screenshot_url) continue;
      const prev = m.get(t.playlist_id);
      if (!prev || new Date(t.captured_at) > new Date(prev.captured_at)) m.set(t.playlist_id, t);
    }
    return m;
  }, [proofThumbs]);

  const grouped = useMemo(() => {
    const g: Record<Group, EcoAllocation[]> = { active: [], pending: [], paused: [] };
    for (const a of allocations) {
      const snap = latestSnap.get(a.managed_playlist_id);
      const delivered = Number(snap?.plays_28d ?? snap?.plays_7d ?? snap?.plays_24h ?? 0);
      // Modo cliente: só conta como "no ar" quando JÁ entregou algo (espelha
      // a visão do curador — só aparece o que está rodando, não o ecossistema inteiro).
      const isDelivering = mode === "client"
        ? delivered > 0
        : (a.status === "active" || a.status === "dispatched" || a.status === "done");
      if (isDelivering) g.active.push(a);
      else if (a.status === "paused" || a.status === "failed" || a.status === "cancelled") g.paused.push(a);
      else g.pending.push(a);
    }
    g.active.sort((x, y) => (latestSnap.get(y.managed_playlist_id)?.plays_28d ?? 0) - (latestSnap.get(x.managed_playlist_id)?.plays_28d ?? 0));
    return g;
  }, [allocations, latestSnap, mode]);

  const groupsToRender: Group[] = mode === "client" ? ["active"] : ["active", "pending", "paused"];

  if (allocations.length === 0 || (mode === "client" && grouped.active.length === 0)) {
    const lastCapture = snapshots
      .map(s => new Date(s.captured_at).getTime())
      .sort((a, b) => b - a)[0];
    const nextMs = (lastCapture ?? Date.now()) + 2 * 24 * 60 * 60 * 1000;
    const nextLabel = new Date(nextMs).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
    return (
      <div className="text-sm text-muted-foreground py-10 text-center">
        Bot ainda não capturou dados — próxima coleta prevista em {nextLabel}.
      </div>
    );
  }


  if (flat) {
    const sorted = [...allocations].sort(
      (x, y) => (latestSnap.get(y.managed_playlist_id)?.plays_28d ?? 0) - (latestSnap.get(x.managed_playlist_id)?.plays_28d ?? 0),
    );
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {sorted.map((a) => (
          <PlaylistCard
            key={a.id}
            alloc={a}
            snap={latestSnap.get(a.managed_playlist_id)}
            thumb={latestThumb.get(a.managed_playlist_id)}
            position={positions?.get(a.id)}
            mode={mode}
            campaignId={campaignId}
            snapshotLocked={snapshotLocked}
            onSwapped={onSwapped}
          />
        ))}
      </div>
    );
  }


  return (
    <div className="space-y-6">
      {groupsToRender.map((g) => (
        <PlaylistGroup
          key={g}
          group={g}
          allocations={grouped[g]}
          latestSnap={latestSnap}
          latestThumb={latestThumb}
          positions={positions}
          mode={mode}
        />
      ))}
    </div>
  );
}

function PlaylistGroup({
  group, allocations, latestSnap, latestThumb, positions, mode,
}: {
  group: Group;
  allocations: EcoAllocation[];
  latestSnap: Map<string, EcoSnap>;
  latestThumb: Map<string, ProofThumb>;
  positions?: Map<string, number>;
  mode: "internal" | "client";
}) {
  const defaultOpen = group === "active" || allocations.length <= 5;
  const [open, setOpen] = useState(defaultOpen);

  if (allocations.length === 0) return null;

  return (
    <section>
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between text-left py-2 hover:opacity-80 transition-opacity"
      >
        <div className="flex items-center gap-2">
          {open ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
          <h3 className="text-sm font-semibold">{GROUP_LABEL[group]}</h3>
          <span className="text-xs text-muted-foreground tabular-nums">{allocations.length}</span>
        </div>
      </button>

      {open && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-2">
          {allocations.map((a) => (
            <PlaylistCard
              key={a.id}
              alloc={a}
              snap={latestSnap.get(a.managed_playlist_id)}
              thumb={latestThumb.get(a.managed_playlist_id)}
              position={positions?.get(a.id)}
              mode={mode}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function PlaylistCard({
  alloc, snap, thumb, position, mode,
}: {
  alloc: EcoAllocation;
  snap?: EcoSnap;
  thumb?: ProofThumb;
  position?: number;
  mode: "internal" | "client";
}) {
  const pl = alloc.managed_playlists;
  const delivered = snap?.plays_28d ?? snap?.plays_7d ?? 0;
  const pct = alloc.planned_streams > 0 ? Math.min(100, Math.round((Number(delivered) / alloc.planned_streams) * 100)) : 0;
  const delta24 = snap?.plays_24h ?? null;

  return (
    <Card className="p-3 hover:bg-elevated/30 transition-colors">
      <div className="flex items-start gap-3">
        {pl?.cover_url ? (
          <img src={pl.cover_url} alt="" className="w-12 h-12 rounded object-cover shrink-0" />
        ) : (
          <div className="w-12 h-12 rounded bg-muted grid place-items-center shrink-0">
            <Music className="h-4 w-4 text-muted-foreground" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="font-medium text-sm truncate leading-tight">{pl?.name ?? "—"}</div>
          <div className="text-[11px] text-muted-foreground tabular-nums mt-0.5">
            {formatInt(pl?.followers ?? 0)} saves
            {mode === "internal" && position != null && (
              <> · <span className="text-foreground font-semibold">#{position}</span></>
            )}
          </div>
        </div>
        {thumb?.screenshot_url && (
          <a href={thumb.screenshot_url} target="_blank" rel="noreferrer" className="shrink-0">
            <img src={thumb.screenshot_url} alt="" className="w-10 h-10 rounded object-cover border border-border hover:opacity-80 transition-opacity" />
          </a>
        )}
      </div>

      {/* Progresso */}
      <div className="mt-3">
        <div className="flex items-center justify-between text-[11px] mb-1">
          <span className="text-muted-foreground">Entrega</span>
          <span className="tabular-nums font-medium">
            {formatInt(Number(delivered))} <span className="text-muted-foreground">/ {formatInt(alloc.planned_streams)}</span>
          </span>
        </div>
        <div className="h-1 rounded-full bg-muted overflow-hidden">
          <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>

      {/* Footer: delta + ações */}
      <div className="mt-3 flex items-center justify-between text-[11px]">
        <Delta value={delta24} />
        <div className="flex items-center gap-1">
          {thumb && (
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <Camera className="h-3 w-3" /> última prova {timeAgo(thumb.captured_at)}
            </span>
          )}
          {pl?.spotify_url && (
            <a href={pl.spotify_url} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground ml-2">
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      </div>
    </Card>
  );
}

function Delta({ value }: { value: number | null }) {
  if (value == null || value === 0) {
    return <span className="inline-flex items-center gap-1 text-muted-foreground"><Minus className="h-3 w-3" /> —</span>;
  }
  if (value > 0) {
    return <span className="inline-flex items-center gap-1 text-primary"><TrendingUp className="h-3 w-3" /> +{formatInt(value)} <span className="text-muted-foreground">/24h</span></span>;
  }
  return <span className="inline-flex items-center gap-1 text-destructive"><TrendingDown className="h-3 w-3" /> {formatInt(value)}</span>;
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diff / 3_600_000);
  if (h < 1) return "agora";
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}
