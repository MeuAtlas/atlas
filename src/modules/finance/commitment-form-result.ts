export type FinanceFormResult = {
  ok: boolean;
  message: string;
  fieldErrors: Record<string, string[]>;
  id?: string;
};

export const successfulFormResult = (
  message: string,
  id?: string,
): FinanceFormResult => ({
  ok: true,
  message,
  fieldErrors: {},
  id,
});

export const failedFormResult = (
  message: string,
  fieldErrors: Record<string, string[]> = {},
): FinanceFormResult => ({
  ok: false,
  message,
  fieldErrors,
});
