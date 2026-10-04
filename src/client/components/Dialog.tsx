import { useEffect, useId, useRef, type ReactNode } from "react";

/** Accessible modal built on the native <dialog> element (focus trap + Esc). */
export function Dialog({
  open,
  title,
  children,
  onClose,
  actions,
  tone = "default",
}: {
  open: boolean;
  title: string;
  children?: ReactNode;
  onClose: () => void;
  actions?: ReactNode;
  tone?: "default" | "danger" | "warning" | "success";
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className={`dialog dialog--${tone}`}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <h2 id={titleId} className="dialog__title">
        {title}
      </h2>
      {children && <div className="dialog__body">{children}</div>}
      {actions && <div className="dialog__actions">{actions}</div>}
    </dialog>
  );
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  onConfirm,
  onCancel,
  busy,
  tone = "default",
}: {
  open: boolean;
  title: string;
  message?: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
  tone?: "default" | "danger" | "warning";
}) {
  return (
    <Dialog
      open={open}
      title={title}
      onClose={onCancel}
      tone={tone}
      actions={
        <>
          <button type="button" className={`btn ${tone === "danger" ? "btn--danger" : "btn--primary"}`} onClick={onConfirm} disabled={busy} autoFocus>
            {busy ? "جارٍ التنفيذ…" : confirmLabel}
          </button>
          <button type="button" className="btn btn--ghost" onClick={onCancel} disabled={busy}>
            إلغاء
          </button>
        </>
      }
    >
      {message}
    </Dialog>
  );
}
