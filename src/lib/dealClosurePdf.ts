// Gera PDF de FECHAMENTO do deal — relatório completo final
// Inclui: música(s), baseline, evolução, playlists categorizadas, R$/play, score, prazo
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import {
  computeCuratorStats,
  type CuratorDeal,
  type CuratorDealLog,
  type CuratorDealSong,
  type CuratorPlaylist,
  type CuratorDealProgress,
} from "@/lib/curatorDealsUtils";

function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return Math.round(n).toLocaleString("pt-BR");
}
function fmtBRL(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n);
}

export type DealClosurePdfInput = {
  deal: CuratorDeal;
  songs: CuratorDealSong[];
  logs: CuratorDealLog[];
  playlists: CuratorPlaylist[];
  progress?: CuratorDealProgress | null;
  closeStatus: "completed" | "cancelled";
  closeReason?: string | null;
};

export function buildDealClosurePdf(input: DealClosurePdfInput): Blob {
  const { deal, songs, logs, playlists, progress, closeStatus, closeReason } = input;
  const stats = computeCuratorStats(deal, logs, playlists, progress ?? null);

  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 40;
  let y = margin;

  // ── HEADER ──
  doc.setFillColor(5, 5, 5);
  doc.rect(0, 0, pageW, 96, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.text("NexEngine — Relatório de Fechamento", margin, 42);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(180, 180, 180);
  doc.text(
    `${closeStatus === "completed" ? "Concluído com sucesso" : "Encerrado antes da meta"} · ${format(new Date(), "dd/MM/yyyy HH:mm", { locale: ptBR })}`,
    margin,
    62,
  );
  doc.text(`Curador: ${deal.curator_name}`, margin, 78);

  y = 124;
  doc.setTextColor(20, 20, 20);

  // ── DEAL OVERVIEW ──
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text("Deal", margin, y);
  y += 16;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(80, 80, 80);
  const startStr = format(new Date(deal.started_at), "dd/MM/yyyy", { locale: ptBR });
  const endStr = deal.ends_at ? format(new Date(deal.ends_at), "dd/MM/yyyy", { locale: ptBR }) : "—";
  doc.text(`Período: ${startStr} → ${endStr}`, margin, y);
  y += 14;
  doc.text(`Músicas no deal: ${songs.length || 1}`, margin, y);
  y += 14;
  if (closeReason) {
    doc.text(`Motivo do encerramento: ${closeReason}`, margin, y, { maxWidth: pageW - margin * 2 });
    y += 14;
  }
  doc.setTextColor(20, 20, 20);

  // ── KPIs ──
  y += 8;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text("Resultado", margin, y);
  y += 14;

  const cost = Number(deal.cost ?? 0) || 0;
  const cppDenom = stats.earned > 0 ? stats.earned : Number(deal.target_plays ?? 0);
  const costPerPlay = cost > 0 && cppDenom > 0 ? cost / cppDenom : null;
  const cppIsEstimate = stats.earned === 0;

  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    body: [
      ["Plays entregues", `${fmt(stats.earned)} de ${fmt(Number(deal.target_plays ?? 0))} (${stats.pct}%)`],
      ["Velocidade média", stats.vel !== null ? `${fmt(stats.vel)} plays/dia` : "—"],
      ["Investido", fmtBRL(cost)],
      [
        "Custo por play",
        costPerPlay !== null
          ? `${new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: costPerPlay < 0.01 ? 4 : 2, maximumFractionDigits: costPerPlay < 0.01 ? 4 : 2 }).format(costPerPlay)}${cppIsEstimate ? " (estimado)" : ""}`
          : "—",
      ],
      [
        "Prazo",
        stats.onTime === true
          ? "Cumprido"
          : stats.onTime === false
          ? "Não cumprido"
          : "Indefinido",
      ],
      [
        "Qualidade do tráfego",
        `${Math.round(stats.legitShare * 100)}% legítimo · ${Math.round(stats.suspiciousShare * 100)}% suspeito`,
      ],
      ["Score do deal", `${stats.score}/100`],
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

  // ── MÚSICAS ──
  if (songs.length > 0) {
    if (y > 700) { doc.addPage(); y = margin; }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.text(`Músicas (${songs.length})`, margin, y);
    y += 6;
    autoTable(doc, {
      startY: y + 4,
      margin: { left: margin, right: margin },
      head: [["#", "Música", "Artista", "Meta", "Diária"]],
      body: songs.map((s, i) => [
        String(i + 1),
        s.song_name,
        s.song_artist ?? "—",
        fmt(Number(s.target_plays ?? 0)),
        fmt(Number(s.daily_goal ?? 0)),
      ]),
      styles: { fontSize: 9, cellPadding: 6 },
      headStyles: { fillColor: [29, 185, 84], textColor: [0, 0, 0], fontStyle: "bold" },
    });
    // @ts-expect-error jspdf-autotable types
    y = (doc.lastAutoTable?.finalY ?? y) + 20;
  }

  // ── PLAYLISTS POR CATEGORIA ──
  const dealPlaylists = playlists.filter((p) => p.deal_id === deal.id);
  if (dealPlaylists.length > 0) {
    if (y > 680) { doc.addPage(); y = margin; }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.text(`Playlists (${dealPlaylists.length})`, margin, y);
    y += 6;
    const labelMap: Record<string, string> = {
      curator: "Do curador",
      editorial: "Editorial",
      organic: "Orgânica",
      suspicious: "Suspeita",
      baseline: "Inicial",
    };
    const order = ["curator", "editorial", "organic", "suspicious", "baseline"];
    const sorted = [...dealPlaylists].sort((a, b) => {
      const sa = (a.match_status ?? (a.is_initial_roster ? "baseline" : "curator")) as string;
      const sb = (b.match_status ?? (b.is_initial_roster ? "baseline" : "curator")) as string;
      return order.indexOf(sa) - order.indexOf(sb);
    });
    autoTable(doc, {
      startY: y + 4,
      margin: { left: margin, right: margin },
      head: [["Playlist", "Categoria", "Plays 7d", "Plays 28d"]],
      body: sorted.map((p) => {
        const status = (p.match_status ?? (p.is_initial_roster ? "baseline" : "curator")) as string;
        return [
          p.playlist_name,
          labelMap[status] ?? status,
          fmt(Number(p.streams_7d ?? 0)),
          fmt(Number(p.streams_28d ?? 0)),
        ];
      }),
      styles: { fontSize: 9, cellPadding: 6, overflow: "linebreak" },
      headStyles: { fillColor: [29, 185, 84], textColor: [0, 0, 0], fontStyle: "bold" },
      alternateRowStyles: { fillColor: [248, 248, 248] },
      columnStyles: {
        0: { cellWidth: 240 },
        1: { cellWidth: 90 },
        2: { cellWidth: 70, halign: "right" },
        3: { cellWidth: 70, halign: "right" },
      },
    });
    // @ts-expect-error jspdf-autotable types
    y = (doc.lastAutoTable?.finalY ?? y) + 20;
  }

  // ── EVOLUÇÃO (logs não-baseline) ──
  if (stats.nonBaselineLogs.length > 0) {
    if (y > 680) { doc.addPage(); y = margin; }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.text("Evolução", margin, y);
    y += 6;
    autoTable(doc, {
      startY: y + 4,
      margin: { left: margin, right: margin },
      head: [["Data", "Plays acumulados", "Δ desde último"]],
      body: stats.nonBaselineLogs.map((l, i, arr) => {
        const prev = i === 0 ? Number(deal.baseline_plays ?? 0) : Number(arr[i - 1].total_plays);
        const delta = Number(l.total_plays) - prev;
        return [
          format(new Date(l.created_at), "dd/MM HH:mm", { locale: ptBR }),
          fmt(Number(l.total_plays)),
          (delta >= 0 ? "+" : "") + fmt(delta),
        ];
      }),
      styles: { fontSize: 9, cellPadding: 6 },
      headStyles: { fillColor: [29, 185, 84], textColor: [0, 0, 0], fontStyle: "bold" },
      alternateRowStyles: { fillColor: [248, 248, 248] },
    });
  }

  // ── FOOTER ──
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    const ph = doc.internal.pageSize.getHeight();
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(140, 140, 140);
    doc.text(`Powered by NexEngine · ${i}/${pageCount}`, pageW - margin, ph - 16, { align: "right" });
  }

  return doc.output("blob");
}

export async function uploadClosurePdf(blob: Blob, dealId: string): Promise<string> {
  const path = `${dealId}/fechamento-${Date.now()}.pdf`;
  const { error } = await supabase.storage
    .from("deal-prints")
    .upload(path, blob, { contentType: "application/pdf", upsert: false });
  if (error) throw error;
  const { data } = supabase.storage.from("deal-prints").getPublicUrl(path);
  return data.publicUrl;
}
