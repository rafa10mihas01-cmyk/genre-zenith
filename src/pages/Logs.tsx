import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  CheckCircle2, XCircle, AlertCircle, RefreshCw, Search, ScrollText, Clock,
} from "lucide-react";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

interface Log {
  id: string;
  created_at: string | null;
  acao: string;
  status: string;
  mensagem: string | null;
  duracao_ms: number | null;
  genre_id: string | null;
  term_id: string | null;
}

const ACTIONS = ["generate-terms", "run-search", "analyze-genre", "test-apify"];
const STATUSES = ["sucesso", "erro", "info"];

export default function Logs() {
  const [logs, setLogs] = useState<Log[]>([]);
  const [genres, setGenres] = useState<{ id: string; nome: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [fGenre, setFGenre] = useState<string>("all");
  const [fAction, setFAction] = useState<string>("all");
  const [fStatus, setFStatus] = useState<string>("all");

  async function load() {
    setLoading(true);
    const [{ data: g }, { data: l }] = await Promise.all([
      supabase.from("genres").select("id,nome").order("nome"),
      supabase.from("collection_logs").select("*").order("created_at", { ascending: false }).limit(500),
    ]);
    setGenres(g ?? []);
    setLogs((l ?? []) as Log[]);
    setLoading(false);
  }

  useEffect(() => {
    load();
    const interval = setInterval(load, 15000);
    return () => clearInterval(interval);
  }, []);

  const genreMap = useMemo(() => new Map(genres.map(g => [g.id, g.nome])), [genres]);

  const filtered = logs.filter(l => {
    if (fGenre !== "all" && l.genre_id !== fGenre) return false;
    if (fAction !== "all" && l.acao !== fAction) return false;
    if (fStatus !== "all" && l.status !== fStatus) return false;
    if (q && !(l.mensagem ?? "").toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  });

  const counts = {
    total: logs.length,
    sucesso: logs.filter(l => l.status === "sucesso").length,
    erro: logs.filter(l => l.status === "erro").length,
  };

  return (
    <div className="max-w-[1400px] mx-auto">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Logs de Coleta</h1>
          <p className="text-sm text-muted-foreground mt-1">Histórico das últimas 500 ações do motor</p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          Atualizar
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 mt-6">
        <StatCard icon={ScrollText} label="Total" value={counts.total} tone="default" />
        <StatCard icon={CheckCircle2} label="Sucesso" value={counts.sucesso} tone="success" />
        <StatCard icon={XCircle} label="Erro" value={counts.erro} tone="destructive" />
      </div>

      {/* Filters */}
      <div className="nx-card p-4 mt-4 flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar mensagem…" className="pl-9" />
        </div>
        <Select value={fGenre} onValueChange={setFGenre}>
          <SelectTrigger className="w-[180px]"><SelectValue placeholder="Gênero" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os gêneros</SelectItem>
            {genres.map(g => <SelectItem key={g.id} value={g.id}>{g.nome}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={fAction} onValueChange={setFAction}>
          <SelectTrigger className="w-[180px]"><SelectValue placeholder="Ação" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as ações</SelectItem>
            {ACTIONS.map(a => <SelectItem key={a} value={a}>{a}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={fStatus} onValueChange={setFStatus}>
          <SelectTrigger className="w-[140px]"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos status</SelectItem>
            {STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <div className="nx-card mt-4 overflow-hidden">
        <div className="divide-y divide-border max-h-[60vh] overflow-y-auto">
          {filtered.length === 0 && !loading && (
            <div className="p-12 text-center text-sm text-muted-foreground">Nenhum log encontrado.</div>
          )}
          {filtered.map(l => (
            <div key={l.id} className="flex items-start gap-3 p-3 hover:bg-muted/30 transition-colors">
              <StatusIcon status={l.status} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
                  <span className="font-mono text-foreground">{l.acao}</span>
                  {l.genre_id && (
                    <>
                      <span>·</span>
                      <span>{genreMap.get(l.genre_id) ?? l.genre_id.slice(0, 8)}</span>
                    </>
                  )}
                  <span>·</span>
                  <Clock className="h-3 w-3" />
                  <span>{formatDate(l.created_at)}</span>
                  {l.duracao_ms != null && (
                    <>
                      <span>·</span>
                      <span className="font-mono">{l.duracao_ms}ms</span>
                    </>
                  )}
                </div>
                <p className="text-sm mt-1 break-words">{l.mensagem ?? "—"}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, tone }: { icon: any; label: string; value: number; tone: "default" | "success" | "destructive" }) {
  const tones = {
    default: "bg-muted/40 text-foreground border-border",
    success: "bg-success/15 text-success border-success/30",
    destructive: "bg-destructive/15 text-destructive border-destructive/30",
  };
  return (
    <div className="nx-card p-4">
      <div className={cn("inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-md border", tones[tone])}>
        <Icon className="h-3.5 w-3.5" /> {label}
      </div>
      <div className="text-2xl font-bold mt-2 tabular-nums">{value}</div>
    </div>
  );
}

function StatusIcon({ status }: { status: string }) {
  if (status === "sucesso") return <CheckCircle2 className="h-4 w-4 text-success mt-0.5 shrink-0" />;
  if (status === "erro") return <XCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />;
  return <AlertCircle className="h-4 w-4 text-warning mt-0.5 shrink-0" />;
}
