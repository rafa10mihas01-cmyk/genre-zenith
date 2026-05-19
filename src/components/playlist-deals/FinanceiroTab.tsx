// FinanceiroTab — dashboard operacional de custos da curadoria.
// Lê do ledger curator_purchases via useCuratorFinance.
import { useMemo } from "react";
import { Wallet, TrendingUp, Users, Receipt, Target } from "lucide-react";
import { useCuratorFinance } from "@/hooks/useCuratorFinance";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { KpiBig } from "@/components/KpiBig";
import type { CuratorDeal } from "@/lib/curatorDealsUtils";

const fmtBRL = (v: number | null | undefined) =>
  v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const fmtBRLShort = (v: number | null | undefined) => {
  if (v == null) return "—";
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}R$ ${(abs / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi`;
  if (abs >= 1_000) return `${sign}R$ ${(abs / 1_000).toLocaleString("pt-BR", { maximumFractionDigits: abs >= 10_000 ? 0 : 1 })} mil`;
  return fmtBRL(v);
};

const fmtCpp = (v: number | null | undefined) =>
  v == null ? "—" : `R$ ${v.toFixed(4)}`;

interface Props {
  deals: CuratorDeal[];
}

export function FinanceiroTab({ deals }: Props) {
  const { byCurator, purchases, totals, loading } = useCuratorFinance();

  // Comprometido = soma de target_plays dos deals abertos × CPP global
  const committed = useMemo(() => {
    if (!totals.globalCpp) return 0;
    const openTarget = deals
      .filter((d) => !d.closed_at)
      .reduce((acc, d) => acc + Number(d.target_plays ?? 0), 0);
    return openTarget * totals.globalCpp;
  }, [deals, totals.globalCpp]);

  const saldoVirtual = totals.totalSpent - committed;

  // Ranking: menor CPP primeiro
  const ranking = useMemo(() => {
    return [...byCurator]
      .filter((r) => r.plays_purchased > 0)
      .sort((a, b) => (a.cpp ?? Infinity) - (b.cpp ?? Infinity));
  }, [byCurator]);

  if (loading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-28 rounded-2xl bg-card border border-border animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat icon={Wallet} label="Total comprado" value={fmtBRL(totals.totalSpent)} mobileValue={fmtBRLShort(totals.totalSpent)} hint={`${formatNumber(totals.totalPlays)} plays`} />
        <Stat icon={Target} label="Comprometido" value={fmtBRL(committed)} mobileValue={fmtBRLShort(committed)} hint={`${deals.filter(d => !d.closed_at).length} deals abertos`} tone="primary" />
        <Stat icon={TrendingUp} label="Saldo derivado" value={fmtBRL(saldoVirtual)} mobileValue={fmtBRLShort(saldoVirtual)} hint="Comprado − comprometido" tone={saldoVirtual >= 0 ? "success" : "warning"} />
        <Stat icon={Receipt} label="CPP médio" value={fmtCpp(totals.globalCpp)} hint="Custo por play global" />
      </section>

      <section className="rounded-2xl bg-card border border-border overflow-hidden">
        <header className="px-5 py-4 border-b border-border flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Ranking de curadores</h3>
            <p className="text-xs text-muted-foreground mt-0.5">Ordenado por menor CPP</p>
          </div>
          <Users className="h-4 w-4 text-muted-foreground" />
        </header>
        {ranking.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-muted-foreground">
            Sem compras
          </div>
        ) : (
          <div className="overflow-auto max-h-[360px]">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-card z-10">
                <tr className="text-[11px] uppercase tracking-wide text-muted-foreground border-b border-border">
                  <th className="text-left px-5 py-2 font-medium">#</th>
                  <th className="text-left px-5 py-2 font-medium">Curador</th>
                  <th className="text-right px-5 py-2 font-medium">Plays</th>
                  <th className="text-right px-5 py-2 font-medium">Investido</th>
                  <th className="text-right px-5 py-2 font-medium">CPP</th>
                  <th className="text-right px-5 py-2 font-medium">Compras</th>
                </tr>
              </thead>
              <tbody>
                {ranking.map((r, i) => {
                  const isCheap = totals.globalCpp && r.cpp != null && r.cpp < totals.globalCpp;
                  const isExpensive = totals.globalCpp && r.cpp != null && r.cpp > totals.globalCpp * 1.5;
                  return (
                    <tr key={r.curator_id} className="border-b border-border last:border-0 hover:bg-elevated/40">
                      <td className="px-5 py-3 text-muted-foreground tabular-nums">{i + 1}</td>
                      <td className="px-5 py-3 font-medium text-foreground">{r.name}</td>
                      <td className="px-5 py-3 text-right tabular-nums">{formatNumber(r.plays_purchased)}</td>
                      <td className="px-5 py-3 text-right tabular-nums">{fmtBRL(r.total_cost)}</td>
                      <td className={cn("px-5 py-3 text-right tabular-nums font-semibold",
                        isCheap && "text-primary",
                        isExpensive && "text-amber-500"
                      )}>{fmtCpp(r.cpp)}</td>
                      <td className="px-5 py-3 text-right text-muted-foreground tabular-nums">{r.purchase_count}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-2xl bg-card border border-border overflow-hidden">
        <header className="px-5 py-4 border-b border-border">
          <h3 className="text-sm font-semibold text-foreground">Últimas compras</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Histórico imutável do ledger</p>
        </header>
        {purchases.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-muted-foreground">
            Sem compras
          </div>
        ) : (
          <ul className="divide-y divide-border overflow-auto max-h-[420px]">
            {purchases.slice(0, 30).map((p) => {
              const curator = byCurator.find((c) => c.curator_id === p.curator_id);
              return (
                <li key={p.id} className="px-5 py-3 flex items-center gap-4 text-sm">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-foreground truncate">{curator?.name ?? "—"}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {new Date(p.purchased_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" })}
                      {p.note && <span className="ml-2 opacity-70">· {p.note}</span>}
                    </div>
                  </div>
                  <div className="text-right tabular-nums">
                    <div className="text-foreground">{formatNumber(p.plays_purchased)} plays</div>
                    <div className="text-xs text-muted-foreground">{fmtBRL(p.amount)} · {fmtCpp(p.cpp)}</div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function Stat({
  icon: Icon, label, value, mobileValue, hint, tone = "default",
}: {
  icon: any; label: string; value: string; mobileValue?: string; hint?: string;
  tone?: "default" | "primary" | "success" | "warning";
}) {
  const valueColor =
    tone === "primary" ? "text-primary"
    : tone === "success" ? "text-primary"
    : tone === "warning" ? "text-amber-500"
    : "text-foreground";
  return (
    <div className="rounded-2xl bg-card border border-border p-4 sm:p-5 min-h-[118px] overflow-hidden">
      <div className="flex items-start gap-2 text-[10px] sm:text-xs text-muted-foreground uppercase tracking-[0.08em] sm:tracking-wide leading-tight min-w-0">
        <Icon className="h-3.5 w-3.5 shrink-0 mt-0.5" />
        <span className="min-w-0 line-clamp-2 break-words">{label}</span>
      </div>
      <div className={cn("mt-2 tabular-nums font-bold leading-tight min-w-0", valueColor)}>
        {mobileValue ? (
          <>
            <span className="block sm:hidden text-[22px] truncate">{mobileValue}</span>
            <span className="hidden sm:block text-2xl truncate">{value}</span>
          </>
        ) : (
          <span className="block text-xl sm:text-2xl truncate">{value}</span>
        )}
      </div>
      {hint && <div className="text-[11px] sm:text-xs text-muted-foreground mt-1 line-clamp-2 leading-snug">{hint}</div>}
    </div>
  );
}
