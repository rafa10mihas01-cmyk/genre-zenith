// useCockpitDerivations — useMemos derivados do diagnostico.
// Movido 1:1 do PlaylistCockpit.tsx (Fase 2 / Commit 3).
// Nenhuma fórmula, cap, sort ou filtro foi alterado.
import { useMemo } from "react";
import type { Diagnosis, Suggestion, Zone } from "../types";
import { HEALTH_META, ZONE_CAPS, zoneFromPos, norm } from "../helpers";

export function useCockpitDerivations(diag: Diagnosis | null) {
  const analysis = diag?.tracks_analysis ?? [];
  const suggestions = diag?.tracks_suggestions ?? [];
  const caps = diag?.raw?.applied_caps;

  const buckets = useMemo(() => {
    const removeAll = analysis.filter((t) => t.status === "remove")
      .sort((a, b) => a.position - b.position);
    const demoteAll = analysis.filter((t) => t.status === "demote")
      .sort((a, b) => a.position - b.position);
    const promoteAll = analysis.filter((t) => t.status === "promote")
      .sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0));

    // Aplica o cap recomendado pelo cérebro — detecta tudo, executa só o que
    // cabe neste ciclo. UI mostra "X detectadas · Y recomendadas".
    const recRemove = caps?.recommended_remove ?? removeAll.length;
    const recDemote = caps?.recommended_demote ?? demoteAll.length;
    const recPromote = caps?.recommended_promote ?? promoteAll.length;

    // Adicionar: respeita capped_suggestions do backend e ainda aplica
    // cap por zona pra não empilhar 6 faixas brigando por posição 0/1.
    // Excedente "desce" pra próxima zona com vaga (anchor → premium → support → tail).
    const addAfterBackendCap = caps?.capped_suggestions != null
      ? suggestions.slice(0, caps.capped_suggestions)
      : suggestions;
    const ZONE_ORDER: Zone[] = ["anchor", "premium", "support", "tail"];
    function zoneStart(z: Zone): number {
      return z === "anchor" ? 0 : z === "premium" ? 2 : z === "support" ? 6 : 12;
    }
    const zoneCount: Record<Zone, number> = { anchor: 0, premium: 0, support: 0, tail: 0 };
    const addFinal: Array<Suggestion & { _zone: Zone }> = [];
    for (const s of addAfterBackendCap) {
      const original = (s.target_zone ?? zoneFromPos(s.suggested_position ?? 99)) as Zone;
      let z: Zone = original;
      const startIdx = ZONE_ORDER.indexOf(original);
      for (let k = startIdx; k < ZONE_ORDER.length; k++) {
        if (zoneCount[ZONE_ORDER[k]] < ZONE_CAPS[ZONE_ORDER[k]]) { z = ZONE_ORDER[k]; break; }
      }
      if (zoneCount[z] >= ZONE_CAPS[z]) continue;
      zoneCount[z]++;
      // Posição sempre derivada do contador da zona — garante slots únicos
      // no batch (#13, #14, #15... em vez de #14, #14, #15, #15 repetidos).
      // O `suggested_position` do backend é só uma dica da zona, não do slot.
      const pos = zoneStart(z) + zoneCount[z] - 1;
      addFinal.push({ ...s, _zone: z, suggested_position: pos });
    }

    return {
      remove: removeAll.slice(0, recRemove),
      demote: demoteAll.slice(0, recDemote),
      promote: promoteAll.slice(0, recPromote),
      add: addFinal,
      detected: {
        remove: removeAll.length,
        demote: demoteAll.length,
        promote: promoteAll.length,
        add: suggestions.length,
      },
    };
  }, [analysis, suggestions, caps]);

  const health = HEALTH_META[diag?.raw?.health_status ?? "saudavel"];
  const market = diag?.raw?.market_insights;
  const idealRange = market?.ideal_track_count_range;

  // Sets pra cruzar Mercado ↔ Plano: o que já está, o que está sugerido.
  const currentTrackKeys = useMemo(
    () => new Set(analysis.map((t) => norm(t.track_name))),
    [analysis],
  );
  const currentArtistKeys = useMemo(
    () => new Set(analysis.map((t) => norm(t.artist_name))),
    [analysis],
  );
  const suggestionByTitle = useMemo(() => {
    const m = new Map<string, string>(); // norm(title) → spotify_track_id
    for (const s of buckets.add) m.set(norm(s.nome), s.spotify_track_id);
    return m;
  }, [buckets.add]);

  return {
    analysis,
    suggestions,
    caps,
    buckets,
    health,
    market,
    idealRange,
    currentTrackKeys,
    currentArtistKeys,
    suggestionByTitle,
  } as const;
}
