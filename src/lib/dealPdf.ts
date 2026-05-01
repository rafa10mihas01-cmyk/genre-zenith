// Gera PDF organizado a partir do JSON estruturado pela IA e faz upload
// pro bucket público. Retorna a URL pública.
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { supabase } from "@/integrations/supabase/client";

export type ParsedDealPlaylist = {
  name: string;
  plays: number | null;
  spotify_url: string | null;
  spotify_id?: string | null;
};

export type ParsedDealData = {
  song_name: string | null;
  song_artist: string | null;
  total_plays: number | null;
  playlists: ParsedDealPlaylist[];
};

export function extractSpotifyPlaylistId(url: string | null | undefined): string | null {
  if (!url || typeof url !== "string") return null;
  const m = url.match(/playlist[/:]([a-zA-Z0-9]{16,})/);
  return m ? m[1] : null;
}

export type DealPdfContext = {
  dealId: string;
  curatorName?: string | null;
  songFallbackName?: string | null;
  isBaseline: boolean;
};

function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return Math.round(n).toLocaleString("pt-BR");
}

export function buildDealPdf(parsed: ParsedDealData, ctx: DealPdfContext): Blob {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 40;
  let y = margin;

  // Header
  doc.setFillColor(5, 5, 5);
  doc.rect(0, 0, pageW, 90, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text("NexEngine — Relatório de Deal", margin, 40);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(180, 180, 180);
  doc.text(
    `${ctx.isBaseline ? "Registro inicial (baseline)" : "Atualização de progresso"} · ${new Date().toLocaleString("pt-BR")}`,
    margin,
    60,
  );
  if (ctx.curatorName) {
    doc.text(`Curador: ${ctx.curatorName}`, margin, 76);
  }

  y = 120;
  doc.setTextColor(20, 20, 20);

  // Música
  const songName = parsed.song_name ?? ctx.songFallbackName ?? "—";
  const songArtist = parsed.song_artist ?? "";
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("Música", margin, y);
  y += 18;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.text(songName, margin, y);
  y += 14;
  if (songArtist) {
    doc.setTextColor(110, 110, 110);
    doc.text(songArtist, margin, y);
    doc.setTextColor(20, 20, 20);
    y += 14;
  }

  // Total
  y += 10;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("Plays totais", margin, y);
  y += 22;
  doc.setFontSize(22);
  doc.setTextColor(29, 185, 84); // primary verde
  doc.text(fmt(parsed.total_plays), margin, y);
  doc.setTextColor(20, 20, 20);
  y += 22;

  // Tabela de playlists
  if (parsed.playlists.length > 0) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text(`Playlists (${parsed.playlists.length})`, margin, y);
    y += 8;

    autoTable(doc, {
      startY: y + 4,
      margin: { left: margin, right: margin },
      head: [["#", "Playlist", "Plays", "Link"]],
      body: parsed.playlists.map((p, i) => [
        String(i + 1),
        p.name,
        fmt(p.plays),
        p.spotify_url ?? "—",
      ]),
      styles: { fontSize: 9, cellPadding: 6, overflow: "linebreak" },
      headStyles: { fillColor: [29, 185, 84], textColor: [0, 0, 0], fontStyle: "bold" },
      alternateRowStyles: { fillColor: [245, 245, 245] },
      columnStyles: {
        0: { cellWidth: 28 },
        1: { cellWidth: 230 },
        2: { cellWidth: 70, halign: "right" },
        3: { cellWidth: "auto", textColor: [60, 60, 200] },
      },
    });
  } else {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(11);
    doc.setTextColor(110, 110, 110);
    doc.text("Nenhuma playlist identificada no texto.", margin, y + 20);
  }

  // Footer
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    const ph = doc.internal.pageSize.getHeight();
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(140, 140, 140);
    doc.text(
      `Powered by NexEngine · ${i}/${pageCount}`,
      pageW - margin,
      ph - 16,
      { align: "right" },
    );
  }

  return doc.output("blob");
}

export async function uploadDealPdf(blob: Blob, dealId: string): Promise<string> {
  const path = `${dealId}/relatorio-${Date.now()}.pdf`;
  const { error } = await supabase.storage
    .from("deal-prints")
    .upload(path, blob, { contentType: "application/pdf", upsert: false });
  if (error) throw error;
  const { data } = supabase.storage.from("deal-prints").getPublicUrl(path);
  return data.publicUrl;
}
