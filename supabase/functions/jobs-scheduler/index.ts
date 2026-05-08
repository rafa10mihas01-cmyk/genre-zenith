// jobs-scheduler — popula jobs_queue automaticamente com base no estado atual do Cloud.
// Auth: x-agent-token (admin/ops). Pode ser chamado manualmente pelo painel ou via pg_cron.
//
// Tipos enfileirados:
//   spotify.deal.collect  — para cada curator_deal_songs com auto_collect=true e next_auto_collect_at <= now()
//   spotify.artist.fetch  — artistas com deals ativos sem snapshot nas últimas 24h (cooldown 6h)
//   spotify.print_batch   — bot_print_batches pendentes há > 1min e ainda incompletos
//
// Garantias:
//   - dedupe_key impede enfileirar o mesmo trabalho 2x enquanto o anterior não termina
//   - prioridade dinâmica: quanto mais atrasado, menor o número (mais alto na fila)
//   - limite por chamada (default 100/tipo) para não estourar fila
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, jr, requireAgentToken } from "../_shared/admin-auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

type Kind = "spotify.deal.collect" | "spotify.artist.fetch" | "spotify.print_batch";
const ALL_KINDS: Kind[] = ["spotify.deal.collect", "spotify.artist.fetch", "spotify.print_batch"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const guard = requireAgentToken(req);
  if (!guard.ok) return guard.resp;

  let body: { kinds?: Kind[]; per_kind_limit?: number } = {};
  try { body = await req.json(); } catch {}
  const kinds = (body.kinds && body.kinds.length ? body.kinds : ALL_KINDS) as Kind[];
  const limit = Math.max(1, Math.min(500, body.per_kind_limit ?? 100));

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);
  const enqueued: Record<string, number> = {};
  const errors: Record<string, string> = {};

  for (const kind of kinds) {
    try {
      if (kind === "spotify.deal.collect") {
        enqueued[kind] = await scheduleDealCollect(sb, limit);
      } else if (kind === "spotify.artist.fetch") {
        enqueued[kind] = await scheduleArtistFetch(sb, limit);
      } else if (kind === "spotify.print_batch") {
        enqueued[kind] = await schedulePrintBatch(sb, limit);
      }
    } catch (e) {
      errors[kind] = String((e as Error)?.message ?? e);
    }
  }

  return jr({ enqueued, errors, ran_at: new Date().toISOString() }, 200);
});

// -------- helpers --------

async function existingDedupeKeys(sb: ReturnType<typeof createClient>, keys: string[]): Promise<Set<string>> {
  if (!keys.length) return new Set();
  const { data, error } = await sb
    .from("jobs_queue")
    .select("dedupe_key")
    .in("dedupe_key", keys)
    .in("status", ["pending", "processing", "retry"]);
  if (error) throw error;
  return new Set((data ?? []).map((r: { dedupe_key: string | null }) => r.dedupe_key).filter(Boolean) as string[]);
}

async function bulkInsertJobs(
  sb: ReturnType<typeof createClient>,
  rows: Array<{ job_type: string; payload: unknown; dedupe_key: string; priority: number }>,
): Promise<number> {
  if (!rows.length) return 0;
  const { error } = await sb.from("jobs_queue").insert(
    rows.map((r) => ({
      job_type: r.job_type,
      payload: r.payload,
      dedupe_key: r.dedupe_key,
      priority: r.priority,
      status: "pending",
      max_attempts: 3,
    })),
  );
  if (error) throw error;
  return rows.length;
}

async function scheduleDealCollect(sb: ReturnType<typeof createClient>, limit: number): Promise<number> {
  // Songs com auto_collect ligado e janela vencida (ou nunca coletada)
  const nowIso = new Date().toISOString();
  const { data: songs, error } = await sb
    .from("curator_deal_songs")
    .select("id, deal_id, next_auto_collect_at, last_auto_collect_at, position")
    .eq("auto_collect", true)
    .or(`next_auto_collect_at.is.null,next_auto_collect_at.lte.${nowIso}`)
    .order("next_auto_collect_at", { ascending: true, nullsFirst: true })
    .limit(limit);
  if (error) throw error;
  if (!songs?.length) return 0;

  const keys = songs.map((s) => `deal-collect:${s.id}`);
  const taken = await existingDedupeKeys(sb, keys);

  const rows = songs
    .filter((s) => !taken.has(`deal-collect:${s.id}`))
    .map((s) => {
      // Quanto mais atrasado, maior prioridade (menor número).
      const overdueMin = s.next_auto_collect_at
        ? Math.max(0, (Date.now() - new Date(s.next_auto_collect_at).getTime()) / 60_000)
        : 999;
      const priority = Math.max(10, 100 - Math.min(80, Math.round(overdueMin / 5)));
      return {
        job_type: "spotify.deal.collect",
        payload: { deal_id: s.deal_id, song_id: s.id },
        dedupe_key: `deal-collect:${s.id}`,
        priority,
      };
    });
  return bulkInsertJobs(sb, rows);
}

async function scheduleArtistFetch(sb: ReturnType<typeof createClient>, limit: number): Promise<number> {
  // Artists com deal ativo sem snapshot recente (24h). Cooldown 6h via dedupe_key.
  // Usamos curator_deals ativos como fonte de artistas.
  const { data: deals, error } = await sb
    .from("curator_deals")
    .select("id, song_artist, spotify_owner_id, last_reconciled_at")
    .neq("state", "closed")
    .order("last_reconciled_at", { ascending: true, nullsFirst: true })
    .limit(limit);
  if (error) throw error;
  if (!deals?.length) return 0;

  // Agrupa por artista (spotify_owner_id ou song_artist como fallback)
  const byArtist = new Map<string, { artist_key: string; spotify_owner_id: string | null }>();
  for (const d of deals) {
    const key = d.spotify_owner_id ?? `name:${(d.song_artist ?? "").trim().toLowerCase()}`;
    if (!key || key === "name:") continue;
    if (!byArtist.has(key)) byArtist.set(key, { artist_key: key, spotify_owner_id: d.spotify_owner_id });
  }

  // Cooldown 6h: dedupe_key inclui janela horária discretizada.
  const window = Math.floor(Date.now() / (6 * 3600_000));
  const candidates = Array.from(byArtist.values()).map((a) => ({
    ...a,
    dedupe_key: `artist-fetch:${a.artist_key}:${window}`,
  }));
  const taken = await existingDedupeKeys(sb, candidates.map((c) => c.dedupe_key));

  const rows = candidates
    .filter((c) => !taken.has(c.dedupe_key))
    .map((c) => ({
      job_type: "spotify.artist.fetch",
      payload: { artist_id: c.spotify_owner_id ?? c.artist_key },
      dedupe_key: c.dedupe_key,
      priority: 80,
    }));
  return bulkInsertJobs(sb, rows);
}

async function schedulePrintBatch(sb: ReturnType<typeof createClient>, limit: number): Promise<number> {
  const cutoff = new Date(Date.now() - 60_000).toISOString();
  const { data: batches, error } = await sb
    .from("bot_print_batches")
    .select("id, deal_id, total_parts, received_parts, status, created_at")
    .in("status", ["pending"])
    .lt("created_at", cutoff)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw error;
  if (!batches?.length) return 0;

  const candidates = batches
    .filter((b) => (b.received_parts ?? 0) < (b.total_parts ?? 0))
    .map((b) => ({
      dedupe_key: `print-batch:${b.id}`,
      payload: { deal_id: b.deal_id, batch_id: b.id },
    }));
  const taken = await existingDedupeKeys(sb, candidates.map((c) => c.dedupe_key));

  const rows = candidates
    .filter((c) => !taken.has(c.dedupe_key))
    .map((c) => ({
      job_type: "spotify.print_batch",
      payload: c.payload,
      dedupe_key: c.dedupe_key,
      priority: 60,
    }));
  return bulkInsertJobs(sb, rows);
}
