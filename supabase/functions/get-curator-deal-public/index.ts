// get-curator-deal-public — retorna dados públicos de um deal de curador
// a partir do public_token (sem expor user_id). Usado pela página pública
// que o curador acessa para ver a meta e cadastrar playlists.
// Sem auth (rota pública). Service role para ignorar RLS.
//
// Fonte de verdade do progresso: curator_deal_snapshots (prints do admin via S4A).
// O frontend não calcula nada — apenas renderiza `progress` e `snapshot_history`.
import { corsHeaders } from "npm:@supabase/supabase-js/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { assertDealOperable } from "../_shared/deal-access.ts";
import { checkRateLimit, clientIp, rateLimitResponse } from "../_shared/rate-limit.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Rate limit: 120 req/min por IP.
  const ip = clientIp(req);
  const rl = await checkRateLimit(`get-curator-deal-public:${ip}`, 60, 120);
  if (!rl.allowed) return rateLimitResponse(corsHeaders);

  try {
    const body = await req.json().catch(() => ({}));
    const token = typeof body?.public_token === "string" ? body.public_token.trim() : "";
    const slug = typeof body?.slug === "string" ? body.slug.trim() : "";

    if (!token && !slug) {
      return jr({ ok: false, error: "public_token ou slug obrigatório" }, 400);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false },
    });

    // Aceita slug (preferencial) ou token (compatibilidade com links antigos).
    const looksLikeToken = (v: string) => /^[a-f0-9]{20,}$/i.test(v);
    let query = admin
      .from("curator_deals")
      .select(
        "id, curator_name, song_spotify_url, song_name, song_artist, song_cover_url, target_plays, daily_goal, baseline_plays, cost, started_at, ends_at, public_token, slug, created_at, spotify_owner_id, spotify_owner_url, state, closed_at, closed_status, token_revoked_at, token_expires_at, campaign_id, source",
      );

    if (token) {
      query = query.eq("public_token", token);
    } else if (looksLikeToken(slug)) {
      query = query.eq("public_token", slug);
    } else {
      query = query.eq("slug", slug);
    }

    const { data: deal, error: dealErr } = await query.maybeSingle();

    if (dealErr) return jr({ ok: false, error: dealErr.message }, 200);
    if (!deal) return jr({ ok: false, error: "not found" }, 200);

    // Dados base + RPCs de progresso e histórico (snapshots como fonte única).
    const [
      { data: playlists, error: plErr },
      { data: songs, error: songsErr },
      { data: progressRpc, error: progressErr },
      { data: historyRpc, error: historyErr },
      { data: latestSnaps, error: snapsErr },
    ] = await Promise.all([
      admin
        // Separação operacional × observacional: hub público do curador só vê entregas reais.
        .from("v_curator_playlists_operational")
        .select(
          "id, deal_id, song_id, spotify_url, playlist_name, followers, is_baseline, added_at, spotify_playlist_id, spotify_owner_id, spotify_owner_name, image_url, added_at_spotify, match_status, match_reason, last_paste_at",
        )
        .eq("deal_id", deal.id)
        .or("match_status.eq.curator,is_baseline.eq.true")
        .order("added_at", { ascending: true }),
      admin
        .from("curator_deal_songs")
        .select(
          "id, deal_id, song_spotify_url, spotify_track_id, song_name, song_artist, song_cover_url, daily_goal, target_plays, baseline_plays, position, started_at, ends_at, ramp_up_days, created_at",
        )
        .eq("deal_id", deal.id)
        .order("position", { ascending: true }),
      admin.rpc("get_curator_deal_progress", { p_deal_id: deal.id }),
      admin.rpc("get_curator_deal_snapshot_history", { p_deal_id: deal.id }),
      admin
        .from("curator_deal_snapshots")
        .select("playlist_id, captured_at, plays_24h, plays_7d, plays_28d, is_baseline")
        .eq("deal_id", deal.id)
        .eq("is_baseline", false)
        .order("captured_at", { ascending: false }),
    ]);

    // Erros críticos (sem playlists/songs a página não tem o que mostrar) ainda quebram.
    if (plErr) return jr({ ok: false, error: plErr.message }, 200);
    if (songsErr) return jr({ ok: false, error: songsErr.message }, 200);
    // Erros de progresso/histórico/snapshots são DEGRADAÇÃO GRACIOSA:
    // a página do curador continua abrindo (apenas sem números agregados de progresso).
    // Motivo: RPCs como get_curator_deal_progress podem estourar statement_timeout
    // quando a campanha tem muitas leituras em campaign_playlist_collections, e
    // bloquear o link inteiro por isso transforma uma lentidão em "link expirado".
    if (progressErr) console.error("[get-curator-deal-public] progress error (degraded):", progressErr.message);
    if (historyErr) console.error("[get-curator-deal-public] history error (degraded):", historyErr.message);
    if (snapsErr) console.error("[get-curator-deal-public] snaps error (degraded):", snapsErr.message);

    // Último snapshot por playlist (já vem ordenado desc).
    const latestByPlaylist: Record<string, { plays_24h: number | null; plays_7d: number | null; plays_28d: number | null; captured_at: string }> = {};
    for (const s of (latestSnaps ?? []) as any[]) {
      if (!s.playlist_id) continue;
      if (!latestByPlaylist[s.playlist_id]) {
        latestByPlaylist[s.playlist_id] = {
          plays_24h: s.plays_24h ?? null,
          plays_7d: s.plays_7d ?? null,
          plays_28d: s.plays_28d ?? null,
          captured_at: s.captured_at,
        };
      }
    }

    // Fallback essencial para o portal do curador: o painel interno já lê o
    // Growth Engine por spotify_playlist_id, enquanto alguns snapshots recentes
    // ficam com plays_7d/28d nulos. Sem isso, o curador vê "—" embora a mesma
    // playlist apareça com número no deal interno.
    const growthBySpotifyPlaylist: Record<string, { plays_7d: number | null }> = {};
    if ((deal as any).campaign_id) {
      try {
        const playlistIds = Array.from(
          new Set(
            ((playlists ?? []) as any[])
              .map((p) => (p.spotify_playlist_id ?? "").trim())
              .filter(Boolean),
          ),
        );
        if (playlistIds.length > 0) {
          const { data: growthRows } = await admin
            .from("vw_campaign_playlist_growth")
            .select("playlist_id, current_plays, delivery_accumulated, delta, attributed_to")
            .eq("campaign_id", (deal as any).campaign_id)
            .in("playlist_id", playlistIds)
            .like("attributed_to", "curator:%");
          for (const r of (growthRows ?? []) as Array<{ playlist_id: string | null; current_plays: number | null; delivery_accumulated: number | null; delta: number | null }>) {
            const pid = (r.playlist_id ?? "").trim();
            if (!pid) continue;
            const value = r.current_plays ?? r.delivery_accumulated ?? r.delta ?? null;
            if (value == null) continue;
            const prev = growthBySpotifyPlaylist[pid]?.plays_7d;
            growthBySpotifyPlaylist[pid] = { plays_7d: Math.max(Number(prev ?? 0), Number(value)) };
          }
        }
      } catch (_e) { /* best-effort */ }
    }

    // Gate informativo: leitura segue permitida (curador vê o histórico),
    // mas o frontend usa esse flag pra desabilitar mutações.
    const gate = assertDealOperable(deal as any);
    const access = gate.ok
      ? { writable: true }
      : { writable: false, code: gate.code, reason: gate.error };

    // Campaign shadow context: quando o deal é shadow de uma campanha,
    // o portal precisa saber se a baseline já foi capturada antes de aceitar
    // cadastros de playlist (sistema de identidade por playlist_id).
    let campaign_context: {
      is_campaign_shadow: boolean;
      campaign_id: string | null;
      baseline_status: string | null;
      baseline_captured_at: string | null;
      baseline_playlist_count: number;
    } = {
      is_campaign_shadow: false,
      campaign_id: null,
      baseline_status: null,
      baseline_captured_at: null,
      baseline_playlist_count: 0,
    };
    if ((deal as any).source === "campaign_internal" && (deal as any).campaign_id) {
      const campaignId = (deal as any).campaign_id as string;
      const { data: camp } = await admin
        .from("campaigns")
        .select("baseline_status, baseline_captured_at")
        .eq("id", campaignId)
        .maybeSingle();
      const { count: baselineCount } = await admin
        .from("campaign_playlist_collections")
        .select("playlist_id", { count: "exact", head: true })
        .eq("campaign_id", campaignId)
        .eq("is_baseline", true);
      campaign_context = {
        is_campaign_shadow: true,
        campaign_id: campaignId,
        baseline_status: (camp as any)?.baseline_status ?? null,
        baseline_captured_at: (camp as any)?.baseline_captured_at ?? null,
        baseline_playlist_count: baselineCount ?? 0,
      };
    }

    // ====== Submissões do curador na camada de campanha (CCP) ======
    // Resumo + lista de conflitos de baseline para esta dupla deal/campanha.
    // Nunca quebra a resposta — se a tabela/colunas não existirem, devolve vazio.
    let curator_submissions: {
      total: number;
      valid: number;
      baseline_conflict: number;
      pending_substitution: number;
      resolved: number;
    } = { total: 0, valid: 0, baseline_conflict: 0, pending_substitution: 0, resolved: 0 };
    let baseline_conflicts: Array<{
      playlist_id: string;
      playlist_url: string;
      playlist_name: string | null;
      registered_at: string | null;
      baseline_conflict_at: string | null;
      baseline_captured_at: string | null;
      baseline_plays_7d: number | null;
      reason: string;
      resolved: boolean;
    }> = [];

    if ((deal as any).campaign_id) {
      const campaignId = (deal as any).campaign_id as string;
      try {
        const { data: ccpRows } = await admin
          .from("curator_campaign_playlists")
          .select(
            "playlist_id, playlist_url, status, registered_at, matched_at, baseline_conflict_at",
          )
          .eq("deal_id", (deal as any).id);

        const rows = (ccpRows ?? []) as Array<any>;
        const total = rows.length;
        const valid = rows.filter((r) => r.status === "matched").length;
        const conflictRows = rows.filter((r) => r.status === "baseline_conflict");
        const conflictCount = conflictRows.length;

        // Enriquecer conflitos com dados da baseline (nome + plays_7d + captura)
        const conflictIds = conflictRows.map((r) => r.playlist_id);
        const baselineByPid: Record<string, any> = {};
        if (conflictIds.length > 0) {
          const { data: baseRows } = await admin
            .from("campaign_playlist_collections")
            .select("playlist_id, playlist_name_at_capture, plays_7d, captured_at, is_baseline")
            .eq("campaign_id", campaignId)
            .eq("is_baseline", true)
            .in("playlist_id", conflictIds);
          for (const b of (baseRows ?? []) as any[]) {
            baselineByPid[b.playlist_id] = b;
          }
        }

        // "Resolvido" = curador registrou outra playlist (não-conflito) DEPOIS
        // do conflito, na mesma campanha/deal.
        const validSorted = rows
          .filter((r) => r.status === "matched" && r.registered_at)
          .map((r) => new Date(r.registered_at).getTime());

        baseline_conflicts = conflictRows.map((r) => {
          const base = baselineByPid[r.playlist_id] ?? null;
          const conflictAt = r.baseline_conflict_at
            ? new Date(r.baseline_conflict_at).getTime()
            : (r.registered_at ? new Date(r.registered_at).getTime() : 0);
          const resolved = validSorted.some((t) => t > conflictAt);
          return {
            playlist_id: r.playlist_id,
            playlist_url: r.playlist_url,
            playlist_name: base?.playlist_name_at_capture ?? null,
            registered_at: r.registered_at ?? null,
            baseline_conflict_at: r.baseline_conflict_at ?? null,
            baseline_captured_at: base?.captured_at ?? null,
            baseline_plays_7d: typeof base?.plays_7d === "number" ? base.plays_7d : null,
            reason:
              "A música já estava nesta playlist antes do início da campanha. Conta como cenário pré-existente, não como entrega nova do curador.",
            resolved,
          };
        });

        const resolvedCount = baseline_conflicts.filter((c) => c.resolved).length;
        curator_submissions = {
          total,
          valid,
          baseline_conflict: conflictCount,
          pending_substitution: conflictCount - resolvedCount,
          resolved: resolvedCount,
        };
      } catch (_e) {
        // best-effort; mantém defaults
      }
    }


    // Histórico prévio: para cada playlist do curador, buscar baseline_plays
    // da view de crescimento da campanha. baseline_plays > 0 = música já tinha
    // atividade naquela playlist antes da campanha (não bloqueia, só sinaliza).
    const baselinePlaysByPid: Record<string, number> = {};
    if ((deal as any).campaign_id) {
      try {
        const playlistIds = Array.from(
          new Set(
            ((playlists ?? []) as any[])
              .map((p) => (p.spotify_playlist_id ?? "").trim())
              .filter(Boolean),
          ),
        );
        if (playlistIds.length > 0) {
          const { data: growthRows } = await admin
            .from("vw_campaign_playlist_growth")
            .select("playlist_id, baseline_plays")
            .eq("campaign_id", (deal as any).campaign_id)
            .in("playlist_id", playlistIds);
          for (const r of (growthRows ?? []) as Array<{ playlist_id: string | null; baseline_plays: number | null }>) {
            const pid = (r.playlist_id ?? "").trim();
            if (!pid) continue;
            baselinePlaysByPid[pid] = Math.max(0, Number(r.baseline_plays ?? 0));
          }
        }
      } catch (_e) { /* best-effort */ }
    }

    return jr({
      ok: true,
      deal,
      access,
      campaign_context,
      playlists: (playlists ?? []).map((p: any) => ({
        ...p,
        plays_24h: latestByPlaylist[p.id]?.plays_24h ?? null,
        plays_7d: latestByPlaylist[p.id]?.plays_7d ?? growthBySpotifyPlaylist[(p.spotify_playlist_id ?? "").trim()]?.plays_7d ?? null,
        plays_28d: latestByPlaylist[p.id]?.plays_28d ?? null,
        last_window_capture_at: latestByPlaylist[p.id]?.captured_at ?? null,
        baseline_plays_prior: baselinePlaysByPid[(p.spotify_playlist_id ?? "").trim()] ?? 0,
      })),
      songs: songs ?? [],
      progress: progressRpc ?? null,
      snapshot_history: (() => {
        // Dedup espelhando o admin (DealHistorySheet): 1 registro por dia
        // pra coletas (não-baseline), priorizando o entry com mais prints
        // — empate vence o mais recente. Baselines sempre preservadas.
        // Motivo: o bot disparou várias vezes no mesmo dia durante testes
        // e gerou 31 registros redundantes; o curador precisa ver a mesma
        // timeline limpa que aparece no painel interno (~6 entradas).
        const list = (historyRpc as any[] | null) ?? [];
        type Entry = any;
        const baselines: Entry[] = [];
        const byDay = new Map<string, Entry>();
        for (const e of list) {
          if (e?.is_baseline) { baselines.push(e); continue; }
          const ts = new Date(e.captured_at).getTime();
          if (!Number.isFinite(ts)) continue;
          const day = new Date(ts).toISOString().slice(0, 10);
          const prints = Array.isArray(e.print_urls) ? e.print_urls.length : 0;
          const cur = byDay.get(day);
          if (!cur) { byDay.set(day, e); continue; }
          const curPrints = Array.isArray(cur.print_urls) ? cur.print_urls.length : 0;
          const curTs = new Date(cur.captured_at).getTime();
          if (prints > curPrints || (prints === curPrints && ts > curTs)) {
            byDay.set(day, e);
          }
        }
        const merged = [...baselines, ...byDay.values()];
        merged.sort((a, b) => new Date(a.captured_at).getTime() - new Date(b.captured_at).getTime());
        return merged;
      })(),
      curator_submissions,
      baseline_conflicts,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return jr({ ok: false, error: msg }, 200);
  }
});
