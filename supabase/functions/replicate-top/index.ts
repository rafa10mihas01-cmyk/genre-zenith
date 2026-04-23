// replicate-top — GERADOR DE PACOTE DE REPLICAÇÃO (somente dados).
//
// ⚠️ ESTA FUNÇÃO NUNCA CRIA PLAYLIST NO SPOTIFY.
//    Ela apenas seleciona TOP playlists do gênero, escolhe blueprints compatíveis
//    e devolve o pacote pra revisão/aprovação manual.
//
// Fluxo:
//   1) Seleciona TOP N playlists do gênero (score = followers * quality).
//   2) Garante que existam blueprints (auto-roda extract-blueprints se faltar).
//   3) Pra cada candidata, escolhe um blueprint compatível (mesmo tier ou próximo).
//   4) Devolve o "plano" — sem criar nada no Spotify, sem aprovar template.
//
// POST { genre_id, top_n?=5, triggered_by?='manual' }
// 🚫 BLOQUEIO: qualquer body com mode==="execute" é rejeitado.
import { corsHeaders } from "npm:@supabase/supabase-js/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface Body {
  genre_id: string;
  top_n?: number;
  triggered_by?: "manual" | "cron" | "batch";
  // Compat: aceitos mas IGNORADOS — replicação nunca executa.
  dry_run?: boolean;
  mode?: string;
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
const PRIORITY_WEIGHT: Record<string, number> = { alta: 2, media: 1, baixa: 0 };

function nearestBlueprint(targetTier: string, blueprints: any[]): any | null {
  if (blueprints.length === 0) return null;
  const eligible = blueprints.filter(b => (b.replication_priority ?? "media") !== "baixa");
  if (eligible.length === 0) return null;
  const exact = eligible
    .filter(b => b.tier === targetTier)
    .sort((a, b) =>
      (PRIORITY_WEIGHT[b.replication_priority ?? "media"] - PRIORITY_WEIGHT[a.replication_priority ?? "media"]) ||
      (Number(b.replication_score) - Number(a.replication_score))
    );
  if (exact.length > 0) return exact[0];
  const targetIdx = TIER_ORDER.indexOf(targetTier as any);
  return [...eligible]
    .map(b => ({ b, dist: Math.abs(TIER_ORDER.indexOf(b.tier) - targetIdx) }))
    .sort((a, b) =>
      a.dist - b.dist ||
      (PRIORITY_WEIGHT[b.b.replication_priority ?? "media"] - PRIORITY_WEIGHT[a.b.replication_priority ?? "media"]) ||
      (Number(b.b.replication_score) - Number(a.b.replication_score))
    )[0]?.b ?? null;
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

  // 🚫 BLOQUEIO DE SEGURANÇA — replicação NUNCA executa criação no Spotify.
  if (body.mode === "execute" || body.mode === "create" || body.mode === "publish") {
    return jr({
      ok: false,
      error: "🚫 replicate-top é APENAS gerador de pacote. Use create-spotify-playlist com template aprovado pra publicar no Spotify.",
    }, 400);
  }

  const topN = Math.max(1, Math.min(body.top_n ?? 5, 20));
  const triggeredBy = body.triggered_by ?? "manual";

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  const startedAt = Date.now();

  // 1) Carrega blueprints + replicações já feitas (anti-duplicação)
  let { data: blueprints } = await supabase
    .from("playlist_blueprints")
    .select("id,tier,name,replication_score,replication_priority,replication_reason,performance_source")
    .eq("genre_id", body.genre_id)
    .eq("status", "active");

  // 2) Se não houver blueprints, tenta gerar automaticamente antes de falhar
  if (!blueprints || blueprints.length === 0) {
    const ext = await callFn("extract-blueprints", { genre_id: body.genre_id, max_per_tier: 5, force: false });
    if (ext.ok && ext.data?.ok !== false) {
      const { data: refreshed } = await supabase
        .from("playlist_blueprints")
        .select("id,tier,name,replication_score,replication_priority,replication_reason,performance_source")
        .eq("genre_id", body.genre_id)
        .eq("status", "active");
      blueprints = refreshed ?? [];
    }
    if (!blueprints || blueprints.length === 0) {
      return jr({
        ok: false,
        error: "Nenhum blueprint disponível e extract-blueprints não conseguiu gerar. Rode o Cérebro primeiro pra coletar dados.",
      }, 400);
    }
  }

  const { data: alreadyReplicated } = await supabase
    .from("replications")
    .select("source_result_id")
    .eq("genre_id", body.genre_id)
    .in("status", ["created", "approved", "generating", "pending", "package"]);
  const replicatedIds = new Set((alreadyReplicated ?? []).map(r => r.source_result_id).filter(Boolean));

  // 3) TOP N candidatas — score híbrido prioriza:
  //    a) playlists oficiais Spotify (owner_type='spotify') = curadoria editorial → tendência real
  //    b) playlists grandes de usuários (100k+) = validação social
  //    Multipliers ficam inertes se owner_type vier null (compat com dados antigos).
  const { data: pool, error: poolErr } = await supabase
    .from("search_results")
    .select("id,nome_playlist,seguidores,quality_score,total_musicas,spotify_url,followers_source,followers_verified_at,owner_id,owner_type")
    .eq("genre_id", body.genre_id)
    .eq("is_valid", true)
    .eq("followers_source", "spotify_api")
    .not("followers_verified_at", "is", null)
    .not("seguidores", "is", null)
    .gt("quality_score", 60)
    .order("seguidores", { ascending: false })
    .limit(100);
  if (poolErr) return jr({ ok: false, error: poolErr.message }, 500);

  const candidates = (pool ?? [])
    .filter(p => !replicatedIds.has(p.id))
    .map(p => {
      const baseScore = (p.seguidores ?? 0) * ((Number(p.quality_score) || 50) / 100);
      // Oficial Spotify vale 2.5× — captura tendência editorial real
      const sourceMult = p.owner_type === "spotify" ? 2.5 : 1.0;
      // Bonus por nome editorial (Top, Viral, Hits) — mesmo sendo de usuário, indica padrão de curadoria
      const editorialBonus = /\b(top|viral|hits|charts|novidades)\b/i.test(p.nome_playlist ?? "") ? 1.2 : 1.0;
      return {
        ...p,
        _score: baseScore * sourceMult * editorialBonus,
        _tier: tierFor(p.seguidores ?? 0),
        _source_label: p.owner_type === "spotify" ? "oficial_spotify" : (p.owner_type === "user" ? "user_grande" : "desconhecido"),
      };
    })
    .sort((a, b) => b._score - a._score)
    .slice(0, topN);

  if (candidates.length === 0) {
    return jr({ ok: false, error: "Nenhuma playlist elegível pra replicação (todas já replicadas ou abaixo do threshold de qualidade)." }, 400);
  }

  // 4) Monta o pacote: candidata ↔ blueprint compatível
  const plan: any[] = [];
  for (const cand of candidates) {
    const bp = nearestBlueprint(cand._tier, blueprints);
    if (!bp) continue;
    plan.push({
      candidate: {
        id: cand.id,
        nome: cand.nome_playlist,
        seguidores: cand.seguidores,
        tier: cand._tier,
        score: Math.round(cand._score),
        spotify_url: cand.spotify_url,
        source: cand._source_label,
        owner_id: cand.owner_id ?? null,
      },
      blueprint: {
        id: bp.id,
        name: bp.name,
        tier: bp.tier,
        priority: bp.replication_priority ?? "media",
        reason: bp.replication_reason ?? null,
        performance_source: bp.performance_source ?? null,
      },
    });
  }

  // 5) Log final — REPLICAÇÃO NUNCA TOCA NO SPOTIFY
  await supabase.from("collection_logs").insert({
    genre_id: body.genre_id,
    acao: "replicate-top",
    status: "sucesso",
    mensagem: `REPLICAÇÃO FINALIZADA — pacote gerado com ${plan.length} item(ns) • nenhum envio ao Spotify (gatilho ${triggeredBy})`,
    duracao_ms: Date.now() - startedAt,
  });

  return jr({
    ok: true,
    mode: "package_only",
    spotify_calls: 0,
    triggered_by: triggeredBy,
    candidates_found: candidates.length,
    plan,
    message: "Pacote gerado. Nenhuma playlist criada no Spotify.",
  });
});
