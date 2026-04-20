import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Search, Sparkles, Play, Eye, Database, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/StatusBadge";
import { formatNumber, formatDate } from "@/lib/format";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { generateTerms } from "@/lib/engine";

interface Genre {
  id: string; nome: string; slug: string; status: string;
  total_termos: number; total_playlists: number; total_musicas: number;
  ultima_coleta: string | null;
}

export default function Genres() {
  const [genres, setGenres] = useState<Genre[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("todos");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const load = async () => {
    const { data, error } = await supabase
      .from("genres")
      .select("id,nome,slug,status,total_termos,total_playlists,total_musicas,ultima_coleta")
      .order("nome");
    if (error) toast.error("Erro ao carregar gêneros", { description: error.message });
    setGenres(data ?? []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    return genres.filter((g) => {
      if (statusFilter !== "todos" && g.status !== statusFilter) return false;
      if (q && !g.nome.toLowerCase().includes(q.toLowerCase())) return false;
      return true;
    });
  }, [genres, q, statusFilter]);

  const toggle = (id: string) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };
  const allChecked = filtered.length > 0 && filtered.every((g) => selected.has(g.id));
  const toggleAll = () => {
    if (allChecked) setSelected(new Set());
    else setSelected(new Set(filtered.map((g) => g.id)));
  };

  const nav = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);

  const handleGenerate = async (id: string) => {
    setBusy(id);
    await generateTerms(id);
    setBusy(null);
    load();
  };
  const handleCollect = (id: string) => nav(`/collect?genre=${id}`);
  const handleBulk = () => {
    if (selected.size === 0) return;
    const first = Array.from(selected)[0];
    nav(`/collect?genre=${first}&queue=${Array.from(selected).join(",")}`);
  };

  return (
    <div className="space-y-5 max-w-[1400px] mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Gêneros</h1>
          <p className="text-sm text-muted-foreground">{genres.length} gêneros • {selected.size} selecionados</p>
        </div>
        {selected.size > 0 && (
          <Button onClick={() => notReady("Coleta em lote")} className="gap-2">
            <Play className="h-4 w-4" /> Coletar {selected.size} em lote
          </Button>
        )}
      </div>

      <div className="nx-card p-4 flex flex-col md:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar gênero…" className="pl-9 bg-elevated border-border" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full md:w-[200px] bg-elevated border-border">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos os status</SelectItem>
            <SelectItem value="pendente">Pendente</SelectItem>
            <SelectItem value="coletando">Coletando</SelectItem>
            <SelectItem value="analisado">Analisado</SelectItem>
            <SelectItem value="erro">Erro</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="nx-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-elevated text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="p-3 text-left w-10">
                  <Checkbox checked={allChecked} onCheckedChange={toggleAll} />
                </th>
                <th className="p-3 text-left">Nome</th>
                <th className="p-3 text-left">Status</th>
                <th className="p-3 text-right">Termos</th>
                <th className="p-3 text-right">Playlists</th>
                <th className="p-3 text-right">Músicas</th>
                <th className="p-3 text-left">Última coleta</th>
                <th className="p-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="nx-row-zebra">
              {loading && (
                <tr><td colSpan={8} className="p-8 text-center text-muted-foreground">
                  <Loader2 className="h-4 w-4 mx-auto animate-spin" />
                </td></tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={8} className="p-8 text-center text-muted-foreground">Nenhum gênero encontrado</td></tr>
              )}
              {filtered.map((g) => (
                <tr key={g.id} className="border-t border-border hover:bg-elevated/40">
                  <td className="p-3">
                    <Checkbox checked={selected.has(g.id)} onCheckedChange={() => toggle(g.id)} />
                  </td>
                  <td className="p-3 font-medium">{g.nome}</td>
                  <td className="p-3"><StatusBadge status={g.status} /></td>
                  <td className="p-3 text-right tabular-nums">{formatNumber(g.total_termos)}</td>
                  <td className="p-3 text-right tabular-nums">{formatNumber(g.total_playlists)}</td>
                  <td className="p-3 text-right tabular-nums">{formatNumber(g.total_musicas)}</td>
                  <td className="p-3 text-xs text-muted-foreground">{formatDate(g.ultima_coleta)}</td>
                  <td className="p-3">
                    <div className="flex items-center justify-end gap-1">
                      <Button size="sm" variant="ghost" onClick={() => notReady("Geração de termos")} title="Gerar termos">
                        <Sparkles className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => notReady("Coleta")} title="Coletar agora">
                        <Play className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="sm" variant="ghost" asChild title="Ver modelo">
                        <Link to={`/models/${g.id}`}><Eye className="h-3.5 w-3.5" /></Link>
                      </Button>
                      <Button size="sm" variant="ghost" asChild title="Ver dados brutos">
                        <Link to={`/models/${g.id}?tab=raw`}><Database className="h-3.5 w-3.5" /></Link>
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
