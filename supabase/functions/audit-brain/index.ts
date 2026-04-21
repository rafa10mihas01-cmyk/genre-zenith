// audit-brain — auditoria automática de qualidade pós brain-run.
// Computa métricas por gênero, loga warnings, flag genres como "needs_attention".
//
// POST { genre_id }            → audita um gênero específico
// POST { trigger?: string }    → audita TODOS os gêneros ativos (modo cron/cleanup)
import { corsHeaders } from "npm:@supabase/supabase-js/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Blacklist forte por slug (espelho do run-search/cleanup-brain)
const STRONG_BLACKLIST_BY_GENRE: Record<string, string[]> = {
  funk: [
    "phonk", "boogie", "oldies", "chicano", "anime",
    "meow", "pocoyo", "bruno mars", "uptown funk",
    "kordhell", "eternxlkz", "disco",
  ],
};

// Termos esperados/legítimos por gênero (para detectar "ruído de keywords")
const EXPECTED_TERMS_BY_GENRE: Record<string, string[]> = {
  funk: ["funk", "mandelão", "putaria", "carioca", "sp", "br", "brasil", "tiktok", "viral", "remix", "consciente", "automotivo", "150bpm", "bh", "rj"],
  sertanejo: ["sertanejo", "modão", "feminejo", "sofrência", "universitário", "raiz", "agro", "balada", "viral", "tiktok", "br", "brasil"],
  piseiro: ["piseiro", "vaquejada", "nordeste", "arrochado", "romântico", "sofrência", "viral", "tiktok", "barraco", "br", "brasil"],
};

// Limiares de degradação (gatilho para needs_attention)
const THRESHOLDS = {
  false_positive_pct: 5,    // > 5% playlists inválidas (is_valid=false) é alerta
  no_followers_pct: 40,     // > 40% sem followers é alerta
  blacklist_pct: 3,         // > 3% blacklist detectada é alerta
  keyword_noise_pct: 25,    // > 25% palavras-chave inesperadas é alerta
  min_sample: 20,           // só audita se houver ≥20 playlists (evita falso alarme)
};

interface AuditMetrics {
  genre_id: string;
  genre_nome: string;
  total_playlists: number;
  false_positive_pct: number;
  no_followers_pct: number;
  blacklist_pct: number;
  keyword_noise_pct: number;
  unexpected_terms: string[];
  warnings: string[];
  needs_attention: boolean;
}

const STOPWORDS = new Set([
  "a","o","as","os","de","da","do","das","dos","e","em","no","na","para","por","com",
  "the","of","and","to","in","on","for","with","best","top","mix","playlist","playlists",
  "música","musicas","músicas","musica","hits","hit","new","novo","nova","2024","2025","2023",
]);

function tokenize(text: string): string[] {
  return (text || "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(w => w.length >= 3 && !STOPWORDS.has(w));
}

async function auditGenre(supabase: any, genre: { id: string; nome: string; slug: string | null }): Promise<AuditMetrics> {
  const slugKey = (genre.slug ?? "").toLowerCase() || (genre.nome ?? "").toLowerCase();
  const blacklist = STRONG_BLACKLIST_BY_GENRE[slugKey] ?? [];
  const expected = new Set(EXPECTED_TERMS_BY_GENRE[slugKey] ?? [slugKey]);

  // Pega TODAS as playlists do gênero (válidas + inválidas) pra calcular taxas reais
  const { data: rows, error } = await supabase
    .from("search_results")
    .select("nome_playlist, descricao, seguidores, is_valid, validation_reason")
    .eq("genre_id", genre.id)
    .limit(2000);

  if (error) throw new Error(`scan ${genre.nome}: ${error.message}`);

  const total = rows?.length ?? 0;
  const m: AuditMetrics = {
    genre_id: genre.id,
    genre_nome: genre.nome,
    total_playlists: total,
    false_positive_pct: 0,
    no_followers_pct: 0,
    blacklist_pct: 0,
    keyword_noise_pct: 0,
    unexpected_terms: [],
    warnings: [],
    needs_attention: false,
  };

  if (total < THRESHOLDS.min_sample) {
    m.warnings.push(`amostra_insuficiente:${total}<${THRESHOLDS.min_sample}`);
    return m;
  }

  let invalidCount = 0;
  let noFollowersCount = 0;
  let blacklistHits = 0;
  const tokenFreq = new Map<string, number>();

  for (const r of rows!) {
    if (r.is_valid === false) invalidCount++;
    if (r.seguidores == null) noFollowersCount++;

    const haystack = `${r.nome_playlist ?? ""} ${r.descricao ?? ""}`.toLowerCase();
    if (blacklist.some(b => b && haystack.includes(b))) blacklistHits++;

    for (const tok of tokenize(r.nome_playlist ?? "")) {
      tokenFreq.set(tok, (tokenFreq.get(tok) ?? 0) + 1);
    }
  }

  m.false_positive_pct = +((invalidCount / total) * 100).toFixed(2);
  m.no_followers_pct = +((noFollowersCount / total) * 100).toFixed(2);
  m.blacklist_pct = +((blacklistHits / total) * 100).toFixed(2);

  // Keyword noise: tokens frequentes (≥10% das playlists) que NÃO são esperados
  const noiseThreshold = Math.max(2, Math.floor(total * 0.1));
  const unexpected: { term: string; count: number }[] = [];
  let noiseHits = 0;
  for (const [tok, count] of tokenFreq.entries()) {
    if (count < noiseThreshold) continue;
    if (expected.has(tok)) continue;
    if (slugKey.includes(tok) || tok.includes(slugKey)) continue;
    unexpected.push({ term: tok, count });
    noiseHits += count;
  }
  unexpected.sort((a, b) => b.count - a.count);
  m.unexpected_terms = unexpected.slice(0, 10).map(u => `${u.term}(${u.count})`);
  // Aproximação: % de "ocorrências ruidosas" sobre total de tokens analisados
  const totalTokens = Array.from(tokenFreq.values()).reduce((s, n) => s + n, 0) || 1;
  m.keyword_noise_pct = +((noiseHits / totalTokens) * 100).toFixed(2);

  // Avalia thresholds → constrói warnings
  if (m.false_positive_pct > THRESHOLDS.false_positive_pct)
    m.warnings.push(`false_positive:${m.false_positive_pct}%>${THRESHOLDS.false_positive_pct}%`);
  if (m.no_followers_pct > THRESHOLDS.no_followers_pct)
    m.warnings.push(`no_followers:${m.no_followers_pct}%>${THRESHOLDS.no_followers_pct}%`);
  if (m.blacklist_pct > THRESHOLDS.blacklist_pct)
    m.warnings.push(`blacklist:${m.blacklist_pct}%>${THRESHOLDS.blacklist_pct}%`);
  if (m.keyword_noise_pct > THRESHOLDS.keyword_noise_pct)
    m.warnings.push(`keyword_noise:${m.keyword_noise_pct}%>${THRESHOLDS.keyword_noise_pct}%`);

  m.needs_attention = m.warnings.length > 0;
  return m;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const start = Date.now();
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  let body: { genre_id?: string; trigger?: string } = {};
  try { body = await req.json(); } catch { /* sem body, audita todos */ }
  const trigger = (body.trigger ?? "manual").slice(0, 32);

  try {
    let genres: { id: string; nome: string; slug: string | null }[];
    if (body.genre_id) {
      const { data, error } = await supabase
        .from("genres").select("id, nome, slug").eq("id", body.genre_id).single();
      if (error || !data) return j({ ok: false, error: "Gênero não encontrado" }, 404);
      genres = [data];
    } else {
      const { data, error } = await supabase
        .from("genres").select("id, nome, slug").eq("ativo", true);
      if (error) throw error;
      genres = data ?? [];
    }

    const results: AuditMetrics[] = [];
    for (const g of genres) {
      try {
        const m = await auditGenre(supabase, g);
        results.push(m);

        // Atualiza flag no gênero (sempre — limpa se voltou ao normal)
        await supabase
          .from("genres")
          .update({
            needs_attention: m.needs_attention,
            attention_reason: m.needs_attention ? m.warnings.join(" | ").slice(0, 500) : null,
            attention_flagged_at: m.needs_attention ? new Date().toISOString() : null,
            last_audit_metrics: {
              total_playlists: m.total_playlists,
              false_positive_pct: m.false_positive_pct,
              no_followers_pct: m.no_followers_pct,
              blacklist_pct: m.blacklist_pct,
              keyword_noise_pct: m.keyword_noise_pct,
              unexpected_terms: m.unexpected_terms,
              warnings: m.warnings,
              audited_at: new Date().toISOString(),
            },
          })
          .eq("id", g.id);
      } catch (e) {
        results.push({
          genre_id: g.id, genre_nome: g.nome, total_playlists: 0,
          false_positive_pct: 0, no_followers_pct: 0, blacklist_pct: 0,
          keyword_noise_pct: 0, unexpected_terms: [],
          warnings: [`audit_error:${(e as Error).message}`],
          needs_attention: false,
        });
      }
    }

    const flagged = results.filter(r => r.needs_attention);
    const status = flagged.length > 0 ? "warning" : "sucesso";
    const duration = Date.now() - start;

    const summary =
      `audit-brain (${trigger}) | ` +
      `auditados: ${results.length} | ` +
      `flagged: ${flagged.length}` +
      (flagged.length > 0
        ? ` | ` + flagged.map(f => `${f.genre_nome}[${f.warnings.join(",")}]`).join(" ; ")
        : "");

    await supabase.from("collection_logs").insert({
      acao: "audit-brain",
      status,
      mensagem: summary.slice(0, 4000),
      duracao_ms: duration,
    });

    return j({ ok: true, trigger, audited: results.length, flagged: flagged.length, results });
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    console.error("audit-brain error", msg);
    await supabase.from("collection_logs").insert({
      acao: "audit-brain",
      status: "erro",
      mensagem: `audit-brain (${trigger}) FALHOU: ${msg}`.slice(0, 4000),
      duracao_ms: Date.now() - start,
    });
    return j({ ok: false, error: msg }, 500);
  }
});

function j(payload: any, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
