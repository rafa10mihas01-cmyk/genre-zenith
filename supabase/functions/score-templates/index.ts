// score-templates — calcula final_score (0-100) e quality_tier para templates pendentes.
// Fórmula:
//   40% replication_score (já vem 0-100)
//   25% qualidade de tracks (% com spotify_track_id válido)
//   15% força da fonte (selo/spotify do blueprint origem)
//   10% aderência ao DNA (keywords do template ⋂ palavras_chave do gênero)
//   10% nome+keywords (heurística leve: comprimento + nº keywords + emojis)
//
// Tier:
//   final_score >= 75 → hot   (🔥)  + dispara generate-cover-variations
//   45-74            → medium (⚠️)
//   < 45             → weak   (❌)  + status='archived' (some da UI principal)
//
// POST { template_ids?: string[], blueprint_id?: string, force?: boolean }
// Sem body = ranqueia TODOS os templates pending sem score.
import { corsHeaders } from "npm:@supabase/supabase-js/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { sourceMultiplier } from "../_shared/labels.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function clamp(n: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, n));
}

function scoreTracks(seeds: any[]): number {
  // % de track_seeds com spotify_track_id válido + bônus por quantidade adequada (10-20)
  if (!Array.isArray(seeds) || seeds.length === 0) return 0;
  const withId = seeds.filter((s) => !!s?.spotify_track_id).length;
  const pct = (withId / seeds.length) * 100;
  // Penaliza tracklists curtas demais (<8) e exageradas (>30)
  const len = seeds.length;
  let lenBonus = 0;
  if (len >= 10 && len <= 25) lenBonus = 10;
  else if (len >= 8) lenBonus = 5;
  return clamp(pct * 0.9 + lenBonus);
}

function scoreSource(blueprint: any): number {
  // Source = força do blueprint origem. Multiplicador 2.5 (selo/spotify) → 100, 1.0 (user) → 40.
  // Também considera tier do blueprint (top/medium/low) e sample_size.
  const sources = Array.isArray(blueprint?.source_playlists) ? blueprint.source_playlists : [];
  if (sources.length === 0) return 30;
  const avgMult = sources
    .slice(0, 5)
    .map((p: any) => sourceMultiplier(p?.owner_type))
    .reduce((a: number, b: number) => a + b, 0) / Math.min(sources.length, 5);
  // avgMult vai de 1.0 a 2.5 → mapeia pra 40-100
  const fromMult = ((avgMult - 1.0) / 1.5) * 60 + 40;
  // Bônus tier do blueprint
  const tierBonus = blueprint?.tier === "top" ? 10 : blueprint?.tier === "medium" ? 5 : 0;
  return clamp(fromMult + tierBonus);
}

function scoreDna(templateKeywords: any[], genreKeywords: any[]): number {
  if (!Array.isArray(templateKeywords) || templateKeywords.length === 0) return 50;
  const tKws = new Set(
    templateKeywords
      .map((k) => (typeof k === "string" ? k : k?.value ?? "").toLowerCase().trim())
      .filter(Boolean),
  );
  const gKws = new Set(
    (Array.isArray(genreKeywords) ? genreKeywords : [])
      .map((k) => (typeof k === "string" ? k : k?.value ?? "").toLowerCase().trim())
      .filter(Boolean),
  );
  if (gKws.size === 0) return 60; // sem dados do gênero, score neutro
  let hits = 0;
  for (const k of tKws) if (gKws.has(k)) hits++;
  const overlap = hits / tKws.size;
  return clamp(overlap * 100);
}

function scoreNaming(name: string, keywords: any[]): number {
  if (!name || typeof name !== "string") return 0;
  const len = name.trim().length;
  const wordCount = name.trim().split(/\s+/).length;
  // Nome bom: 12-50 chars, 3-7 palavras
  let nameScore = 0;
  if (len >= 12 && len <= 50 && wordCount >= 3 && wordCount <= 7) nameScore = 70;
  else if (len >= 8 && len <= 60) nameScore = 50;
  else nameScore = 25;
  // Bônus por ter keywords (5-8 ideal)
  const kwCount = Array.isArray(keywords) ? keywords.length : 0;
  const kwBonus = kwCount >= 5 && kwCount <= 8 ? 30 : kwCount >= 3 ? 15 : 0;
  return clamp(nameScore + kwBonus);
}

function tierFromScore(score: number): "hot" | "medium" | "weak" {
  if (score >= 75) return "hot";
  if (score >= 45) return "medium";
  return "weak";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jr({ error: "POST only" }, 405);

  let body: { template_ids?: string[]; blueprint_id?: string; force?: boolean } = {};
  try { body = await req.json(); } catch { /* sem body é ok */ }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  // Seleciona templates a pontuar
  let q = supabase
    .from("playlist_templates")
    .select("id,name,blueprint_id,genre_id,track_seeds,keywords,replication_score,status,scored_at,quality_tier")
    .in("status", ["pending"])
    .limit(500);

  if (body.template_ids && body.template_ids.length > 0) {
    q = q.in("id", body.template_ids);
  } else if (body.blueprint_id) {
    q = q.eq("blueprint_id", body.blueprint_id);
  } else if (!body.force) {
    // Default: só os ainda não pontuados
    q = q.is("scored_at", null);
  }

  const { data: templates, error: tplErr } = await q;
  if (tplErr) return jr({ ok: false, error: tplErr.message }, 500);
  if (!templates || templates.length === 0) {
    return jr({ ok: true, scored: 0, message: "nenhum template pra pontuar" });
  }

  // Pre-fetch blueprints e genre_models necessários
  const blueprintIds = [...new Set(templates.map((t) => t.blueprint_id))];
  const genreIds = [...new Set(templates.map((t) => t.genre_id))];

  const [{ data: blueprints }, { data: models }] = await Promise.all([
    supabase.from("playlist_blueprints").select("id,tier,source_playlists,sample_size").in("id", blueprintIds),
    supabase.from("genre_models").select("genre_id,palavras_chave").in("genre_id", genreIds),
  ]);

  const bpMap = new Map((blueprints ?? []).map((b) => [b.id, b]));
  const modelMap = new Map((models ?? []).map((m) => [m.genre_id, m]));

  let countHot = 0, countMed = 0, countWeak = 0;
  const updates: any[] = [];
  const hotIds: string[] = [];

  for (const t of templates) {
    const bp = bpMap.get(t.blueprint_id);
    const model = modelMap.get(t.genre_id);

    const sReplication = clamp(Number(t.replication_score ?? 0));
    const sTracks = scoreTracks(Array.isArray(t.track_seeds) ? t.track_seeds : []);
    const sSource = scoreSource(bp);
    const sDna = scoreDna(
      Array.isArray(t.keywords) ? t.keywords : [],
      Array.isArray(model?.palavras_chave) ? model!.palavras_chave : [],
    );
    const sNaming = scoreNaming(t.name, Array.isArray(t.keywords) ? t.keywords : []);

    const finalScore = clamp(
      sReplication * 0.40 +
      sTracks * 0.25 +
      sSource * 0.15 +
      sDna * 0.10 +
      sNaming * 0.10
    );

    const tier = tierFromScore(finalScore);
    if (tier === "hot") countHot++;
    else if (tier === "medium") countMed++;
    else countWeak++;

    const update: any = {
      id: t.id,
      final_score: Math.round(finalScore * 100) / 100,
      quality_tier: tier,
      score_breakdown: {
        replication: Math.round(sReplication),
        tracks: Math.round(sTracks),
        source: Math.round(sSource),
        dna: Math.round(sDna),
        naming: Math.round(sNaming),
      },
      scored_at: new Date().toISOString(),
    };

    // Auto-arquiva fracos
    if (tier === "weak") {
      update.status = "archived";
      update.rejection_reason = "auto-arquivado: score insuficiente";
    }

    // Marca hot pra geração de capa (se ainda não foi pedida)
    if (tier === "hot") hotIds.push(t.id);

    updates.push(update);
  }

  // Aplica updates em lote (um por um — Supabase não tem batch update nativo)
  for (const u of updates) {
    const { id, ...patch } = u;
    await supabase.from("playlist_templates").update(patch).eq("id", id);
  }

  // Dispara geração de capa pros hot que ainda não tinham (fire-and-forget)
  // Faz async pra não travar a resposta
  if (hotIds.length > 0) {
    const { data: hotPending } = await supabase
      .from("playlist_templates")
      .select("id")
      .in("id", hotIds)
      .eq("auto_cover_requested", false)
      .is("cover_image_url", null);

    const toGen = (hotPending ?? []).map((r) => r.id);
    if (toGen.length > 0) {
      await supabase.from("playlist_templates")
        .update({ auto_cover_requested: true })
        .in("id", toGen);

      // dispara em background sem await
      (async () => {
        for (const id of toGen) {
          try {
            await fetch(`${SUPABASE_URL}/functions/v1/generate-cover-variations`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${SERVICE_KEY}`,
              },
              body: JSON.stringify({ template_id: id }),
            });
          } catch (e) {
            console.warn(`[score-templates] cover gen failed for ${id}:`, (e as Error).message);
          }
        }
      })();
    }
  }

  await supabase.from("collection_logs").insert({
    acao: "score-templates",
    status: "sucesso",
    mensagem: `${updates.length} pontuados (🔥 ${countHot} / ⚠️ ${countMed} / ❌ ${countWeak}), ${hotIds.length} capas auto-disparadas`,
  }).then(() => {}, () => {});

  return jr({
    ok: true,
    scored: updates.length,
    breakdown: { hot: countHot, medium: countMed, weak: countWeak },
    auto_covers_triggered: hotIds.length,
  });
});
