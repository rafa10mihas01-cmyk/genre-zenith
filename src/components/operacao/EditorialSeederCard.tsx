// EditorialSeederCard — UI pra acionar o flow "coletar oficiais Spotify" por gênero.
// 1. Gera termos editoriais via LLM (seed-editorial-terms)
// 2. Busca oficiais Spotify via Search API (fetch-spotify-featured)
// Mostra resultado real (quantas oficiais foram encontradas/inseridas).
import { useEffect, useState } from "react";
import { Sparkles, Loader2, Crown, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type Genre = { id: string; nome: string; slug: string };

type SeedResult = {
  created: number;
  total_terms: number;
  terms: { termo: string; rationale: string; novo: boolean }[];
};

type FetchResult = {
  found: number;
  inserted: number;
  updated: number;
  query_stats: { q: string; total: number; oficiais: number }[];
};

export function EditorialSeederCard() {
  const [genres, setGenres] = useState<Genre[]>([]);
  const [genreId, setGenreId] = useState<string>("");
  const [running, setRunning] = useState(false);
  const [stage, setStage] = useState<"idle" | "seeding" | "fetching" | "done">("idle");
  const [seedRes, setSeedRes] = useState<SeedResult | null>(null);
  const [fetchRes, setFetchRes] = useState<FetchResult | null>(null);
  const [oficiaisCount, setOficiaisCount] = useState<number>(0);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("genres").select("id,nome,slug").eq("ativo", true).order("nome");
      setGenres((data ?? []) as Genre[]);
    })();
  }, []);

  // recarrega contador de oficiais quando troca de gênero
  useEffect(() => {
    if (!genreId) { setOficiaisCount(0); return; }
    (async () => {
      const { count } = await supabase
        .from("search_results")
        .select("*", { count: "exact", head: true })
        .eq("genre_id", genreId)
        .eq("owner_type", "spotify");
      setOficiaisCount(count ?? 0);
    })();
  }, [genreId, fetchRes]);

  const run = async () => {
    if (!genreId) { toast.error("Selecione um gênero"); return; }
    setRunning(true);
    setSeedRes(null); setFetchRes(null);
    try {
      // 1) gera termos editoriais
      setStage("seeding");
      const seed = await supabase.functions.invoke("seed-editorial-terms", { body: { genre_id: genreId } });
      if (seed.error) throw new Error(seed.error.message ?? "Falha ao gerar termos");
      const sd = seed.data as SeedResult;
      setSeedRes(sd);

      // 2) busca oficiais com queries geradas
      setStage("fetching");
      const queries = sd.terms.map(t => t.termo);
      const fetch = await supabase.functions.invoke("fetch-spotify-featured", {
        body: { genre_id: genreId, queries, limit: 30 },
      });
      if (fetch.error) throw new Error(fetch.error.message ?? "Falha ao buscar no Spotify");
      const fr = fetch.data as FetchResult;
      setFetchRes(fr);

      setStage("done");
      toast.success(`${fr.inserted} oficiais novas + ${fr.updated} atualizadas`);
    } catch (e) {
      toast.error((e as Error).message);
      setStage("idle");
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="nx-card">
      <div className="flex items-center gap-3 mb-4">
        <div className="h-9 w-9 rounded-full bg-elevated border border-border flex items-center justify-center">
          <Crown className="h-4 w-4 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold">Coletar playlists oficiais Spotify</h3>
          <p className="text-xs text-muted-foreground">
            Gera termos editoriais (Top, Viral, Hits, Novidades) por gênero e busca direto na Spotify Search API. Custo Apify: zero.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 mb-3">
        <Select value={genreId} onValueChange={setGenreId} disabled={running}>
          <SelectTrigger className="w-[220px] h-9 bg-elevated border-border rounded-full text-sm">
            <SelectValue placeholder="Selecione o gênero" />
          </SelectTrigger>
          <SelectContent>
            {genres.map(g => (
              <SelectItem key={g.id} value={g.id} className="capitalize">{g.nome}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button onClick={run} disabled={!genreId || running} className="h-9 rounded-full gap-2">
          {running
            ? <><Loader2 className="h-4 w-4 animate-spin" /> {stage === "seeding" ? "Gerando termos…" : "Buscando no Spotify…"}</>
            : <><Sparkles className="h-4 w-4" /> Executar</>}
        </Button>
        {genreId && (
          <span className="ml-auto text-xs text-muted-foreground tabular-nums">
            <strong className="text-foreground">{oficiaisCount}</strong> oficial(is) já no banco
          </span>
        )}
      </div>

      {(seedRes || fetchRes) && (
        <div className="space-y-3 pt-3 border-t border-border">
          {seedRes && (
            <div>
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-bold mb-2">
                Termos editoriais ({seedRes.created} novos / {seedRes.total_terms} totais)
              </div>
              <div className="flex flex-wrap gap-1.5">
                {seedRes.terms.map((t, i) => (
                  <span
                    key={i}
                    title={t.rationale}
                    className={cn(
                      "inline-flex items-center px-2.5 h-6 rounded-full text-[11px] font-medium border",
                      t.novo
                        ? "bg-primary/15 border-primary/40 text-primary"
                        : "bg-elevated border-border text-muted-foreground",
                    )}
                  >
                    {t.termo}{t.novo && " ★"}
                  </span>
                ))}
              </div>
            </div>
          )}

          {fetchRes && (
            <div>
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-bold mb-2">
                Resultado da busca
              </div>
              <div className="grid grid-cols-3 gap-3 mb-3">
                <Stat label="Encontradas" value={fetchRes.found} />
                <Stat label="Novas" value={fetchRes.inserted} tone="primary" />
                <Stat label="Atualizadas" value={fetchRes.updated} />
              </div>
              <div className="space-y-1">
                {fetchRes.query_stats.map((s, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <span className="text-muted-foreground truncate flex-1">{s.q}</span>
                    <span className="tabular-nums text-foreground">
                      <strong>{s.oficiais}</strong> <span className="text-muted-foreground">/ {s.total}</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "primary" }) {
  return (
    <div className="rounded-xl border border-border bg-elevated/40 px-3 py-2">
      <div className={cn("text-xl font-semibold tabular-nums", tone === "primary" && "text-primary")}>{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
    </div>
  );
}
