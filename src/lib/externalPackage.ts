import { supabase } from "@/integrations/supabase/client";
import type { CampaignSnapshot } from "@/lib/campaignSnapshot";

const DEFAULT_COST_PER_STREAM = 0.04;

/**
 * Próxima compra disponível do curador (FIFO).
 * `deal_id IS NULL` = ainda não foi consumida por nenhum deal.
 */
export interface NextPurchase {
  id: string;
  plays: number;
  amount: number;
  cpp: number;
  note: string | null;
}

export interface CuratorCandidate {
  id: string;
  name: string;
  contact: string | null;
  /** Total já entregue historicamente (proxy de capacidade). */
  purchased_plays: number;
  /** Custo por stream — vem da próxima compra disponível ou média histórica. */
  cost_per_stream: number;
  /** Próxima compra FIFO não-consumida (se houver). */
  next_purchase: NextPurchase | null;
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
      ? Math.max(0, targetStreams - allocated)
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
  // 1) Curadores ativos
  const { data: curatorsData, error } = await supabase
    .from("curators")
    .select("id, name, contact, purchased_plays, total_cost, default_plays, default_amount, archived_at, paused_at")
    .is("archived_at", null)
    .is("paused_at", null);
  if (error) throw error;

  const ids = (curatorsData ?? []).map((c: any) => c.id);
  if (ids.length === 0) return [];

  // 2) Próxima compra não-consumida (deal_id IS NULL) por curador, FIFO (mais antiga)
  const { data: purchasesData } = await supabase
    .from("curator_purchases")
    .select("id, curator_id, plays_purchased, amount, cpp, note, purchased_at")
    .in("curator_id", ids)
    .is("deal_id", null)
    .order("purchased_at", { ascending: true });

  // Pega só a primeira de cada curador (FIFO)
  const nextByCurator = new Map<string, NextPurchase>();
  for (const p of (purchasesData ?? []) as any[]) {
    if (nextByCurator.has(p.curator_id)) continue;
    nextByCurator.set(p.curator_id, {
      id: p.id,
      plays: Number(p.plays_purchased ?? 0),
      amount: Number(p.amount ?? 0),
      cpp: Number(p.cpp ?? 0),
      note: p.note,
    });
  }

  return (curatorsData ?? []).map((c: any) => {
    const next = nextByCurator.get(c.id) ?? null;
    // Prioridade da taxa: próxima compra > média histórica > preço-tabela > default
    const totalCost = Number(c.total_cost ?? 0);
    const totalPlays = Number(c.purchased_plays ?? 0);
    const defAmount = Number(c.default_amount ?? 0);
    const defPlays = Number(c.default_plays ?? 0);
    const cps = next && next.cpp > 0
      ? next.cpp
      : totalPlays > 0 && totalCost > 0
        ? totalCost / totalPlays
        : defPlays > 0
          ? defAmount / defPlays
          : DEFAULT_COST_PER_STREAM;
    return {
      id: c.id,
      name: c.name,
      contact: c.contact,
      purchased_plays: totalPlays,
      cost_per_stream: cps,
      next_purchase: next,
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

  return { packageId: pkg.id, created: true };
}

export async function addPackageItem(args: {
  packageId: string;
  curatorId: string;
  assignedStreams?: number;
  costPerStream?: number;
  /** Compra origem (curator_purchases.id) que será consumida por este item. */
  purchaseId?: string;
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
      source_purchase_id: args.purchaseId ?? null,
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
    .select("id, curator_id, assigned_streams, assigned_cost, cost_per_stream, curator_deal_id, source_purchase_id, curators(name)")
    .eq("package_id", packageId);
  if (itemsErr) throw itemsErr;

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Sessão expirada");

  const endsAt = new Date();
  endsAt.setDate(endsAt.getDate() + snapshot.days);

  let created = 0;
  for (const it of items ?? []) {
    if (!it.assigned_streams || it.assigned_streams <= 0) continue;

    // 1) Se o item já tem deal linkado, pula (idempotente).
    if (it.curator_deal_id) continue;

    // 2) Checa se já existe deal para esse item (proteção contra race —
    // outra requisição pode ter criado o deal entre o fetch e o insert).
    const { data: existingDeal } = await supabase
      .from("curator_deals")
      .select("id")
      .eq("external_package_item_id", it.id)
      .maybeSingle();

    let dealId = existingDeal?.id as string | undefined;

    if (!dealId) {
      // 3) Insere. UNIQUE em external_package_item_id garante atomicidade:
      // se 2 cliques concorrentes chegarem aqui, o segundo recebe 23505 e
      // a gente recupera o deal já criado.
      const { data: deal, error: dealErr } = await supabase
        .from("curator_deals")
        .insert({
          user_id: user.id,
          curator_id: it.curator_id,
          curator_name: (it as any).curators?.name ?? "Curador",
          campaign_id: campaignId,
          origin: "external_package",
          external_package_item_id: it.id,
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
        .maybeSingle();

      if (dealErr) {
        const isDup = (dealErr as any).code === "23505";
        if (!isDup) throw dealErr;
        // Race perdida: busca o deal que o vencedor criou.
        const { data: winner } = await supabase
          .from("curator_deals")
          .select("id")
          .eq("external_package_item_id", it.id)
          .maybeSingle();
        if (!winner?.id) throw new Error("Falha ao recuperar deal após conflito");
        dealId = winner.id;
      } else {
        if (!deal?.id) throw new Error("Falha ao criar deal");
        dealId = deal.id;
        created++;
      }
    }

    await supabase
      .from("campaign_external_package_items")
      .update({ curator_deal_id: dealId })
      .eq("id", it.id);

    // Mantém a música principal do deal na mesma língua do pacote. O trigger
    // cria essa linha a partir do deal; se o deal já existia/foi recuperado,
    // este sync evita alvo antigo preso em curator_deal_songs.
    await supabase
      .from("curator_deal_songs")
      .update({
        target_plays: it.assigned_streams,
        daily_goal: Math.ceil(it.assigned_streams / snapshot.days),
      })
      .eq("deal_id", dealId);

    // Linka a compra de origem ao deal — marca como consumida.
    if ((it as any).source_purchase_id) {
      await supabase
        .from("curator_purchases")
        .update({ deal_id: dealId })
        .eq("id", (it as any).source_purchase_id);
    }
  }

  // Recalcula target_cost com o custo REAL contratado (soma dos itens),
  // eliminando divergência entre orçado (CPP médio do plano) e contratado
  // (CPP real de cada curador na curator_purchases).
  const realCost = (items ?? []).reduce(
    (s, it) => s + Number((it as any).assigned_cost ?? 0),
    0,
  );
  const realStreams = (items ?? []).reduce(
    (s, it) => s + Number((it as any).assigned_streams ?? 0),
    0,
  );

  await supabase
    .from("campaign_external_packages")
    .update({
      status: "dispatched",
      confirmed_at: new Date().toISOString(),
      target_cost: +realCost.toFixed(2),
      target_streams: realStreams,
    })
    .eq("id", packageId);

  return { dealsCreated: created };
}

export async function updatePackageItem(
  itemId: string,
  patch: { assigned_streams: number; cost_per_stream: number },
) {
  const assignedCost = +(patch.assigned_streams * patch.cost_per_stream).toFixed(2);
  const { error } = await supabase
    .from("campaign_external_package_items")
    .update({
      assigned_streams: patch.assigned_streams,
      cost_per_stream: patch.cost_per_stream,
      assigned_cost: assignedCost,
    })
    .eq("id", itemId);
  if (error) throw error;

  // Cascata: se o item já tem deal vinculado, atualiza o deal pra refletir
  // o novo target/custo (evita divergência item ↔ deal).
  const { data: linkedDeal } = await supabase
    .from("curator_deals")
    .select("id, ends_at, created_at")
    .eq("external_package_item_id", itemId)
    .maybeSingle();

  if (linkedDeal?.id) {
    const start = new Date(linkedDeal.created_at as string).getTime();
    const end = new Date(linkedDeal.ends_at as string).getTime();
    const days = Math.max(1, Math.ceil((end - start) / 86_400_000));
    const dailyGoal = Math.ceil(patch.assigned_streams / days);
    await supabase
      .from("curator_deals")
      .update({
        target_plays: patch.assigned_streams,
        cost: assignedCost,
        daily_goal: dailyGoal,
      })
      .eq("id", linkedDeal.id);
    await supabase
      .from("curator_deal_songs")
      .update({
        target_plays: patch.assigned_streams,
        daily_goal: dailyGoal,
      })
      .eq("deal_id", linkedDeal.id);
  }
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

