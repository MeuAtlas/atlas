import type { InputHTMLAttributes, ReactNode } from "react";

type FormFieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  icon: ReactNode;
  error?: string;
  trailing?: ReactNode;
};

export function FormField({ label, icon, error, trailing, className = "", ...props }: FormFieldProps) {
  return (
    <div className="atlas-field">
      <label htmlFor={props.id} className="atlas-field-label">{label}</label>
      <div className="relative">
        <span className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-[var(--atlas-muted)]">{icon}</span>
        <input
          {...props}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${props.id}-error` : undefined}
          className={`atlas-field-input ${error ? "border-[var(--atlas-error)]" : "border-[var(--atlas-border)]"} ${className}`}
        />
        {trailing}
      </div>
      {error ? <p id={`${props.id}-error`} className="atlas-field-error" aria-live="polite">{error}</p> : null}
    </div>
  );
}
