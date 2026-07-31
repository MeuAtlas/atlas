import { z } from "zod";

export const simpleRecurrenceSchema = z.enum([
  "none",
  "monthly",
  "weekly",
  "biweekly",
  "annual",
  "custom",
]);

export type SimpleCommitmentRecurrence =
  z.infer<typeof simpleRecurrenceSchema>;
export type SimpleCommitmentContext =
  | "personal"
  | "household"
  | "work"
  | "travel";
export type BudgetPriority =
  | "essential"
  | "adjustable"
  | "optional"
  | "unknown";

export type ParsedCommitmentText = {
  direction: "income" | "expense";
  title: string | null;
  amountCents: number | null;
  estimationMode: "fixed" | "historical_median";
  expectedDateRule: "fixed_day" | "unspecified_in_month";
  recurrence: SimpleCommitmentRecurrence | null;
  dueDay: number | null;
  dueDate: string | null;
  personName: string | null;
  context: SimpleCommitmentContext | null;
  confidence: number;
  missingFields: Array<"title" | "amount" | "schedule" | "recurrence">;
};

export const simpleCommitmentSchema = z.object({
  title: z.string().trim().min(1, "Informe o nome do compromisso.").max(160),
  amount: z.string().trim().min(1, "Informe um valor válido."),
  scheduleDate: z.string().date("Informe quando o compromisso acontece."),
  recurrence: simpleRecurrenceSchema,
  relationTarget: z.string().trim().default("personal"),
  advanced: z.object({
    categoryId: z.string().uuid().nullable().default(null),
    paymentMethod: z.enum([
      "bank_debit",
      "credit_card",
      "payroll",
      "pix",
      "boleto",
      "cash",
      "transfer",
      "other",
    ]).nullable().default(null),
    accountId: z.string().uuid().nullable().default(null),
    cardId: z.string().uuid().nullable().default(null),
    variableAmount: z.boolean().default(false),
    minimumAmount: z.string().nullable().default(null),
    maximumAmount: z.string().nullable().default(null),
    endDate: z.string().date().nullable().default(null),
    budgetPriority: z.enum([
      "essential", "adjustable", "optional", "unknown",
    ]).default("unknown"),
    notes: z.string().trim().max(1000).nullable().default(null),
    autoMatchEnabled: z.boolean().default(false),
  }),
}).superRefine((value, context) => {
  if (parseBrazilianMoneyToCents(value.amount) === null) {
    context.addIssue({
      code: "custom",
      path: ["amount"],
      message: "Informe um valor válido.",
    });
  }
  if (value.relationTarget.startsWith("person:")) {
    const id = value.relationTarget.slice(7);
    if (!z.string().uuid().safeParse(id).success) {
      context.addIssue({
        code: "custom",
        path: ["relationTarget"],
        message: "Selecione uma pessoa válida.",
      });
    }
  } else if (![
    "personal", "household", "work", "travel",
  ].includes(value.relationTarget)) {
    context.addIssue({
      code: "custom",
      path: ["relationTarget"],
      message: "Selecione uma relação válida.",
    });
  }
});

export type SimpleCommitmentInput = z.infer<typeof simpleCommitmentSchema>;

export function parseBrazilianMoneyToCents(value: string) {
  const cleaned = value
    .replace(/\s/g, "")
    .replace(/^R\$/i, "")
    .replace(/[^\d,.-]/g, "");
  if (!cleaned) return null;
  const normalized = cleaned.includes(",")
    ? cleaned.replace(/\./g, "").replace(",", ".")
    : /^\d{1,3}(?:\.\d{3})+$/.test(cleaned)
      ? cleaned.replace(/\./g, "")
      : cleaned;
  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return Math.round(amount * 100);
}

export function formatBrazilianMoney(cents: number | null) {
  if (cents === null) return "";
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(cents / 100);
}

const normalized = (value: string) => value.normalize("NFD")
  .replace(/\p{Diacritic}/gu, "")
  .toLocaleLowerCase("pt-BR");

const monthNumbers: Record<string, number> = {
  janeiro: 1,
  fevereiro: 2,
  marco: 3,
  abril: 4,
  maio: 5,
  junho: 6,
  julho: 7,
  agosto: 8,
  setembro: 9,
  outubro: 10,
  novembro: 11,
  dezembro: 12,
};

function validIsoDate(year: number, month: number, day: number) {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (month < 1 || month > 12 || day < 1 || day > last) return null;
  return `${year}-${String(month).padStart(2, "0")}-${
    String(day).padStart(2, "0")
  }`;
}

export function parseCommitmentNaturalLanguage(
  text: string,
  options: { peopleNames?: string[]; today?: string } = {},
): ParsedCommitmentText {
  const source = text.trim();
  const plain = normalized(source);
  const direction = /\b(receita|receitas|recebido|comissao|salario|aluguel recebido)\b/
    .test(plain)
    ? "income" as const
    : "expense" as const;
  const estimationMode = /\b(historico|historica|mediana|usar historico|calcular pelo historico)\b/
      .test(plain)
    ? "historical_median" as const
    : "fixed" as const;
  const today = options.today ?? new Date().toISOString().slice(0, 10);
  const amountMatch = source.match(
    /R\$\s*([\d.]+(?:,\d{1,2})?)|(?:^|[\s,])([\d.]+,\d{2})(?=\s|$|[,.])/i,
  );
  const amountText = amountMatch?.[1] ?? amountMatch?.[2] ?? "";
  const amountCents = amountText
    ? parseBrazilianMoneyToCents(amountText)
    : null;

  let recurrence: SimpleCommitmentRecurrence | null = null;
  if (/\b(todo|cada)\s+mes\b|por\s+mes|mensal/.test(plain)) {
    recurrence = "monthly";
  } else if (/a\s+cada\s+15\s+dias|quinzenal/.test(plain)) {
    recurrence = "biweekly";
  } else if (/\b(toda|cada)\s+semana\b|semanal/.test(plain)) {
    recurrence = "weekly";
  } else if (/\b(todo|cada)\s+ano\b|anual/.test(plain)) {
    recurrence = "annual";
  } else if (
    /\b(consulta|unico|uma vez|nao repete)\b/.test(plain) ||
    /\bdia\s+\d{1,2}\s+de\s+[a-zç]+\b/.test(plain)
  ) {
    recurrence = "none";
  }

  const dueDayMatch = plain.match(
    /(?:vence(?:\s+no)?|vencimento(?:\s+no)?|no)?\s*dia\s+(\d{1,2})\b/,
  );
  const dueDay = dueDayMatch ? Number(dueDayMatch[1]) : null;
  const fullDateMatch = plain.match(
    /\bdia\s+(\d{1,2})\s+de\s+([a-zç]+)(?:\s+de\s+(\d{4}))?/,
  );
  let dueDate: string | null = null;
  if (fullDateMatch) {
    const month = monthNumbers[fullDateMatch[2]];
    let year = Number(fullDateMatch[3] ?? today.slice(0, 4));
    const candidate = month
      ? validIsoDate(year, month, Number(fullDateMatch[1]))
      : null;
    if (candidate && !fullDateMatch[3] && candidate < today) year += 1;
    dueDate = month
      ? validIsoDate(year, month, Number(fullDateMatch[1]))
      : null;
  }

  const matchedPersonName = (options.peopleNames ?? []).find(name =>
    plain.includes(normalized(name))
  ) ?? null;
  const context: SimpleCommitmentContext | null =
    /\b(casa|moradia|residencia)\b/.test(plain) ? "household"
      : /\b(trabalho|empresa|profissional)\b/.test(plain) ? "work"
        : /\b(viagem|ferias)\b/.test(plain) ? "travel"
          : null;
  const personName = context ? null : matchedPersonName;
  const firstPart = source.split(",")[0]?.trim() ?? "";
  const title = firstPart
    .replace(/^(pagar|pagamento de|conta de)\s+/i, "")
    .trim() || null;
  const missingFields: ParsedCommitmentText["missingFields"] = [];
  if (!title) missingFields.push("title");
  if (amountCents === null && estimationMode === "fixed") {
    missingFields.push("amount");
  }
  if (dueDay === null && dueDate === null) missingFields.push("schedule");
  if (recurrence === null) missingFields.push("recurrence");
  const identified = 4 - missingFields.length;

  return {
    direction,
    title,
    amountCents,
    estimationMode,
    expectedDateRule: dueDay ? "fixed_day" : "unspecified_in_month",
    recurrence,
    dueDay: dueDay && dueDay >= 1 && dueDay <= 31 ? dueDay : null,
    dueDate,
    personName,
    context,
    confidence: Math.round((identified / 4) * 100) / 100,
    missingFields,
  };
}

export function relationTargetParts(value: string): {
  personId: string | null;
  contextType: SimpleCommitmentContext;
} {
  if (value.startsWith("person:")) {
    return { personId: value.slice(7), contextType: "personal" };
  }
  const contextType = [
    "household", "work", "travel",
  ].includes(value)
    ? value as SimpleCommitmentContext
    : "personal";
  return { personId: null, contextType };
}

export type SimpleProjectionInput = {
  month: string;
  expectedIncomeCents: number;
  commitments: Array<{
    amountCents: number;
    commitmentType: "recurring" | "one_time";
    budgetPriority: BudgetPriority;
    status: string;
  }>;
};

export function getSimpleCommitmentProjection(input: SimpleProjectionInput) {
  const active = input.commitments.filter(item =>
    !["cancelled", "skipped", "archived"].includes(item.status)
  );
  const sum = (priority: BudgetPriority) => active
    .filter(item => item.budgetPriority === priority)
    .reduce((total, item) => total + item.amountCents, 0);
  const recurringCommitments = active
    .filter(item => item.commitmentType === "recurring")
    .reduce((total, item) => total + item.amountCents, 0);
  const oneTimeCommitments = active
    .filter(item => item.commitmentType === "one_time")
    .reduce((total, item) => total + item.amountCents, 0);
  const totalCommitted = active.reduce(
    (total, item) => total + item.amountCents,
    0,
  );
  const adjustableCommitments = sum("adjustable");
  const optionalCommitments = sum("optional");
  return {
    month: input.month,
    expectedIncome: input.expectedIncomeCents,
    essentialCommitments: sum("essential"),
    adjustableCommitments,
    optionalCommitments,
    unknownCommitments: sum("unknown"),
    recurringCommitments,
    oneTimeCommitments,
    totalCommitted,
    remainingAmount: input.expectedIncomeCents - totalCommitted,
    potentialSavings: adjustableCommitments + optionalCommitments,
  };
}
