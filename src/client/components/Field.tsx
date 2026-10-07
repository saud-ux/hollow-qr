import { useId, type InputHTMLAttributes } from "react";
import { tr } from "../lib/i18n";

export function Field({
  label,
  error,
  hint,
  ...input
}: { label: string; error?: string | null; hint?: string } & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  const errId = `${id}-err`;
  const hintId = `${id}-hint`;
  return (
    <div className={`field ${error ? "field--error" : ""}`}>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        aria-invalid={Boolean(error)}
        aria-describedby={[error ? errId : null, hint ? hintId : null].filter(Boolean).join(" ") || undefined}
        {...input}
      />
      {hint && !error && (
        <small id={hintId} className="field__hint">
          {hint}
        </small>
      )}
      {error && (
        <small id={errId} className="field__error" role="alert">
          {error}
        </small>
      )}
    </div>
  );
}

export function Alert({ tone = "info", children }: { tone?: "info" | "error" | "success" | "warning"; children: React.ReactNode }) {
  return (
    <div className={`alert alert--${tone}`} role={tone === "error" ? "alert" : "status"}>
      {children}
    </div>
  );
}

export function Spinner({ label = tr("جارٍ التحميل…", "Loading…") }: { label?: string }) {
  return (
    <div className="spinner" role="status" aria-live="polite">
      <span className="spinner__dot" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}
