import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { BenefitAccount } from "../../shared/benefits";
import { tr } from "../lib/i18n";
import { riyals } from "../lib/menu";
import { play } from "../lib/motion";
import { successFeedback, warnFeedback } from "../lib/native";
import { Dialog } from "./Dialog";
import { Alert } from "./Field";

function BenefitIcon({ kind }: { kind: "cup" | "wallet" | "tag" }) {
  return (
    <svg className="checkout-perk__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {kind === "cup" ? <><path d="M6 8h12l-1.5 13h-9L6 8Z" /><path d="M4 8V5h16v3H4ZM7 5l1-3h8l1 3" /></> : kind === "wallet" ? <><path d="M20 8H5a2 2 0 0 1 0-4h13v4M3 6v13a2 2 0 0 0 2 2h15V8" /><path d="M20 12h-5v5h5M6 4l10-2v2" /></> : <><path d="m3 3 8 .5L22 14l-8 8L3.5 11 3 3Z" /><circle cx="7.5" cy="7.5" r="1" /></>}
    </svg>
  );
}

type Props = {
  compact?: boolean;
  account: BenefitAccount | null;
  selectedGifts: number;
  giftLimit: number;
  onGiftsChange: (count: number) => void;
  couponInput: string;
  onCouponInputChange: (code: string) => void;
  couponCode: string;
  couponDiscount: number;
  couponChecking: boolean;
  couponError: string | null;
  onApplyCoupon: () => void;
  onRemoveCoupon: () => void;
  useBalance: boolean;
  onBalanceChange: (use: boolean) => void;
};

/** Stamped on like a paper ticket: a little too big, then pressed flat. */
const TICKET_IN: Keyframe[] = [
  { opacity: 0, transform: "scale(1.15) rotate(-3deg)" },
  { opacity: 1, transform: "scale(.97) rotate(.4deg)", offset: 0.6 },
  { opacity: 1, transform: "none" },
];
const SHAKE: Keyframe[] = [
  { transform: "translateX(0)" }, { transform: "translateX(-9px)" }, { transform: "translateX(8px)" },
  { transform: "translateX(-6px)" }, { transform: "translateX(4px)" }, { transform: "translateX(0)" },
];

export function CheckoutBenefits(props: Props) {
  const [giftOpen, setGiftOpen] = useState(false);
  const { account, selectedGifts, giftLimit } = props;
  const couponBox = useRef<HTMLDetailsElement>(null);
  const entry = useRef<HTMLDivElement>(null);
  const ticket = useRef<HTMLDivElement>(null);

  // An applied code stays in view, as a gold ticket that stamps on with a tap you can feel.
  const applied = props.couponCode;
  const shownCode = useRef(applied);
  useLayoutEffect(() => {
    if (applied && couponBox.current) couponBox.current.open = true;
    if (applied && applied !== shownCode.current) {
      void play(ticket.current, TICKET_IN, { duration: 520, easing: "cubic-bezier(.3,.7,.1,1)" });
      successFeedback();
    }
    shownCode.current = applied;
  }, [applied]);

  // A code that doesn't work: the field shakes its head.
  const { couponError } = props;
  useEffect(() => {
    if (!couponError) return;
    void play(entry.current, SHAKE, { duration: 420, easing: "ease-out" });
    warnFeedback();
  }, [couponError]);
  return (
    <>
      {account && account.gift_cups > 0 && (
        <section className={`sheet checkout-gift ${props.compact ? "checkout-gift--compact" : ""}`} aria-label={tr("ضيافتك من هولو", "Coffee on HOLLOW")}>
          <div className="checkout-gift__heading">
            <BenefitIcon kind="cup" />
            <div><h2>{props.compact ? tr("أكواب الضيافة", "Gift cups") : tr("القهوة علينا", "Coffee on us")}</h2><p>{props.compact && selectedGifts > 0 ? tr(`استخدام ${selectedGifts} من ${account.gift_cups} أكواب`, `Using ${selectedGifts} of ${account.gift_cups} cups`) : tr(`${account.gift_cups} أكواب متاحة`, `${account.gift_cups} cups available`)}</p></div>
          </div>
          <div className="checkout-gift__selection">
            <div><strong>{selectedGifts > 0 ? tr(`استخدام ${selectedGifts} كوب في هذا الطلب`, `Use ${selectedGifts} cups in this order`) : tr("كم كوب تبي تستخدم؟", "How many cups would you like?")}</strong><small>{tr("قهوة اليوم والمقطرة · حار أو بارد", "Daily coffee and V60 · Hot or iced")}</small></div>
            <button type="button" className="btn btn--secondary" onClick={() => setGiftOpen(true)} disabled={giftLimit === 0}>{selectedGifts > 0 ? tr("تعديل", "Edit") : tr("اختيار", "Choose")}</button>
          </div>
          {giftLimit === 0 && <p className="muted">{tr("أضف قهوة اليوم أو المقطرة لاستخدام هديتك", "Add daily coffee or V60 to use your gift")}</p>}
        </section>
      )}
      {account && (
        <section className={`sheet checkout-wallet ${props.compact ? "checkout-wallet--compact" : ""}`}>
          <label className="checkout-perk__row">
            <BenefitIcon kind="wallet" />
            <span className="checkout-perk__copy"><span>{tr("رصيد هولو", "HOLLOW balance")}</span><strong>{riyals(account.balance_halalas)}</strong><small>{account.balance_halalas === 0 ? tr("ما عندك رصيد حالياً", "No balance available yet") : tr("استخدام الرصيد", "Use balance")}</small></span>
            <input className="switch" type="checkbox" role="switch" aria-label={tr("استخدام رصيد هولو", "Use HOLLOW balance")} checked={props.useBalance} disabled={account.balance_halalas === 0} onChange={e => props.onBalanceChange(e.target.checked)} />
          </label>
        </section>
      )}
      <details ref={couponBox} className="sheet checkout-coupon">
        <summary><BenefitIcon kind="tag" /><span>{tr("عندك كود خصم؟", "Have a discount code?")}</span><span className="checkout-coupon__chevron" aria-hidden="true">⌄</span></summary>
        {!applied && <div ref={entry} className="coupon-entry field">
          <input type="text" disabled={props.couponChecking} aria-invalid={!!props.couponError} aria-describedby={props.couponError ? "checkout-coupon-error" : undefined} aria-label={tr("أدخل الكود", "Enter code")} placeholder={tr("أدخل الكود", "Enter code")} autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={40} value={props.couponInput} onChange={e => props.onCouponInputChange(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); if (props.couponInput.trim()) props.onApplyCoupon(); } }} />
          <button type="button" className="btn btn--primary" disabled={props.couponChecking || !props.couponInput.trim()} onClick={props.onApplyCoupon}>{props.couponChecking ? tr("جارٍ التحقق…", "Checking…") : tr("تطبيق", "Apply")}</button>
        </div>}
        {props.couponError && <div id="checkout-coupon-error"><Alert tone="error">{props.couponError}</Alert></div>}
        {applied && (
          <div ref={ticket} className="coupon-ticket" role="status">
            <span className="coupon-ticket__icon" aria-hidden="true">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
            </span>
            <span className="coupon-ticket__text">
              <b dir="ltr">{applied}</b>
              <small>{props.couponDiscount > 0 ? tr(`تم تطبيق الكود · − ${riyals(props.couponDiscount)}`, `Applied · − ${riyals(props.couponDiscount)}`) : tr("تم تطبيق الكود", "Code applied")}</small>
            </span>
            <button type="button" className="coupon-ticket__remove" aria-label={tr("إزالة الكود", "Remove code")} onClick={props.onRemoveCoupon}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
            </button>
          </div>
        )}
      </details>
      <Dialog open={giftOpen} dismissible title={tr("اختر عدد أكواب الضيافة", "Choose your gift cups")} onClose={() => setGiftOpen(false)} actions={<button type="button" className="btn btn--primary" autoFocus onClick={() => setGiftOpen(false)}>{tr("تم", "Done")}</button>}>
        <p>{tr(`تقدر تستخدم حتى ${giftLimit} كوب من طلبك الحالي`, `You can use up to ${giftLimit} cups in this order`)}</p>
        <div className="gift-quantity" dir="ltr">
          <button type="button" className="btn btn--secondary" aria-label={tr("تقليل الأكواب", "Fewer cups")} disabled={selectedGifts <= 0} onClick={() => props.onGiftsChange(Math.max(0, selectedGifts - 1))}>−</button>
          <output aria-live="polite">{selectedGifts}</output>
          <button type="button" className="btn btn--secondary" aria-label={tr("زيادة الأكواب", "More cups")} disabled={selectedGifts >= giftLimit} onClick={() => props.onGiftsChange(Math.min(giftLimit, selectedGifts + 1))}>+</button>
        </div>
      </Dialog>
    </>
  );
}
