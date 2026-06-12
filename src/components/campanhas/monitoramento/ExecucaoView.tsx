import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TrendingUp, Users, Layers, Activity, Search, Download, ArrowUpDown, Radio as RadioIcon } from "lucide-react";
import { formatInt } from "@/lib/campaignEngine";
import { cn } from "@/lib/utils";
import { useVirtualizer } from "@tanstack/react-virtual";
import { usePlaylistCovers, type PlaylistMeta } from "@/hooks/usePlaylistCovers";
import { PlaylistCell } from "./PlaylistCell";
import { KpiBig } from "@/components/KpiBig";
import { useIsMobile } from "@/hooks/use-mobile";
import { useRadioCollected } from "@/hooks/useRadioCollected";

type GrowthRow = {
  campaign_id: string;
  playlist_id: string;
  playlist_url: string | null;
  current_name: string | null;
  baseline_name: string | null;
  baseline_plays: number | null;
  current_plays: number | null;
  delta: number;
  last_import_delta: number | null;
  baseline_at: string | null;
  last_captured_at: string | null;
  first_seen_at: string | null;
  attributed_to: string;
  attributed_curator_id: string | null;
  is_baseline_conflict: boolean | null;
};

type CollectionRow = {
  playlist_id: string;
  playlist_url: string | null;
  playlist_name_at_capture: string | null;
  plays_7d: number | null;
  captured_at: string | null;
  is_baseline: boolean | null;
  first_seen_at: string | null;
  created_at: string | null;
  upload_id: string | null;
  excluded: boolean | null;
  window_days: number | null;
};

type UploadMeta = {
  id: string;
  created_at: string | null;
  reference_date: string | null;
  quarantined_at: string | null;
};

type AccRow = {
  delivery_accumulated: number;
  last_import_delta: number | null;
};

type CuratorMeta = { id: string; name: string | null };
type SortKey = "delta" | "current" | "baseline" | "name";

const ROW_H = 64;
const ROW_H_MOBILE = 56;

export function ExecucaoView({
  campaignId,
  onOpenHistory,
  mode = "all",
  tabsSlot,
}: {
  campaignId: string;
  onOpenHistory?: (playlistId: string) => void;
  mode?: "all" | "ecosystem" | "curators" | "organic";
  tabsSlot?: React.ReactNode;
}) {
  const initialScope: "all" | "ecosystem" | "curator" | "organic" =
    mode === "curators" ? "curator" : mode === "ecosystem" ? "ecosystem" : mode === "organic" ? "organic" : "all";
  const scopeLocked = mode !== "all";
  const [rows, setRows] = useState<GrowthRow[] | null>(null);
  const [curators, setCurators] = useState<Record<string, CuratorMeta>>({});
  const [statuses, setStatuses] = useState<Record<string, string>>({});

  // filters
  const [q, setQ] = useState("");
  const [scope, setScope] = useState<"all" | "ecosystem" | "curator" | "organic">(initialScope);
  const [curatorFilter, setCuratorFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sort, setSort] = useState<SortKey>("delta");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  useEffect(() => {
    let cancelled = false;
    const PAGE_SIZE = 1000;

    const fetchAllCollections = async () => {
      const out: CollectionRow[] = [];
      for (let from = 0; ; from += PAGE_SIZE) {
        const { data, error } = await supabase
          .from("campaign_playlist_collections")
          .select("playlist_id, playlist_url, playlist_name_at_capture, plays_7d, captured_at, is_baseline, first_seen_at, created_at, upload_id, excluded, window_days")
          .eq("campaign_id", campaignId)
          .order("created_at", { ascending: true })
          .range(from, from + PAGE_SIZE - 1);
        if (error) throw error;
        out.push(...((data ?? []) as CollectionRow[]));
        if ((data?.length ?? 0) < PAGE_SIZE) break;
      }
      return out;
    };

    const collectionSortKey = (r: CollectionRow, uploads: Map<string, UploadMeta>) => {
      const u = r.upload_id ? uploads.get(r.upload_id) : null;
      return `${u?.reference_date ?? r.captured_at?.slice(0, 10) ?? "0000-00-00"}|${u?.created_at ?? r.created_at ?? r.captured_at ?? ""}`;
    };

    const pickLatest = (items: CollectionRow[], uploads: Map<string, UploadMeta>) => {
      return [...items].sort((a, b) => collectionSortKey(b, uploads).localeCompare(collectionSortKey(a, uploads)))[0] ?? null;
    };

    const buildAccumulated = (
      collections: CollectionRow[],
      uploads: Map<string, UploadMeta>,
      allowed: Set<string>,
      canonicalWindowDays: number,
    ) => {
      const byPlaylist = new Map<string, CollectionRow[]>();
      for (const c of collections) {
        if (c.window_days !== canonicalWindowDays) continue;
        if (!c.is_baseline && !allowed.has(c.playlist_id)) continue;
        const arr = byPlaylist.get(c.playlist_id) ?? [];
        arr.push(c);
        byPlaylist.set(c.playlist_id, arr);
      }

      const acc = new Map<string, AccRow>();
      for (const [pid, list] of byPlaylist) {
        const ordered = [...list].sort((a, b) => collectionSortKey(a, uploads).localeCompare(collectionSortKey(b, uploads)));
        const hasBaseline = ordered.some((r) => !!r.is_baseline);
        let prev: number | null = null;
        let total = 0;
        let lastImportDelta: number | null = null;
        ordered.forEach((row, idx) => {
          const plays = Number(row.plays_7d ?? 0);
          const delta = idx === 0
            ? (hasBaseline ? 0 : plays)
            : Math.max(0, plays - (prev ?? plays));
          total += delta;
          lastImportDelta = idx === 0 && hasBaseline ? null : delta;
          prev = plays;
        });
        acc.set(pid, { delivery_accumulated: total, last_import_delta: lastImportDelta });
      }
      return acc;
    };

    (async () => {
      // ─────────────────────────────────────────────────────────────
      // FONTE DE VERDADE: campaign_playlist_collections + curator_campaign_playlists + campaign_eco_allocations
      // A tela calcula o crescimento localmente para não depender da view pesada que pode estourar timeout.
      // ─────────────────────────────────────────────────────────────
      try {
      const [campaignRes, collections, ccpRes, ecoRes] = await Promise.all([
        supabase.from("campaigns").select("canonical_window_days").eq("id", campaignId).maybeSingle(),
        fetchAllCollections(),
        supabase
          .from("curator_campaign_playlists")
          .select("playlist_id, curator_id, status, playlist_url, excluded_from_kpis")
          .eq("campaign_id", campaignId),
        supabase
          .from("campaign_eco_allocations")
          .select("managed_playlist_id, managed_playlists!inner(spotify_playlist_id)")
          .eq("campaign_id", campaignId),
      ]);

      const uploadIds = Array.from(new Set(collections.map((c) => c.upload_id).filter((id): id is string => !!id)));
      const { data: uploadRows, error: uploadErr } = uploadIds.length > 0
        ? await supabase
          .from("label_spreadsheet_uploads")
          .select("id, created_at, reference_date, quarantined_at")
          .in("id", uploadIds)
        : { data: [] as UploadMeta[], error: null };
      if (uploadErr) throw uploadErr;

      const uploads = new Map<string, UploadMeta>(((uploadRows ?? []) as UploadMeta[]).map((u) => [u.id, u]));
      const validCollections = collections.filter((c) => {
        if (c.excluded) return false;
        const u = c.upload_id ? uploads.get(c.upload_id) : null;
        return !u?.quarantined_at;
      });

      // Conjunto canônico de playlist_ids da campanha
      const collIds = new Set<string>(validCollections.map((r) => r.playlist_id));
      const curatorRegByPlaylist = new Map<string, { curator_id: string; status: string; playlist_url: string | null; excluded_from_kpis: boolean | null }>();
      for (const r of (ccpRes.data ?? []) as any[]) {
        // precedência: matched > pending_match > baseline_conflict > resto
        const cur = curatorRegByPlaylist.get(r.playlist_id);
        const rank = (s: string) => (s === "matched" ? 1 : s === "pending_match" ? 2 : s === "baseline_conflict" ? 3 : 4);
        if (!cur || rank(r.status) < rank(cur.status)) {
          curatorRegByPlaylist.set(r.playlist_id, { curator_id: r.curator_id, status: r.status, playlist_url: r.playlist_url, excluded_from_kpis: r.excluded_from_kpis ?? false });
        }
      }
      const ecoIds = new Set<string>(
        ((ecoRes.data ?? []) as any[])
          .map((r) => r.managed_playlists?.spotify_playlist_id)
          .filter(Boolean)
      );

      const candidateOwnedIds = Array.from(new Set([...collIds, ...curatorRegByPlaylist.keys()].filter(Boolean)));
      const { data: ownedRows } = candidateOwnedIds.length > 0
        ? await supabase
          .from("managed_playlists")
          .select("spotify_playlist_id")
          .in("spotify_playlist_id", candidateOwnedIds)
        : { data: [] as any[] };
      const internalOwnedIds = new Set<string>(
        ((ownedRows ?? []) as any[])
          .map((r) => r.spotify_playlist_id)
          .filter(Boolean)
      );

      const allIds = new Set<string>([
        ...collIds,
        ...curatorRegByPlaylist.keys(),
        ...ecoIds,
      ]);

      const byPlaylist = new Map<string, CollectionRow[]>();
      for (const c of validCollections) {
        const arr = byPlaylist.get(c.playlist_id) ?? [];
        arr.push(c);
        byPlaylist.set(c.playlist_id, arr);
      }
      const allowedForAcc = new Set<string>([
        ...Array.from(curatorRegByPlaylist.entries())
          .filter(([, r]) => !r.excluded_from_kpis)
          .map(([pid]) => pid),
        ...ecoIds,
        ...validCollections.filter((c) => !!c.is_baseline).map((c) => c.playlist_id),
      ]);
      const canonicalWindowDays = Number((campaignRes.data as any)?.canonical_window_days ?? 7);
      const accumulated = buildAccumulated(validCollections, uploads, allowedForAcc, canonicalWindowDays);

      // Materializar lista canônica usando as coletas já importadas como fonte oficial.
      const list: GrowthRow[] = [];
      for (const pid of allIds) {
        const collected = byPlaylist.get(pid) ?? [];
        const baseline = pickLatest(collected.filter((c) => !!c.is_baseline), uploads);
        const latest = pickLatest(collected, uploads);
        const firstSeenAt = collected.reduce<string | null>((min, c) => {
          const v = c.first_seen_at ?? c.captured_at ?? null;
          if (!v) return min;
          return !min || v < min ? v : min;
        }, null);
        const acc = accumulated.get(pid);
        const reg = curatorRegByPlaylist.get(pid);
        const attribution: string = (ecoIds.has(pid) || internalOwnedIds.has(pid))
          ? "ecosystem"
          : (reg && (!reg.excluded_from_kpis || reg.status === "baseline_conflict") ? `curator:${reg.curator_id}` : "organic");
        const curatorId = attribution.startsWith("curator:")
          ? (reg?.curator_id ?? null)
          : null;
        if (latest || baseline) {
          list.push({
            campaign_id: campaignId,
            playlist_id: pid,
            playlist_url: latest?.playlist_url ?? baseline?.playlist_url ?? reg?.playlist_url ?? null,
            current_name: latest?.playlist_name_at_capture ?? baseline?.playlist_name_at_capture ?? null,
            baseline_name: baseline?.playlist_name_at_capture ?? null,
            baseline_plays: baseline?.plays_7d ?? null,
            current_plays: latest?.plays_7d ?? null,
            delta: acc?.delivery_accumulated ?? 0,
            last_import_delta: acc?.last_import_delta ?? null,
            baseline_at: baseline?.captured_at ?? null,
            last_captured_at: latest?.captured_at ?? null,
            first_seen_at: firstSeenAt,
            attributed_to: attribution,
            attributed_curator_id: curatorId,
            is_baseline_conflict: reg?.status === "baseline_conflict" ? true : null,
          });
        } else {
          // Playlist vinculada à campanha mas SEM coleta ainda. Aparece com "Sem dados".
          list.push({
            campaign_id: campaignId,
            playlist_id: pid,
            playlist_url: reg?.playlist_url ?? null,
            current_name: null,
            baseline_name: null,
            baseline_plays: null,
            current_plays: null,
            delta: 0,
            last_import_delta: null,
            baseline_at: null,
            last_captured_at: null,
            first_seen_at: null,
            attributed_to: attribution,
            attributed_curator_id: curatorId,
            is_baseline_conflict: reg?.status === "baseline_conflict" ? true : null,
          });
        }
      }
      if (cancelled) return;
      setRows(list);

      // Curadores: pegar TODOS os curadores vinculados à campanha (não só os com crescimento)
      const allCuratorIds = Array.from(new Set(list.map((r) => r.attributed_curator_id).filter((id): id is string => !!id)));
      if (allCuratorIds.length > 0) {
        const { data: cs } = await supabase.from("curators").select("id, name").in("id", allCuratorIds);
        const cmap: Record<string, CuratorMeta> = {};
        for (const c of (cs ?? []) as CuratorMeta[]) cmap[c.id] = c;
        setCurators(cmap);
      } else {
        setCurators({});
      }

      // Statuses por curador::playlist (TODOS os registros de curator_campaign_playlists)
      const smap: Record<string, string> = {};
      for (const s of (ccpRes.data ?? []) as any[]) {
        smap[`${s.curator_id}::${s.playlist_id}`] = s.status;
      }
      setStatuses(smap);

      // ── LOG DE VALIDAÇÃO ──────────────────────────────────────
      const totalEco = list.filter((r) => r.attributed_to === "ecosystem").length;
      const totalCur = list.filter((r) => r.attributed_to.startsWith("curator:")).length;
      const totalOrg = list.filter((r) => r.attributed_to === "organic").length;
      const totalNoData = list.filter((r) => r.baseline_plays == null && r.current_plays == null).length;
      // eslint-disable-next-line no-console
      console.log("[Monitoramento V2] Fonte de verdade", {
        campaign_id: campaignId,
        total_collections_distinct: collIds.size,
        total_curator_reg_distinct: curatorRegByPlaylist.size,
        total_eco_alloc_distinct: ecoIds.size,
        total_canonical: allIds.size,
        total_renderizado: list.length,
        breakdown: { ecossistema: totalEco, curadores: totalCur, organico: totalOrg },
        soma_buckets: totalEco + totalCur + totalOrg,
        sem_dados: totalNoData,
        match_buckets_total: totalEco + totalCur + totalOrg === list.length,
      });
      if (allIds.size !== list.length) {
        console.warn("[Monitoramento V2] DIVERGÊNCIA: canônico !== renderizado", {
          canonical: allIds.size,
          rendered: list.length,
        });
      }
      } catch (error) {
        console.error("[Monitoramento V2] Falha ao carregar execução", error);
        if (!cancelled) setRows([]);
      }
    })();
    return () => { cancelled = true; };
  }, [campaignId]);

  const totals = useMemo(() => {
    const t = { total: 0, eco: 0, curator: 0, organic: 0, conflict: 0, conflictCount: 0, n: rows?.length ?? 0 };
    for (const r of rows ?? []) {
      const d = Number(r.delta ?? 0);
      // Baseline conflict: NÃO é entrega válida. Não soma como crescimento da campanha
      // nem como crescimento de curador. Fica isolado num bucket próprio (informativo).
      if (r.is_baseline_conflict) {
        t.conflict += d;
        t.conflictCount += 1;
        continue;
      }
      t.total += d;
      if (r.attributed_to === "ecosystem") t.eco += d;
      else if (r.attributed_to.startsWith("curator:")) t.curator += d;
      else t.organic += d;
    }
    return t;
  }, [rows]);

  // Predicado dos filtros NÃO-textuais (atribuição/curador/status). Usado em
  // `filtered` (lista renderizada) e em `searchSuggestions` (autocomplete do
  // input "Buscar playlist..." — só sugere playlists que já estão na campanha
  // e que respeitam os filtros atuais).
  const passesNonQuery = (r: GrowthRow): boolean => {
    const ecosystemPillActive = curatorFilter === "__ecosystem__";
    if (ecosystemPillActive) {
      if (r.attributed_to !== "ecosystem") return false;
    } else {
      if (scope === "ecosystem" && r.attributed_to !== "ecosystem") return false;
      if (scope === "curator" && !r.attributed_to.startsWith("curator:")) return false;
      if (scope === "organic" && (r.attributed_to === "ecosystem" || r.attributed_to.startsWith("curator:"))) return false;
      if (curatorFilter !== "all" && r.attributed_curator_id !== curatorFilter) return false;
    }
    if (statusFilter !== "all") {
      const hasData = r.baseline_plays != null || r.current_plays != null;
      if (statusFilter === "no_data") {
        if (hasData) return false;
      } else if (statusFilter === "pre_campaign") {
        if (!r.attributed_to.startsWith("curator:")) return false;
        if (!(Number(r.baseline_plays ?? 0) > 0)) return false;
      } else {
        const st = r.attributed_curator_id ? statuses[`${r.attributed_curator_id}::${r.playlist_id}`] ?? "pending_match" : null;
        if (st !== statusFilter) return false;
      }
    }
    return true;
  };

  const filtered = useMemo(() => {
    if (!rows) return [];
    const qn = q.trim().toLowerCase();
    let out = rows.filter((r) => {
      if (!passesNonQuery(r)) return false;
      if (qn) {
        const name = (r.current_name ?? r.baseline_name ?? "").toLowerCase();
        if (!name.includes(qn) && !r.playlist_id.toLowerCase().includes(qn)) return false;
      }
      return true;
    });
    const dir = sortDir === "asc" ? 1 : -1;
    const pick = (r: GrowthRow): [number | string, number, number] => {
      const cur = Number(r.current_plays ?? 0);
      const base = Number(r.baseline_plays ?? 0);
      const del = Number(r.delta ?? 0);
      const primary = sort === "delta" ? del
        : sort === "current" ? cur
        : sort === "baseline" ? base
        : (r.current_name ?? r.baseline_name ?? "").toLowerCase();
      return [primary, cur, base];
    };
    out.sort((a, b) => {
      const [pa, ca, ba] = pick(a);
      const [pb, cb, bb] = pick(b);
      if (pa < pb) return -1 * dir;
      if (pa > pb) return 1 * dir;
      // tiebreakers: sempre desc (mais relevante primeiro), independente da direção
      if (cb !== ca) return cb - ca;
      return bb - ba;
    });
    return out;
  }, [rows, q, scope, curatorFilter, statusFilter, sort, sortDir, statuses]);

  const filteredTotals = useMemo(() => {
    return filtered.reduce(
      (acc, r) => {
        acc.baseline += Number(r.baseline_plays ?? 0);
        acc.current += Number(r.current_plays ?? 0);
        acc.delta += Number(r.delta ?? 0);
        return acc;
      },
      { baseline: 0, current: 0, delta: 0 }
    );
  }, [filtered]);

  // Covers/nomes enriquecidos pra todas as playlists da campanha — usados no
  // dropdown do "Buscar playlist" pra mostrar nome real + thumb mesmo quando
  // current_name/baseline_name vierem nulos do bot.
  const allPlaylistIds = useMemo(() => (rows ?? []).map((r) => r.playlist_id), [rows]);
  const allCovers = usePlaylistCovers(allPlaylistIds);

  // Sugestões do input "Buscar playlist": só playlists já cadastradas na
  // campanha que respeitam os filtros ativos (atribuição/curador/status),
  // filtradas por substring do texto digitado. Limita a 50 pra não pesar.
  const searchSuggestions = useMemo(() => {
    if (!rows) return [] as { id: string; name: string; cover: string | null }[];
    const qn = q.trim().toLowerCase();
    const seen = new Set<string>();
    const out: { id: string; name: string; cover: string | null }[] = [];
    for (const r of rows) {
      if (!passesNonQuery(r)) continue;
      if (seen.has(r.playlist_id)) continue;
      const meta = allCovers[r.playlist_id];
      const name = r.current_name ?? r.baseline_name ?? meta?.name ?? r.playlist_id;
      if (qn) {
        const hay = (name + " " + r.playlist_id).toLowerCase();
        if (!hay.includes(qn)) continue;
      }
      seen.add(r.playlist_id);
      out.push({ id: r.playlist_id, name, cover: meta?.cover_url ?? null });
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out.slice(0, 50);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, q, scope, curatorFilter, statusFilter, statuses, allCovers]);
  const [searchOpen, setSearchOpen] = useState(false);

  const curatorOptions = useMemo(
    () =>
      Object.values(curators)
        .map((c) => ({ id: c.id, name: c.name ?? "Curador" }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [curators]
  );

  const exportCsv = () => {
    const head = ["playlist_id", "playlist", "atribuicao", "curador", "status", "baseline", "atual", "delta_acumulada", "ultima_importacao", "first_seen", "ultima_coleta"];
    const lines = [head.join(",")];
    for (const r of filtered) {
      const cur = r.attributed_curator_id ? curators[r.attributed_curator_id]?.name ?? "" : "";
      const st = r.attributed_curator_id ? statuses[`${r.attributed_curator_id}::${r.playlist_id}`] ?? "" : "";
      const name = (r.current_name ?? r.baseline_name ?? "").replace(/"/g, '""');
      lines.push(
        [
          r.playlist_id,
          `"${name}"`,
          r.attributed_to,
          `"${cur}"`,
          st,
          r.baseline_plays ?? 0,
          r.current_plays ?? 0,
          r.delta,
          r.last_import_delta ?? "",
          r.first_seen_at ?? "",
          r.last_captured_at ?? "",
        ].join(",")
      );
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `execucao-${campaignId.slice(0, 8)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const lastCapturedAt = useMemo(() => {
    let latest: string | null = null;
    for (const r of rows ?? []) {
      if (r.last_captured_at && (!latest || r.last_captured_at > latest)) latest = r.last_captured_at;
    }
    return latest;
  }, [rows]);

  const isEcosystem = mode === "ecosystem";

  // Linha virtual da Rádio Spotify (só na aba Ecossistema da visão interna).
  // Lê campaign_radio_collected — não altera engine, snapshot nem financeiro.
  // Nunca renderizada em portal do cliente ou compartilhamento público
  // porque esta view (ExecucaoView) só vive dentro do hub interno da campanha.
  const { data: radioData } = useRadioCollected(isEcosystem ? campaignId : undefined);

  if (!rows) return <Skeleton className="h-96 w-full" />;

  const hasRadio = isEcosystem && !!radioData && (
    (radioData.start_plays_7d ?? 0) > 0 || (radioData.current_plays_7d ?? 0) > 0
  );
  const radioRow: GrowthRow | null = hasRadio && radioData ? {
    campaign_id: campaignId,
    playlist_id: "__radio__",
    playlist_url: null,
    current_name: "Rádio Spotify",
    baseline_name: "Rádio Spotify",
    baseline_plays: radioData.start_plays_7d ?? 0,
    current_plays: radioData.current_plays_7d ?? 0,
    delta: radioData.radio_delta ?? 0,
    last_import_delta: null,
    baseline_at: radioData.start_captured_at,
    last_captured_at: radioData.last_captured_at,
    first_seen_at: radioData.start_captured_at,
    attributed_to: "radio",
    attributed_curator_id: null,
    is_baseline_conflict: false,
  } : null;

  const displayRows = radioRow ? [radioRow, ...filtered] : filtered;
  const displayTotals = radioRow ? {
    baseline: filteredTotals.baseline + (radioRow.baseline_plays ?? 0),
    current: filteredTotals.current + (radioRow.current_plays ?? 0),
    delta: filteredTotals.delta + (radioRow.delta ?? 0),
  } : filteredTotals;


  const filtersBar = (
    <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:flex-wrap">
      {!isEcosystem && (
        <div className="relative w-full sm:flex-1 sm:min-w-[180px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground z-10" />
          <Input
            value={q}
            onChange={(e) => { setQ(e.target.value); setSearchOpen(true); }}
            onFocus={() => setSearchOpen(true)}
            onBlur={() => { setTimeout(() => setSearchOpen(false), 150); }}
            placeholder="Buscar playlist..."
            className="pl-8 h-9"
          />
          {searchOpen && (
            <div className="absolute z-50 left-0 right-0 top-full mt-1 rounded-lg border border-border bg-card shadow-lg max-h-72 overflow-y-auto">
              {searchSuggestions.length === 0 ? (
                <div className="px-3 py-2 text-xs text-muted-foreground">
                  Nenhuma playlist encontrada nos filtros atuais.
                </div>
              ) : (
                searchSuggestions.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onMouseDown={(e) => { e.preventDefault(); setQ(s.name); setSearchOpen(false); }}
                    className="block w-full text-left px-3 py-2 text-sm hover:bg-elevated/60 truncate"
                  >
                    {s.name}
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      )}
      <div className="grid grid-cols-2 gap-2 sm:contents">
        {!scopeLocked && (
          <Select value={scope} onValueChange={(v) => setScope(v as any)}>
            <SelectTrigger className="h-9 w-full sm:w-[180px] sm:shrink-0"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas atribuições</SelectItem>
              <SelectItem value="ecosystem">Ecossistema</SelectItem>
              <SelectItem value="curator">Curadores</SelectItem>
              <SelectItem value="organic">Orgânico</SelectItem>
            </SelectContent>
          </Select>
        )}
        {(mode === "all" || mode === "curators") && (
          <Select value={curatorFilter} onValueChange={setCuratorFilter}>
            <SelectTrigger className="h-9 w-full sm:w-[180px] sm:shrink-0"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos curadores</SelectItem>
              {curatorOptions.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {!isEcosystem && (
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-9 w-full sm:w-[160px] sm:shrink-0"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos status</SelectItem>
              <SelectItem value="matched">Matched</SelectItem>
              <SelectItem value="pending_match">Pending</SelectItem>
              <SelectItem value="pre_campaign">Pré-campanha (subir posição)</SelectItem>
              <SelectItem value="baseline_conflict">Conflito baseline</SelectItem>
              <SelectItem value="not_found_yet">Not found</SelectItem>
              <SelectItem value="no_data">Sem dados</SelectItem>
            </SelectContent>
          </Select>
        )}
        <Button
          variant="outline"
          size="sm"
          aria-label="Exportar CSV"
          className="h-9 w-full sm:w-auto sm:px-3 sm:shrink-0 sm:ml-auto"
          onClick={exportCsv}
        >
          <Download className="h-4 w-4 sm:mr-1.5" />
          <span className="hidden sm:inline">Exportar CSV</span>
          <span className="sm:hidden ml-1.5">CSV</span>
        </Button>
      </div>
    </div>
  );



  return (
    <div className="space-y-4">
      {/* Hero KPI — número gigante de crescimento + métricas secundárias horizontais */}
      <HeroGrowth
        mode={mode}
        totals={totals}
        filteredCount={filtered.length}
        lastCapturedAt={lastCapturedAt}
        radioDelta={radioRow?.delta ?? 0}
        hasRadio={hasRadio}
      />

      {/* Tabs — entre os dois cards (slot vindo do MonitoramentoTab) */}
      {tabsSlot}

      {/* RESULTADO DA CAMPANHA — Atual / Variação / Playlists + sparkline (apenas Visão geral) */}
      {mode === "all" && (
        <Card>
          <CardContent className="p-3 md:p-4 lg:px-5 lg:py-3.5">
            <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground font-semibold mb-2 md:mb-2.5">
              Resultado da campanha
            </div>
            <div className="flex flex-col lg:flex-row lg:items-center gap-3 md:gap-5 lg:gap-6 lg:divide-x lg:divide-border/50">
              <div className="grid grid-cols-3 gap-2 md:gap-8 flex-1">
                <div className="flex flex-col gap-0.5 md:gap-1">
                  <span className="text-[10px] md:text-[11px] text-muted-foreground">Atual</span>
                  <span className="text-[16px] sm:text-[18px] lg:text-[20px] font-medium tabular-nums text-foreground leading-none">
                    {formatInt(filteredTotals.current)}
                  </span>
                </div>
                <div className="flex flex-col gap-0.5 md:gap-1">
                  <span className="text-[10px] md:text-[11px] text-muted-foreground">Variação</span>
                  <span className={cn(
                    "text-[16px] sm:text-[18px] lg:text-[20px] font-medium tabular-nums leading-none",
                    filteredTotals.delta > 0 ? "text-primary" : "text-foreground",
                  )}>
                    {filteredTotals.delta > 0 ? "+" : ""}{formatInt(filteredTotals.delta)}
                  </span>
                </div>
                <div className="flex flex-col gap-0.5 md:gap-1">
                  <span className="text-[10px] md:text-[11px] text-muted-foreground leading-tight">Playlists<span className="hidden md:inline"> monitoradas</span></span>
                  <span className="text-[16px] sm:text-[18px] lg:text-[20px] font-medium tabular-nums text-foreground leading-none">
                    {formatInt(filtered.length)}
                  </span>
                </div>
              </div>
              <div className="w-full lg:w-[360px] shrink-0 lg:pl-6">
                <GrowthSparkline />
              </div>
            </div>
          </CardContent>
        </Card>


      )}

      {totals.conflictCount > 0 && mode === "all" && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="p-3 flex items-start gap-3">
            <span className="mt-0.5 h-2 w-2 rounded-full bg-destructive shrink-0" />
            <div className="text-[12px] text-foreground-body leading-relaxed">
              <strong className="text-destructive">Conflito de baseline:</strong>{" "}
              {totals.conflictCount} playlist(s) já continham a música antes do início da campanha.
              Não contam como entrega válida e foram excluídas dos totais de Curadores/Ecossistema.
              {totals.conflict !== 0 && (
                <> O Δ observado nelas ({totals.conflict > 0 ? "+" : ""}{formatInt(totals.conflict)}) reflete apenas ganho de posição, não entrega nova.</>
              )}
              {" "}Use o filtro <em>Status → Conflito baseline</em> para auditar.
            </div>
          </CardContent>
        </Card>
      )}

      {/* Aba Curadores: KPI tiles no topo (Playlists/Matched/Pending/Conflito/Δ) */}
      {mode === "curators" && (
        <CuratorTiles
          rows={rows}
          curators={curators}
          statuses={statuses}
          curatorFilter={curatorFilter}
          statusFilter={statusFilter}
          onToggleStatus={(st) => setStatusFilter((prev) => (prev === st ? "all" : st))}
        />
      )}

      {/* Filtros — só renderiza nas abas Visão geral / Orgânico. Ecossistema e Curadores usam superfícies próprias. */}
      {!isEcosystem && mode !== "curators" && filtersBar}

      {/* Header da tabela */}
      <div>
        {mode === "curators" ? (
          /* Curadores: pílulas de curador à esquerda + Exportar CSV à direita. Sem régua "X playlists / Atual / Δ" (já está nos KPI tiles acima). */
          <div className="flex items-center justify-between gap-3 mb-2 px-1">
            <CuratorPills
              rows={rows}
              curators={curators}
              statuses={statuses}
              curatorFilter={curatorFilter}
              campaignId={campaignId}
              onPickCurator={(id) => {
                if (!scopeLocked) setScope("curator");
                setCuratorFilter(id);
              }}
            />
            <Button variant="outline" size="sm" className="h-8 px-3 text-[11px] shrink-0" onClick={exportCsv}>
              <Download className="h-3.5 w-3.5 mr-1.5" /> Exportar CSV
            </Button>
          </div>
        ) : (
          <div className="flex items-end justify-between gap-4 mb-2 px-1">
            <div className="text-[13px] text-foreground font-semibold tabular-nums">
              {displayRows.length} {displayRows.length === 1 ? "linha" : "linhas"}
            </div>
            <div className="flex items-center gap-4 md:gap-6 text-[11px] tabular-nums">
              <span className="text-muted-foreground">Atual <span className="text-foreground font-semibold">{formatInt(displayTotals.current)}</span></span>
              <span className="text-muted-foreground">Δ <span className={cn(
                "font-semibold",
                displayTotals.delta > 0 ? "text-primary" : "text-muted-foreground",
              )}>
                {displayTotals.delta > 0 ? "+" : ""}{formatInt(displayTotals.delta)}
              </span></span>
              {isEcosystem && (
                <Button variant="outline" size="sm" className="h-7 px-2.5 text-[11px]" onClick={exportCsv}>
                  <Download className="h-3.5 w-3.5 mr-1.5" /> Exportar CSV
                </Button>
              )}
            </div>
          </div>
        )}




        <Card>
          <CardContent className="p-0">
            <VirtualTable
              rows={displayRows}
              curators={curators}
              statuses={statuses}
              sort={sort}
              sortDir={sortDir}
              onSort={(k) => {
                if (sort === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
                else { setSort(k); setSortDir("desc"); }
              }}
              onRowClick={(pid) => { if (pid !== "__radio__") onOpenHistory?.(pid); }}
            />
          </CardContent>
        </Card>
      </div>

    </div>
  );
}

/** Sparkline puramente decorativa (linha verde subindo) — visual placeholder do mockup. */
function GrowthSparkline() {
  const points = [10, 18, 16, 28, 24, 36, 34, 48, 56, 52, 70, 78, 92];
  const w = 420;
  const h = 100;
  const stepX = w / (points.length - 1);
  const maxY = Math.max(...points);
  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${i * stepX} ${h - (p / maxY) * (h - 10) - 4}`)
    .join(" ");
  const areaPath = `${path} L ${w} ${h} L 0 ${h} Z`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-[100px]" preserveAspectRatio="none">
      <defs>
        <linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.25" />
          <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill="url(#sparkFill)" />
      <path d={path} fill="none" stroke="hsl(var(--primary))" strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" />
      {points.map((p, i) => (
        <circle
          key={i}
          cx={i * stepX}
          cy={h - (p / maxY) * (h - 10) - 4}
          r={i === points.length - 1 ? 3.5 : 2}
          fill="hsl(var(--primary))"
        />
      ))}
    </svg>
  );
}



/**
 * Hero KPI — número gigante de crescimento (56-72px) +
 * métricas secundárias (Ecossistema / Curadores / Orgânico) horizontais.
 */
function HeroGrowth({
  mode,
  totals,
  filteredCount,
  lastCapturedAt,
  radioDelta = 0,
  hasRadio = false,
}: {
  mode: "all" | "ecosystem" | "curators" | "organic";
  totals: { total: number; eco: number; curator: number; organic: number; n: number };
  filteredCount: number;
  lastCapturedAt: string | null;
  radioDelta?: number;
  hasRadio?: boolean;
}) {
  // Ecossistema interno: layout 3 colunas (Playlists / Rádio / Total)
  // Rádio só aparece quando a campanha realmente tem entrega de rádio coletada.
  if (mode === "ecosystem") {
    const playlistsDelta = totals.eco;
    const totalDelta = playlistsDelta + (hasRadio ? radioDelta : 0);
    return (
      <Card>
        <CardContent className="p-0">
          <div className={cn(
            "grid divide-y lg:divide-y-0 lg:divide-x divide-border/50",
            hasRadio ? "grid-cols-1 lg:grid-cols-3" : "grid-cols-1 lg:grid-cols-2",
          )}>
            <SecondaryMetric icon={Layers} label="Playlists" value={playlistsDelta} />
            {hasRadio && <SecondaryMetric icon={RadioIcon} label="Rádio" value={radioDelta} />}
            <SecondaryMetric icon={Activity} label="Total" value={totalDelta} />
          </div>
        </CardContent>
      </Card>
    );
  }

  const heroValue =
    mode === "curators" ? totals.curator
    : mode === "organic" ? totals.organic
    : totals.total;

  const heroLabel =
    mode === "curators" ? "Crescimento curadores"
    : mode === "organic" ? "Crescimento orgânico"
    : "Crescimento total";

  const sign = heroValue > 0 ? "+" : heroValue < 0 ? "" : "";
  const valueClass = heroValue > 0 ? "text-primary" : heroValue < 0 ? "text-destructive" : "text-foreground";

  return (
    <Card>
      <CardContent className="p-0">
        <div
          className={cn(
            "grid divide-y lg:divide-y-0 lg:divide-x divide-border/50",
            mode === "all" ? "grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr]" : "grid-cols-1",
          )}
        >
          {/* Hero principal — número fino premium + label embaixo */}
          <div className={cn(
            "px-4 py-3 md:px-5 md:py-3.5 lg:py-4 flex flex-col justify-center",
            mode === "all" && "col-span-2 lg:col-span-1 border-b border-border/50 lg:border-b-0",
          )}>
            <div
              className={cn(
                "tabular-nums leading-none tracking-tight",
                "text-[28px] md:text-[32px] lg:text-[34px] font-medium",
                valueClass,
              )}
            >
              {sign}{formatInt(heroValue)}
            </div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground font-semibold mt-2 flex items-center gap-1.5">
              {heroLabel}
              <Activity className="h-3 w-3 text-primary/60 animate-pulse" />
            </div>
          </div>


          {/* 3 colunas secundárias com divisores verticais — só na visão geral */}
          {mode === "all" && (
            <>
              <SecondaryMetric icon={Layers} label="Ecossistema" value={totals.eco} />
              <SecondaryMetric icon={Users} label="Curadores" value={totals.curator} />
              <SecondaryMetric icon={Activity} label="Orgânico" value={totals.organic} className="col-span-2 lg:col-span-1 border-t border-border/50 lg:border-t-0" />
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function SecondaryMetric({
  icon: Icon,
  label,
  value,
  className,
}: {
  icon: any;
  label: string;
  value: number;
  className?: string;
}) {
  const sign = value > 0 ? "+" : "";
  return (
    <div className={cn("px-4 py-3 md:px-5 md:py-3.5 lg:py-4 flex flex-col justify-center", className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] md:text-[12px] text-muted-foreground font-normal">
          {label}
        </span>
        <Icon className="h-3.5 w-3.5 text-muted-foreground/60" />
      </div>
      <div className="text-[16px] md:text-[18px] lg:text-[20px] font-medium tabular-nums text-foreground leading-none mt-1.5 md:mt-2">
        {sign}{formatInt(value)}
      </div>
    </div>

  );
}





function VirtualTable({
  rows,
  curators,
  statuses,
  sort,
  sortDir,
  onSort,
  onRowClick,
}: {
  rows: GrowthRow[];
  curators: Record<string, CuratorMeta>;
  statuses: Record<string, string>;
  sort: SortKey;
  sortDir: "asc" | "desc";
  onSort: (k: SortKey) => void;
  onRowClick?: (playlistId: string) => void;
}) {
  const isMobile = useIsMobile();
  const parentRef = useRef<HTMLDivElement>(null);
  const covers = usePlaylistCovers(rows.map((r) => r.playlist_id));
  const rowH = isMobile ? ROW_H_MOBILE : ROW_H;

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowH,
    overscan: 12,
  });

  if (rows.length === 0) {
    return <div className="p-8 text-center text-muted-foreground">Sem playlists para os filtros atuais.</div>;
  }

  return (
    <div>
      {/* Header — só desktop. Mobile usa layout em linha sem cabeçalho. */}
      <div className="hidden md:grid grid-cols-[44px_minmax(220px,2fr)_120px_100px_100px_110px_120px_130px_150px] gap-3 px-4 py-2.5 text-[10px] uppercase tracking-[0.08em] text-muted-foreground border-b border-border bg-card/40">
        <div className="text-right">#</div>
        <SortHeader label="Playlist" k="name" sort={sort} dir={sortDir} onSort={onSort} />
        <div>Atribuição</div>
        <SortHeader label="Baseline" k="baseline" sort={sort} dir={sortDir} onSort={onSort} className="text-right justify-end" />
        <SortHeader label="Atual" k="current" sort={sort} dir={sortDir} onSort={onSort} className="text-right justify-end" />
        <SortHeader label="Δ Acumulada" k="delta" sort={sort} dir={sortDir} onSort={onSort} className="text-right justify-end" />
        <div className="text-right" title="Entrega capturada na importação válida mais recente em relação à anterior. Mostra '—' quando há apenas uma importação.">Última Importação</div>
        <div>Status</div>
        <div>Última coleta</div>
      </div>

      <div
        ref={parentRef}
        className="overflow-auto"
        style={{ height: Math.min(640, Math.max(240, rows.length * rowH + 8)) }}
      >
        <div style={{ height: virtualizer.getTotalSize(), position: "relative", width: "100%" }}>
          {virtualizer.getVirtualItems().map((vi) => {
            const r = rows[vi.index];
            const meta: PlaylistMeta | undefined = covers[r.playlist_id];
            const curName = r.attributed_curator_id ? curators[r.attributed_curator_id]?.name ?? "Curador" : null;
            const st = r.attributed_curator_id ? statuses[`${r.attributed_curator_id}::${r.playlist_id}`] ?? "pending_match" : null;
            const isEven = vi.index % 2 === 0;
            const baseStyle: React.CSSProperties = {
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              height: vi.size,
              transform: `translateY(${vi.start}px)`,
            };

            if (isMobile) {
              return (
                <div
                  key={vi.key}
                  onClick={() => onRowClick?.(r.playlist_id)}
                  className={cn(
                    "flex items-center gap-2.5 px-3 border-b border-border/40 hover:bg-accent/40 transition-colors",
                    isEven ? "bg-transparent" : "bg-card/30",
                    onRowClick && "cursor-pointer",
                  )}
                  style={baseStyle}
                >
                  <div className="w-5 text-right tabular-nums text-[10px] text-muted-foreground font-mono shrink-0">
                    {vi.index + 1}
                  </div>
                  <MobileCover
                    playlistId={r.playlist_id}
                    url={r.playlist_url}
                    coverUrl={meta?.cover_url ?? null}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium text-foreground truncate leading-tight">
                      {r.current_name ?? r.baseline_name ?? meta?.name ?? "—"}
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5 text-[10px] text-muted-foreground min-w-0">
                      <AttributionDot attr={r.attributed_to} />
                      <span className="truncate">
                        {r.attributed_to === "ecosystem"
                          ? "Ecossistema"
                          : r.attributed_to.startsWith("curator:")
                            ? curName ?? "Curador"
                            : "Orgânico"}
                      </span>
                      {meta?.followers != null && (
                        <>
                          <span aria-hidden>·</span>
                          <span className="tabular-nums">{Intl.NumberFormat("pt-BR").format(meta.followers)}</span>
                        </>
                      )}
                      {r.attributed_to.startsWith("curator:") && Number(r.baseline_plays ?? 0) > 0 && (
                        <span
                          className="ml-1 shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wide border border-amber-500/40 text-amber-400 bg-amber-500/5"
                          title="Música já estava nesta playlist antes da campanha. Curador deve subir a posição."
                        >
                          subir posição
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-right shrink-0 leading-tight">
                    <div
                      className={cn(
                        "text-[13px] font-semibold tabular-nums",
                        Number(r.delta) > 0 ? "text-primary" : "text-muted-foreground",
                      )}
                    >
                      {r.baseline_plays == null && r.current_plays == null ? "—" : (Number(r.delta) > 0 ? "+" : "") + formatInt(Number(r.delta ?? 0))}
                    </div>
                    <div className="text-[10px] text-muted-foreground tabular-nums mt-0.5">
                      {r.last_import_delta == null
                        ? (r.current_plays == null ? "sem dados" : formatInt(Number(r.current_plays)))
                        : `última: ${Number(r.last_import_delta) > 0 ? "+" : ""}${formatInt(Number(r.last_import_delta))}`}
                    </div>
                  </div>
                </div>
              );
            }

            return (
              <div
                key={vi.key}
                onClick={() => onRowClick?.(r.playlist_id)}
                className={cn(
                  "grid grid-cols-[44px_minmax(220px,2fr)_120px_100px_100px_110px_120px_130px_150px] gap-3 items-center px-4 border-b border-border/40 hover:bg-accent/40 transition-colors",
                  isEven ? "bg-transparent" : "bg-card/30",
                  onRowClick && "cursor-pointer",
                )}
                style={baseStyle}
              >
                <div className="text-right tabular-nums text-xs text-muted-foreground font-mono">
                  {vi.index + 1}
                </div>

                {r.playlist_id === "__radio__" ? (
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="h-12 w-12 shrink-0 rounded-md bg-primary/10 border border-primary/20 flex items-center justify-center">
                      <RadioIcon className="h-5 w-5 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <div className="font-medium text-foreground truncate">Rádio Spotify</div>
                      <div className="text-xs text-muted-foreground">campaign_radio_collected</div>
                    </div>
                  </div>
                ) : (
                  <PlaylistCell
                    playlistId={r.playlist_id}
                    name={r.current_name ?? r.baseline_name ?? meta?.name ?? null}
                    url={r.playlist_url}
                    coverUrl={meta?.cover_url ?? null}
                    followers={meta?.followers ?? null}
                  />
                )}
                <div className="flex flex-wrap items-center gap-1 min-w-0">
                  <div className="min-w-0 max-w-full">
                    <AttributionBadge attr={r.attributed_to} curatorName={curName} />
                  </div>
                  {r.attributed_to.startsWith("curator:") && Number(r.baseline_plays ?? 0) > 0 && (
                    <span
                      className="shrink-0 inline-flex items-center px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wide border border-amber-500/40 text-amber-400 bg-amber-500/5"
                      title="Música já estava nesta playlist antes da campanha. Curador deve subir a posição."
                    >
                      subir pos.
                    </span>
                  )}
                </div>
                <div className="text-right tabular-nums text-muted-foreground text-sm">{r.baseline_plays == null ? "—" : formatInt(Number(r.baseline_plays))}</div>
                <div className="text-right tabular-nums text-foreground text-sm">{r.current_plays == null ? "—" : formatInt(Number(r.current_plays))}</div>
                <div className={cn("text-right tabular-nums font-semibold text-sm", Number(r.delta) > 0 ? "text-primary" : "text-muted-foreground")}>
                  {r.baseline_plays == null && r.current_plays == null ? "—" : (Number(r.delta) > 0 ? "+" : "") + formatInt(Number(r.delta ?? 0))}
                </div>
                <div
                  className={cn(
                    "text-right tabular-nums text-sm",
                    r.last_import_delta != null && Number(r.last_import_delta) > 0
                      ? "text-foreground font-medium"
                      : "text-muted-foreground",
                  )}
                  title="Entrega da importação válida mais recente comparada à anterior"
                >
                  {r.last_import_delta == null
                    ? "—"
                    : (Number(r.last_import_delta) > 0 ? "+" : "") + formatInt(Number(r.last_import_delta))}
                </div>
                <div>{r.baseline_plays == null && r.current_plays == null ? <Badge variant="outline" className="border-muted-foreground/30 text-muted-foreground">sem dados</Badge> : st ? <MatchStatusBadge status={st} /> : <span className="text-xs text-muted-foreground">—</span>}</div>
                <div className="text-muted-foreground text-xs">
                  {r.last_captured_at ? new Date(r.last_captured_at).toLocaleString("pt-BR") : "—"}
                </div>
              </div>
            );
          })}
        </div>
      </div>

    </div>
  );
}

function SortHeader({
  label, k, sort, dir, onSort, className,
}: { label: string; k: SortKey; sort: SortKey; dir: "asc" | "desc"; onSort: (k: SortKey) => void; className?: string }) {
  const active = sort === k;
  return (
    <button
      onClick={() => onSort(k)}
      className={cn("flex items-center gap-1 hover:text-foreground transition-colors text-left", active && "text-foreground", className)}
    >
      {label}
      <ArrowUpDown className={cn("h-3 w-3 opacity-50", active && "opacity-100")} />
      {active && <span className="text-[10px]">{dir === "asc" ? "↑" : "↓"}</span>}
    </button>
  );
}

function AttributionBadge({ attr, curatorName }: { attr: string; curatorName: string | null }) {
  if (attr === "radio") return <Badge variant="outline" className="border-blue-500/40 text-blue-400">Rádio</Badge>;
  if (attr === "ecosystem") return <Badge variant="outline" className="border-emerald-500/40 text-emerald-400">Ecossistema</Badge>;
  if (attr.startsWith("curator:")) return <Badge variant="outline" className="border-amber-500/40 text-amber-400 truncate max-w-full">{curatorName ?? "Curador"}</Badge>;
  return <Badge variant="outline" className="border-pink-500/40 text-pink-400">Orgânico</Badge>;
}

function AttributionDot({ attr }: { attr: string }) {
  const cls =
    attr === "radio" ? "bg-blue-400"
    : attr === "ecosystem" ? "bg-emerald-400"
    : attr.startsWith("curator:") ? "bg-amber-400"
    : "bg-pink-400";
  return <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", cls)} aria-hidden />;
}

function MobileCover({
  playlistId, url, coverUrl,
}: { playlistId: string; url: string | null | undefined; coverUrl: string | null }) {
  const href = url || `https://open.spotify.com/playlist/${playlistId}`;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => e.stopPropagation()}
      className="h-9 w-9 shrink-0 rounded-md overflow-hidden bg-muted border border-border flex items-center justify-center"
    >
      {coverUrl ? (
        <img src={coverUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
      ) : (
        <span className="text-[10px] text-muted-foreground">♪</span>
      )}
    </a>
  );
}


function MatchStatusBadge({ status }: { status: string }) {
  if (status === "matched") return <Badge className="bg-primary text-primary-foreground">matched</Badge>;
  if (status === "pending_match") return <Badge variant="outline">pending</Badge>;
  if (status === "baseline_conflict") return <Badge variant="outline" className="border-destructive/40 text-destructive">conflito baseline</Badge>;
  if (status === "not_found_yet") return <Badge variant="outline" className="border-destructive/40 text-destructive">not found</Badge>;
  return <Badge variant="outline">{status}</Badge>;
}

function KpiCard({ icon: Icon, label, value, accent, raw }: { icon: any; label: string; value: number; accent?: boolean; raw?: boolean }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wide">
          <Icon className="h-3 w-3" /> {label}
        </div>
        <div className={cn("mt-2 text-2xl font-semibold tabular-nums", accent && "text-primary")}>
          {raw ? value : formatInt(value)}
        </div>
      </CardContent>
    </Card>
  );
}

function KpiCell({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className="px-2 py-2.5 text-center">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={cn("mt-1 text-base font-semibold tabular-nums truncate", accent && "text-primary")}>
        {value > 0 && accent ? "+" : ""}{formatInt(value)}
      </div>
    </div>
  );
}

/**
 * Resumo agregado por curador — usado por CuratorTiles e CuratorPills.
 */
function useCuratorSummary(
  rows: GrowthRow[],
  curators: Record<string, CuratorMeta>,
  statuses: Record<string, string>,
) {
  return useMemo(() => {
    const map = new Map<string, { id: string; name: string; playlists: number; matched: number; pending: number; conflict: number; notFound: number; delta: number }>();
    for (const r of rows) {
      if (!r.attributed_curator_id) continue;
      const cur = r.attributed_curator_id;
      const agg = map.get(cur) ?? { id: cur, name: curators[cur]?.name ?? "Curador", playlists: 0, matched: 0, pending: 0, conflict: 0, notFound: 0, delta: 0 };
      agg.playlists += 1;
      if (!r.is_baseline_conflict) agg.delta += Number(r.delta ?? 0);
      const st = statuses[`${cur}::${r.playlist_id}`] ?? "pending_match";
      if (st === "matched") agg.matched += 1;
      else if (st === "baseline_conflict") agg.conflict += 1;
      else if (st === "not_found_yet") agg.notFound += 1;
      else agg.pending += 1;
      map.set(cur, agg);
    }
    return Array.from(map.values()).sort((a, b) => b.delta - a.delta || b.playlists - a.playlists);
  }, [rows, curators, statuses]);
}

/**
 * CuratorTiles — 5 KPI tiles (Playlists / Matched / Pending / Conflito / Δ).
 * Os 3 do meio são filtros de status (clicar alterna).
 */
function CuratorTiles({
  rows,
  curators,
  statuses,
  curatorFilter,
  statusFilter,
  onToggleStatus,
}: {
  rows: GrowthRow[];
  curators: Record<string, CuratorMeta>;
  statuses: Record<string, string>;
  curatorFilter: string;
  statusFilter: string;
  onToggleStatus: (status: string) => void;
}) {
  const list = useCuratorSummary(rows, curators, statuses);
  const preCampaignCount = useMemo(() => {
    return (rows ?? []).filter((r) => {
      if (!r.attributed_to.startsWith("curator:")) return false;
      if (curatorFilter !== "all" && r.attributed_curator_id !== curatorFilter) return false;
      return Number(r.baseline_plays ?? 0) > 0;
    }).length;
  }, [rows, curatorFilter]);
  const totals = useMemo(() => {
    const target = curatorFilter === "all" ? list : list.filter((c) => c.id === curatorFilter);
    return target.reduce(
      (acc, c) => ({
        playlists: acc.playlists + c.playlists,
        matched: acc.matched + c.matched,
        pending: acc.pending + c.pending,
        conflict: acc.conflict + c.conflict,
        delta: acc.delta + c.delta,
      }),
      { playlists: 0, matched: 0, pending: 0, conflict: 0, delta: 0 },
    );
  }, [list, curatorFilter]);

  if (list.length === 0) return null;

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
      <KpiTile label="Playlists" value={totals.playlists} />
      <KpiTile
        label="Matched"
        value={totals.matched}
        accent="emerald"
        active={statusFilter === "matched"}
        onClick={() => onToggleStatus("matched")}
      />
      <KpiTile
        label="Pending"
        value={totals.pending}
        accent="amber"
        active={statusFilter === "pending_match"}
        onClick={() => onToggleStatus("pending_match")}
      />
      <KpiTile
        label="Pré-campanha"
        value={preCampaignCount}
        accent="amber"
        active={statusFilter === "pre_campaign"}
        onClick={() => onToggleStatus("pre_campaign")}
      />
      <KpiTile
        label="Conflito"
        value={totals.conflict}
        accent="rose"
        active={statusFilter === "baseline_conflict"}
        onClick={() => onToggleStatus("baseline_conflict")}
      />
      <KpiTile label="Δ Variação" value={totals.delta} delta />
    </div>
  );
}

/**
 * CuratorPills — pílulas horizontais (Todos curadores · <cada curador>).
 */
function CuratorPills({
  rows,
  curators,
  statuses,
  curatorFilter,
  onPickCurator,
  campaignId,
}: {
  rows: GrowthRow[];
  curators: Record<string, CuratorMeta>;
  statuses: Record<string, string>;
  curatorFilter: string;
  onPickCurator: (curatorId: string) => void;
  campaignId?: string;
}) {
  const list = useCuratorSummary(rows, curators, statuses);
  const [ecoCount, setEcoCount] = useState<number | null>(null);

  useEffect(() => {
    if (!campaignId) return;
    let cancel = false;
    (async () => {
      const { count } = await supabase
        .from("campaign_eco_allocations")
        .select("id", { count: "exact", head: true })
        .eq("campaign_id", campaignId);
      if (!cancel) setEcoCount(count ?? 0);
    })();
    return () => { cancel = true; };
  }, [campaignId]);

  if (list.length === 0 && !ecoCount) return null;
  const total = list.reduce((s, c) => s + c.playlists, 0);
  const ecosystemActive = curatorFilter === "__ecosystem__";

  return (
    <div className="flex items-center gap-2 overflow-x-auto scrollbar-thin min-w-0">
      <button
        onClick={() => onPickCurator("all")}
        className={cn(
          "shrink-0 inline-flex items-center gap-2 h-8 px-3 rounded-full text-[12px] font-medium transition-colors border",
          curatorFilter === "all"
            ? "bg-accent text-foreground border-[hsl(280_70%_60%)]"
            : "bg-card text-muted-foreground border-border hover:text-foreground hover:bg-accent/60",
        )}
      >
        <span
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            curatorFilter === "all" ? "bg-[hsl(280_70%_60%)] shadow-[0_0_6px_hsl(280_70%_60%/0.7)]" : "bg-muted-foreground/40",
          )}
        />
        Todos curadores
        <span className="text-[10px] tabular-nums text-subtle-foreground">{total}</span>
      </button>
      {list.map((c) => {
        const active = curatorFilter === c.id;
        return (
          <button
            key={c.id}
            onClick={() => onPickCurator(c.id)}
            className={cn(
              "shrink-0 inline-flex items-center gap-2 h-8 px-3 rounded-full text-[12px] font-medium transition-colors border",
              active
                ? "bg-accent text-foreground border-[hsl(280_70%_60%)]"
                : "bg-card text-muted-foreground border-border hover:text-foreground hover:bg-accent/60",
            )}
          >
            {active && <span className="h-1.5 w-1.5 rounded-full bg-[hsl(280_70%_60%)] shadow-[0_0_6px_hsl(280_70%_60%/0.7)]" />}
            <span className="truncate max-w-[160px]">{c.name}</span>
            <span className="text-[10px] tabular-nums text-subtle-foreground">{c.playlists}</span>
          </button>
        );
      })}
      {ecoCount !== null && ecoCount > 0 && (
        <button
          onClick={() => onPickCurator("__ecosystem__")}
          className={cn(
            "shrink-0 inline-flex items-center gap-2 h-8 px-3 rounded-full text-[12px] font-medium transition-colors border",
            ecosystemActive
              ? "bg-accent text-foreground border-emerald-500/60"
              : "bg-card text-muted-foreground border-border hover:text-foreground hover:bg-accent/60",
          )}
          title="Filtrar pelas playlists do ecossistema"
        >
          <Layers className={cn("h-3 w-3", ecosystemActive ? "text-emerald-400" : "text-emerald-400/70")} />
          Ecossistema
          <span className="text-[10px] tabular-nums text-subtle-foreground">{ecoCount}</span>
        </button>
      )}
    </div>
  );
}


function KpiTile({
  label,
  value,
  accent,
  active,
  delta,
  onClick,
}: {
  label: string;
  value: number;
  accent?: "emerald" | "amber" | "rose";
  active?: boolean;
  delta?: boolean;
  onClick?: () => void;
}) {
  const accentMap = {
    emerald: { bar: "bg-emerald-500/60", text: "text-emerald-400", border: "border-emerald-500/40", bg: "bg-emerald-500/[0.06]" },
    amber: { bar: "bg-amber-500/60", text: "text-amber-400", border: "border-amber-500/40", bg: "bg-amber-500/[0.06]" },
    rose: { bar: "bg-rose-500/60", text: "text-rose-400", border: "border-rose-500/40", bg: "bg-rose-500/[0.06]" },
  } as const;
  const a = accent ? accentMap[accent] : undefined;
  const clickable = !!onClick;
  const deltaPositive = delta && value > 0;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!clickable}
      className={cn(
        "relative text-left rounded-2xl border bg-card p-4 transition-colors overflow-hidden",
        clickable
          ? cn(
              "cursor-pointer",
              active && a ? cn(a.border, a.bg) : "border-border hover:border-foreground/20 hover:bg-accent/40",
            )
          : "border-border cursor-default",
      )}
    >
      <div
        className={cn(
          "text-[10px] uppercase tracking-[0.18em] font-semibold transition-colors",
          active && a ? a.text : "text-muted-foreground",
        )}
      >
        {label}
      </div>
      <div
        className={cn(
          "mt-2 text-[22px] font-semibold tabular-nums leading-none",
          delta ? (value > 0 ? "text-primary" : value < 0 ? "text-destructive" : "text-foreground") : "text-foreground",
        )}
      >
        {delta && deltaPositive ? "+" : ""}
        {formatInt(value)}
      </div>
      {a && <div className={cn("absolute bottom-0 left-0 h-[2px] w-full", active ? a.bar : "bg-transparent")} />}
    </button>
  );
}


