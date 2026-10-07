import { useId, useState, type InputHTMLAttributes } from "react";
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
  // Password fields get an eye button to show or hide what was typed.
  const isPassword = input.type === "password";
  const [shown, setShown] = useState(false);
  const field = (
    <input
      id={id}
      aria-invalid={Boolean(error)}
      aria-describedby={[error ? errId : null, hint ? hintId : null].filter(Boolean).join(" ") || undefined}
      {...input}
      type={isPassword && shown ? "text" : input.type}
    />
  );
  return (
    <div className={`field ${error ? "field--error" : ""}`}>
      <label htmlFor={id}>{label}</label>
      {isPassword ? (
        <div className="field__password" dir={input.dir}>
          {field}
          <button
            type="button"
            className="field__eye"
            onClick={() => setShown((v) => !v)}
            aria-controls={id}
            aria-pressed={shown}
            aria-label={shown ? tr("إخفاء كلمة المرور", "Hide password") : tr("إظهار كلمة المرور", "Show password")}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
              <circle cx="12" cy="12" r="3" />
              {shown && <path d="M4 20 20 4" />}
            </svg>
          </button>
        </div>
      ) : (
        field
      )}
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
