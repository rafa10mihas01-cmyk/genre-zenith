// replicate-top — orquestrador de replicação automática.
//
// Fluxo:
//   1) Seleciona TOP N playlists do gênero por score composto (followers + quality)
//      excluindo playlists que JÁ foram replicadas (evita duplicar tema).
//   2) Pra cada candidata, escolhe um BLUEPRINT compatível (mesmo tier ou tier mais
//      próximo) e gera 1 TEMPLATE.
//   3) Aprova automaticamente o template (status=approved).
//   4) Distribui em ROUND-ROBIN entre as ACCOUNTS ativas (respeitando max_playlists).
//   5) Cria a playlist via create-spotify-playlist usando o spotify_user_id da account.
//   6) Registra cada passo em `replications`.
//
// POST {
//   genre_id: string,
//   top_n?: number = 5,
//   triggered_by?: 'manual' | 'cron' | 'batch' = 'manual',
//   dry_run?: boolean = false   // só seleciona e mostra o plano, não executa
// }
import { corsHeaders } from "npm:@supabase/supabase-js/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface Body {
  genre_id: string;
  top_n?: number;
  triggered_by?: "manual" | "cron" | "batch";
  dry_run?: boolean;
}

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function tierFor(followers: number): "mega" | "big" | "medium" | "small" {
  if (followers >= 100_000) return "mega";
  if (followers >= 10_000) return "big";
  if (followers >= 1_000) return "medium";
  return "small";
}

const TIER_ORDER = ["mega", "big", "medium", "small"] as const;

function nearestBlueprint(targetTier: string, blueprints: any[]): any | null {
  if (blueprints.length === 0) return null;
  // 1) match exato
  const exact = blueprints.filter(b => b.tier === targetTier).sort((a, b) => Number(b.replication_score) - Number(a.replication_score));
  if (exact.length > 0) return exact[0];
  // 2) tier mais próximo (distância no array TIER_ORDER)
  const targetIdx = TIER_ORDER.indexOf(targetTier as any);
  return [...blueprints]
    .map(b => ({ b, dist: Math.abs(TIER_ORDER.indexOf(b.tier) - targetIdx) }))
    .sort((a, b) => a.dist - b.dist || Number(b.b.replication_score) - Number(a.b.replication_score))
    [0]?.b ?? null;
}

async function callFn(name: string, body: unknown) {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  let data: any = null;
  try { data = JSON.parse(text); } catch { /* ignore */ }
  return { ok: r.ok, status: r.status, data, raw: text };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jr({ error: "POST only" }, 405);

  let body: Body;
  try { body = await req.json(); } catch { return jr({ error: "invalid json" }, 400); }
  if (!body.genre_id) return jr({ error: "genre_id required" }, 400);

  const topN = Math.max(1, Math.min(body.top_n ?? 5, 20));
  const triggeredBy = body.triggered_by ?? "manual";
  const dryRun = !!body.dry_run;

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  const startedAt = Date.now();

  // 1) Carrega contas ativas + blueprints + playlists já replicadas (anti-duplicação)
  const [{ data: accounts }, { data: blueprints }, { data: alreadyReplicated }] = await Promise.all([
    supabase
      .from("accounts")
      .select("id,spotify_user_id,display_name,max_playlists,current_playlists,status")
      .eq("status", "active")
      .order("current_playlists", { ascending: true }),
    supabase
      .from("playlist_blueprints")
      .select("id,tier,name,replication_score")
      .eq("genre_id", body.genre_id)
      .eq("status", "active"),
    supabase
      .from("replications")
      .select("source_result_id")
      .eq("genre_id", body.genre_id)
      .in("status", ["created", "approved", "generating", "pending"]),
  ]);

  const eligibleAccounts = (accounts ?? []).filter(a => (a.current_playlists ?? 0) < (a.max_playlists ?? 15));
  if (eligibleAccounts.length === 0) {
    return jr({ ok: false, error: "Nenhuma conta ativa com capacidade. Conecte conta Spotify ou aumente max_playlists." }, 400);
  }
  if (!blueprints || blueprints.length === 0) {
    return jr({ ok: false, error: "Nenhum blueprint disponível pra esse gênero. Rode extract-blueprints primeiro." }, 400);
  }

  const replicatedIds = new Set((alreadyReplicated ?? []).map(r => r.source_result_id).filter(Boolean));

  // 2) Seleciona top N candidatas (score composto: followers * quality_score)
  // — exclui as que já foram replicadas
  // — exige is_valid=true e seguidores não nulo
  const { data: pool, error: poolErr } = await supabase
    .from("search_results")
    .select("id,nome_playlist,seguidores,quality_score,total_musicas,spotify_url")
    .eq("genre_id", body.genre_id)
    .eq("is_valid", true)
    .not("seguidores", "is", null)
    .gt("quality_score", 60)
    .order("seguidores", { ascending: false })
    .limit(100);
  if (poolErr) return jr({ ok: false, error: poolErr.message }, 500);

  const candidates = (pool ?? [])
    .filter(p => !replicatedIds.has(p.id))
    .map(p => ({
      ...p,
      _score: (p.seguidores ?? 0) * ((Number(p.quality_score) || 50) / 100),
      _tier: tierFor(p.seguidores ?? 0),
    }))
    .sort((a, b) => b._score - a._score)
    .slice(0, topN);

  if (candidates.length === 0) {
    return jr({ ok: false, error: "Nenhuma playlist elegível pra replicação (todas já replicadas ou abaixo do threshold de qualidade)." }, 400);
  }

  // 3) Distribuição em round-robin pelas accounts elegíveis
  const accountQueue = [...eligibleAccounts];
  const plan: any[] = [];

  for (let i = 0; i < candidates.length; i++) {
    const cand = candidates[i];
    const acc = accountQueue[i % accountQueue.length];
    const bp = nearestBlueprint(cand._tier, blueprints);
    if (!bp) continue;
    plan.push({
      candidate: { id: cand.id, nome: cand.nome_playlist, seguidores: cand.seguidores, tier: cand._tier, score: Math.round(cand._score) },
      blueprint: { id: bp.id, name: bp.name, tier: bp.tier },
      account: { id: acc.id, spotify_user_id: acc.spotify_user_id, display_name: acc.display_name },
    });
  }

  if (dryRun) {
    return jr({ ok: true, dry_run: true, candidates_found: candidates.length, plan });
  }

  // 4) Executa o plano: cria replication → gera template → aprova → cria no Spotify
  const results: any[] = [];

  for (const step of plan) {
    const { candidate, blueprint, account } = step;

    // Cria registro de replicação
    const { data: rep, error: repErr } = await supabase.from("replications").insert({
      genre_id: body.genre_id,
      source_result_id: candidate.id,
      blueprint_id: blueprint.id,
      account_id: account.id,
      selection_score: candidate.score,
      status: "generating",
      triggered_by: triggeredBy,
    }).select("id").single();
    if (repErr || !rep) {
      results.push({ candidate: candidate.nome, error: `replication insert: ${repErr?.message}` });
      continue;
    }

    try {
      // Gera 1 template
      const gen = await callFn("generate-templates", { blueprint_id: blueprint.id, count: 1 });
      if (!gen.ok || gen.data?.ok === false) throw new Error(gen.data?.error ?? `generate-templates ${gen.status}`);
      const tplId = gen.data?.templates?.[0]?.id;
      if (!tplId) throw new Error("generate-templates retornou sem template id");

      // Aprova automaticamente
      await supabase.from("playlist_templates").update({
        status: "approved",
        approved_at: new Date().toISOString(),
      }).eq("id", tplId);

      await supabase.from("replications").update({
        template_id: tplId,
        status: "approved",
      }).eq("id", rep.id);

      // Cria no Spotify usando a account específica
      const create = await callFn("create-spotify-playlist", {
        template_id: tplId,
        spotify_user_id: account.spotify_user_id,
        public: true,
      });
      if (!create.ok || create.data?.ok === false) throw new Error(create.data?.error ?? `create-spotify-playlist ${create.status}`);

      const spotifyId = create.data?.spotify_playlist_id;
      const spotifyUrl = create.data?.spotify_url;

      await supabase.from("replications").update({
        status: "created",
        spotify_playlist_id: spotifyId,
        spotify_url: spotifyUrl,
      }).eq("id", rep.id);

      // Incrementa contador da account
      await supabase.from("accounts").update({
        current_playlists: (eligibleAccounts.find(a => a.id === account.id)?.current_playlists ?? 0) + 1,
      }).eq("id", account.id);

      results.push({
        candidate: candidate.nome,
        account: account.display_name ?? account.spotify_user_id,
        spotify_url: spotifyUrl,
        tracks_added: create.data?.tracks_added,
        status: "created",
      });
    } catch (e) {
      const msg = (e as Error).message;
      await supabase.from("replications").update({
        status: "failed",
        error_message: msg.slice(0, 500),
      }).eq("id", rep.id);
      results.push({ candidate: candidate.nome, account: account.display_name, error: msg });
    }
  }

  await supabase.from("collection_logs").insert({
    genre_id: body.genre_id,
    acao: "replicate-top",
    status: "sucesso",
    mensagem: `Replicadas ${results.filter(r => r.status === "created").length}/${plan.length} (top ${topN}, gatilho ${triggeredBy})`,
    duracao_ms: Date.now() - startedAt,
  });

  return jr({
    ok: true,
    triggered_by: triggeredBy,
    candidates_found: candidates.length,
    executed: plan.length,
    succeeded: results.filter(r => r.status === "created").length,
    failed: results.filter(r => r.error).length,
    results,
  });
});
