// LegacyValorCobradoPanel — destaca campanhas legadas sem `valor_cobrado`
// e permite regularização individual. Some sozinho quando a fila esvazia.
//
// Regras:
// - Só lê/escreve `campaigns.valor_cobrado` (sem tocar em pagamentos / modelagem nova).
// - v_financial_summary é uma view: recalcula sozinha após o UPDATE.
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ExternalLink } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Row = {
  id: string;
  track_name: string | null;
  artist: string | null;
  created_at: string;
  client_id: string | null;
  created_by: string | null;
  clients: { id: string; name: string } | null;
};

const fmtDate = (iso: string) => {
  try {
    return format(new Date(iso), "dd MMM yyyy", { locale: ptBR });
  } catch {
    return iso;
  }
};

function parseBRL(input: string): number | null {
  const cleaned = input.replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".");
  const n = Number(cleaned);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function LegacyValorCobradoPanel() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Row | null>(null);
  const [valueText, setValueText] = useState("");
  const [saving, setSaving] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["legacy-valor-cobrado-null"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("campaigns")
        .select("id, track_name, artist, created_at, client_id, created_by, clients ( id, name )")
        .is("valor_cobrado", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as Row[];
    },
  });

  const rows = useMemo(() => data ?? [], [data]);
  const count = rows.length;

  if (isLoading || count === 0) return null;

  const openRegularize = (r: Row) => {
    setEditing(r);
    setValueText("");
  };

  const save = async () => {
    if (!editing) return;
    const parsed = parseBRL(valueText);
    if (!parsed) {
      toast.error("Informe um valor válido (R$ > 0)");
      return;
    }
    setSaving(true);
    try {
      // Fase 15: passa pela RPC oficial — backend valida (draft+sem plano OU admin).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase.rpc as any)("set_campaign_price", {
        p_campaign_id: editing.id,
        p_valor: parsed,
      });
      if (error) throw error;
      toast.success("Valor contratado registrado");
      setEditing(null);
      await qc.invalidateQueries({ queryKey: ["legacy-valor-cobrado-null"] });
      await qc.invalidateQueries({ queryKey: ["financial-overview"] });
      await qc.invalidateQueries({ queryKey: ["client_finance"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-2xl border border-amber-500/30 bg-amber-500/5 overflow-hidden">
      <header className="px-5 py-4 border-b border-amber-500/20 flex items-start gap-3">
        <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-amber-300">Pendências financeiras</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {count === 1
              ? "1 campanha sem valor contratado"
              : `${count} campanhas sem valor contratado`}
            . Regularize para que entrem nos KPIs financeiros consolidados.
          </p>
        </div>
      </header>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-elevated/30 text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="text-left px-4 py-2 font-medium">Campanha</th>
              <th className="hidden sm:table-cell text-left px-4 py-2 font-medium">Cliente</th>
              <th className="hidden md:table-cell text-left px-4 py-2 font-medium">Data</th>
              <th className="hidden lg:table-cell text-left px-4 py-2 font-medium">Responsável</th>
              <th className="text-right px-4 py-2 font-medium">Ação</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-elevated/40">
                <td className="px-4 py-2.5 min-w-0">
                  <div className="font-medium text-foreground truncate max-w-[220px]" title={r.track_name ?? ""}>
                    Campanha pendente de regularização financeira
                  </div>
                  <div className="text-[11px] text-muted-foreground truncate max-w-[220px]">
                    {r.track_name ?? "—"}
                    {r.artist ? ` · ${r.artist}` : ""}
                  </div>
                </td>
                <td className="hidden sm:table-cell px-4 py-2.5">
                  {r.clients?.id ? (
                    <Link
                      to={`/clientes/${r.clients.id}`}
                      className="text-foreground hover:text-primary inline-flex items-center gap-1"
                    >
                      {r.clients.name}
                      <ExternalLink className="h-3 w-3 opacity-60" />
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="hidden md:table-cell px-4 py-2.5 text-muted-foreground tabular-nums">
                  {fmtDate(r.created_at)}
                </td>
                <td className="hidden lg:table-cell px-4 py-2.5 text-muted-foreground text-[12px] truncate max-w-[160px]">
                  {r.created_by ? (
                    <span title={r.created_by}>{r.created_by.slice(0, 8)}…</span>
                  ) : (
                    <span>—</span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-right">
                  <Button size="sm" variant="outline" onClick={() => openRegularize(r)}>
                    Regularizar
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={editing !== null} onOpenChange={(v) => !v && !saving && setEditing(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Regularizar valor contratado</DialogTitle>
            <DialogDescription>
              Campanha legada sem <code className="text-foreground">valor_cobrado</code>. Informe o valor para
              fechar a pendência. Apenas este campo será editado — pagamento permanece fora desta etapa.
            </DialogDescription>
          </DialogHeader>

          {editing && (
            <div className="space-y-3">
              <div className="rounded-lg border border-border bg-card/40 p-3 text-sm">
                <div className="font-medium text-foreground truncate">{editing.track_name ?? "—"}</div>
                <div className="text-xs text-muted-foreground">
                  {editing.artist ?? "—"} · {editing.clients?.name ?? "sem cliente"} · {fmtDate(editing.created_at)}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="valor-cobrado">Valor contratado (R$)</Label>
                <Input
                  id="valor-cobrado"
                  inputMode="decimal"
                  placeholder="Ex: 1500 ou 1.500,00"
                  value={valueText}
                  onChange={(e) => setValueText(e.target.value)}
                  autoFocus
                />
                <p className="text-[11px] text-muted-foreground">
                  Aceita formato BR (1.500,00) ou número simples (1500).
                </p>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditing(null)} disabled={saving}>
              Cancelar
            </Button>
            <Button onClick={save} disabled={saving || !parseBRL(valueText)}>
              {saving ? "Salvando…" : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
