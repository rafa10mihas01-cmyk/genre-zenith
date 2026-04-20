import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Brain, ChevronRight, RefreshCw, Search, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { formatNumber, timeAgo } from "@/lib/format";
import { StatusBadge } from "@/components/StatusBadge";

interface Row {
  id: string;
  nome: string;
  status: string | null;
  total_playlists: number | null;
  total_musicas: number | null;
  modelo?: { ultima_analise: string | null } | null;
}

export default function Models() {
  const [rows, setRows] = useState<Row[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const { data: genres } = await supabase
      .from("genres")
      .select("id,nome,status,total_playlists,total_musicas")
      .order("total_playlists", { ascending: false, nullsFirst: false });
    const { data: models } = await supabase
      .from("genre_models")
      .select("genre_id,ultima_analise");
    const map = new Map((models ?? []).map(m => [m.genre_id, m]));
    setRows((genres ?? []).map(g => ({ ...g, modelo: map.get(g.id) ?? null })));
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function analyze(id: string) {
    setAnalyzing(id);
    const { data, error } = await supabase.functions.invoke("analyze-genre", { body: { genre_id: id } });
    setAnalyzing(null);
    if (error || !data?.ok) {
      toast.error("Falha ao analisar", { description: error?.message ?? data?.error });
      return;
    }
    toast.success("Modelo gerado", {
      description: `${data.insights.total_playlists_analisadas} playlists • ${data.insights.diversidade_tracks} músicas únicas`,
    });
    load();
  }

  const filtered = rows.filter(r => r.nome.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="max-w-[1400px] mx-auto">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Modelos de Inteligência</h1>
          <p className="text-sm text-muted-foreground mt-1">Análise de padrões SEO por gênero musical</p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Atualizar
        </Button>
      </div>

      <div className="relative mt-6 max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar gênero…" className="pl-9" />
      </div>

      <div className="nx-card mt-4 divide-y divide-border">
        {filtered.length === 0 && !loading && (
          <div className="p-12 text-center text-sm text-muted-foreground">Nenhum gênero encontrado.</div>
        )}
        {filtered.map(r => {
          const hasModel = !!r.modelo;
          const hasData = (r.total_playlists ?? 0) > 0;
          return (
            <div key={r.id} className="flex items-center gap-4 p-4 hover:bg-muted/30 transition-colors">
              <div className="h-10 w-10 rounded-lg bg-accent/15 border border-accent/30 flex items-center justify-center shrink-0">
                <Brain className="h-5 w-5 text-accent" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-medium truncate">{r.nome}</h3>
                  <StatusBadge status={r.status ?? "pendente"} />
                </div>
                <div className="text-xs text-muted-foreground mt-0.5 flex gap-3 flex-wrap">
                  <span>{formatNumber(r.total_playlists)} playlists</span>
                  <span>{formatNumber(r.total_musicas)} músicas</span>
                  <span>
                    {hasModel
                      ? `Analisado ${timeAgo(r.modelo!.ultima_analise)}`
                      : "Sem modelo"}
                  </span>
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => analyze(r.id)}
                disabled={!hasData || analyzing === r.id}
                title={hasData ? "Analisar / re-analisar" : "Coletar dados primeiro"}
              >
                <Sparkles className={`h-4 w-4 ${analyzing === r.id ? "animate-pulse" : ""}`} />
                {hasModel ? "Re-analisar" : "Analisar"}
              </Button>
              {hasModel && (
                <Button size="sm" asChild>
                  <Link to={`/models/${r.id}`}>
                    Ver modelo <ChevronRight className="h-4 w-4" />
                  </Link>
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
