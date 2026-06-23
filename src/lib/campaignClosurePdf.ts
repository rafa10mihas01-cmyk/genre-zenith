// Gera PDF de FECHAMENTO da CAMPANHA (não do deal).
// Funciona pra campanhas de qualquer tipo: ecosystem, external, hybrid.
// Usado pela UI quando o operador abre uma campanha completed cujo
// final_report_url ainda não foi gerado.
//
// Gap 23 — Nível A: branding por cliente. Quando `clients.logo_url` está
// preenchido, mostra o logo no header em vez do texto "NexEngine". Quando
// `clients.brand_color` (hex #RRGGBB) está preenchido, usa essa cor em
// destaques, bordas e headers de tabela. Vazio = template padrão NexEngine.
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import { deliveryPct } from "@/lib/campaignPct";

const fmt = (n: number | null | undefined): string =>
  n == null || !Number.isFinite(n) ? "—" : Math.round(n).toLocaleString("pt-BR");
const fmtBRL = (n: number | null | undefined): string =>
  n == null || !Number.isFinite(n)
    ? "—"
    : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n);

type RGB = [number, number, number];

function hexToRgb(hex: string | null | undefined): RGB | null {
  if (!hex) return null;
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Carrega imagem (logo) como dataURL para incorporar no jsPDF.
// Retorna null se falhar (CORS, 404, formato inválido) — o caller faz fallback.
async function loadImageAsDataUrl(
  url: string,
): Promise<{ dataUrl: string; width: number; height: number; format: "PNG" | "JPEG" } | null> {
  try {
    const res = await fetch(url, { mode: "cors" });
    if (!res.ok) return null;
    const blob = await res.blob();
    const dataUrl: string = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
    const { width, height } = await new Promise<{ width: number; height: number }>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = reject;
      img.src = dataUrl;
    });
    const fmt: "PNG" | "JPEG" = blob.type.includes("png") ? "PNG" : "JPEG";
    return { dataUrl, width, height, format: fmt };
  } catch {
    return null;
  }
}

export type CampaignClosureBranding = {
  logoUrl?: string | null;
  brandColor?: string | null; // hex #RRGGBB
  clientName?: string | null;
};

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
  branding?: CampaignClosureBranding;
};

export async function buildCampaignClosurePdf(input: CampaignClosureInput): Promise<Blob> {
  const { campaign: c, ecoAllocs, ecoSnapshots, branding } = input;
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 40;
  let y = margin;

  // Branding resolvido (com fallback NexEngine)
  const brandRgb: RGB = hexToRgb(branding?.brandColor) ?? [5, 5, 5];
  const accentRgb: RGB = hexToRgb(branding?.brandColor) ?? [29, 185, 84]; // verde Spotify default
  const titleText = branding?.clientName
    ? `${branding.clientName} — Relatório de Campanha`
    : "NexEngine — Relatório de Campanha";

  // Header
  doc.setFillColor(brandRgb[0], brandRgb[1], brandRgb[2]);
  doc.rect(0, 0, pageW, 96, "F");

  // Logo do cliente (se disponível)
  let textOffsetX = margin;
  if (branding?.logoUrl) {
    const img = await loadImageAsDataUrl(branding.logoUrl);
    if (img) {
      const maxH = 56;
      const ratio = img.width / Math.max(1, img.height);
      const h = Math.min(maxH, img.height);
      const w = h * ratio;
      try {
        doc.addImage(img.dataUrl, img.format, margin, 20, w, h);
        textOffsetX = margin + w + 16;
      } catch {
        // formato não suportado — segue com texto
      }
    }
  }

  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text(titleText, textOffsetX, 42);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(220, 220, 220);
  doc.text(
    `${c.track_name}${c.artist ? ` — ${c.artist}` : ""}`,
    textOffsetX,
    62,
  );
  doc.text(
    `Fechamento: ${format(new Date(c.closed_at ?? Date.now()), "dd/MM/yyyy HH:mm", { locale: ptBR })}`,
    textOffsetX,
    78,
  );

  // Faixa de destaque (cor de marca) abaixo do header
  doc.setFillColor(accentRgb[0], accentRgb[1], accentRgb[2]);
  doc.rect(0, 96, pageW, 4, "F");

  y = 132;
  doc.setTextColor(20, 20, 20);

  // Resumo
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(accentRgb[0], accentRgb[1], accentRgb[2]);
  doc.text("Resumo", margin, y);
  doc.setTextColor(20, 20, 20);
  y += 6;

  const delivered = Number(c.total_delivered ?? 0);
  const goal = Number(c.goal_plays ?? 0);
  const pct = deliveryPct(delivered, goal);
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
    styles: { fontSize: 10, cellPadding: 7, lineColor: accentRgb, lineWidth: 0.2 },
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
    doc.setTextColor(accentRgb[0], accentRgb[1], accentRgb[2]);
    doc.text(`Playlists do ecossistema (${ecoAllocs.length})`, margin, y);
    doc.setTextColor(20, 20, 20);

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
      headStyles: { fillColor: accentRgb, textColor: [255, 255, 255], fontStyle: "bold" },
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
        "id, track_name, artist, goal_plays, total_delivered, started_at, closed_at, deadline, valor_cobrado, campaign_type, client_id",
      )
      .eq("id", campaignId)
      .maybeSingle(),
    supabase
      .from("campaign_eco_allocations")
      .select("managed_playlist_id, planned_streams, position, managed_playlists(name, followers, engagement_multiplier_override)")
      .eq("campaign_id", campaignId)
      .order("position", { nullsFirst: false }),
    supabase
      .from("campaign_eco_snapshots")
      .select("managed_playlist_id, plays_28d, captured_at")
      .eq("campaign_id", campaignId)
      .order("captured_at", { ascending: false }),
  ]);

  if (cRes.error || !cRes.data) throw new Error(cRes.error?.message ?? "campaign_not_found");

  // Branding do cliente (opcional)
  let branding: CampaignClosureBranding | undefined;
  const clientId = (cRes.data as any).client_id as string | null;
  if (clientId) {
    const { data: cli } = await supabase
      .from("clients")
      .select("name, logo_url, brand_color")
      .eq("id", clientId)
      .maybeSingle();
    if (cli) {
      branding = {
        logoUrl: (cli as any).logo_url ?? null,
        brandColor: (cli as any).brand_color ?? null,
        clientName: (cli as any).name ?? null,
      };
    }
  }

  const blob = await buildCampaignClosurePdf({
    campaign: cRes.data as any,
    ecoAllocs: (allocsRes.data as any[]) ?? [],
    ecoSnapshots: (snapsRes.data as any[]) ?? [],
    branding,
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
