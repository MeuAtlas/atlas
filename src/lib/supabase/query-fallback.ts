export type SupabaseErrorLike = {
  name?: string | null;
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
  status?: number | null;
  stack?: string | null;
};

export type QueryResult<T> = {
  data: T | null;
  error: SupabaseErrorLike | null;
};

export type SupabaseQueryDiagnostic = {
  query: string;
  name?: string;
  code?: string;
  message: string;
  details?: string;
  hint?: string;
  status?: number;
  stack?: string;
};

export type QueryWarning = SupabaseQueryDiagnostic;

export type DiagnosticLogger = (
  label: string,
  diagnostic: SupabaseQueryDiagnostic,
) => void;

export const defaultLogger: DiagnosticLogger = (label, diagnostic) => {
  const payload = {
    query: diagnostic.query,
    name: diagnostic.name,
    code: diagnostic.code,
    message: diagnostic.message,
    details: diagnostic.details,
    hint: diagnostic.hint,
    status: diagnostic.status,
    stack:
      process.env.NODE_ENV === "development" ? diagnostic.stack : undefined,
  };

  if (label === "[Atlas Required Supabase Query]") {
    console.error(label, payload);
    return;
  }

  if (process.env.NODE_ENV === "development") {
    console.warn(label, payload);
    return;
  }

  console.warn(label, {
    query: payload.query,
    code: payload.code,
    message: payload.message,
  });
};

export function sanitizeError(
  query: string,
  error: unknown,
): SupabaseQueryDiagnostic {
  if (error instanceof Error) {
    const candidate = error as Error & {
      code?: unknown;
      details?: unknown;
      hint?: unknown;
      status?: unknown;
    };

    return {
      query,
      name: candidate.name,
      code: typeof candidate.code === "string" ? candidate.code : undefined,
      message:
        candidate.message ||
        "Consulta opcional do Supabase falhou sem mensagem.",
      details:
        typeof candidate.details === "string"
          ? candidate.details
          : undefined,
      hint: typeof candidate.hint === "string" ? candidate.hint : undefined,
      status:
        typeof candidate.status === "number" ? candidate.status : undefined,
      stack:
        process.env.NODE_ENV === "development"
          ? candidate.stack
          : undefined,
    };
  }

  if (typeof error === "object" && error !== null) {
    const candidate = error as Record<string, unknown>;

    return {
      query,
      name: typeof candidate.name === "string" ? candidate.name : undefined,
      code: typeof candidate.code === "string" ? candidate.code : undefined,
      message:
        typeof candidate.message === "string" && candidate.message
          ? candidate.message
          : "Consulta opcional do Supabase falhou sem mensagem.",
      details:
        typeof candidate.details === "string"
          ? candidate.details
          : undefined,
      hint: typeof candidate.hint === "string" ? candidate.hint : undefined,
      status:
        typeof candidate.status === "number" ? candidate.status : undefined,
      stack:
        process.env.NODE_ENV === "development" &&
        typeof candidate.stack === "string"
          ? candidate.stack
          : undefined,
    };
  }

  if (typeof error === "string") {
    return { query, message: error };
  }

  return {
    query,
    message: "Erro desconhecido em consulta opcional.",
  };
}

export async function withQueryFallback<T>(
  query: string,
  operation: PromiseLike<QueryResult<T>>,
  fallback: T,
  logger: DiagnosticLogger = defaultLogger,
): Promise<{ data: T; warning: QueryWarning | null }> {
  try {
    const result = await operation;
    if (!result.error) {
      return { data: result.data ?? fallback, warning: null };
    }

    const warning = sanitizeError(query, result.error);
    logger("[Atlas Optional Supabase Query]", warning);
    return { data: fallback, warning };
  } catch (error) {
    const warning = sanitizeError(query, error);
    logger("[Atlas Optional Supabase Query]", warning);
    return { data: fallback, warning };
  }
}

export async function requireQuery<T>(
  query: string,
  operation: PromiseLike<QueryResult<T>>,
  logger: DiagnosticLogger = defaultLogger,
): Promise<T> {
  let result: QueryResult<T>;

  try {
    result = await operation;
  } catch (error) {
    const diagnostic = sanitizeError(query, error);
    logger("[Atlas Required Supabase Query]", diagnostic);
    throw new Error(`Falha na consulta obrigatória ${query}.`, {
      cause: diagnostic,
    });
  }

  if (result.error) {
    const diagnostic = sanitizeError(query, result.error);
    logger("[Atlas Required Supabase Query]", diagnostic);
    throw new Error(`Falha na consulta obrigatória ${query}.`, {
      cause: diagnostic,
    });
  }

  return result.data as T;
}
