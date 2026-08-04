import type { PluggyTransaction } from "./types";

export const MAX_TRANSACTION_PAGES = 200;

export type ListPluggyTransactionsInput = {
  accountId: string;
  dateFrom?: string;
  dateTo?: string;
  after?: string;
};

export type PluggyTransactionsPage = {
  results: PluggyTransaction[];
  nextCursor: string | null;
};

export type ListAllPluggyTransactionsResult = {
  transactions: PluggyTransaction[];
  pagesFetched: number;
  cursorsUsed: string[];
  completed: true;
};

const ALLOWED_TRANSACTION_PARAMETERS = new Set([
  "accountId",
  "dateFrom",
  "dateTo",
  "after",
]);

export class PluggyTransactionsPaginationError extends Error {
  readonly code: string;
  readonly pagesFetched: number;
  readonly cursorsUsed: string[];
  readonly partialTransactions: PluggyTransaction[];
  readonly status?: number;
  readonly operation?: string;
  readonly providerMessage?: string;
  readonly responseBodySanitized?: string;
  readonly durationMs?: number;

  constructor(
    message: string,
    options: {
      code: string;
      pagesFetched: number;
      cursorsUsed: string[];
      partialTransactions: PluggyTransaction[];
      cause?: unknown;
    },
  ) {
    super(message, { cause: options.cause });
    this.name = "PluggyTransactionsPaginationError";
    this.code = options.code;
    this.pagesFetched = options.pagesFetched;
    this.cursorsUsed = [...options.cursorsUsed];
    this.partialTransactions = [...options.partialTransactions];
    const cause = options.cause as {
      status?: unknown;
      operation?: unknown;
      providerMessage?: unknown;
      responseBodySanitized?: unknown;
      durationMs?: unknown;
    } | undefined;
    this.status = typeof cause?.status === "number" ? cause.status : undefined;
    this.operation = typeof cause?.operation === "string"
      ? cause.operation
      : "GET /v2/transactions";
    this.providerMessage = typeof cause?.providerMessage === "string"
      ? cause.providerMessage
      : undefined;
    this.responseBodySanitized = typeof cause?.responseBodySanitized === "string"
      ? cause.responseBodySanitized
      : undefined;
    this.durationMs = typeof cause?.durationMs === "number"
      ? cause.durationMs
      : undefined;
  }
}

export function buildPluggyTransactionsUrl(
  input: ListPluggyTransactionsInput,
) {
  const unknownParameters = Object.keys(input).filter(
    key => !ALLOWED_TRANSACTION_PARAMETERS.has(key),
  );
  if (unknownParameters.length) {
    throw new PluggyTransactionsPaginationError(
      `Unsupported transactions parameter: ${unknownParameters[0]}`,
      {
        code: "pluggy_transactions_unknown_parameter",
        pagesFetched: 0,
        cursorsUsed: [],
        partialTransactions: [],
      },
    );
  }
  const accountId = input.accountId?.trim();
  if (!accountId) {
    throw new PluggyTransactionsPaginationError(
      "accountId is required for Pluggy transactions",
      {
        code: "pluggy_transactions_account_required",
        pagesFetched: 0,
        cursorsUsed: [],
        partialTransactions: [],
      },
    );
  }
  const params = new URLSearchParams({ accountId });
  if (input.dateFrom) params.set("dateFrom", input.dateFrom);
  if (input.dateTo) params.set("dateTo", input.dateTo);
  if (input.after) params.set("after", input.after);

  // /v2/transactions is cursor-paginated. Do not add page or pageSize
  // without first validating an official API contract change.
  return `/v2/transactions?${params.toString()}`;
}

function cursorFromNext(next: unknown) {
  if (next === undefined || next === null || next === "") return null;
  if (typeof next !== "string") {
    throw new PluggyTransactionsPaginationError(
      "Pluggy transactions next cursor is invalid",
      {
        code: "pluggy_transactions_invalid_cursor",
        pagesFetched: 0,
        cursorsUsed: [],
        partialTransactions: [],
      },
    );
  }
  const cursor = new URL(next, "https://api.pluggy.ai").searchParams.get("after");
  if (cursor) return cursor;
  if (!next.includes("/") && !next.includes("?")) return next;
  throw new PluggyTransactionsPaginationError(
    "Pluggy transactions next link does not contain an after cursor",
    {
      code: "pluggy_transactions_invalid_cursor",
      pagesFetched: 0,
      cursorsUsed: [],
      partialTransactions: [],
    },
  );
}

export function normalizePluggyTransactionsPage(
  payload: unknown,
): PluggyTransactionsPage {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new PluggyTransactionsPaginationError(
      "Pluggy transactions payload is invalid",
      {
        code: "pluggy_transactions_invalid_payload",
        pagesFetched: 0,
        cursorsUsed: [],
        partialTransactions: [],
      },
    );
  }
  const candidate = payload as { results?: unknown; next?: unknown };
  if (!Array.isArray(candidate.results)) {
    throw new PluggyTransactionsPaginationError(
      "Pluggy transactions results must be an array",
      {
        code: "pluggy_transactions_invalid_payload",
        pagesFetched: 0,
        cursorsUsed: [],
        partialTransactions: [],
      },
    );
  }
  const results = candidate.results.map((row, index) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw new PluggyTransactionsPaginationError(
        `Pluggy transaction at index ${index} is invalid`,
        {
          code: "pluggy_transactions_invalid_payload",
          pagesFetched: 0,
          cursorsUsed: [],
          partialTransactions: [],
        },
      );
    }
    const transaction = row as Partial<PluggyTransaction>;
    if (typeof transaction.id !== "string" ||
      typeof transaction.accountId !== "string") {
      throw new PluggyTransactionsPaginationError(
        `Pluggy transaction at index ${index} has no valid identity`,
        {
          code: "pluggy_transactions_invalid_payload",
          pagesFetched: 0,
          cursorsUsed: [],
          partialTransactions: [],
        },
      );
    }
    return transaction as PluggyTransaction;
  });
  return { results, nextCursor: cursorFromNext(candidate.next) };
}

export async function listAllPluggyTransactions(
  input: Omit<ListPluggyTransactionsInput, "after">,
  fetchPage: (input: ListPluggyTransactionsInput) => Promise<unknown>,
  maxPages = MAX_TRANSACTION_PAGES,
): Promise<ListAllPluggyTransactionsResult> {
  const transactions: PluggyTransaction[] = [];
  const cursorsUsed: string[] = [];
  const seenCursors = new Set<string>();
  const seenPageSignatures = new Set<string>();
  let after: string | undefined;
  let pagesFetched = 0;

  while (true) {
    if (pagesFetched >= maxPages) {
      throw new PluggyTransactionsPaginationError(
        "Pluggy transactions pagination exceeded the safety limit",
        {
          code: "pluggy_pagination_limit",
          pagesFetched,
          cursorsUsed,
          partialTransactions: transactions,
        },
      );
    }
    let page: PluggyTransactionsPage;
    try {
      page = normalizePluggyTransactionsPage(await fetchPage({ ...input, after }));
    } catch (error) {
      if (error instanceof PluggyTransactionsPaginationError &&
        error.code !== "pluggy_transactions_invalid_payload" &&
        error.code !== "pluggy_transactions_invalid_cursor") throw error;
      throw new PluggyTransactionsPaginationError(
        "Pluggy transactions pagination did not complete",
        {
          code: error instanceof PluggyTransactionsPaginationError
            ? error.code
            : "pluggy_transactions_page_failed",
          pagesFetched,
          cursorsUsed,
          partialTransactions: transactions,
          cause: error,
        },
      );
    }
    pagesFetched += 1;
    transactions.push(...page.results);
    if (!page.nextCursor) {
      return { transactions, pagesFetched, cursorsUsed, completed: true };
    }
    const signature = page.results.map(row => row.id).join("|");
    if (seenPageSignatures.has(signature) || seenCursors.has(page.nextCursor)) {
      throw new PluggyTransactionsPaginationError(
        "Pluggy transactions endpoint returned a repeated cursor or page",
        {
          code: "pluggy_pagination_repeated_cursor",
          pagesFetched,
          cursorsUsed,
          partialTransactions: transactions,
        },
      );
    }
    seenPageSignatures.add(signature);
    seenCursors.add(page.nextCursor);
    cursorsUsed.push(page.nextCursor);
    after = page.nextCursor;
  }
}
