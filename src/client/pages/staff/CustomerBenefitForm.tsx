import { useState } from "react";
import type { BenefitAccount } from "../../../shared/benefits";
import { Alert } from "../../components/Field";
import { formatDateTime } from "../../lib/dates";
import { errorText } from "../../lib/api";
import { benefitCall } from "../../lib/benefits";
import { newIdempotencyKey } from "../../lib/hooks";
import { riyals, useMenu } from "../../lib/menu";

/**
 * What a staff sheet does with the customer's balance and hospitality cups:
 * take money from the balance, use hospitality cups, or (admin) add to or
 * correct either.
 */
export type BenefitKind = "balance" | "gift" | "adjust";

export function BenefitForm({
  accountId,
  account,
  kind,
  onDone,
}: {
  accountId: string;
  account: BenefitAccount;
  kind: BenefitKind;
  onDone: (title: string) => void;
}) {
  const { menu } = useMenu();
  const coffees = menu?.items.filter((i) => account.gift_item_ids.includes(i.id)) ?? [];
  const [money, setMoney] = useState("");
  const [cups, setCups] = useState(kind === "gift" ? "1" : "");
  const [reason, setReason] = useState("");
  const [picked, setPicked] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Keep the same key if a response is lost; retries cannot double-debit.
  const [attempt, setAttempt] = useState<{ signature: string; key: string } | null>(null);

  // With one coffee to choose from, it is chosen already.
  const item = picked || (coffees.length === 1 ? coffees[0]!.id : "");
  const amountHalalas = kind === "gift" ? 0 : Math.round(Number(money || 0) * 100);
  const cupCount = kind === "balance" ? 0 : Math.trunc(Number(cups || 0));
  const ready =
    reason.trim() !== "" &&
    (kind === "balance" ? amountHalalas > 0 : kind === "gift" ? cupCount > 0 && item !== "" : amountHalalas !== 0 || cupCount !== 0);

  async function submit() {
    if (busy || !ready) return;
    const payload = {
      accountId,
      amountHalalas,
      cups: cupCount,
      reason: reason.trim(),
      menuItemId: kind === "gift" ? item : undefined,
    };
    const mode = kind === "adjust" ? "adjust" : "spend";
    const signature = JSON.stringify({ mode, payload });
    const key = attempt?.signature === signature ? attempt.key : newIdempotencyKey();
    setAttempt({ signature, key });
    setBusy(true);
    setError(null);
    try {
      await benefitCall(mode, { ...payload, idempotencyKey: key });
      setAttempt(null);
      onDone(
        kind === "balance"
          ? `تم خصم ${riyals(amountHalalas)} من الرصيد`
          : kind === "gift"
            ? cupCount === 1
              ? "تم استخدام كوب ضيافة"
              : `تم استخدام ${cupCount} أكواب ضيافة`
            : "تم حفظ التعديل",
      );
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="form">
      {kind !== "gift" && (
        <label className="field">
          {kind === "adjust" ? "المبلغ بالريال (بالسالب للتصحيح)" : "المبلغ بالريال"}
          <input
            type="number"
            inputMode="decimal"
            min={kind === "balance" ? 0 : undefined}
            max="1000000"
            step="0.01"
            value={money}
            onChange={(e) => setMoney(e.target.value)}
          />
        </label>
      )}
      {kind === "gift" && (
        <div className="field">
          القهوة
          <div className="staff-choice">
            {coffees.map((c) => (
              <button key={c.id} type="button" className={item === c.id ? "is-on" : ""} aria-pressed={item === c.id} onClick={() => setPicked(c.id)}>
                {c.nameAr}
              </button>
            ))}
          </div>
          {coffees.length === 0 && <span className="muted">لا توجد قهوة مشمولة بأكواب الضيافة.</span>}
        </div>
      )}
      {kind !== "balance" && (
        <label className="field">
          {kind === "adjust" ? "أكواب الضيافة (بالسالب للتصحيح)" : "عدد الأكواب"}
          <input
            type="number"
            inputMode="numeric"
            min={kind === "gift" ? 1 : undefined}
            max={kind === "gift" ? account.gift_cups : 10000}
            step="1"
            value={cups}
            onChange={(e) => setCups(e.target.value)}
          />
        </label>
      )}
      <label className="field">
        رقم الفاتورة أو السبب
        <input value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
      </label>
      {error && <Alert tone="error">{error}</Alert>}
      <button type="button" className="btn btn--primary btn--lg" disabled={busy || !ready} onClick={() => void submit()}>
        {busy
          ? "جارٍ الحفظ…"
          : kind === "balance"
            ? amountHalalas > 0
              ? `خصم ${riyals(amountHalalas)}`
              : "خصم من الرصيد"
            : kind === "gift"
              ? "استخدام أكواب الضيافة"
              : "حفظ التعديل"}
      </button>
    </div>
  );
}

/** The customer's balance and hospitality cups movements, newest first. */
export function BenefitHistory({ account }: { account: BenefitAccount }) {
  if (account.movements.length === 0) return <p className="muted">لا توجد حركات بعد.</p>;
  return (
    <ul className="benefits-history">
      {account.movements.map((m) => (
        <li key={m.id}>
          <span>
            {m.reason}
            {m.actor_name ? ` · ${m.actor_name}` : ""}
          </span>
          <small>{formatDateTime(m.created_at)}</small>
          <span>
            {riyals(m.amount_halalas)} · {m.cups} كوب
          </span>
        </li>
      ))}
    </ul>
  );
}
