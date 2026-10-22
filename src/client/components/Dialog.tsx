import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { tr, type Lang } from "../lib/i18n";

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
  lead,
  className,
  focusDialog = false,
  tone = "default",
  dismissible = false,
  lang,
}: {
  open: boolean;
  title: string;
  children?: ReactNode;
  onClose: () => void;
  actions?: ReactNode;
  /** Shown above the title, e.g. an illustration. */
  lead?: ReactNode;
  className?: string;
  /** Opens with focus on the dialog itself, so no button shows a focus ring before anyone picks one. */
  focusDialog?: boolean;
  tone?: "default" | "danger" | "warning" | "success";
  dismissible?: boolean;
  /** A dialog written in one language whatever the app's (its direction follows). */
  lang?: Lang;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const backdropPress = useRef(false);
  // While it fades out, it keeps showing what it showed when open (pages often
  // clear what a dialog shows in the same step that closes it).
  const [shown, setShown] = useState({ title, children, actions, lead });
  if (open && (shown.title !== title || shown.children !== children || shown.actions !== actions || shown.lead !== lead)) setShown({ title, children, actions, lead });
  const view = open ? { title, children, actions, lead } : shown;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      el.showModal();
      if (focusDialog) el.focus();
    }
    if (!open && el.open) el.close();
  }, [open, focusDialog]);
  useEffect(() => {
    if (!open || !dismissible) return;
    // Fixed positioning also prevents background scrolling in iOS Safari.
    const body = document.body;
    const root = document.documentElement;
    const x = window.scrollX, y = window.scrollY;
    const previous = { position: body.style.position, top: body.style.top, left: body.style.left, width: body.style.width, overflow: body.style.overflow, rootOverflow: root.style.overflow };
    Object.assign(body.style, { position: "fixed", top: `-${y}px`, left: `-${x}px`, width: "100%", overflow: "hidden" });
    root.style.overflow = "hidden";
    return () => {
      Object.assign(body.style, { position: previous.position, top: previous.top, left: previous.left, width: previous.width, overflow: previous.overflow });
      root.style.overflow = previous.rootOverflow;
      window.scrollTo({ left: x, top: y, behavior: "instant" });
    };
  }, [open, dismissible]);
  function outside(el: HTMLDialogElement, x: number, y: number) {
    const bounds = el.getBoundingClientRect();
    return x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom;
  }
  return (
    <dialog
      ref={ref}
      className={`dialog dialog--${tone}${className ? ` ${className}` : ""}`}
      lang={lang}
      dir={lang ? (lang === "ar" ? "rtl" : "ltr") : undefined}
      aria-labelledby={titleId}
      tabIndex={focusDialog ? -1 : undefined}
      onPointerDown={e => { backdropPress.current = e.target === e.currentTarget && outside(e.currentTarget, e.clientX, e.clientY); }}
      onClick={e => {
        if (dismissible && backdropPress.current && e.target === e.currentTarget && outside(e.currentTarget, e.clientX, e.clientY)) onClose();
        backdropPress.current = false;
      }}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      {view.lead}
      {dismissible ? <div className="dialog__heading">
        <h2 id={titleId} className="dialog__title">{view.title}</h2>
        <button type="button" className="dialog__close" aria-label={tr("إغلاق", "Close")} onClick={onClose}>×</button>
      </div> : <h2 id={titleId} className="dialog__title">{view.title}</h2>}
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
  cancelLabel,
  onConfirm,
  onCancel,
  busy,
  tone = "default",
}: {
  open: boolean;
  title: string;
  message?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
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
            {cancelLabel ?? tr("إلغاء", "Cancel")}
          </button>
        </>
      }
    >
      {message}
    </Dialog>
  );
}
