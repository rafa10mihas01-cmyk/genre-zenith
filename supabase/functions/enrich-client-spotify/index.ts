// enrich-client-spotify — Recebe { client_id }, lê spotify_artist_url do cliente,
// extrai o artist ID e popula clients.{spotify_artist_id, monthly_listeners, image_url}.
//
// Fase 17-C (arquitetura definitiva): leitura pública via CACHE (spotify_artist_cache).
// Nenhuma chamada direta a api.spotify.com. Em cache miss / stale, getArtistCacheBatch
// auto-enfileira em spotify_enrichment_queue (priority=3); o spotify-enrichment-worker
// preenche assincronamente e a próxima invocação encontra os dados.
//
// Disparado pelo frontend após criar/atualizar cliente com spotify_artist_url.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getArtistCacheBatch } from "../_shared/spotify-cache.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function extractArtistId(url: string): string | null {
  if (!url) return null;
  const m = url.match(/artist\/([A-Za-z0-9]{22})/);
  return m ? m[1] : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  let body: any;
  try { body = await req.json(); } catch { return jr({ ok: false, error: "Invalid JSON" }, 400); }
  const clientId: string | undefined = body?.client_id;
  if (!clientId) return jr({ ok: false, error: "client_id obrigatório" }, 400);

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  const { data: client, error: cErr } = await supabase
    .from("clients")
    .select("id, spotify_artist_url, spotify_artist_id")
    .eq("id", clientId)
    .maybeSingle();
  if (cErr) return jr({ ok: false, error: cErr.message }, 500);
  if (!client) return jr({ ok: false, error: "cliente não encontrado" }, 404);

  const url = (client as any).spotify_artist_url as string | null;
  const artistId = extractArtistId(url ?? "");
  if (!artistId) {
    return jr({ ok: false, skipped: "sem_spotify_artist_url_valida" });
  }

  // Fase 17-C: cache + fila. Cache miss → auto-enqueue.
  const cache = await getArtistCacheBatch([artistId]);
  const row = cache.get(artistId);

  if (!row || row.fetch_status !== "ok") {
    // Persiste pelo menos o ID — UI já tem o handle; restante chega na próxima rodada.
    await supabase.from("clients").update({ spotify_artist_id: artistId }).eq("id", clientId);
    return jr({
      ok: true,
      client_id: clientId,
      spotify_artist_id: artistId,
      enrichment_status: "enqueued",
      message: "Dados de artista serão preenchidos pelo enrichment worker (cache miss). Reabra em alguns instantes.",
    }, 202);
  }

  const updates: Record<string, unknown> = {
    spotify_artist_id: artistId,
    monthly_listeners: typeof row.followers === "number" ? row.followers : null,
    image_url: row.image_url ?? null,
  };

  const { error: uErr } = await supabase.from("clients").update(updates).eq("id", clientId);
  if (uErr) return jr({ ok: false, error: uErr.message }, 500);

  return jr({
    ok: true,
    client_id: clientId,
    spotify_artist_id: artistId,
    monthly_listeners: updates.monthly_listeners,
    image_url: updates.image_url,
    name: row.name ?? null,
    source: "spotify_artist_cache",
  });
});
