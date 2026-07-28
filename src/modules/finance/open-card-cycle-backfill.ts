import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildNextInstallmentOccurrence,
  buildPostedInstallmentOccurrence,
  matchInstallmentTransactionToOccurrence,
  normalizeInstallmentMerchant,
  projectInstallmentSeed,
  type InstallmentOccurrenceSeed,
  type PreviousInvoiceInstallment,
} from "./open-card-cycle";
import { persistedCardMovementAmountBrl } from "./foreign-card-movement";

type BackfillMode = "dry-run" | "apply";

export type OpenCycleInstallmentBackfillReport = {
  mode: BackfillMode;
  cycleId: string;
  competenceMonth: string;
  sourceDocumentId: string;
  activePreviousPlans: number;
  currentPostedPlans: number;
  expectedOccurrences: number;
  currentCycleOccurrences: number;
  existingPlans: number;
  existingOccurrences: number;
  plansCreated: number;
  occurrencesCreated: number;
  transactionsReconciled: number;
  installmentsWithoutMatch: number;
  currentPostedInstallmentsTotal: number;
  projectedCurrentInstallmentsTotal: number;
  futureOccurrences: number;
  confirmedOpenTotal: number;
  detailedTotalAfterBackfill: number;
  reconciliationDifference: number;
  cardLastFours: string[];
};

type ParsedInstallmentEntry = {
  id?: string;
  entryType?: string;
  isIgnored?: boolean;
  amountCents?: number;
  transactionDate?: string | null;
  descriptionRaw?: string;
  merchantNormalized?: string;
  cardLastFour?: string | null;
  currencyCode?: string;
  confidence?: number;
  installment?: {
    current?: number;
    total?: number;
    confidence?: number;
  } | null;
};

function money(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function shiftMonth(value: string, offset: number) {
  const [year, month] = value.slice(0, 7).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1 + offset, 1))
    .toISOString().slice(0, 10);
}

function isProgressedStatus(value: string | null | undefined) {
  return ["posted", "confirmed", "paid"].includes(value ?? "");
}

function assertQuery(
  result: { error: { message?: string } | null },
  context: string,
) {
  if (result.error) {
    throw new Error(`${context}: ${result.error.message ?? "query_failed"}`);
  }
}

function previousSeeds(input: {
  entries: ParsedInstallmentEntry[];
  cardId: string;
  competenceMonth: string;
  dueDay: number;
}) {
  return input.entries.flatMap((entry, index) => {
    if (
      entry.entryType !== "installment_purchase" ||
      entry.isIgnored ||
      !entry.installment
    ) return [];
    const current = Number(entry.installment.current);
    const total = Number(entry.installment.total);
    const amount = Math.abs(Number(entry.amountCents ?? 0)) / 100;
    const source: PreviousInvoiceInstallment = {
      sourceId: String(entry.id ?? `parsed-entry-${index}`),
      merchantNormalized: String(
        entry.merchantNormalized ?? entry.descriptionRaw ?? "",
      ),
      description: String(entry.descriptionRaw ?? "Parcela"),
      amount,
      currencyCode: String(entry.currencyCode ?? "BRL"),
      cardId: input.cardId,
      cardLastFour: entry.cardLastFour ?? null,
      originalDate: entry.transactionDate ?? null,
      currentInstallment: current,
      totalInstallments: total,
      confidence: Number(
        entry.installment.confidence ?? entry.confidence ?? 0.8,
      ),
    };
    const next = buildNextInstallmentOccurrence(
      source,
      input.competenceMonth,
      input.dueDay,
    );
    return next ? [next] : [];
  });
}

function postedSeeds(input: {
  purchases: Array<Record<string, unknown>>;
  cardId: string;
  competenceMonth: string;
  dueDay: number;
  instrumentLastFour: Map<string, string>;
}) {
  const candidates = input.purchases.flatMap((purchase, index) => {
    const current = Number(purchase.installment_number ?? 0);
    const total = Number(purchase.installment_count ?? 0);
    if (
      total <= 1 ||
      current < 1 ||
      current > total ||
      purchase.transaction_role === "invoice_payment" ||
      ["forecast", "cancelled"].includes(String(purchase.status ?? ""))
    ) return [];
    const source: PreviousInvoiceInstallment = {
      sourceId: String(purchase.external_id ?? purchase.id ?? `purchase-${index}`),
      merchantNormalized: String(
        purchase.merchant ?? purchase.description ?? "",
      ),
      description: String(purchase.description ?? "Compra parcelada"),
      amount: persistedCardMovementAmountBrl(purchase) ?? 0,
      currencyCode: "BRL",
      cardId: String(purchase.card_id ?? input.cardId),
      cardLastFour: input.instrumentLastFour.get(
        String(purchase.instrument_id ?? ""),
      ) ?? null,
      originalDate: String(purchase.purchase_date ?? "") || null,
      currentInstallment: current,
      totalInstallments: total,
      confidence: purchase.installment_confidence === "confirmed" ? 0.98 : 0.85,
    };
    const seed = buildPostedInstallmentOccurrence(
      source,
      input.competenceMonth,
      input.dueDay,
    );
    if (!seed) return [];
    const merchant = normalizeInstallmentMerchant(source.merchantNormalized);
    return [{
      ...seed,
      matchingFingerprint: [
        "atlas:pluggy-plan",
        source.cardId,
        source.cardLastFour ?? "",
        merchant,
        source.amount.toFixed(2),
        source.totalInstallments,
        source.originalDate ?? "",
      ].join(":"),
    }];
  });
  const unique = new Map<string, InstallmentOccurrenceSeed>();
  for (const candidate of candidates) {
    const current = unique.get(candidate.matchingFingerprint);
    if (
      !current ||
      candidate.installmentNumber < current.installmentNumber
    ) {
      unique.set(candidate.matchingFingerprint, candidate);
    }
  }
  return [...unique.values()];
}

export async function backfillOpenCardCycleInstallments(input: {
  supabase: SupabaseClient;
  userId: string;
  cycleId: string;
  confirmedOpenTotal: number;
  existingDetailedTotal: number;
  mode: BackfillMode;
}): Promise<OpenCycleInstallmentBackfillReport> {
  const cycleResult = await input.supabase.from("card_invoices")
    .select("id,card_id,reference_month,cycle_start_date,cycle_end_date,due_date,status")
    .eq("id", input.cycleId).eq("owner_id", input.userId).maybeSingle();
  assertQuery(cycleResult, "open_cycle");
  if (!cycleResult.data || cycleResult.data.status !== "open") {
    throw new Error("open_cycle_not_found");
  }
  const cycle = cycleResult.data;
  const competenceMonth = `${String(cycle.due_date).slice(0, 7)}-01`;
  const dueDay = Number(String(cycle.due_date).slice(8, 10)) || 10;
  const cardsResult = await input.supabase.from("credit_cards")
    .select("id,bank_connection_id,last_four_digits,status,user_archived_at,credit_card_instruments(id,last_four_digits,user_archived_at)")
    .eq("owner_id", input.userId);
  assertQuery(cardsResult, "cycle_cards");
  const cards = cardsResult.data ?? [];
  const primary = cards.find(card => card.id === cycle.card_id);
  const cycleCards = cards.filter(card =>
    card.id === cycle.card_id ||
    Boolean(
      primary?.bank_connection_id &&
      card.bank_connection_id === primary.bank_connection_id &&
      card.status === "active" &&
      !card.user_archived_at,
    ));
  const cardIds = cycleCards.map(card => String(card.id));
  const instrumentLastFour = new Map(
    cycleCards.flatMap(card =>
      (card.credit_card_instruments ?? [])
        .filter(instrument => !instrument.user_archived_at)
        .map(instrument => [
          String(instrument.id),
          String(instrument.last_four_digits ?? ""),
        ] as const)),
  );
  const documentResult = await input.supabase.from("invoice_documents")
    .select("id,workspace_id,card_id,parsed_payload,processing_status,review_status,created_at")
    .eq("user_id", input.userId).in("card_id", cardIds)
    .is("deleted_at", null)
    .order("created_at", { ascending: false }).limit(20);
  assertQuery(documentResult, "invoice_documents");
  const sourceDocument = (documentResult.data ?? []).find(document => {
    const parsed = document.parsed_payload as {
      parsed?: {
        nextCycleStartDate?: string;
        nextCycleEndDate?: string;
        dueDate?: string;
      };
    } | null;
    return parsed?.parsed?.nextCycleStartDate === cycle.cycle_start_date &&
      parsed?.parsed?.nextCycleEndDate === cycle.cycle_end_date;
  });
  if (!sourceDocument) throw new Error("previous_invoice_review_not_found");
  const parsedPayload = sourceDocument.parsed_payload as {
    parsed?: { entries?: ParsedInstallmentEntry[] };
  };
  const parsedEntries = parsedPayload.parsed?.entries ?? [];

  const purchasesResult = await input.supabase.from("card_purchases")
    .select("id,external_id,card_id,instrument_id,description,merchant,installment_amount,installment_number,installment_count,installment_confidence,purchase_date,transaction_role,status")
    .eq("owner_id", input.userId).in("card_id", cardIds)
    .gte("purchase_date", cycle.cycle_start_date)
    .lte("purchase_date", cycle.cycle_end_date)
    .limit(1000);
  assertQuery(purchasesResult, "current_card_purchases");

  const fromPrevious = previousSeeds({
    entries: parsedEntries,
    cardId: String(cycle.card_id),
    competenceMonth,
    dueDay,
  });
  const fromCurrent = postedSeeds({
    purchases: (purchasesResult.data ?? []) as Array<Record<string, unknown>>,
    cardId: String(cycle.card_id),
    competenceMonth,
    dueDay,
    instrumentLastFour,
  });
  const firstSeeds = [...fromPrevious, ...fromCurrent];
  const expected = firstSeeds.flatMap(seed =>
    projectInstallmentSeed(seed, dueDay));
  const existingPlansResult = await input.supabase
    .from("card_installment_plans")
    .select("id,matching_fingerprint")
    .eq("owner_id", input.userId).in("card_id", cardIds);
  assertQuery(existingPlansResult, "existing_installment_plans");
  const existingOccurrencesResult = await input.supabase
    .from("card_installment_occurrences")
    .select("id,installment_plan_id,installment_number,status,source")
    .eq("owner_id", input.userId).in("card_id", cardIds);
  assertQuery(existingOccurrencesResult, "existing_installment_occurrences");
  const existingPlans = new Map(
    (existingPlansResult.data ?? []).map(plan => [
      String(plan.matching_fingerprint),
      String(plan.id),
    ]),
  );
  const existingOccurrences = new Map(
    (existingOccurrencesResult.data ?? []).map(occurrence => [
      `${occurrence.installment_plan_id}:${occurrence.installment_number}`,
      occurrence,
    ]),
  );
  const matchedCurrent = new Set<string>();
  for (const projected of fromPrevious) {
    const transaction = fromCurrent.find(current =>
      ["exact_match", "high_confidence_match"].includes(
        matchInstallmentTransactionToOccurrence({
          id: current.sourceId,
          amount: current.amount,
          effect: "debit",
          merchantNormalized: current.merchantNormalized,
          installmentNumber: current.installmentNumber,
          installmentTotal: current.totalInstallments,
          cardLastFour: current.cardLastFour,
          competenceMonth: current.competenceMonth,
        }, projected).status,
      ));
    if (transaction) matchedCurrent.add(projected.matchingFingerprint);
  }
  const currentPostedTotal = money(
    fromCurrent.reduce((sum, seed) => sum + seed.amount, 0),
  );
  const currentProjectedTotal = money(
    fromPrevious
      .filter(seed => !matchedCurrent.has(seed.matchingFingerprint))
      .reduce((sum, seed) => sum + seed.amount, 0),
  );
  const detailedTotalAfterBackfill = money(
    input.existingDetailedTotal + currentProjectedTotal,
  );
  const report: OpenCycleInstallmentBackfillReport = {
    mode: input.mode,
    cycleId: input.cycleId,
    competenceMonth,
    sourceDocumentId: String(sourceDocument.id),
    activePreviousPlans: fromPrevious.length,
    currentPostedPlans: fromCurrent.length,
    expectedOccurrences: expected.length,
    currentCycleOccurrences: firstSeeds.length,
    existingPlans: existingPlans.size,
    existingOccurrences: existingOccurrences.size,
    plansCreated: firstSeeds.filter(seed =>
      !existingPlans.has(seed.matchingFingerprint)).length,
    occurrencesCreated: 0,
    transactionsReconciled: matchedCurrent.size,
    installmentsWithoutMatch: fromPrevious.length - matchedCurrent.size,
    currentPostedInstallmentsTotal: currentPostedTotal,
    projectedCurrentInstallmentsTotal: currentProjectedTotal,
    futureOccurrences: expected.filter(occurrence =>
      occurrence.competenceMonth !== competenceMonth).length,
    confirmedOpenTotal: money(input.confirmedOpenTotal),
    detailedTotalAfterBackfill,
    reconciliationDifference: money(
      input.confirmedOpenTotal - detailedTotalAfterBackfill,
    ),
    cardLastFours: [...new Set([
      ...cycleCards.map(card => String(card.last_four_digits ?? "")),
      ...instrumentLastFour.values(),
    ].filter(Boolean))],
  };
  if (input.mode === "dry-run") return report;

  let occurrencesCreated = 0;
  for (const first of firstSeeds) {
    const existingPlanId = existingPlans.get(first.matchingFingerprint);
    const planRow = {
      workspace_id: sourceDocument.workspace_id,
      owner_id: input.userId,
      card_id: first.cardId,
      card_last_four: first.cardLastFour,
      merchant_normalized: first.merchantNormalized,
      description_reference: first.description,
      installment_amount: first.amount,
      currency_code: first.currencyCode,
      total_installments: first.totalInstallments,
      first_known_installment: first.installmentNumber,
      latest_known_installment: first.status === "posted"
        ? first.installmentNumber
        : first.installmentNumber - 1,
      posted_installments: first.status === "posted"
        ? first.installmentNumber
        : first.installmentNumber - 1,
      remaining_installments: first.totalInstallments -
        (first.status === "posted"
          ? first.installmentNumber
          : first.installmentNumber - 1),
      estimated_first_competence: shiftMonth(
        first.competenceMonth,
        -(first.installmentNumber - 1),
      ),
      estimated_last_competence: shiftMonth(
        first.competenceMonth,
        first.totalInstallments - first.installmentNumber,
      ),
      status: first.status === "posted" &&
          first.installmentNumber === first.totalInstallments
        ? "completed"
        : "active",
      confidence: first.confidence,
      matching_fingerprint: first.matchingFingerprint,
      manually_reviewed: false,
    };
    const savedPlan = await input.supabase.from("card_installment_plans")
      .upsert(planRow, {
        onConflict: "workspace_id,card_id,matching_fingerprint",
      })
      .select("id").single();
    assertQuery(savedPlan, "save_installment_plan");
    const planId = String(savedPlan.data?.id ?? existingPlanId);
    if (!planId) throw new Error("installment_plan_id_missing");
    for (const occurrence of projectInstallmentSeed(first, dueDay)) {
      const existing = existingOccurrences.get(
        `${planId}:${occurrence.installmentNumber}`,
      );
      const currentMonth = occurrence.competenceMonth === competenceMonth;
      const reconciled = currentMonth &&
        matchedCurrent.has(first.matchingFingerprint);
      const desiredStatus = reconciled ? "posted" : occurrence.status;
      const savedOccurrence = await input.supabase
        .from("card_installment_occurrences")
        .upsert({
          workspace_id: sourceDocument.workspace_id,
          owner_id: input.userId,
          installment_plan_id: planId,
          card_id: occurrence.cardId,
          bill_id: currentMonth ? input.cycleId : null,
          invoice_entry_id: null,
          competence_month: occurrence.competenceMonth,
          installment_number: occurrence.installmentNumber,
          total_installments: occurrence.totalInstallments,
          amount: occurrence.amount,
          status: isProgressedStatus(existing?.status)
            ? existing?.status
            : desiredStatus,
          due_date: occurrence.dueDate,
          source: isProgressedStatus(existing?.status)
            ? existing?.source
            : desiredStatus === "posted" ? "pluggy" : "projection",
          confidence: occurrence.confidence,
        }, { onConflict: "installment_plan_id,installment_number" });
      assertQuery(savedOccurrence, "save_installment_occurrence");
      if (!existing) occurrencesCreated += 1;
    }
  }
  const cycleUpdate = await input.supabase.from("card_invoices")
    .update({
      confirmed_invoice_total: input.confirmedOpenTotal,
      manual_invoice_total: input.confirmedOpenTotal,
      current_display_total: input.confirmedOpenTotal,
      total_amount: input.confirmedOpenTotal,
      calculated_invoice_total: detailedTotalAfterBackfill,
      source: "manual",
      total_source: "manual_bank_confirmation",
      reconciliation_difference:
        input.confirmedOpenTotal - detailedTotalAfterBackfill,
      reconciliation_status:
        Math.abs(input.confirmedOpenTotal - detailedTotalAfterBackfill) <= 0.01
          ? "matched"
          : "divergent",
      data_completeness: "partial",
    })
    .eq("id", input.cycleId).eq("owner_id", input.userId);
  assertQuery(cycleUpdate, "save_confirmed_open_total");
  return {
    ...report,
    mode: "apply",
    occurrencesCreated,
  };
}
