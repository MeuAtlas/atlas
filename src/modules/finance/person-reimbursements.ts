export type BankDirection = "inflow" | "outflow" | "neutral" | "review";
export type PersonPixFlowRole =
  | "sent_to_person"
  | "received_from_person"
  | "reimbursement_received"
  | "advance_to_person";
export type ExpenseAllocationType =
  | "full"
  | "percentage"
  | "fixed_amount"
  | "remainder";

export type CounterpartyIdentity = {
  providerCounterpartyId?: string | null;
  taxNumberHash?: string | null;
  pixKeyHash?: string | null;
  bankCode?: string | null;
  accountMasked?: string | null;
  normalizedName?: string | null;
};

export type PersonCounterpartyRule = CounterpartyIdentity & {
  id: string;
  personId: string;
  directionScope: "both" | "incoming_only" | "outgoing_only";
  isActive: boolean;
  manuallyConfirmed: boolean;
  matchPriority?: number;
};

export type CounterpartyMatch = {
  personId: string;
  counterpartyId: string;
  confidence: number;
  matchSource:
    | "provider_counterparty_id"
    | "tax_number_hash"
    | "pix_key_hash"
    | "bank_account"
    | "composite"
    | "normalized_name";
  direction: "incoming" | "outgoing";
  autoApplicable: boolean;
};

export type AllocationRule = {
  personId: string;
  allocationType: ExpenseAllocationType;
  allocationValue: number;
  reimbursable: boolean;
};

export type CalculatedAllocation = AllocationRule & {
  allocatedAmountCents: number;
  reimbursableAmountCents: number;
};

export type ExpenseNetCostInput = {
  grossExpenseAmountCents: number;
  totalPaidInitiallyByUserCents?: number;
  userResponsibilityAmountCents: number;
  otherPeopleResponsibilityAmountCents: number;
  reimbursedAmountCents: number;
};

export type ExpenseNetCost = {
  grossExpenseAmountCents: number;
  userResponsibilityAmountCents: number;
  otherPeopleResponsibilityAmountCents: number;
  reimbursedAmountCents: number;
  pendingReimbursementAmountCents: number;
  netUserCostCents: number;
  totalPaidInitiallyByUserCents: number;
};

export type PendingReimbursementExpense = {
  id: string;
  personId: string;
  pendingAmountCents: number;
  dueDate?: string | null;
  description?: string | null;
  commitmentActive?: boolean;
  counterpartyConfirmed?: boolean;
};

export function normalizeCounterpartyName(value: string | null | undefined) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function directionAllowed(
  scope: PersonCounterpartyRule["directionScope"],
  direction: "incoming" | "outgoing",
) {
  return scope === "both" ||
    (scope === "incoming_only" && direction === "incoming") ||
    (scope === "outgoing_only" && direction === "outgoing");
}

export function matchPixCounterpartyToPerson(input: {
  counterparty: CounterpartyIdentity;
  rules: PersonCounterpartyRule[];
  direction: "incoming" | "outgoing";
}): CounterpartyMatch | null {
  const candidates = input.rules
    .filter(rule => rule.isActive && directionAllowed(rule.directionScope, input.direction))
    .map(rule => {
      const identity = input.counterparty;
      const exact = (
        field: keyof Pick<CounterpartyIdentity,
          "providerCounterpartyId" | "taxNumberHash" | "pixKeyHash">
      ) => Boolean(identity[field] && rule[field] && identity[field] === rule[field]);
      let confidence = 0;
      let source: CounterpartyMatch["matchSource"] | null = null;
      if (exact("providerCounterpartyId")) {
        confidence = 0.99; source = "provider_counterparty_id";
      } else if (exact("taxNumberHash")) {
        confidence = 0.98; source = "tax_number_hash";
      } else if (exact("pixKeyHash")) {
        confidence = 0.97; source = "pix_key_hash";
      } else if (
        identity.bankCode && identity.accountMasked &&
        identity.bankCode === rule.bankCode &&
        identity.accountMasked === rule.accountMasked
      ) {
        confidence = 0.94; source = "bank_account";
      } else {
        const matchingParts = [
          identity.bankCode && identity.bankCode === rule.bankCode,
          identity.accountMasked && identity.accountMasked === rule.accountMasked,
          identity.normalizedName &&
            normalizeCounterpartyName(identity.normalizedName) ===
              normalizeCounterpartyName(rule.normalizedName),
        ].filter(Boolean).length;
        if (matchingParts >= 2) {
          confidence = 0.9; source = "composite";
        } else if (
          identity.normalizedName && rule.normalizedName &&
          normalizeCounterpartyName(identity.normalizedName) ===
            normalizeCounterpartyName(rule.normalizedName)
        ) {
          confidence = rule.manuallyConfirmed ? 0.84 : 0.76;
          source = "normalized_name";
        }
      }
      return source ? {
        personId: rule.personId,
        counterpartyId: rule.id,
        confidence,
        matchSource: source,
        direction: input.direction,
        autoApplicable: confidence >= 0.95 ||
          (confidence >= 0.84 && source === "normalized_name" && rule.manuallyConfirmed),
        priority: rule.matchPriority ?? 100,
      } : null;
    })
    .filter((value): value is NonNullable<typeof value> => value !== null)
    .sort((left, right) =>
      right.confidence - left.confidence || left.priority - right.priority);
  if (!candidates.length || candidates[0].confidence < 0.75) return null;
  const best = candidates[0];
  return {
    personId: best.personId,
    counterpartyId: best.counterpartyId,
    confidence: best.confidence,
    matchSource: best.matchSource,
    direction: best.direction,
    autoApplicable: best.autoApplicable,
  };
}

export function resolvePersonPixRole(input: {
  bankDirection: BankDirection;
  asReimbursement?: boolean;
  asAdvance?: boolean;
}) {
  if (input.bankDirection === "inflow") {
    return {
      bankDirection: "inflow" as const,
      personFlowRole: input.asReimbursement
        ? "reimbursement_received" as const
        : "received_from_person" as const,
      transactionRole: input.asReimbursement ? "reimbursement" : "person_transfer",
      incomeEffect: input.asReimbursement ? "neutral" as const : "normal" as const,
      cashFlowEffect: "inflow" as const,
    };
  }
  if (input.bankDirection === "outflow") {
    return {
      bankDirection: "outflow" as const,
      personFlowRole: input.asAdvance
        ? "advance_to_person" as const
        : "sent_to_person" as const,
      transactionRole: input.asAdvance ? "advance_to_person" : "person_transfer",
      incomeEffect: "normal" as const,
      cashFlowEffect: "outflow" as const,
    };
  }
  return {
    bankDirection: input.bankDirection,
    personFlowRole: null,
    transactionRole: "unclassified",
    incomeEffect: "normal" as const,
    cashFlowEffect: "none" as const,
  };
}

export function calculateExpenseAllocations(
  totalCents: number,
  rules: AllocationRule[],
): CalculatedAllocation[] {
  if (!Number.isInteger(totalCents) || totalCents < 0) {
    throw new Error("O valor total da despesa é inválido.");
  }
  if (!rules.length) throw new Error("Informe ao menos uma responsabilidade.");
  if (new Set(rules.map(rule => rule.personId)).size !== rules.length) {
    throw new Error("Uma pessoa não pode aparecer duas vezes na divisão.");
  }
  if (rules.filter(rule => rule.allocationType === "remainder").length > 1) {
    throw new Error("Use no máximo uma divisão pelo restante.");
  }
  let allocated = 0;
  const calculated = rules.map(rule => {
    let amount = 0;
    if (rule.allocationType === "full") amount = totalCents;
    if (rule.allocationType === "percentage") {
      if (rule.allocationValue < 0 || rule.allocationValue > 100) {
        throw new Error("O percentual deve estar entre 0 e 100.");
      }
      amount = Math.round(totalCents * rule.allocationValue / 100);
    }
    if (rule.allocationType === "fixed_amount") {
      amount = Math.round(rule.allocationValue);
    }
    if (rule.allocationType !== "remainder") allocated += amount;
    return { ...rule, allocatedAmountCents: amount, reimbursableAmountCents: 0 };
  });
  const remainder = calculated.find(item => item.allocationType === "remainder");
  if (allocated > totalCents) throw new Error("A divisão supera o valor da despesa.");
  if (remainder) remainder.allocatedAmountCents = totalCents - allocated;
  else if (allocated !== totalCents) {
    throw new Error("A divisão precisa cobrir todo o valor da despesa.");
  }
  return calculated.map(item => ({
    ...item,
    reimbursableAmountCents: item.reimbursable ? item.allocatedAmountCents : 0,
  }));
}

export function calculatePersonExpenseNetCost(
  input: ExpenseNetCostInput,
): ExpenseNetCost {
  const reimbursed = Math.max(0, input.reimbursedAmountCents);
  const otherResponsibility = Math.max(0, input.otherPeopleResponsibilityAmountCents);
  const initiallyPaid = input.totalPaidInitiallyByUserCents ??
    input.grossExpenseAmountCents;
  return {
    grossExpenseAmountCents: input.grossExpenseAmountCents,
    userResponsibilityAmountCents: input.userResponsibilityAmountCents,
    otherPeopleResponsibilityAmountCents: otherResponsibility,
    reimbursedAmountCents: reimbursed,
    pendingReimbursementAmountCents: Math.max(otherResponsibility - reimbursed, 0),
    netUserCostCents: Math.max(initiallyPaid - reimbursed, 0),
    totalPaidInitiallyByUserCents: initiallyPaid,
  };
}

export function allocateReimbursementAmounts(
  reimbursementAmountCents: number,
  expenses: Array<{ id: string; pendingAmountCents: number }>,
) {
  let remainingCents = Math.max(0, reimbursementAmountCents);
  const allocations = expenses.map(expense => {
    const allocatedAmountCents = Math.min(
      Math.max(0, expense.pendingAmountCents),
      remainingCents,
    );
    remainingCents -= allocatedAmountCents;
    return { expenseAllocationId: expense.id, allocatedAmountCents };
  }).filter(allocation => allocation.allocatedAmountCents > 0);
  return { allocations, unallocatedAmountCents: remainingCents };
}

function dateDistanceDays(left?: string | null, right?: string | null) {
  if (!left || !right) return 30;
  return Math.abs(
    new Date(`${left}T12:00:00Z`).getTime() -
    new Date(`${right}T12:00:00Z`).getTime(),
  ) / 86_400_000;
}

export function suggestReimbursementMatches(input: {
  personId: string;
  amountCents: number;
  receivedDate: string;
  description?: string | null;
  expenses: PendingReimbursementExpense[];
}) {
  const normalizedDescription = normalizeCounterpartyName(input.description);
  return input.expenses
    .filter(expense =>
      expense.personId === input.personId && expense.pendingAmountCents > 0)
    .map(expense => {
      let confidence = 0.55;
      const reasons = ["mesma pessoa"];
      const difference = Math.abs(expense.pendingAmountCents - input.amountCents);
      if (difference === 0) {
        confidence += 0.25; reasons.push("valor exato");
      } else if (difference <= Math.max(100, expense.pendingAmountCents * 0.05)) {
        confidence += 0.12; reasons.push("valor próximo");
      }
      const days = dateDistanceDays(input.receivedDate, expense.dueDate);
      if (days <= 10) {
        confidence += 0.08; reasons.push("data próxima");
      }
      if (expense.commitmentActive) {
        confidence += 0.04; reasons.push("compromisso ativo");
      }
      if (
        normalizedDescription && expense.description &&
        normalizeCounterpartyName(expense.description).split(" ")
          .some(part => part.length >= 4 && normalizedDescription.includes(part))
      ) {
        confidence += 0.04; reasons.push("descrição compatível");
      }
      if (expense.counterpartyConfirmed) {
        confidence += 0.04; reasons.push("contraparte confirmada");
      }
      return {
        expenseAllocationId: expense.id,
        confidence: Math.min(confidence, 0.99),
        reasons,
        autoApplicable: false,
      };
    })
    .sort((left, right) => right.confidence - left.confidence);
}

export type SharedCommitmentProjection = {
  grossAmountCents: number;
  userResponsibilityCents: number;
  reimbursementExpectedCents: number;
  reimbursementReceivedCents: number;
  netProjectedCostCents: number;
};

export function buildSharedCommitmentProjection(input: {
  grossAmountCents: number;
  userResponsibilityCents: number;
  reimbursementReceivedCents?: number;
}): SharedCommitmentProjection {
  const reimbursementExpectedCents = Math.max(
    input.grossAmountCents - input.userResponsibilityCents,
    0,
  );
  return {
    grossAmountCents: input.grossAmountCents,
    userResponsibilityCents: input.userResponsibilityCents,
    reimbursementExpectedCents,
    reimbursementReceivedCents: input.reimbursementReceivedCents ?? 0,
    netProjectedCostCents: input.userResponsibilityCents,
  };
}
