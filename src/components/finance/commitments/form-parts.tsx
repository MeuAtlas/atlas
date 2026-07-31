import type { ReactNode } from "react";

export type FieldErrors = Record<string, string>;

export function FormErrorSummary({
  errors,
  formMessage,
}: {
  errors: FieldErrors;
  formMessage?: string;
}) {
  const messages = Array.from(new Set(Object.values(errors)));
  if (!messages.length && !formMessage) return null;
  return (
    <section
      className="commitment-error-summary"
      role="alert"
      aria-labelledby="commitment-error-title"
      tabIndex={-1}
      data-error-summary
    >
      <strong id="commitment-error-title">
        Revise os dados antes de salvar
      </strong>
      {formMessage ? <p>{formMessage}</p> : null}
      {messages.length ? (
        <ul>{messages.map(message => <li key={message}>{message}</li>)}</ul>
      ) : null}
    </section>
  );
}

export function FormField({
  name,
  label,
  error,
  required,
  help,
  wide,
  children,
}: {
  name: string;
  label: string;
  error?: string;
  required?: boolean;
  help?: string;
  wide?: boolean;
  children: ReactNode;
}) {
  const errorId = `${name}-error`;
  const helpId = `${name}-help`;
  return (
    <label
      className={`commitment-field${wide ? " wide" : ""}${error ? " invalid" : ""}`}
      htmlFor={name}
    >
      <span>
        {label}
        {required ? <b aria-hidden="true"> *</b> : null}
      </span>
      {children}
      {error ? <small id={errorId} className="field-error">{error}</small> : null}
      {!error && help ? <small id={helpId}>{help}</small> : null}
    </label>
  );
}

export function ToggleField({
  name,
  label,
  help,
  checked,
  defaultChecked,
  onChange,
}: {
  name: string;
  label: string;
  help?: string;
  checked?: boolean;
  defaultChecked?: boolean;
  onChange?: (checked: boolean) => void;
}) {
  return (
    <label className="commitment-toggle">
      <input
        name={name}
        type="checkbox"
        checked={checked}
        defaultChecked={checked === undefined ? defaultChecked : undefined}
        onChange={event => onChange?.(event.target.checked)}
      />
      <span aria-hidden="true"><i /></span>
      <span>
        <b>{label}</b>
        {help ? <small>{help}</small> : null}
      </span>
    </label>
  );
}
