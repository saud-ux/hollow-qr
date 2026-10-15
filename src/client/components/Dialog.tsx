import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { tr } from "../lib/i18n";

/**
 * Accessible modal built on the native <dialog> element (focus trap + Esc).
 * It fades and grows in, and fades out (styles.css).
 */
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
  // While it fades out, it keeps showing what it showed when open (pages often
  // clear what a dialog shows in the same step that closes it).
  const [shown, setShown] = useState({ title, children, actions });
  if (open && (shown.title !== title || shown.children !== children || shown.actions !== actions)) setShown({ title, children, actions });
  const view = open ? { title, children, actions } : shown;
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
        {view.title}
      </h2>
      {view.children && <div className="dialog__body">{view.children}</div>}
      {view.actions && <div className="dialog__actions">{view.actions}</div>}
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
            {busy ? tr("جارٍ التنفيذ…", "Working…") : confirmLabel}
          </button>
          <button type="button" className="btn btn--ghost" onClick={onCancel} disabled={busy}>
            {tr("إلغاء", "Cancel")}
          </button>
        </>
      }
    >
      {message}
    </Dialog>
  );
}
