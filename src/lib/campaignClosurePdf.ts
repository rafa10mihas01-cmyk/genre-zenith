// Gera PDF de FECHAMENTO da CAMPANHA (não do deal).
// Funciona pra campanhas de qualquer tipo: ecosystem, external, hybrid.
// Usado pela UI quando o operador abre uma campanha completed cujo
// final_report_url ainda não foi gerado.
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";

const fmt = (n: number | null | undefined): string =>
  n == null || !Number.isFinite(n) ? "—" : Math.round(n).toLocaleString("pt-BR");
const fmtBRL = (n: number | null | undefined): string =>
  n == null || !Number.isFinite(n)
    ? "—"
    : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n);

export type CampaignClosureInput = {
  campaign: {
    id: string;
    track_name: string;
    artist?: string | null;
    goal_plays: number;
    total_delivered: number;
    started_at: string;
    closed_at?: string | null;
    deadline?: string | null;
    valor_cobrado?: number | null;
    campaign_type?: string | null;
  };
  ecoAllocs: Array<{
    planned_streams: number;
    position?: number | null;
    managed_playlists?: { name: string | null; followers: number | null } | null;
  }>;
  ecoSnapshots: Array<{
    managed_playlist_id: string;
    plays_28d: number | null;
    captured_at: string;
  }>;
};

export function buildCampaignClosurePdf(input: CampaignClosureInput): Blob {
  const { campaign: c, ecoAllocs, ecoSnapshots } = input;
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 40;
  let y = margin;

  // Header
  doc.setFillColor(5, 5, 5);
  doc.rect(0, 0, pageW, 96, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.text("NexEngine — Relatório de Campanha", margin, 42);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(180, 180, 180);
  doc.text(
    `${c.track_name}${c.artist ? ` — ${c.artist}` : ""}`,
    margin,
    62,
  );
  doc.text(
    `Fechamento: ${format(new Date(c.closed_at ?? Date.now()), "dd/MM/yyyy HH:mm", { locale: ptBR })}`,
    margin,
    78,
  );

  y = 124;
  doc.setTextColor(20, 20, 20);

  // Resumo
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text("Resumo", margin, y);
  y += 6;

  const delivered = Number(c.total_delivered ?? 0);
  const goal = Number(c.goal_plays ?? 0);
  const pct = goal > 0 ? Math.round((delivered / goal) * 100) : 0;
  const cost = Number(c.valor_cobrado ?? 0) || 0;
  const cpp = cost > 0 && delivered > 0 ? cost / delivered : null;
  const startStr = format(new Date(c.started_at), "dd/MM/yyyy", { locale: ptBR });
  const endStr = c.closed_at
    ? format(new Date(c.closed_at), "dd/MM/yyyy", { locale: ptBR })
    : "—";

  autoTable(doc, {
    startY: y + 4,
    margin: { left: margin, right: margin },
    body: [
      ["Tipo", c.campaign_type ?? "—"],
      ["Período", `${startStr} → ${endStr}`],
      ["Meta", fmt(goal)],
      ["Plays entregues", `${fmt(delivered)} (${pct}%)`],
      ["Investido", fmtBRL(cost)],
      [
        "Custo por play",
        cpp != null
          ? new Intl.NumberFormat("pt-BR", {
              style: "currency",
              currency: "BRL",
              minimumFractionDigits: cpp < 0.01 ? 4 : 2,
              maximumFractionDigits: cpp < 0.01 ? 4 : 2,
            }).format(cpp)
          : "—",
      ],
    ],
    styles: { fontSize: 10, cellPadding: 7 },
    columnStyles: {
      0: { cellWidth: 160, fontStyle: "bold", textColor: [60, 60, 60] },
      1: { cellWidth: "auto", textColor: [20, 20, 20] },
    },
    theme: "plain",
    alternateRowStyles: { fillColor: [248, 248, 248] },
  });
  // @ts-expect-error jspdf-autotable types
  y = (doc.lastAutoTable?.finalY ?? y) + 20;

  // Playlists do ecossistema
  if (ecoAllocs.length > 0) {
    if (y > 680) {
      doc.addPage();
      y = margin;
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.text(`Playlists do ecossistema (${ecoAllocs.length})`, margin, y);

    // Mais recente snapshot por playlist
    const latestByPl = new Map<string, number>();
    for (const s of ecoSnapshots) {
      const prev = latestByPl.get(s.managed_playlist_id);
      if (prev == null) latestByPl.set(s.managed_playlist_id, Number(s.plays_28d ?? 0));
    }

    autoTable(doc, {
      startY: y + 6,
      margin: { left: margin, right: margin },
      head: [["Playlist", "Pos.", "Plano", "Entregue (28d)"]],
      body: ecoAllocs.map((a) => [
        a.managed_playlists?.name ?? "—",
        a.position != null ? String(a.position) : "—",
        fmt(a.planned_streams),
        fmt(latestByPl.get((a as any).managed_playlist_id) ?? null),
      ]),
      styles: { fontSize: 9, cellPadding: 6, overflow: "linebreak" },
      headStyles: { fillColor: [29, 185, 84], textColor: [0, 0, 0], fontStyle: "bold" },
      alternateRowStyles: { fillColor: [248, 248, 248] },
      columnStyles: {
        0: { cellWidth: 280 },
        1: { cellWidth: 50, halign: "center" },
        2: { cellWidth: 80, halign: "right" },
        3: { cellWidth: 90, halign: "right" },
      },
    });
  }

  // Footer
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    const ph = doc.internal.pageSize.getHeight();
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(140, 140, 140);
    doc.text(`Powered by NexEngine · ${i}/${pageCount}`, pageW - margin, ph - 16, {
      align: "right",
    });
  }

  return doc.output("blob");
}

export async function generateAndStoreCampaignReport(campaignId: string): Promise<string> {
  // Busca tudo necessário
  const [cRes, allocsRes, snapsRes] = await Promise.all([
    supabase
      .from("campaigns")
      .select(
        "id, track_name, artist, goal_plays, total_delivered, started_at, closed_at, deadline, valor_cobrado, campaign_type",
      )
      .eq("id", campaignId)
      .maybeSingle(),
    supabase
      .from("campaign_eco_allocations")
      .select("managed_playlist_id, planned_streams, position, managed_playlists(name, followers)")
      .eq("campaign_id", campaignId)
      .order("position", { nullsFirst: false }),
    supabase
      .from("campaign_eco_snapshots")
      .select("managed_playlist_id, plays_28d, captured_at")
      .eq("campaign_id", campaignId)
      .order("captured_at", { ascending: false }),
  ]);

  if (cRes.error || !cRes.data) throw new Error(cRes.error?.message ?? "campaign_not_found");

  const blob = buildCampaignClosurePdf({
    campaign: cRes.data as any,
    ecoAllocs: (allocsRes.data as any[]) ?? [],
    ecoSnapshots: (snapsRes.data as any[]) ?? [],
  });

  const path = `campaigns/${campaignId}/fechamento-${Date.now()}.pdf`;
  const { error: upErr } = await supabase.storage
    .from("deal-prints")
    .upload(path, blob, { contentType: "application/pdf", upsert: false });
  if (upErr) throw upErr;

  // URL assinada por 10 anos (~315M segundos)
  const { data: signed, error: signedErr } = await supabase.storage
    .from("deal-prints")
    .createSignedUrl(path, 60 * 60 * 24 * 365 * 10);
  if (signedErr || !signed?.signedUrl) throw signedErr ?? new Error("signed_url_failed");

  const url = signed.signedUrl;
  await supabase
    .from("campaigns")
    .update({ final_report_url: url })
    .eq("id", campaignId);

  return url;
}
