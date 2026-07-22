export type AtlasErrorResult = { message: string; code?: string };

export type SupabaseErrorLike = {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
};

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

export function logSupabaseError(error: SupabaseErrorLike, context: string) {
  console.error("[Atlas Supabase Error]", {
    context,
    code: error.code,
    message: error.message,
    details: error.details,
    hint: error.hint,
  });
}

export function throwSupabaseError(error: SupabaseErrorLike, context: string, publicMessage: string): never {
  logSupabaseError(error, context);
  throw new Error(publicMessage);
}
