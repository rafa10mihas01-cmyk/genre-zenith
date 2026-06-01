import { supabase } from "@/integrations/supabase/client";
import type { CampaignSnapshot } from "@/lib/campaignSnapshot";

const DEFAULT_COST_PER_STREAM = 0.04;

export interface CuratorCandidate {
  id: string;
  name: string;
  contact: string | null;
  /** Total já entregue historicamente (proxy de capacidade). */
  purchased_plays: number;
  /** Custo por stream histórico ou padrão. */
  cost_per_stream: number;
  archived_at: string | null;
  paused_at: string | null;
}

export interface SuggestedAllocation {
  curator_id: string;
  curator_name: string;
  assigned_streams: number;
  assigned_cost: number;
  cost_per_stream: number;
  /** Capacidade histórica do curador (usada no ranking). */
  capacity: number;
}

/**
 * Sugere distribuição dos streamsExt entre curadores ativos.
 *
 * Estratégia:
 *  - Filtra curadores sem archived_at e sem paused_at.
 *  - Capacidade = max(purchased_plays, default_plays) — proxy de entrega histórica.
 *  - Distribui proporcional à capacidade até cobrir o alvo.
 *  - Preço usa cost_per_stream do curador (default_amount/default_plays) ou R$ 0,040.
 */
export function suggestExternalAllocations(
  targetStreams: number,
  curators: CuratorCandidate[],
): SuggestedAllocation[] {
  if (targetStreams <= 0 || curators.length === 0) return [];

  const ranked = curators
    .filter(c => !c.archived_at && !c.paused_at)
    .map(c => ({
      ...c,
      capacity: Math.max(c.purchased_plays, 1),
    }))
    .sort((a, b) => b.capacity - a.capacity);

  const totalCapacity = ranked.reduce((s, c) => s + c.capacity, 0);
  if (totalCapacity <= 0) return [];

  let allocated = 0;
  const items: SuggestedAllocation[] = ranked.map((c, i) => {
    const share = c.capacity / totalCapacity;
    let assigned = i === ranked.length - 1
      ? Math.max(0, targetStreams - allocated) // último absorve o resto
      : Math.round(share * targetStreams);
    allocated += assigned;
    const cps = c.cost_per_stream > 0 ? c.cost_per_stream : DEFAULT_COST_PER_STREAM;
    return {
      curator_id: c.id,
      curator_name: c.name,
      assigned_streams: assigned,
      assigned_cost: +(assigned * cps).toFixed(2),
      cost_per_stream: cps,
      capacity: c.capacity,
    };
  });

  return items.filter(it => it.assigned_streams > 0);
}

export async function fetchCuratorCandidates(): Promise<CuratorCandidate[]> {
  const { data, error } = await supabase
    .from("curators")
    .select("id, name, contact, purchased_plays, default_plays, default_amount, archived_at, paused_at")
    .is("archived_at", null)
    .is("paused_at", null);
  if (error) throw error;
  return (data ?? []).map((c: any) => {
    const defAmount = Number(c.default_amount ?? 0);
    const defPlays = Number(c.default_plays ?? 0);
    const cps = defPlays > 0 ? defAmount / defPlays : DEFAULT_COST_PER_STREAM;
    return {
      id: c.id,
      name: c.name,
      contact: c.contact,
      purchased_plays: Number(c.purchased_plays ?? 0),
      cost_per_stream: cps,
      archived_at: c.archived_at,
      paused_at: c.paused_at,
    };
  });
}

/**
 * Cria (ou retorna) o draft do pacote externo da campanha + itens sugeridos.
 * Idempotente: se já existe draft, retorna sem sobrescrever.
 */
export async function ensureExternalPackageDraft(
  campaignId: string,
  snapshot: CampaignSnapshot,
): Promise<{ packageId: string; created: boolean }> {
  // 1) Tenta reutilizar pacote existente (draft OU dispatched).
  // Se já confirmou, queremos mostrar o confirmado, não criar um draft novo do zero.
  const { data: existingList } = await supabase
    .from("campaign_external_packages")
    .select("id, status, confirmed_at, created_at")
    .eq("campaign_id", campaignId)
    .in("status", ["draft", "dispatched"])
    .order("confirmed_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(1);
  const existing = existingList?.[0];
  if (existing?.id) return { packageId: existing.id, created: false };

  // 2) Tenta criar — se constraint disparar, busca de novo (race / RLS de leitura)
  const { data: pkg, error } = await supabase
    .from("campaign_external_packages")
    .insert({
      campaign_id: campaignId,
      target_streams: snapshot.streamsExt,
      target_cost: snapshot.custoExt,
      status: "draft",
    })
    .select("id")
    .maybeSingle();

  if (error) {
    // 23505 = unique_violation. Draft já existe — busca direto.
    if ((error as any).code === "23505" || /uniq_cep_campaign_draft|duplicate key/i.test(error.message)) {
      const { data: again, error: againErr } = await supabase
        .from("campaign_external_packages")
        .select("id")
        .eq("campaign_id", campaignId)
        .eq("status", "draft")
        .maybeSingle();
      if (againErr) throw againErr;
      if (again?.id) return { packageId: again.id, created: false };
    }
    throw error;
  }
  if (!pkg) throw new Error("Falha ao criar pacote externo");

  // Não auto-popular itens — o usuário escolhe manualmente quais curadores entram no pacote.
  return { packageId: pkg.id, created: true };
}

export async function addPackageItem(args: {
  packageId: string;
  curatorId: string;
  assignedStreams?: number;
  costPerStream?: number;
}) {
  const cps = args.costPerStream && args.costPerStream > 0 ? args.costPerStream : DEFAULT_COST_PER_STREAM;
  const streams = Math.max(0, args.assignedStreams ?? 0);
  const { error } = await supabase
    .from("campaign_external_package_items")
    .insert({
      package_id: args.packageId,
      curator_id: args.curatorId,
      assigned_streams: streams,
      cost_per_stream: cps,
      assigned_cost: +(streams * cps).toFixed(2),
    });
  if (error) throw error;
}

/**
 * Confirma o pacote: gera curator_deals para cada item e marca como dispatched.
 */
export async function confirmExternalPackage(args: {
  packageId: string;
  campaignId: string;
  snapshot: CampaignSnapshot;
}): Promise<{ dealsCreated: number }> {
  const { packageId, campaignId, snapshot } = args;

  const { data: items, error: itemsErr } = await supabase
    .from("campaign_external_package_items")
    .select("id, curator_id, assigned_streams, assigned_cost, cost_per_stream, curator_deal_id, curators(name)")
    .eq("package_id", packageId);
  if (itemsErr) throw itemsErr;

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Sessão expirada");

  const endsAt = new Date();
  endsAt.setDate(endsAt.getDate() + snapshot.days);

  let created = 0;
  for (const it of items ?? []) {
    if (it.curator_deal_id) continue;
    if (!it.assigned_streams || it.assigned_streams <= 0) continue;

    const { data: deal, error: dealErr } = await supabase
      .from("curator_deals")
      .insert({
        user_id: user.id,
        curator_id: it.curator_id,
        curator_name: (it as any).curators?.name ?? "Curador",
        campaign_id: campaignId,
        origin: "external_package",
        song_spotify_url: snapshot.music.trackUrl ?? "",
        song_name: snapshot.music.title ?? "Sem título",
        song_artist: snapshot.music.artist,
        song_cover_url: snapshot.music.coverUrl,
        target_plays: it.assigned_streams,
        cost: it.assigned_cost,
        daily_goal: Math.ceil(it.assigned_streams / snapshot.days),
        ends_at: endsAt.toISOString(),
        ramp_up_days: 5,
      })
      .select("id")
      .single();

    if (dealErr || !deal) throw dealErr ?? new Error("Falha ao criar deal");

    await supabase
      .from("campaign_external_package_items")
      .update({ curator_deal_id: deal.id })
      .eq("id", it.id);

    created++;
  }

  await supabase
    .from("campaign_external_packages")
    .update({ status: "dispatched", confirmed_at: new Date().toISOString() })
    .eq("id", packageId);

  return { dealsCreated: created };
}

export async function updatePackageItem(
  itemId: string,
  patch: { assigned_streams: number; cost_per_stream: number },
) {
  const { error } = await supabase
    .from("campaign_external_package_items")
    .update({
      assigned_streams: patch.assigned_streams,
      cost_per_stream: patch.cost_per_stream,
      assigned_cost: +(patch.assigned_streams * patch.cost_per_stream).toFixed(2),
    })
    .eq("id", itemId);
  if (error) throw error;
}

export async function removePackageItem(itemId: string) {
  const { error } = await supabase.from("campaign_external_package_items").delete().eq("id", itemId);
  if (error) throw error;
}

/**
 * Reabre um pacote já confirmado: apaga os curator_deals que ainda estão em
 * status 'proposto' (segurança — não toca em deals já aceitos/em execução),
 * limpa curator_deal_id dos items e devolve o pacote para 'draft'.
 */
export async function reopenExternalPackage(packageId: string): Promise<{ dealsRemoved: number }> {
  const { data: items, error: itemsErr } = await supabase
    .from("campaign_external_package_items")
    .select("id, curator_deal_id")
    .eq("package_id", packageId);
  if (itemsErr) throw itemsErr;

  const dealIds = (items ?? []).map(i => i.curator_deal_id).filter(Boolean) as string[];
  let removed = 0;
  if (dealIds.length > 0) {
    const { data: deleted, error: delErr } = await supabase
      .from("curator_deals")
      .delete()
      .in("id", dealIds)
      .eq("state", "proposto")
      .select("id");
    if (delErr) throw delErr;
    removed = deleted?.length ?? 0;
  }

  await supabase
    .from("campaign_external_package_items")
    .update({ curator_deal_id: null })
    .eq("package_id", packageId);

  const { error: pkgErr } = await supabase
    .from("campaign_external_packages")
    .update({ status: "draft", confirmed_at: null })
    .eq("id", packageId);
  if (pkgErr) throw pkgErr;

  return { dealsRemoved: removed };
}

