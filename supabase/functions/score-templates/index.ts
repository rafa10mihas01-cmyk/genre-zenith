// score-templates — calcula final_score (0-100), quality_tier e aplica CAP de 30% pros hot.
// Fórmula:
//   40% replication_score (já vem 0-100)
//   25% qualidade de tracks (% com spotify_track_id válido)
//   15% força da fonte (selo/spotify do blueprint origem)
//   10% aderência ao DNA (keywords do template ⋂ palavras_chave do gênero)
//   10% nome+keywords (heurística leve: comprimento + nº keywords + emojis)
//
// Tier (com CAP):
//   - Score >= 75 É CANDIDATO a hot
//   - Apenas TOP 30% (configurável via hot_cap_pct) viram hot de fato
//   - Excedentes que pontuariam hot caem pra medium
//   - 45-74 → medium (⚠️)
//   - < 45  → weak (❌) → status='archived'
//
// Capas: dispara generate-cover-variations APENAS pros hot finais
// que ainda não têm cover_variations.
//
// POST { template_ids?: string[], blueprint_id?: string, force?: boolean, hot_cap_pct?: number }
import { corsHeaders } from "npm:@supabase/supabase-js/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { sourceMultiplier } from "../_shared/labels.ts";
import { requireTeamAccess } from "../_shared/auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DEFAULT_HOT_CAP = 0.30; // 30% do total elegível
const HOT_MIN_SCORE = 75;     // só pode ser hot se >= 75

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
  if (!Array.isArray(seeds) || seeds.length === 0) return 0;
  const withId = seeds.filter((s) => !!s?.spotify_track_id).length;
  const pct = (withId / seeds.length) * 100;
  const len = seeds.length;
  let lenBonus = 0;
  if (len >= 10 && len <= 25) lenBonus = 10;
  else if (len >= 8) lenBonus = 5;
  return clamp(pct * 0.9 + lenBonus);
}

function scoreSource(blueprint: any): number {
  const sources = Array.isArray(blueprint?.source_playlists) ? blueprint.source_playlists : [];
  if (sources.length === 0) return 30;
  const avgMult = sources
    .slice(0, 5)
    .map((p: any) => sourceMultiplier(p?.owner_type))
    .reduce((a: number, b: number) => a + b, 0) / Math.min(sources.length, 5);
  const fromMult = ((avgMult - 1.0) / 1.5) * 60 + 40;
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
  if (gKws.size === 0) return 60;
  let hits = 0;
  for (const k of tKws) if (gKws.has(k)) hits++;
  const overlap = hits / tKws.size;
  return clamp(overlap * 100);
}

function scoreNaming(name: string, keywords: any[]): number {
  if (!name || typeof name !== "string") return 0;
  const len = name.trim().length;
  const wordCount = name.trim().split(/\s+/).length;
  let nameScore = 0;
  if (len >= 12 && len <= 50 && wordCount >= 3 && wordCount <= 7) nameScore = 70;
  else if (len >= 8 && len <= 60) nameScore = 50;
  else nameScore = 25;
  const kwCount = Array.isArray(keywords) ? keywords.length : 0;
  const kwBonus = kwCount >= 5 && kwCount <= 8 ? 30 : kwCount >= 3 ? 15 : 0;
  return clamp(nameScore + kwBonus);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "OPTIONS") {
    const guard = await requireTeamAccess(req);
    if (!guard.ok) return guard.resp;
  }
  if (req.method !== "POST") return jr({ error: "POST only" }, 405);

  let body: { template_ids?: string[]; blueprint_id?: string; force?: boolean; hot_cap_pct?: number } = {};
  try { body = await req.json(); } catch { /* sem body é ok */ }

  const hotCap = typeof body.hot_cap_pct === "number" && body.hot_cap_pct > 0 && body.hot_cap_pct <= 1
    ? body.hot_cap_pct
    : DEFAULT_HOT_CAP;

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
    q = q.is("scored_at", null);
  }

  const { data: templates, error: tplErr } = await q;
  if (tplErr) return jr({ ok: false, error: tplErr.message }, 500);
  if (!templates || templates.length === 0) {
    return jr({ ok: true, scored: 0, message: "nenhum template pra pontuar" });
  }

  // Pre-fetch blueprints e genre_models
  const blueprintIds = [...new Set(templates.map((t) => t.blueprint_id))];
  const genreIds = [...new Set(templates.map((t) => t.genre_id))];

  const [{ data: blueprints }, { data: models }] = await Promise.all([
    supabase.from("playlist_blueprints").select("id,tier,source_playlists,sample_size").in("id", blueprintIds),
    supabase.from("genre_models").select("genre_id,palavras_chave").in("genre_id", genreIds),
  ]);

  const bpMap = new Map((blueprints ?? []).map((b) => [b.id, b]));
  const modelMap = new Map((models ?? []).map((m) => [m.genre_id, m]));

  // FASE 1: calcula score de todos
  type Scored = {
    id: string;
    finalScore: number;
    breakdown: Record<string, number>;
  };
  const scored: Scored[] = [];

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

    scored.push({
      id: t.id,
      finalScore,
      breakdown: {
        replication: Math.round(sReplication),
        tracks: Math.round(sTracks),
        source: Math.round(sSource),
        dna: Math.round(sDna),
        naming: Math.round(sNaming),
      },
    });
  }

  // FASE 2: aplica CAP de 30% nos hot
  // Para o cap, considera o universo TOTAL de templates pending (não só os pontuados agora)
  // — assim o cap reflete a distribuição real.
  const { count: totalPendingCount } = await supabase
    .from("playlist_templates")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");

  const universe = Math.max(totalPendingCount ?? scored.length, scored.length);
  const maxHotAllowed = Math.max(1, Math.floor(universe * hotCap));

  // Quantos hot já existem fora deste batch?
  const idsBeingScored = new Set(scored.map((s) => s.id));
  const { data: existingHot } = await supabase
    .from("playlist_templates")
    .select("id,final_score")
    .eq("status", "pending")
    .eq("quality_tier", "hot");

  const existingHotOutside = (existingHot ?? []).filter((h) => !idsBeingScored.has(h.id));
  const remainingHotSlots = Math.max(0, maxHotAllowed - existingHotOutside.length);

  // Ordena candidatos a hot por score desc
  const hotCandidates = scored
    .filter((s) => s.finalScore >= HOT_MIN_SCORE)
    .sort((a, b) => b.finalScore - a.finalScore);

  const promotedHotIds = new Set(hotCandidates.slice(0, remainingHotSlots).map((c) => c.id));

  // FASE 3: define tier final + monta updates
  let countHot = 0, countMed = 0, countWeak = 0;
  const updates: any[] = [];
  const hotIds: string[] = [];

  for (const s of scored) {
    let tier: "hot" | "medium" | "weak";
    if (s.finalScore < 45) tier = "weak";
    else if (s.finalScore >= HOT_MIN_SCORE && promotedHotIds.has(s.id)) tier = "hot";
    else tier = "medium";

    if (tier === "hot") { countHot++; hotIds.push(s.id); }
    else if (tier === "medium") countMed++;
    else countWeak++;

    const update: any = {
      id: s.id,
      final_score: Math.round(s.finalScore * 100) / 100,
      quality_tier: tier,
      score_breakdown: s.breakdown,
      scored_at: new Date().toISOString(),
    };

    if (tier === "weak") {
      update.status = "archived";
      update.archived_at = new Date().toISOString();
      update.archived_reason = "weak_score";
      update.rejection_reason = "auto-arquivado: score insuficiente";
    }

    updates.push(update);
  }

  // Aplica updates
  for (const u of updates) {
    const { id, ...patch } = u;
    await supabase.from("playlist_templates").update(patch).eq("id", id);
  }

  // Dispara capas SOMENTE pros hot finais SEM cover_variations existentes
  if (hotIds.length > 0) {
    const { data: hotNeedingCover } = await supabase
      .from("playlist_templates")
      .select("id,cover_variations,cover_image_url,auto_cover_requested")
      .in("id", hotIds);

    const toGen = (hotNeedingCover ?? [])
      .filter((r) => {
        const hasVariations = Array.isArray(r.cover_variations) && r.cover_variations.length > 0;
        return !r.auto_cover_requested && !r.cover_image_url && !hasVariations;
      })
      .map((r) => r.id);

    if (toGen.length > 0) {
      await supabase.from("playlist_templates")
        .update({ auto_cover_requested: true })
        .in("id", toGen);

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
    mensagem: `${updates.length} pontuados | cap ${Math.round(hotCap * 100)}% (max ${maxHotAllowed}, slots ${remainingHotSlots}) | 🔥 ${countHot} / ⚠️ ${countMed} / ❌ ${countWeak}`,
  }).then(() => {}, () => {});

  // 🔔 Notificação INFO para cada template HOT criado
  if (countHot > 0) {
    await supabase.rpc("create_notification", {
      p_type: "info",
      p_title: countHot === 1 ? "Novo template HOT 🔥" : `${countHot} templates HOT criados 🔥`,
      p_message: `Score alto detectado. Pronto para revisar e publicar.`,
      p_action_url: "/criacao",
      p_metadata: { hot_count: countHot, total_scored: updates.length },
    }).then(() => {}, () => {});
  }

  return jr({
    ok: true,
    scored: updates.length,
    cap: { pct: hotCap, max_allowed: maxHotAllowed, slots_used_outside: existingHotOutside.length, slots_in_batch: remainingHotSlots },
    breakdown: { hot: countHot, medium: countMed, weak: countWeak },
    auto_covers_triggered: hotIds.length,
  });
});
