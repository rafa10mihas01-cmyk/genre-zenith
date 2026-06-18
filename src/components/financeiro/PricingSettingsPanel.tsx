// Painel de configuração de pricing — custos por stream + preço de venda
// + margem alvo. Singleton por usuário (tabela pricing_settings).
import { useState, useEffect } from "react";
import { Settings as SettingsIcon, Save, Loader2 } from "lucide-react";
import { usePricingSettings } from "@/hooks/usePricingSettings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { getErrorMessage } from "@/lib/errors";

function rsPerThousand(v: number): string {
  return (v * 1000).toLocaleString("pt-BR", { maximumFractionDigits: 0 });
}

export function PricingSettingsPanel() {
  const { settings, isLoading, update } = usePricingSettings();
  const [eco, setEco] = useState("");
  const [ext, setExt] = useState("");
  const [marketEco, setMarketEco] = useState("");
  const [marketExt, setMarketExt] = useState("");
  const [sell, setSell] = useState("");
  const [margin, setMargin] = useState("");

  useEffect(() => {
    setEco(String(settings.cost_per_stream_eco));
    setExt(String(settings.cost_per_stream_ext));
    setMarketEco(String(settings.market_per_stream_eco));
    setMarketExt(String(settings.market_per_stream_ext));
    setSell(String(settings.price_per_stream_sell));
    setMargin(String(settings.target_margin_pct));
  }, [settings]);

  const handleSave = async () => {
    const ecoN = Number(eco.replace(",", "."));
    const extN = Number(ext.replace(",", "."));
    const mEcoN = Number(marketEco.replace(",", "."));
    const mExtN = Number(marketExt.replace(",", "."));
    const sellN = Number(sell.replace(",", "."));
    const marginN = Number(margin.replace(",", "."));
    if ([ecoN, extN, mEcoN, mExtN, sellN, marginN].some(n => !Number.isFinite(n) || n < 0)) {
      toast.error("Valores inválidos");
      return;
    }
    try {
      await update.mutateAsync({
        cost_per_stream_eco: ecoN,
        cost_per_stream_ext: extN,
        market_per_stream_eco: mEcoN,
        market_per_stream_ext: mExtN,
        price_per_stream_sell: sellN,
        target_margin_pct: marginN,
      });
      toast.success("Configurações salvas");
    } catch (e: unknown) {
      toast.error(getErrorMessage(e) ?? "Falha ao salvar");
    }
  };

  const ecoN = Number(eco.replace(",", ".")) || 0;
  const extN = Number(ext.replace(",", ".")) || 0;
  const sellN = Number(sell.replace(",", ".")) || 0;
  const marginPreview = sellN > 0
    ? (((sellN - ((ecoN + extN) / 2)) / sellN) * 100)
    : 0;

  return (
    <div className="rounded-2xl border border-border bg-card p-5 space-y-5">
      <header className="flex items-center gap-2">
        <SettingsIcon className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-base font-semibold">Pricing — custos, mercado e venda</h3>
      </header>
      <p className="text-sm text-muted-foreground">
        <strong className="text-foreground">Operacional</strong> = quanto custa de fato pra entregar.{" "}
        <strong className="text-foreground">Mercado</strong> = valor equivalente se comprado de terceiros (inteligência financeira, não vai pro caixa).{" "}
        <strong className="text-foreground">Venda</strong> = o que cobra do cliente.
      </p>

      <div className="space-y-2">
        <div className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">Custo operacional</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Ecossistema interno (R$/stream)" hint={`R$ ${rsPerThousand(ecoN)}/mil`} value={eco} onChange={setEco} />
          <Field label="Curadores externos (R$/stream)" hint={`R$ ${rsPerThousand(extN)}/mil`} value={ext} onChange={setExt} />
        </div>
      </div>

      <div className="space-y-2">
        <div className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">Valor de mercado equivalente</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Interno — valor de mercado" hint={`R$ ${rsPerThousand(Number(marketEco.replace(",", ".")) || 0)}/mil`} value={marketEco} onChange={setMarketEco} />
          <Field label="Externo — valor de mercado" hint={`R$ ${rsPerThousand(Number(marketExt.replace(",", ".")) || 0)}/mil`} value={marketExt} onChange={setMarketExt} />
        </div>
      </div>

      <div className="space-y-2">
        <div className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">Venda ao cliente</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Preço de venda (R$/stream)" hint={`R$ ${rsPerThousand(sellN)}/mil`} value={sell} onChange={setSell} />
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">Margem alvo (%)</Label>
            <Input value={margin} onChange={(e) => setMargin(e.target.value)} placeholder="50" inputMode="decimal" />
            <p className="text-xs text-muted-foreground">
              Margem prevista: <strong className="text-foreground">{marginPreview.toFixed(0)}%</strong>
            </p>
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={update.isPending || isLoading}>
          {update.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
          Salvar
        </Button>
      </div>
    </div>
  );
}

function Field({ label, hint, value, onChange }: {
  label: string; hint: string; value: string; onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Label className="text-xs uppercase tracking-wide text-muted-foreground">{label}</Label>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="0,000"
        inputMode="decimal"
      />
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}
