import type { SupabaseClient } from "@supabase/supabase-js";
import { throwSupabaseError } from "@/lib/errors";
import {
  allocatedAmountCents,
  moneyToCents,
  type CommitmentPersonAllocation,
  type FinancialPerson,
} from "./commitments";
import {
  resolvePersonExpenseRecurrenceType,
  type PersonDashboardEntry,
  type PersonFinancialDashboardData,
} from "./person-financial-dashboard";

type LooseRow = Record<string, unknown>;

const one = <T>(value: T | T[] | null | undefined): T | null =>
  Array.isArray(value) ? value[0] ?? null : value ?? null;
const text = (value: unknown, fallback = "") =>
  typeof value === "string" ? value : fallback;
const nullableText = (value: unknown) =>
  typeof value === "string" && value ? value : null;
const normalized = (value: unknown) => text(value).normalize("NFD")
  .replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("pt-BR")
  .replace(/\s+/g, " ").trim();
const cents = (value: unknown) =>
  Math.abs(moneyToCents(value as number | string | null) ?? 0);
const relation = (row: LooseRow, key: string) =>
  one(row[key] as LooseRow | LooseRow[] | null);

const allocationCents = (
  amountCents: number,
  allocationType: string,
  allocationValue: unknown,
  personId: string,
) => allocatedAmountCents(amountCents, {
  personId,
  allocationType: allocationType as CommitmentPersonAllocation["allocationType"],
  allocationValue: Number(allocationValue ?? 100),
  isPrimary: false,
});

const transactionDirection = (row: LooseRow) => {
  const direction = text(row.bank_direction);
  if (direction === "inflow" || direction === "outflow") return direction;
  if (direction === "neutral") return "neutral";
  return text(row.transaction_type) === "income" ? "inflow" : "outflow";
};

const transactionEntry = (
  raw: LooseRow,
  personId: string,
  recurrenceByTransaction: Map<string, LooseRow>,
): PersonDashboardEntry | null => {
  const transaction = relation(raw, "financial_transactions");
  if (!transaction) return null;
  const id = text(transaction.id);
  const linkedOccurrence = recurrenceByTransaction.get(id);
  const category = relation(transaction, "financial_categories");
  const account = relation(transaction, "financial_accounts");
  const direction = transactionDirection(transaction);
  const nature = nullableText(transaction.financial_nature);
  const personFlowRole = nullableText(transaction.person_flow_role);
  const reimbursementRole = nullableText(transaction.reimbursement_role);
  const isPix = nature === "pix_sent" || nature === "pix_received";
  const isReimbursement = reimbursementRole === "reimbursement" ||
    personFlowRole === "reimbursement_received";
  const linkedCommitment = linkedOccurrence
    ? relation(linkedOccurrence, "financial_commitments")
    : null;
  const amountCents = allocationCents(
    cents(transaction.amount),
    text(raw.allocation_type, "full"),
    raw.allocation_value,
    personId,
  );
  const isClassifiedPixExpense = direction === "outflow" &&
    ["sent_to_person", "advance_to_person"].includes(personFlowRole ?? "") &&
    reimbursementRole !== "common_transfer";
  return {
    id,
    canonicalKey: `transaction:${id}`,
    sourceType: "bank_transaction",
    date: text(transaction.competence_date),
    description: text(transaction.description, "Movimentação bancária"),
    amountCents,
    categoryId: nullableText(transaction.category_id),
    categoryName: text(category?.name, isPix ? "Pix enviados" : "Outros"),
    accountId: nullableText(transaction.account_id),
    accountName: text(account?.name, "Conta bancária"),
    direction,
    status: text(transaction.status, "realized"),
    linkSource: text(raw.source, "manual"),
    financialNature: nature,
    financialRole: nullableText(transaction.financial_role),
    personFlowRole,
    reimbursementRole,
    incomeEffect: text(transaction.income_effect, "normal"),
    recurrenceType: resolvePersonExpenseRecurrenceType({
      linkedOccurrence: Boolean(linkedOccurrence),
      commitmentType: nullableText(linkedCommitment?.commitment_type),
      recurrenceFrequency: nullableText(linkedCommitment?.recurrence_frequency),
    }),
    commitmentId: nullableText(linkedOccurrence?.commitment_id),
    linkedTransactionId: id,
    linkedCardPurchaseId: null,
    isConfirmedExpense: isPix
      ? isClassifiedPixExpense
      : direction === "outflow",
    isPix,
    isReimbursement,
    isUnclassifiedPix: isPix && !isReimbursement &&
      (direction === "inflow" ||
        !["sent_to_person", "advance_to_person"].includes(
          personFlowRole ?? "",
        )),
  };
};

const commitmentOccurrenceEntry = (
  row: LooseRow,
  occurrence: LooseRow,
  personId: string,
): PersonDashboardEntry | null => {
  if (["cancelled", "skipped", "disputed"].includes(text(occurrence.status))) {
    return null;
  }
  const id = text(occurrence.id);
  const category = relation(row, "financial_categories");
  const account = relation(row, "financial_accounts");
  const card = relation(row, "credit_cards");
  const amountCents = allocationCents(
    cents(occurrence.actual_amount ?? occurrence.expected_amount),
    text(row.person_allocation_type, "full"),
    row.person_allocation_value,
    personId,
  );
  const paid = text(occurrence.status) === "paid";
  const linkedTransactionId = nullableText(occurrence.linked_transaction_id);
  const linkedCardPurchaseId = nullableText(occurrence.linked_card_movement_id);
  return {
    id,
    canonicalKey: linkedTransactionId
      ? `transaction:${linkedTransactionId}`
      : linkedCardPurchaseId
        ? `card:${linkedCardPurchaseId}`
        : `occurrence:${id}`,
    sourceType: "commitment",
    date: text(
      occurrence.payment_date ??
        occurrence.expected_due_date ??
        occurrence.competence_month,
    ),
    description: text(row.title, "Compromisso"),
    amountCents,
    categoryId: nullableText(row.category_id),
    categoryName: text(category?.name, "Sem categoria"),
    accountId: nullableText(row.account_id ?? row.card_id),
    accountName: text(
      account?.name ?? card?.name,
      row.payment_method === "payroll" ? "Folha de pagamento" : "Sem conta",
    ),
    direction: text(row.cash_flow_direction, "expense") === "income"
      ? "inflow"
      : "outflow",
    status: text(occurrence.status),
    linkSource: row.is_payroll_deduction ? "payroll" : "commitment",
    financialNature: row.is_payroll_deduction ? "payroll" : "bill_payment",
    financialRole: "expense",
    personFlowRole: null,
    reimbursementRole: null,
    incomeEffect: "normal",
    recurrenceType: resolvePersonExpenseRecurrenceType({
      linkedOccurrence: text(row.commitment_type) !== "one_time",
      commitmentType: nullableText(row.commitment_type),
      recurrenceFrequency: nullableText(row.recurrence_frequency),
    }),
    commitmentId: text(row.id),
    linkedTransactionId,
    linkedCardPurchaseId,
    isConfirmedExpense: paid,
    isPix: row.payment_method === "pix",
    isReimbursement: false,
    isUnclassifiedPix: false,
  };
};

export async function getPersonFinancialDashboard(
  supabase: SupabaseClient,
  input: {
    workspaceId: string;
    personId: string;
    referenceMonth: string;
  },
): Promise<PersonFinancialDashboardData> {
  const reference = input.referenceMonth.slice(0, 7);
  const yearStart = `${reference.slice(0, 4)}-01-01`;
  const historyDate = new Date(`${reference}-01T12:00:00Z`);
  historyDate.setUTCMonth(historyDate.getUTCMonth() - 11);
  const from = historyDate.toISOString().slice(0, 10) < yearStart
    ? historyDate.toISOString().slice(0, 10)
    : yearStart;
  const periodEnd = new Date(`${reference}-01T12:00:00Z`);
  periodEnd.setUTCMonth(periodEnd.getUTCMonth() + 1);
  periodEnd.setUTCDate(0);
  const to = periodEnd.toISOString().slice(0, 10);
  const futureEnd = new Date(`${to}T12:00:00Z`);
  futureEnd.setUTCDate(futureEnd.getUTCDate() + 90);

  const [
    personResult,
    transactionResult,
    commitmentLinkResult,
    allocationResult,
    reimbursementResult,
    counterpartyResult,
  ] = await Promise.all([
    supabase.from("financial_people").select(
      "id,workspace_id,name,relation_type,is_dependent,is_active,color_key,notes",
    ).eq("workspace_id", input.workspaceId).eq("id", input.personId)
      .neq("relation_type", "self")
      .is("archived_at", null).single(),
    supabase.from("transaction_people").select(
      "allocation_type,allocation_value,source,manually_confirmed,financial_transactions:financial_transactions!transaction_people_transaction_id_fkey!inner(id,description,amount,transaction_type,transaction_role,bank_direction,financial_nature,financial_role,person_flow_role,reimbursement_role,income_effect,status,competence_date,account_id,category_id,financial_categories:financial_categories!financial_transactions_category_id_fkey(name),financial_accounts:financial_accounts!financial_transactions_account_id_fkey(name))",
    ).eq("workspace_id", input.workspaceId).eq("person_id", input.personId)
      .gte("financial_transactions.competence_date", from)
      .lte("financial_transactions.competence_date", to),
    supabase.from("commitment_people").select(
      "allocation_type,allocation_value,financial_commitments!inner(id,title,commitment_type,recurrence_frequency,expected_amount,category_id,account_id,card_id,payment_method,is_payroll_deduction,cash_flow_direction,status,financial_categories(name),financial_accounts(name),credit_cards(name),financial_commitment_occurrences(id,commitment_id,competence_month,expected_due_date,expected_amount,actual_amount,status,payment_date,linked_transaction_id,linked_card_movement_id))",
    ).eq("workspace_id", input.workspaceId).eq("person_id", input.personId),
    supabase.from("expense_allocations").select(
      "id,allocation_role,allocated_amount,reimbursable_amount,reimbursed_amount,pending_reimbursement_amount,status,source_type,notes,source_transaction_id,source_card_movement_id,source_commitment_occurrence_id,financial_transactions:financial_transactions!expense_allocations_source_transaction_id_fkey(id,description,amount,competence_date,bank_direction,financial_nature,financial_role,person_flow_role,reimbursement_role,income_effect,status,account_id,category_id,financial_categories:financial_categories!financial_transactions_category_id_fkey(name),financial_accounts:financial_accounts!financial_transactions_account_id_fkey(name)),card_purchases:card_purchases!expense_allocations_source_card_movement_id_fkey(id,description,total_amount,installment_amount,amount_brl,purchase_date,competence_date,status,transaction_role,card_id,category_id,financial_categories:financial_categories!card_purchases_category_id_fkey(name),credit_cards:credit_cards!card_purchases_card_id_fkey(name)),financial_commitment_occurrences:financial_commitment_occurrences!expense_allocations_source_commitment_occurrence_id_fkey(id,commitment_id,competence_month,expected_due_date,payment_date,expected_amount,actual_amount,status,linked_transaction_id,linked_card_movement_id)",
    ).eq("workspace_id", input.workspaceId).eq("person_id", input.personId)
      .is("archived_at", null),
    supabase.from("financial_reimbursements").select(
      "id,amount,received_date,status,manually_confirmed,reimbursement_allocations(allocated_amount)",
    ).eq("workspace_id", input.workspaceId).eq("person_id", input.personId)
      .gte("received_date", from).lte("received_date", to)
      .is("archived_at", null),
    supabase.from("person_counterparties").select(
      "id,display_name,bank_name,masked_pix_key,masked_tax_number,account_masked,direction_scope,valid_from,is_active,updated_at",
    ).eq("workspace_id", input.workspaceId).eq("person_id", input.personId)
      .is("archived_at", null).order("match_priority"),
  ]);
  if (personResult.error || !personResult.data) {
    throwSupabaseError(
      personResult.error ?? { message: "person not found" },
      "getPersonFinancialDashboard",
      "Não foi possível carregar a análise financeira da pessoa.",
    );
  }
  const unavailableSources = [
    ["movimentações", transactionResult],
    ["compromissos", commitmentLinkResult],
    ["despesas compartilhadas", allocationResult],
    ["reembolsos", reimbursementResult],
    ["vínculos Pix", counterpartyResult],
  ].filter(([, result]) =>
    (result as { error: unknown }).error
  ).map(([label]) => String(label));

  const personRow = personResult.data;
  const person: FinancialPerson = {
    id: String(personRow.id),
    workspaceId: String(personRow.workspace_id),
    name: String(personRow.name),
    relationType: String(personRow.relation_type),
    isDependent: Boolean(personRow.is_dependent),
    isActive: Boolean(personRow.is_active),
    colorKey: personRow.color_key,
    notes: personRow.notes,
  };
  const commitmentRows: LooseRow[] = [];
  const commitmentById = new Map<string, LooseRow>();
  const occurrenceByTransaction = new Map<string, LooseRow>();
  const occurrenceByCard = new Map<string, LooseRow>();
  for (const raw of commitmentLinkResult.data ?? []) {
    const link = raw as unknown as LooseRow;
    const commitment = relation(link, "financial_commitments");
    if (!commitment) continue;
    const prepared: LooseRow = {
      ...commitment,
      person_allocation_type: link.allocation_type,
      person_allocation_value: link.allocation_value,
    };
    commitmentRows.push(prepared);
    commitmentById.set(text(prepared.id), prepared);
    for (
      const occurrence of (commitment.financial_commitment_occurrences ??
        []) as LooseRow[]
    ) {
      const transactionId = nullableText(occurrence.linked_transaction_id);
      const cardId = nullableText(occurrence.linked_card_movement_id);
      if (transactionId) {
        occurrenceByTransaction.set(transactionId, {
          ...occurrence,
          financial_commitments: prepared,
        });
      }
      if (cardId) occurrenceByCard.set(cardId, occurrence);
    }
  }

  const entries: PersonDashboardEntry[] = [];
  for (const raw of transactionResult.data ?? []) {
    const entry = transactionEntry(
      raw as unknown as LooseRow,
      input.personId,
      occurrenceByTransaction,
    );
    if (entry?.date) entries.push(entry);
  }
  for (const commitment of commitmentRows) {
    for (
      const occurrence of (commitment.financial_commitment_occurrences ??
        []) as LooseRow[]
    ) {
      const entry = commitmentOccurrenceEntry(
        commitment,
        occurrence,
        input.personId,
      );
      if (entry?.date && entry.date >= from && entry.date <= to) {
        entries.push(entry);
      }
    }
  }

  const allocations = [];
  for (const raw of allocationResult.data ?? []) {
    const row = raw as unknown as LooseRow;
    const transaction = relation(row, "financial_transactions");
    const card = relation(row, "card_purchases");
    const occurrence = relation(row, "financial_commitment_occurrences");
    const commitment = occurrence
      ? commitmentById.get(text(occurrence.commitment_id)) ?? null
      : null;
    const date = text(
      transaction?.competence_date ??
        card?.competence_date ??
        card?.purchase_date ??
        occurrence?.payment_date ??
        occurrence?.expected_due_date ??
        occurrence?.competence_month,
    ) || null;
    allocations.push({
      id: text(row.id),
      date,
      role: text(row.allocation_role),
      allocatedAmountCents: cents(row.allocated_amount),
      reimbursableAmountCents: cents(row.reimbursable_amount),
      reimbursedAmountCents: cents(row.reimbursed_amount),
      pendingAmountCents: cents(row.pending_reimbursement_amount),
      status: text(row.status),
    });
    if (text(row.allocation_role) !== "beneficiary") continue;
    if (transaction) {
      const transactionId = text(transaction.id);
      if (entries.some(entry =>
        entry.linkedTransactionId === transactionId
      )) continue;
      const synthetic = transactionEntry({
        allocation_type: "fixed_amount",
        allocation_value: Number(row.allocated_amount),
        source: "expense_allocation",
        financial_transactions: transaction,
      }, input.personId, occurrenceByTransaction);
      if (synthetic) {
        synthetic.amountCents = cents(row.allocated_amount);
        entries.push(synthetic);
      }
      continue;
    }
    if (card) {
      const cardId = text(card.id);
      const category = relation(card, "financial_categories");
      const cardAccount = relation(card, "credit_cards");
      const linkedOccurrence = occurrenceByCard.get(cardId);
      entries.push({
        id: cardId,
        canonicalKey: `card:${cardId}`,
        sourceType: "card_purchase",
        date: date ?? text(card.purchase_date),
        description: text(card.description, "Compra no cartão"),
        amountCents: cents(row.allocated_amount),
        categoryId: nullableText(card.category_id),
        categoryName: text(category?.name, "Outros"),
        accountId: nullableText(card.card_id),
        accountName: text(cardAccount?.name, "Cartão de crédito"),
        direction: "outflow",
        status: text(card.status, "realized"),
        linkSource: "expense_allocation",
        financialNature: "purchase",
        financialRole: "expense",
        personFlowRole: null,
        reimbursementRole: null,
        incomeEffect: "normal",
        recurrenceType: resolvePersonExpenseRecurrenceType({
          linkedOccurrence: Boolean(linkedOccurrence),
        }),
        commitmentId: linkedOccurrence
          ? nullableText(linkedOccurrence.commitment_id)
          : null,
        linkedTransactionId: null,
        linkedCardPurchaseId: cardId,
        isConfirmedExpense: true,
        isPix: false,
        isReimbursement: false,
        isUnclassifiedPix: false,
      });
      continue;
    }
    if (occurrence && commitment) {
      const prepared: LooseRow = {
        ...commitment,
        person_allocation_type: "fixed_amount",
        person_allocation_value: Number(row.allocated_amount),
      };
      const entry = commitmentOccurrenceEntry(
        prepared,
        occurrence,
        input.personId,
      );
      if (entry) {
        entry.amountCents = cents(row.allocated_amount);
        entries.push(entry);
      }
      continue;
    }
    entries.push({
      id: text(row.id),
      canonicalKey: `manual-allocation:${text(row.id)}`,
      sourceType: "manual_expense",
      date: date ?? to,
      description: text(row.notes, "Despesa manual"),
      amountCents: cents(row.allocated_amount),
      categoryId: null,
      categoryName: "Outros",
      accountId: null,
      accountName: "Lançamento manual",
      direction: "outflow",
      status: text(row.status, "active"),
      linkSource: "expense_allocation",
      financialNature: "other",
      financialRole: "expense",
      personFlowRole: null,
      reimbursementRole: null,
      incomeEffect: "normal",
      recurrenceType: "extraordinary",
      commitmentId: null,
      linkedTransactionId: null,
      linkedCardPurchaseId: null,
      isConfirmedExpense: true,
      isPix: false,
      isReimbursement: false,
      isUnclassifiedPix: false,
    });
  }

  const upcomingCommitments = commitmentRows.flatMap(commitment =>
    ((commitment.financial_commitment_occurrences ?? []) as LooseRow[])
      .filter(occurrence => {
        const dueDate = text(
          occurrence.expected_due_date ?? occurrence.competence_month,
        );
        return dueDate > to &&
          dueDate <= futureEnd.toISOString().slice(0, 10) &&
          !["paid", "cancelled", "skipped", "disputed"].includes(
            text(occurrence.status),
          );
      })
      .map(occurrence => {
        const category = relation(commitment, "financial_categories");
        return {
          id: text(occurrence.id),
          title: text(commitment.title, "Compromisso"),
          categoryName: text(category?.name, "Sem categoria"),
          dueDate: text(
            occurrence.expected_due_date ?? occurrence.competence_month,
          ),
          amountCents: cents(
            occurrence.expected_amount ?? commitment.expected_amount,
          ),
          recurrenceType: resolvePersonExpenseRecurrenceType({
            commitmentType: nullableText(commitment.commitment_type),
            recurrenceFrequency: nullableText(
              commitment.recurrence_frequency,
            ),
          }),
          paymentMethod: nullableText(commitment.payment_method),
          status: text(occurrence.status),
        };
      })
  ).sort((left, right) => left.dueDate.localeCompare(right.dueDate));

  const reimbursements = (reimbursementResult.data ?? []).map(raw => {
    const row = raw as unknown as LooseRow;
    const reimbursementAllocations =
      (row.reimbursement_allocations ?? []) as LooseRow[];
    return {
      id: text(row.id),
      date: text(row.received_date),
      amountCents: cents(row.amount),
      status: text(row.status),
      isConfirmed: Boolean(row.manually_confirmed) &&
        !["cancelled", "disputed"].includes(text(row.status)),
      allocatedAmountCents: reimbursementAllocations.reduce(
        (sum, allocation) => sum + cents(allocation.allocated_amount),
        0,
      ),
    };
  });
  const unclassifiedPix = entries.filter(entry => entry.isUnclassifiedPix);
  const warnings: string[] = [];
  if (unavailableSources.length) {
    warnings.push(
      `Dados parciais: ${unavailableSources.join(", ")} indisponível(is) nesta atualização.`,
    );
  }
  if (unclassifiedPix.length) {
    const total = unclassifiedPix.reduce(
      (sum, entry) => sum + entry.amountCents,
      0,
    );
    warnings.push(
      `Há ${(total / 100).toLocaleString("pt-BR", {
        style: "currency",
        currency: "BRL",
      })} em Pix ainda sem classificação financeira.`,
    );
  }
  if (commitmentRows.some(row => !row.category_id)) {
    warnings.push("Há compromisso vinculado sem categoria.");
  }
  if (reimbursements.some(item => item.allocatedAmountCents === 0)) {
    warnings.push("Há reembolso sem despesa compartilhada vinculada.");
  }
  return {
    person,
    entries,
    reimbursements,
    allocations,
    upcomingCommitments,
    counterpartyLinks: (counterpartyResult.data ?? []).map(raw => {
      const counterpartyName = normalized(raw.display_name);
      return {
        id: String(raw.id),
        displayName: raw.display_name || "Contraparte Pix",
        bankName: raw.bank_name,
        maskedIdentifier:
          raw.masked_pix_key ||
          raw.masked_tax_number ||
          raw.account_masked ||
          "Identificador protegido",
        directionScope: raw.direction_scope,
        validFrom: raw.valid_from,
        isActive: raw.is_active,
        movementCount: counterpartyName
          ? entries.filter(entry =>
              normalized(entry.description).includes(counterpartyName)
            ).length
          : 0,
        lastAppliedAt: raw.updated_at,
      };
    }),
    dataQualityWarnings: warnings,
    generatedAt: new Date().toISOString(),
  };
}
