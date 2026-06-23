// ColetaPanel — visão da coleta de dados Spotify.
// Mostra apenas dados verificados pelo Spotify e ignora histórico antigo sem verificação.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Search, Music2, CheckCircle2, Loader2,
  Filter, Database,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { timeAgo, formatNumber } from "@/lib/format";

type GenreStats = {
  genre_id: string;
  nome: string;
  total_termos: number;
  total_playlists: number;
  validas: number;
  invalidas: number;
  ultima_coleta: string | null;
};

export function ColetaPanel() {
  const [stats, setStats] = useState<GenreStats[]>([]);
  const [lastVerif, setLastVerif] = useState<string | null>(null);
  const [recentVerified, setRecentVerified] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const [genresRes, verifRes, recentRes, breakdownRes] = await Promise.all([
      supabase.from("genres").select("id, nome, total_termos, total_playlists, ultima_coleta").eq("ativo", true),
      supabase.from("search_results").select("followers_verified_at").not("followers_verified_at", "is", null).order("followers_verified_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("search_results").select("id", { count: "exact", head: true }).not("followers_verified_at", "is", null).gte("followers_verified_at", sevenDaysAgo),
      // Substitui o N+1 (2 queries por gênero) por UMA única busca dos últimos 7 dias.
      supabase.from("search_results").select("genre_id, is_valid").not("followers_verified_at", "is", null).gte("followers_verified_at", sevenDaysAgo),
    ]);

    // Agrega válidas/inválidas por gênero a partir do resultado único.
    const counts = new Map<string, { validas: number; invalidas: number }>();
    for (const r of (breakdownRes.data ?? []) as Array<{ genre_id: string | null; is_valid: boolean | null }>) {
      if (!r.genre_id) continue;
      const cur = counts.get(r.genre_id) ?? { validas: 0, invalidas: 0 };
      if (r.is_valid) cur.validas++;
      else cur.invalidas++;
      counts.set(r.genre_id, cur);
    }

    const out: GenreStats[] = (genresRes.data ?? []).map((g: any) => {
      const c = counts.get(g.id) ?? { validas: 0, invalidas: 0 };
      return {
        genre_id: g.id,
        nome: g.nome,
        total_termos: g.total_termos ?? 0,
        total_playlists: c.validas + c.invalidas,
        validas: c.validas,
        invalidas: c.invalidas,
        ultima_coleta: g.ultima_coleta,
      };
    });
    const visible = out.filter((g) => g.total_playlists > 0);
    visible.sort((a, b) => b.total_playlists - a.total_playlists);
    setStats(visible);
    setLastVerif((verifRes.data as any)?.followers_verified_at ?? null);
    setRecentVerified(recentRes.count ?? 0);
    setLoading(false);
  };


  useEffect(() => {
    load();
    const ch = supabase
      .channel("sistema-coleta")
      .on("postgres_changes", { event: "*", schema: "public", table: "search_results" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  if (loading) {
    return (
      <div className="nx-card p-6 flex items-center justify-center text-sm text-muted-foreground gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando dados de coleta…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Status global */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="nx-card border border-success/30 bg-success/5 p-3 flex items-center gap-3">
          <CheckCircle2 className="h-5 w-5 text-success shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-xs uppercase tracking-wider text-muted-foreground font-bold">Coleta Spotify</p>
            <p className="text-sm font-semibold text-foreground">{formatNumber(recentVerified)} playlists recentes</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">verificadas nos últimos 7 dias</p>
          </div>
        </div>

        <div className="nx-card border border-border p-3 flex items-center gap-3">
          <Database className="h-5 w-5 text-primary shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-xs uppercase tracking-wider text-muted-foreground font-bold">Última verificação Spotify</p>
            <p className="text-sm font-semibold text-foreground">{lastVerif ? timeAgo(lastVerif) : "Nunca"}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">checagem de seguidores reais</p>
          </div>
        </div>
      </div>

      {/* Tabela por gênero */}
      <div>
        <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-bold mb-2 flex items-center gap-1.5">
          <Filter className="h-3 w-3" /> Coleta por gênero
        </h3>
        {stats.length === 0 ? (
          <div className="nx-card p-6 text-center text-sm text-muted-foreground">
            Nenhum dado Spotify recente encontrado.
          </div>
        ) : (
          <div className="space-y-1.5">
            {stats.map((s) => {
              const taxaValidas = s.validas + s.invalidas > 0
                ? Math.round((s.validas / (s.validas + s.invalidas)) * 100)
                : 0;
              return (
                <div key={s.genre_id} className="nx-card border border-border p-3">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-foreground">{s.nome}</p>
                      <p className="text-[11px] text-muted-foreground">
                        Última coleta: {s.ultima_coleta ? timeAgo(s.ultima_coleta) : "nunca"}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 text-xs">
                      <Stat icon={Search} label="termos" value={s.total_termos} />
                      <Stat icon={Music2} label="playlists" value={s.total_playlists} />
                      <Badge variant="outline" className={cn(
                        "tabular-nums",
                        taxaValidas >= 80 && "border-success/40 bg-success/5 text-success",
                        taxaValidas < 80 && taxaValidas >= 50 && "border-warning/40 bg-warning/5 text-warning",
                        taxaValidas < 50 && "border-destructive/40 bg-destructive/5 text-destructive",
                      )}>
                        {taxaValidas}% válidas
                      </Badge>
                    </div>
                  </div>
                  {s.invalidas > 0 && (
                    <p className="text-[11px] text-muted-foreground mt-1.5">
                      {formatNumber(s.invalidas)} playlist{s.invalidas !== 1 ? "s" : ""} descartada{s.invalidas !== 1 ? "s" : ""} (poucos seguidores, fora do tema, etc.)
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: number }) {
  return (
    <span className="flex items-center gap-1 text-muted-foreground tabular-nums">
      <Icon className="h-3 w-3" />
      <strong className="text-foreground">{formatNumber(value)}</strong> {label}
    </span>
  );
}
