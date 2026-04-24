// genre-autopilot — Pipeline completo "Usar inteligência"
//
// Orquestra em sequência (sem intervenção manual):
//   1. analyze-genre              (cache 24h)
//   2. generate-playlists-briefing (cache 7d)
//   3. extract-blueprints         (reusa se já existe blueprint ativo)
//   4. generate-templates         (sempre novos, máx 5)
//   5. generate-cover-variations  (1 por template, só se faltar)
//   6. auto-aprovar templates HOT (score≥75 + tier=hot + ≥25 tracks)
//   7. replicate-top              (gera pacote, NÃO publica)
//
// Atualiza public.autopilot_runs a cada passo (frontend escuta via realtime).
//
// POST { genre_id: string, max_templates?: number }
//   → { ok, run_id }                (resposta imediata; trabalho continua em background)
//
// Cooldown: 1 execução por gênero por hora.
import { corsHeaders } from "npm:@supabase/supabase-js/cors";
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";
import { requireTeamAccess } from "../_shared/auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const COOLDOWN_MS = 60 * 60 * 1000;        // 1h
const ANALYZE_CACHE_MS = 24 * 60 * 60 * 1000; // 24h
const BRIEFING_CACHE_MS = 7 * 24 * 60 * 60 * 1000; // 7d
// Teto de segurança quando o body força um número (ou quando algo der errado no cálculo dinâmico).
const HARD_CAP_TEMPLATES = 10;
const FALLBACK_TEMPLATES = 4; // mesmo valor de base_daily padrão

// Auto-aprovação — 25 tracks é apenas critério de VALIDAÇÃO do template.
// O tamanho real da playlist é definido em generate-templates (proporção da playlist base ±20%, ou 40-60 se não houver base).
const APPROVE_MIN_SCORE = 75;
const APPROVE_TIER = "hot";
const APPROVE_MIN_TRACKS = 25;

type Step =
  | "analyze"
  | "briefing"
  | "blueprints"
  | "templates"
  | "covers"
  | "approve"
  | "replicate"
  | "done";

const STEP_ORDER: Step[] = [
  "analyze", "briefing", "blueprints", "templates", "covers", "approve", "replicate", "done",
];

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function progressFor(step: Step): number {
  const idx = STEP_ORDER.indexOf(step);
  return Math.round((idx / (STEP_ORDER.length - 1)) * 100);
}

async function updateRun(
  sb: SupabaseClient,
  runId: string,
  patch: Record<string, unknown>,
) {
  const { error } = await sb.from("autopilot_runs").update(patch).eq("id", runId);
  if (error) console.error("[autopilot] updateRun error:", error.message);
}

async function setStep(
  sb: SupabaseClient,
  runId: string,
  step: Step,
  extra: Record<string, unknown> = {},
) {
  await updateRun(sb, runId, {
    current_step: step,
    progress_pct: progressFor(step),
    ...extra,
  });
}

async function pushCompleted(
  sb: SupabaseClient,
  runId: string,
  step: Step,
  meta: Record<string, unknown> = {},
) {
  const { data } = await sb.from("autopilot_runs").select("steps_completed").eq("id", runId).maybeSingle();
  const arr = Array.isArray(data?.steps_completed) ? data!.steps_completed : [];
  arr.push({ step, at: new Date().toISOString(), ...meta });
  await updateRun(sb, runId, { steps_completed: arr });
}

async function invokeFn<T = any>(
  fnName: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; data?: T; error?: string }> {
  try {
    const resp = await fetch(`${SUPABASE_URL}/functions/v1/${fnName}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const text = await resp.text();
    let data: any;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    if (!resp.ok) return { ok: false, error: data?.error ?? `HTTP ${resp.status}` };
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ============================================================
// PIPELINE — roda em background depois que respondemos ao cliente
// ============================================================
async function runPipeline(
  sb: SupabaseClient,
  runId: string,
  genreId: string,
  maxTemplates: number,
  targetMeta: Record<string, unknown> = {},
) {
  const startedAt = Date.now();
  const cacheHits: Record<string, boolean> = {};
  let templatesGenerated = 0;
  let templatesApproved = 0;
  let coversGenerated = 0;

  try {
    // ─── 1. ANALYZE ──────────────────────────────────────────────
    await setStep(sb, runId, "analyze");
    const { data: model } = await sb
      .from("genre_models")
      .select("ultima_analise")
      .eq("genre_id", genreId)
      .maybeSingle();

    const analyzeAge = model?.ultima_analise
      ? Date.now() - new Date(model.ultima_analise).getTime()
      : Number.POSITIVE_INFINITY;

    if (analyzeAge < ANALYZE_CACHE_MS) {
      cacheHits.analyze = true;
      await pushCompleted(sb, runId, "analyze", { cached: true });
    } else {
      const r = await invokeFn("analyze-genre", { genre_id: genreId });
      if (!r.ok) throw new Error(`analyze-genre falhou: ${r.error}`);
      await pushCompleted(sb, runId, "analyze", { cached: false });
    }

    // ─── 2. BRIEFING ─────────────────────────────────────────────
    await setStep(sb, runId, "briefing");
    const { data: brief } = await sb
      .from("playlist_briefings")
      .select("created_at")
      .eq("genre_id", genreId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const briefingAge = brief?.created_at
      ? Date.now() - new Date(brief.created_at).getTime()
      : Number.POSITIVE_INFINITY;

    if (briefingAge < BRIEFING_CACHE_MS) {
      cacheHits.briefing = true;
      await pushCompleted(sb, runId, "briefing", { cached: true });
    } else {
      const r = await invokeFn("generate-playlists-briefing", { genre_id: genreId });
      if (!r.ok) throw new Error(`generate-playlists-briefing falhou: ${r.error}`);
      await pushCompleted(sb, runId, "briefing", { cached: false });
    }

    // ─── 3. BLUEPRINTS ───────────────────────────────────────────
    await setStep(sb, runId, "blueprints");
    const { data: existingBps } = await sb
      .from("playlist_blueprints")
      .select("id, replication_score, replication_priority, tier")
      .eq("genre_id", genreId)
      .eq("status", "active");

    let blueprints = existingBps ?? [];
    if (blueprints.length === 0) {
      const r = await invokeFn("extract-blueprints", { genre_id: genreId, max_per_tier: 5 });
      if (!r.ok) throw new Error(`extract-blueprints falhou: ${r.error}`);
      const { data: fresh } = await sb
        .from("playlist_blueprints")
        .select("id, replication_score, replication_priority, tier")
        .eq("genre_id", genreId)
        .eq("status", "active");
      blueprints = fresh ?? [];
      await pushCompleted(sb, runId, "blueprints", { count: blueprints.length, cached: false });
    } else {
      cacheHits.blueprints = true;
      await pushCompleted(sb, runId, "blueprints", { count: blueprints.length, cached: true });
    }

    if (blueprints.length === 0) {
      throw new Error("Nenhum blueprint disponível após extração — gênero sem dados suficientes");
    }

    // Top blueprints: prioridade alta primeiro, depois score
    const PRI: Record<string, number> = { alta: 2, media: 1, baixa: 0 };
    const ranked = [...blueprints].sort(
      (a, b) =>
        (PRI[b.replication_priority ?? "media"] - PRI[a.replication_priority ?? "media"]) ||
        (Number(b.replication_score) - Number(a.replication_score)),
    );

    // ─── 4. TEMPLATES ────────────────────────────────────────────
    // Sempre gera novos. Distribui maxTemplates entre top blueprints (1-2 por blueprint).
    await setStep(sb, runId, "templates");
    const remaining = maxTemplates;
    const generated: string[] = [];
    let perBp = Math.max(1, Math.ceil(remaining / Math.min(ranked.length, 3)));
    for (const bp of ranked) {
      if (generated.length >= maxTemplates) break;
      const needed = Math.min(perBp, maxTemplates - generated.length);
      const r = await invokeFn<{ templates?: { id: string }[] }>("generate-templates", {
        blueprint_id: bp.id,
        count: needed,
      });
      if (!r.ok) {
        console.warn(`[autopilot] generate-templates falhou pro blueprint ${bp.id}: ${r.error}`);
        continue;
      }
      const ids = (r.data?.templates ?? []).map((t) => t.id).filter(Boolean);
      generated.push(...ids);
    }
    templatesGenerated = generated.length;
    await updateRun(sb, runId, { templates_generated: templatesGenerated });
    await pushCompleted(sb, runId, "templates", { count: templatesGenerated });

    if (templatesGenerated === 0) {
      throw new Error("Nenhum template foi gerado — verificar blueprints/IA");
    }

    // ─── 5. CAPAS ────────────────────────────────────────────────
    await setStep(sb, runId, "covers");
    const { data: tplsForCovers } = await sb
      .from("playlist_templates")
      .select("id, cover_image_url, cover_variations")
      .in("id", generated);

    for (const tpl of tplsForCovers ?? []) {
      const hasCover = tpl.cover_image_url || (Array.isArray(tpl.cover_variations) && tpl.cover_variations.length > 0);
      if (hasCover) continue;
      const r = await invokeFn("generate-cover-variations", { template_id: tpl.id });
      if (r.ok) {
        coversGenerated++;
        // Seleciona index 0 automaticamente
        const variations = (r.data as any)?.variations ?? [];
        const first = variations[0];
        if (first?.url) {
          await sb.from("playlist_templates")
            .update({
              cover_image_url: first.url,
              cover_selected_index: 0,
            })
            .eq("id", tpl.id);
        }
      } else {
        console.warn(`[autopilot] generate-cover-variations falhou pro template ${tpl.id}: ${r.error}`);
      }
    }
    await updateRun(sb, runId, { covers_generated: coversGenerated });
    await pushCompleted(sb, runId, "covers", { count: coversGenerated });

    // ─── 6. AUTO-APROVAR ─────────────────────────────────────────
    // 🎯 score-templates roda em background (disparado por generate-templates).
    // Aguarda até ~30s pelos scores (poll a cada 2s). Sem isso, lê final_score=0 e nada é aprovado.
    await setStep(sb, runId, "approve");
    let candidates: any[] | null = null;
    for (let attempt = 0; attempt < 15; attempt++) {
      const { data } = await sb
        .from("playlist_templates")
        .select("id, final_score, quality_tier, tracks_added, track_seeds, status, scored_at")
        .in("id", generated);
      candidates = data ?? [];
      const allScored = candidates.length > 0 && candidates.every((t) => t.scored_at != null);
      if (allScored) break;
      await new Promise((r) => setTimeout(r, 2000));
    }

    for (const t of candidates ?? []) {
      if (t.status !== "pending") continue;
      const score = Number(t.final_score ?? 0);
      const tier = String(t.quality_tier ?? "");
      const tracksCount =
        Number(t.tracks_added ?? 0) ||
        (Array.isArray(t.track_seeds) ? t.track_seeds.length : 0);

      if (score >= APPROVE_MIN_SCORE && tier === APPROVE_TIER && tracksCount >= APPROVE_MIN_TRACKS) {
        const { error } = await sb
          .from("playlist_templates")
          .update({
            status: "approved",
            approved_at: new Date().toISOString(),
          })
          .eq("id", t.id);
        if (!error) templatesApproved++;
      }
    }
    await updateRun(sb, runId, { templates_approved: templatesApproved });
    await pushCompleted(sb, runId, "approve", {
      approved: templatesApproved,
      total: candidates?.length ?? 0,
    });

    // ─── 7. REPLICATE-TOP (pacote, não publica) ─────────────────
    await setStep(sb, runId, "replicate");
    const r = await invokeFn("replicate-top", {
      genre_id: genreId,
      top_n: maxTemplates,
      triggered_by: "autopilot",
    });
    if (!r.ok) {
      // Não é fatal — só logamos; pacote pode ser regerado depois
      console.warn(`[autopilot] replicate-top falhou: ${r.error}`);
      await pushCompleted(sb, runId, "replicate", { ok: false, error: r.error });
    } else {
      await pushCompleted(sb, runId, "replicate", { ok: true });
    }

    // ─── DONE ────────────────────────────────────────────────────
    const tierLabel = targetMeta.performance_tier ? ` · perf=${targetMeta.performance_tier}` : "";
    const scoreLabel = targetMeta.final_score != null ? ` (score=${Number(targetMeta.final_score).toFixed(2)})` : "";
    const targetLabel = targetMeta.target_today != null
      ? ` · alvo=${targetMeta.target_today}/dia (gerar=${maxTemplates})`
      : ` · gerar=${maxTemplates}`;
    const summary =
      `${templatesGenerated} templates gerados · ${templatesApproved} aprovados automaticamente · ${coversGenerated} capas criadas` +
      targetLabel + tierLabel + scoreLabel +
      (Object.keys(cacheHits).length ? ` · cache: ${Object.keys(cacheHits).join(", ")}` : "");

    await updateRun(sb, runId, {
      status: "success",
      current_step: "done",
      progress_pct: 100,
      cache_hits: cacheHits,
      summary,
      finished_at: new Date().toISOString(),
      duracao_ms: Date.now() - startedAt,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[autopilot] pipeline error:", msg);
    await updateRun(sb, runId, {
      status: "error",
      error_message: msg,
      finished_at: new Date().toISOString(),
      duracao_ms: Date.now() - startedAt,
      cache_hits: cacheHits,
      templates_generated: templatesGenerated,
      templates_approved: templatesApproved,
      covers_generated: coversGenerated,
    });
  }
}

// ============================================================
// HTTP handler
// ============================================================
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jr({ error: "method not allowed" }, 405);

  // 🔐 Exige sessão válida com role admin/curador (evita disparo anônimo de IA cara)
  const guard = await requireTeamAccess(req);
  if (!guard.ok) return guard.resp;

  let body: { genre_id?: string; max_templates?: number };
  try {
    body = await req.json();
  } catch {
    return jr({ error: "invalid json" }, 400);
  }

  const genreId = body.genre_id;
  if (!genreId || typeof genreId !== "string") {
    return jr({ error: "genre_id obrigatório" }, 400);
  }

  // Override opcional do client (limitado a 1..HARD_CAP). Quando ausente, target é 100% dinâmico.
  const explicitMax = body.max_templates != null
    ? Math.min(Math.max(1, Number(body.max_templates)), HARD_CAP_TEMPLATES)
    : null;

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 🧹 Limpa runs zumbis antes de checar concorrência (>30min sem update vira 'error')
  await sb.rpc("cleanup_stale_autopilot_runs", { p_minutes: 30 })
    .then(() => {}, (e) => console.warn("[autopilot] cleanup_stale failed:", e?.message));

  // ─ Cooldown + lock: já tem run em <1h? ─
  const since = new Date(Date.now() - COOLDOWN_MS).toISOString();
  const { data: recent } = await sb
    .from("autopilot_runs")
    .select("id, status, started_at")
    .eq("genre_id", genreId)
    .gte("started_at", since)
    .order("started_at", { ascending: false })
    .limit(1);

  if (recent && recent.length > 0) {
    const r = recent[0];
    if (r.status === "running") {
      return jr({ ok: false, error: "Já existe uma execução em andamento", run_id: r.id }, 409);
    }
    if (r.status === "success") {
      const minutesAgo = Math.round((Date.now() - new Date(r.started_at).getTime()) / 60000);
      return jr(
        {
          ok: false,
          error: `Cooldown ativo: última execução bem-sucedida foi há ${minutesAgo}min. Aguarde ${60 - minutesAgo}min.`,
          run_id: r.id,
        },
        429,
      );
    }
    // status === 'error' → permite tentar de novo
  }

  // ─ Valida gênero ─
  const { data: genre } = await sb
    .from("genres")
    .select("id, nome")
    .eq("id", genreId)
    .maybeSingle();
  if (!genre) return jr({ error: "Gênero não encontrado" }, 404);

  // ─ Calcula target dinâmico v2 (média ponderada por followers, mix 3d+7d, contagem hoje em SP) ─
  let targetMeta: Record<string, unknown> = {};
  let dynamicRemaining: number | null = null;
  try {
    const { data: targetRows, error: targetErr } = await sb.rpc("get_genre_daily_target_v2", {
      p_genre_id: genreId,
    });
    if (targetErr) {
      console.warn("[autopilot] get_genre_daily_target_v2 erro:", targetErr.message);
    } else if (Array.isArray(targetRows) && targetRows.length > 0) {
      targetMeta = targetRows[0] as Record<string, unknown>;
      dynamicRemaining = Number(targetMeta.remaining ?? 0);
    }
  } catch (e) {
    console.warn("[autopilot] get_genre_daily_target_v2 exception:", e instanceof Error ? e.message : String(e));
  }

  // Se já atingiu o alvo do dia (e não é override manual), não cria run nem gasta IA
  if (explicitMax == null && dynamicRemaining != null && dynamicRemaining <= 0) {
    return jr({
      ok: false,
      error: `Meta diária já atingida (${targetMeta.generated_today}/${targetMeta.target_today}). Tente novamente após 00h (horário de Brasília).`,
      target: targetMeta,
    }, 200);
  }

  // Decide quanto gerar:
  //   - explicit override → respeita (clampado pelo HARD_CAP)
  //   - senão usa o `remaining` do dia
  //   - fallback se RPC falhou
  let toGenerate: number;
  if (explicitMax != null) {
    toGenerate = explicitMax;
  } else if (dynamicRemaining != null) {
    toGenerate = dynamicRemaining;
  } else {
    toGenerate = FALLBACK_TEMPLATES;
  }
  toGenerate = Math.min(Math.max(1, toGenerate), HARD_CAP_TEMPLATES);

  // ─ Cria run ─
  const { data: run, error: createErr } = await sb
    .from("autopilot_runs")
    .insert({
      genre_id: genreId,
      status: "running",
      current_step: "analyze",
      progress_pct: 0,
      triggered_by: "manual",
    })
    .select("id")
    .single();

  if (createErr || !run) {
    return jr({ error: `Falha ao criar run: ${createErr?.message ?? "unknown"}` }, 500);
  }

  // ─ Dispara pipeline em background e responde imediatamente ─
  // deno-lint-ignore no-explicit-any
  const ER: any = (globalThis as any).EdgeRuntime;
  if (ER && typeof ER.waitUntil === "function") {
    ER.waitUntil(runPipeline(sb, run.id, genreId, toGenerate, targetMeta));
  } else {
    // Fallback (não deveria ocorrer no Supabase Edge)
    runPipeline(sb, run.id, genreId, toGenerate, targetMeta);
  }

  return jr({ ok: true, run_id: run.id, target: targetMeta, will_generate: toGenerate });
});
