import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Sparkles, Loader2, Music2, Hash, Search, Lightbulb, Wrench, Radio,
  Activity, Brain, Image as ImageIcon, Palette, Wand2, FileText,
  TrendingUp, Rocket, ArrowRight,
} from "lucide-react";
import { EditorialSeederCard } from "@/components/operacao/EditorialSeederCard";
import { formatDate, timeAgo } from "@/lib/format";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { KpiBig } from "@/components/KpiBig";
import { Empty } from "@/components/cerebro/_shared";

/* ===================== HELPERS DE LOGS (Coleta) ===================== */

/** Mapeia o nome técnico da função para um título humano + ícone + descrição curta. */
export const ACTION_META: Record<
  string,
  { title: string; desc: string; icon: any }
> = {
  "analyze-genre":          { title: "Análise de gênero",        desc: "Modelo aprendeu padrões da base",   icon: Lightbulb },
  "analyze-visual-dna":     { title: "Análise visual",           desc: "Identificou estilo das capas",      icon: Palette },
  "analyze-genre-visual-dna":{ title: "Análise visual",          desc: "Identificou estilo das capas",      icon: Palette },
  "genre-insights":         { title: "Resumo da IA",             desc: "Tendências e oportunidades",        icon: Wand2 },
  "create-spotify-playlist":{ title: "Playlist publicada",       desc: "Nova playlist enviada ao Spotify",  icon: Rocket },
  "generate-templates":     { title: "Templates gerados",        desc: "Variações criadas a partir do blueprint", icon: FileText },
  "extract-blueprints":     { title: "Blueprints extraídos",     desc: "Padrões fortes consolidados",       icon: Sparkles },
  "extract-replication-rules":{ title: "Regras aprendidas",      desc: "Aprendizados do que dá resultado",  icon: Sparkles },
  "replicate-top":          { title: "Replicação top",           desc: "Pacote das melhores playlists",     icon: Radio },
  "auto-replicate-playlists":{ title: "Replicação automática",   desc: "Sistema replicou sozinho",          icon: Radio },
  "auto-adjust-playlists":  { title: "Ajuste automático",        desc: "Sistema corrigiu playlists",        icon: Wrench },
  "enrich-playlists":       { title: "Enriquecimento",           desc: "Buscou seguidores e faixas",        icon: TrendingUp },
  "fetch-tracks-spotify":   { title: "Coleta de faixas",         desc: "Faixas das playlists baixadas",     icon: Music2 },
  "collect-batch":          { title: "Coleta em lote",           desc: "Lote de playlists coletado",        icon: Search },
  "daily-collect":          { title: "Coleta diária",            desc: "Rotina diária de descoberta",       icon: Search },
  "run-search":             { title: "Busca por termo",          desc: "Termo executado no Spotify",        icon: Search },
  "fetch-spotify-featured": { title: "Destaques Spotify",        desc: "Playlists em destaque coletadas",   icon: Search },
  "score-templates":        { title: "Score de templates",       desc: "Recalculou pontuação",              icon: TrendingUp },
  "track-playlist-metrics": { title: "Métricas das playlists",   desc: "Snapshot de seguidores",            icon: TrendingUp },
  "audit-brain":            { title: "Auditoria do sistema",     desc: "Verificação de saúde",              icon: Activity },
  "cleanup-brain":          { title: "Limpeza do sistema",       desc: "Removeu dados obsoletos",           icon: Activity },
  "learning-loop":          { title: "Ciclo de aprendizado",     desc: "Iteração completa do sistema",      icon: Brain },
  "generate-cover-variations":{ title: "Variações de capa",      desc: "Gerou opções de capa",              icon: ImageIcon },
  "upload-playlist-cover":  { title: "Capa enviada",             desc: "Capa aplicada na playlist",         icon: ImageIcon },
  "generate-playlists-briefing":{ title: "Briefing de criação",  desc: "Briefing pronto p/ produzir",       icon: FileText },
  "seed-editorial-terms":   { title: "Termos editoriais",        desc: "Sementes de busca semeadas",        icon: Hash },
  "generate-terms":         { title: "Geração de termos",        desc: "Novos termos sugeridos pela IA",    icon: Hash },
  "expire-stale-templates": { title: "Expiração de templates",   desc: "Templates velhos arquivados",       icon: Activity },
  "revalidate-dataset":     { title: "Revalidação",              desc: "Base reconferida",                  icon: Activity },
  "spotify-auth":           { title: "Conexão Spotify",          desc: "Token renovado",                    icon: Activity },
};

export function actionMeta(acao: string) {
  return ACTION_META[acao] ?? {
    title: acao.replace(/[-_]/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
    desc: "—",
    icon: Activity,
  };
}

/** Limpa a mensagem técnica: corta JSON, remove `[global]`, encurta duração. */
export function cleanLogMessage(msg: string | null): string {
  if (!msg) return "";
  let out = String(msg);
  // Remove prefixos tipo "[global] " ou "[piseiro] "
  out = out.replace(/^\[[^\]]+\]\s*/, "");
  // Se tem JSON gigante no meio, corta antes do primeiro "{"
  const firstBrace = out.indexOf("{");
  if (firstBrace > 0 && out.length - firstBrace > 80) {
    out = out.slice(0, firstBrace).trim().replace(/[|·•]\s*$/, "").trim();
  }
  // Limita tamanho
  if (out.length > 180) out = out.slice(0, 177).trim() + "…";
  return out;
}

export function statusLabel(status: string) {
  if (status === "sucesso") return { label: "OK", cls: "bg-primary/15 text-primary" };
  if (status === "erro")    return { label: "Erro", cls: "bg-destructive/15 text-destructive" };
  return { label: "Aviso", cls: "bg-warning/15 text-warning" };
}

export function Coleta({ genreId }: { genreId?: string }) {
  const [logs, setLogs] = useState<any[]>([]);
  const [pending, setPending] = useState<number>(0);
  const [enriching, setEnriching] = useState(false);

  const load = async () => {
    let q = supabase.from("collection_logs").select("*").order("created_at", { ascending: false }).limit(40);
    if (genreId) q = q.eq("genre_id", genreId);
    const { data: l } = await q;
    setLogs(l ?? []);
    if (genreId) {
      const { count } = await supabase
        .from("search_results").select("*", { count: "exact", head: true })
        .eq("genre_id", genreId).is("seguidores", null).not("spotify_url", "is", null);
      setPending(count ?? 0);
    }
  };
  useEffect(() => {
    if (!genreId) return;
    load();
    const ch = supabase
      .channel(`coleta:${genreId}:${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "collection_logs", filter: `genre_id=eq.${genreId}` }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "search_results", filter: `genre_id=eq.${genreId}` }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [genreId]);

  const runEnrich = async () => {
    if (!genreId) return;
    setEnriching(true);
    try {
      const { data, error } = await supabase.functions.invoke("enrich-playlists", {
        body: { genre_id: genreId, limit: 50, fetch_tracks: true },
      });
      if (error) throw error;
      toast.success(`${data?.enriched ?? 0} playlists enriquecidas`);
      load();
    } catch (e: any) { toast.error(e?.message); }
    setEnriching(false);
  };

  return (
    <div className="space-y-4">
      {/* Coletar oficiais Spotify — descoberta de fontes (movido da Operação) */}
      <EditorialSeederCard />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <KpiBig icon={Activity} label="Eventos recentes" value={String(logs.length)} hint="Últimas 40 ações" />
        <KpiBig icon={Music2} label="Aguardando enriquecer" value={String(pending)} hint="Playlists sem dados completos" />
        <div className="nx-card p-4 flex items-center justify-between">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Ação</div>
            <div className="text-sm font-bold mt-0.5">Enriquecer agora</div>
            <div className="text-[11px] text-muted-foreground mt-0.5 truncate">
              Busca seguidores e faixas das pendentes
            </div>
          </div>
          <Button size="sm" onClick={runEnrich} disabled={enriching || !genreId || pending === 0}>
            {enriching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            Rodar
          </Button>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground font-bold">
            Histórico de ações
          </h3>
          <span className="text-[11px] text-muted-foreground">{logs.length} eventos</span>
        </div>
        <div className="nx-card overflow-hidden">
          {logs.length === 0 ? (
            <div className="p-8"><Empty msg="Sem atividade registrada para este gênero." /></div>
          ) : (
            <ul className="divide-y divide-border max-h-[60vh] overflow-y-auto nx-scroll">
              {logs.map(l => <LogRow key={l.id} log={l} />)}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function LogRow({ log }: { log: any }) {
  const [open, setOpen] = useState(false);
  const meta = actionMeta(log.acao);
  const st = statusLabel(log.status);
  const Icon = meta.icon;
  const message = cleanLogMessage(log.mensagem);
  const hasDetails = !!log.mensagem && log.mensagem.length > 60;

  return (
    <li className="px-4 py-3">
      <div className="flex items-start gap-3">
        <span className={cn(
          "h-9 w-9 rounded-full flex items-center justify-center shrink-0 mt-0.5",
          log.status === "sucesso" ? "bg-primary/10 text-primary"
          : log.status === "erro" ? "bg-destructive/10 text-destructive"
          : "bg-warning/10 text-warning",
        )}>
          <Icon className="h-4 w-4" />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-bold leading-tight">{meta.title}</span>
            <span className={cn("text-[10px] uppercase font-bold px-1.5 py-0.5 rounded", st.cls)}>
              {st.label}
            </span>
            <span className="text-[11px] text-muted-foreground tabular-nums ml-auto">
              {timeAgo(log.created_at)}
              {log.duracao_ms != null && <span className="ml-2 opacity-70">{(log.duracao_ms / 1000).toFixed(1)}s</span>}
            </span>
          </div>

          <p className="text-[13px] text-foreground/85 mt-1 leading-snug">
            {message || meta.desc}
          </p>

          {hasDetails && (
            <button
              type="button"
              onClick={() => setOpen(o => !o)}
              className="mt-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1"
            >
              {open ? "Ocultar detalhes" : "Ver detalhes técnicos"}
              <ArrowRight className={cn("h-3 w-3 transition-transform", open && "rotate-90")} />
            </button>
          )}

          {open && (
            <pre className="mt-2 text-[11px] text-muted-foreground bg-elevated/60 border border-border rounded-md p-2.5 max-h-48 overflow-auto whitespace-pre-wrap break-all font-mono">
              {log.mensagem}
              {"\n\n"}
              <span className="text-foreground/50">acao: {log.acao} · {formatDate(log.created_at)}</span>
            </pre>
          )}
        </div>
      </div>
    </li>
  );
}
