export type AtlasErrorResult = { message: string; code?: string };

export type SupabaseErrorLike = {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
  status?: number | string;
  name?: string;
  cause?: unknown;
};

export type NormalizedSupabaseError = {
  context: string;
  name: string | null;
  code: string | null;
  message: string | null;
  details: string | null;
  hint: string | null;
  status: number | string | null;
  cause: string | null;
  rawType: string;
};

function explicitValue(
  value: unknown,
): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
}

export function normalizeSupabaseError(
  error: unknown,
  context: string,
): NormalizedSupabaseError {
  const candidate =
    typeof error === "object" && error !== null
      ? error as Record<string, unknown>
      : {};
  const causeValue = candidate.cause;
  const cause =
    causeValue instanceof Error
      ? causeValue.message
      : explicitValue(causeValue);
  return {
    context,
    name: explicitValue(candidate.name),
    code: explicitValue(candidate.code),
    message:
      explicitValue(candidate.message) ??
      (error instanceof Error ? error.message : null),
    details: explicitValue(candidate.details),
    hint: explicitValue(candidate.hint),
    status:
      typeof candidate.status === "number" ||
      typeof candidate.status === "string"
        ? candidate.status
        : null,
    cause,
    rawType:
      error === null
        ? "null"
        : error === undefined
          ? "undefined"
          : typeof error === "object"
            ? error.constructor?.name ?? "Object"
            : typeof error,
  };
}

export function normalizeError(error: unknown): AtlasErrorResult {
  if (error instanceof Error) return { message: error.message };
  if (typeof error === "object" && error !== null) {
    const candidate = error as { message?: unknown; code?: unknown };
    return {
      message: typeof candidate.message === "string" ? candidate.message : "Ocorreu um erro inesperado.",
      code: typeof candidate.code === "string" ? candidate.code : undefined,
    };
  }
  if (typeof error === "string") return { message: error };
  return { message: "Ocorreu um erro inesperado." };
}

export function logSupabaseError(error: unknown, context: string) {
  console.error(
    "[Atlas Supabase Error]",
    normalizeSupabaseError(error, context),
  );
}

export function throwSupabaseError(error: unknown, context: string, publicMessage: string): never {
  logSupabaseError(error, context);
  throw new Error(publicMessage);
}
