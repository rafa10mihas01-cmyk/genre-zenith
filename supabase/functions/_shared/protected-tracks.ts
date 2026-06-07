// _shared/protected-tracks.ts
// =====================================================================
// FONTE ÚNICA DE VERDADE para faixas protegidas por campanha ativa.
//
// REGRA: qualquer automação que mova, remova ou substitua tracks numa
// managed_playlist DEVE consultar este helper ANTES de executar.
//
// Critério de proteção (mesmo do diagnose-managed-playlist):
//   campaign_eco_allocations.status IN ('pending','dispatched','active')
//   AND campaigns.status            IN ('draft','active','paused')
//
// Não depende do JSON do diagnose. Consulta direta nas tabelas-fonte.
// =====================================================================

const PROTECTED_ALLOC_STATUSES = ["pending", "dispatched", "active"] as const;
const PROTECTED_CAMPAIGN_STATUSES = ["draft", "active", "paused"] as const;

export type ProtectedTrack = {
  spotify_track_id: string;
  campaign_id: string;
  campaign_status: string;
  alloc_status: string;
  planned_streams: number | null;
  planned_position: number | null;
};

/**
 * Retorna as faixas protegidas de uma managed_playlist.
 * Aceita managed_playlists.id OU managed_playlists.spotify_playlist_id.
 * Retorna lista vazia se a playlist não for gerenciada (= não tem campanha).
 */
export async function getProtectedTracksForPlaylist(
  supabase: any,
  opts: { managed_playlist_id?: string; spotify_playlist_id?: string },
): Promise<ProtectedTrack[]> {
  let managedId = opts.managed_playlist_id ?? null;

  if (!managedId && opts.spotify_playlist_id) {
    const { data: pl } = await supabase
      .from("managed_playlists")
      .select("id")
      .eq("spotify_playlist_id", opts.spotify_playlist_id)
      .maybeSingle();
    managedId = pl?.id ?? null;
  }

  if (!managedId) return [];

  const { data, error } = await supabase
    .from("campaign_eco_allocations")
    .select(
      "campaign_id, planned_streams, position, status, campaigns!inner(id, spotify_track_id, status)",
    )
    .eq("managed_playlist_id", managedId)
    .in("status", PROTECTED_ALLOC_STATUSES as unknown as string[])
    .in("campaigns.status", PROTECTED_CAMPAIGN_STATUSES as unknown as string[]);

  if (error || !data) return [];

  const out = new Map<string, ProtectedTrack>();
  for (const row of data as any[]) {
    const tid: string | null = row?.campaigns?.spotify_track_id ?? null;
    if (!tid) continue;
    const cur: ProtectedTrack = {
      spotify_track_id: tid,
      campaign_id: row.campaign_id,
      campaign_status: row.campaigns.status,
      alloc_status: row.status,
      planned_streams: row.planned_streams ?? null,
      planned_position: row.position ?? null,
    };
    const prev = out.get(tid);
    if (!prev || (cur.planned_streams ?? 0) > (prev.planned_streams ?? 0)) {
      out.set(tid, cur);
    }
  }
  return Array.from(out.values());
}

/** Conjunto de spotify:track:{id} URIs protegidos. */
export function protectedUriSet(protectedTracks: ProtectedTrack[]): Set<string> {
  return new Set(protectedTracks.map((p) => `spotify:track:${p.spotify_track_id}`));
}

/**
 * Loga tentativa bloqueada de movimentar/remover faixa protegida.
 * Grava em collection_logs (acao = 'protected-track-block').
 */
export async function logProtectedBlock(
  supabase: any,
  payload: {
    source: string;
    spotify_playlist_id: string | null;
    managed_playlist_id: string | null;
    action: string;
    blocked_tracks: string[];
    extra?: Record<string, unknown>;
  },
): Promise<void> {
  try {
    await supabase.from("collection_logs").insert({
      acao: "protected-track-block",
      status: "bloqueado",
      mensagem: `${payload.source}: ${payload.action} bloqueado em ${
        payload.spotify_playlist_id ?? payload.managed_playlist_id ?? "?"
      } — ${payload.blocked_tracks.length} faixa(s) protegida(s)`,
      detalhes: payload as unknown as Record<string, unknown>,
    });
  } catch {
    // silencioso — proteção nunca pode quebrar fluxo por causa de log
  }
}
