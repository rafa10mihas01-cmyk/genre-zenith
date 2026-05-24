// FeatureFlagsPanel — toggles administrativos para flags em system_flags (singleton 'app').
// Hoje expõe auto_deal_from_campaign. Estrutura preparada para crescer.
import { useCallback, useEffect, useState } from "react";
import { Flag, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

type FlagsRow = {
  singleton_key: string;
  auto_deal_from_campaign: boolean | null;
  updated_at: string | null;
};

type FlagDef = {
  key: keyof Pick<FlagsRow, "auto_deal_from_campaign">;
  title: string;
  description: string;
  impact: string;
};

const FLAGS: FlagDef[] = [
  {
    key: "auto_deal_from_campaign",
    title: "Criar deal automaticamente ao aprovar plano",
    description:
      "Quando ligado, aprovar o plano de uma campanha do tipo Ecossistema/Híbrida cria o deal e semeia as playlists do curador.",
    impact: "Afeta o fluxo de Campanhas → Deals. Desligar pausa a criação automática até religar.",
  },
];

export function FeatureFlagsPanel() {
  const [row, setRow] = useState<FlagsRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("system_flags")
      .select("singleton_key, auto_deal_from_campaign, updated_at")
      .eq("singleton_key", "app")
      .maybeSingle();
    setLoading(false);
    if (error) {
      toast({ title: "Erro ao carregar flags", description: error.message, variant: "destructive" });
      return;
    }
    setRow((data as FlagsRow) ?? null);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function toggle(flag: FlagDef, next: boolean) {
    setSavingKey(flag.key);
    const { error } = await supabase
      .from("system_flags")
      .update({ [flag.key]: next, updated_at: new Date().toISOString() })
      .eq("singleton_key", "app");
    setSavingKey(null);
    if (error) {
      toast({ title: "Erro ao atualizar", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: next ? "Flag ligada" : "Flag desligada", description: flag.title });
    load();
  }

  return (
    <div className="rounded-2xl border border-border bg-card">
      <div className="px-5 py-4 border-b border-border flex items-center gap-3">
        <div className="h-8 w-8 rounded-md bg-muted/40 border border-border flex items-center justify-center">
          <Flag className="h-4 w-4 text-muted-foreground" />
        </div>
        <div>
          <h3 className="text-[14px] font-semibold leading-tight text-foreground">Feature flags</h3>
          <p className="text-[12px] text-muted-foreground leading-tight">
            Toggles globais que afetam comportamento operacional do sistema
          </p>
        </div>
      </div>

      <div className="divide-y divide-border">
        {loading ? (
          <div className="px-5 py-8 flex items-center justify-center text-muted-foreground text-sm">
            <Loader2 className="h-4 w-4 animate-spin mr-2" /> Carregando flags…
          </div>
        ) : !row ? (
          <div className="px-5 py-8 text-center text-sm text-muted-foreground">
            Linha singleton de <code>system_flags</code> não encontrada.
          </div>
        ) : (
          FLAGS.map((flag) => {
            const value = !!row[flag.key];
            const saving = savingKey === flag.key;
            return (
              <div key={flag.key} className="px-5 py-4 flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        "h-1.5 w-1.5 rounded-full shrink-0",
                        value ? "bg-primary" : "bg-muted-foreground/50",
                      )}
                    />
                    <p className="text-[13.5px] font-semibold text-foreground leading-tight">{flag.title}</p>
                  </div>
                  <p className="text-[12px] text-muted-foreground leading-snug mt-1.5">{flag.description}</p>
                  <p className="text-[11px] text-muted-foreground/80 leading-snug mt-1 italic">{flag.impact}</p>
                </div>
                <Switch checked={value} disabled={saving} onCheckedChange={(v) => toggle(flag, v)} />
              </div>
            );
          })
        )}
      </div>

      {row?.updated_at && (
        <div className="px-5 py-2.5 border-t border-border bg-elevated/30">
          <p className="text-[10.5px] text-muted-foreground">
            Última alteração: {new Date(row.updated_at).toLocaleString("pt-BR")}
          </p>
        </div>
      )}
    </div>
  );
}
