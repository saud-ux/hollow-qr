import { Link } from "react-router";
import { ACTION_LABELS_AR, ROLE_LABELS_AR } from "../../shared/messages";
import type { TransactionItem } from "../../shared/types";
import { formatDateTime } from "../lib/dates";

export function describeTransaction(t: TransactionItem): string {
  switch (t.action) {
    case "ADD_CUPS":
      return `+${t.quantity} ${t.quantity === 1 ? "كوب" : "أكواب"}`;
    case "REMOVE_CUPS":
      return `−${t.quantity} ${t.quantity === 1 ? "كوب" : "أكواب"}`;
    case "UNDO":
      return "تراجع عن عملية";
    case "ADMIN_ADJUSTMENT":
      return `تعديل إلى ${t.newStampCount}`;
    default:
      return ACTION_LABELS_AR[t.action] ?? t.action;
  }
}

export function ActivityList({ items, showCustomer = true }: { items: TransactionItem[]; showCustomer?: boolean }) {
  if (items.length === 0) return <p className="muted">لا توجد عمليات بعد.</p>;
  return (
    <ul className="activity">
      {items.map((t) => (
        <li key={t.id} className={`activity__item ${t.reversedBy ? "activity__item--reversed" : ""}`}>
          <div className="activity__main">
            <strong>{describeTransaction(t)}</strong>
            {showCustomer && (
              <Link to={`/staff/customers/${t.accountId}`} className="activity__customer">
                {t.customerName} <span dir="ltr">({t.memberId})</span>
              </Link>
            )}
          </div>
          <div className="activity__meta">
            <span dir="ltr">
              {t.previousStampCount} → {t.newStampCount}
            </span>
            {t.previousMembershipStatus !== t.newMembershipStatus && (
              <span>{t.newMembershipStatus === "cancelled" ? "ملغاة" : "نشطة"}</span>
            )}
            <span>
              {t.actorName} ({ROLE_LABELS_AR[t.actorRole]})
            </span>
            <time dateTime={t.createdAt}>{formatDateTime(t.createdAt)}</time>
            {t.reversedBy && <span className="badge badge--muted">تم التراجع</span>}
          </div>
        </li>
      ))}
    </ul>
  );
}
