import { useState } from "react";
import type { MenuResponse } from "../../../shared/ordering";
import { useBenefits, benefitCall } from "../../lib/benefits";
import { riyals, useMenu } from "../../lib/menu";
import { errorText } from "../../lib/api";
import { newIdempotencyKey } from "../../lib/hooks";
import { Alert } from "../../components/Field";

export function CustomerBenefitsPanel({
  accountId,
  isAdmin,
}: {
  accountId: string;
  isAdmin: boolean;
}) {
  const [version, setVersion] = useState(0);
  const { account, error: loadError } = useBenefits(true, accountId, version);
  const { menu } = useMenu();
  const [mode, setMode] = useState("spend");
  const [money, setMoney] = useState("");
  const [cups, setCups] = useState(0);
  const [reason, setReason] = useState("");
  const [item, setItem] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  // Keep the same key if a response is lost; retries cannot double-debit.
  const [attempt, setAttempt] = useState<{
    signature: string;
    key: string;
  } | null>(null);
  async function submit() {
    if (busy) return;
    const amountHalalas = Math.round(Number(money || 0) * 100);
    const payload = {
      accountId,
      amountHalalas,
      cups,
      reason: reason.trim(),
      menuItemId: item || undefined,
    };
    const signature = JSON.stringify({ mode, payload });
    const key =
      attempt?.signature === signature ? attempt.key : newIdempotencyKey();
    setAttempt({ signature, key });
    setBusy(true);
    setError(null);
    setOk(false);
    try {
      await benefitCall(mode, { ...payload, idempotencyKey: key });
      setVersion((v) => v + 1);
      setMoney("");
      setCups(0);
      setReason("");
      setAttempt(null);
      setOk(true);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  const coffees: MenuResponse["items"] =
    menu?.items.filter((i) => account?.gift_item_ids.includes(i.id)) ?? [];
  return (
    <section className="panel">
      <h2>رصيد العميل وأكواب الضيافة</h2>
      {loadError && <Alert tone="error">{loadError}</Alert>}
      {account && (
        <>
          <div className="benefits-row">
            <strong>الرصيد: {riyals(account.balance_halalas)}</strong>
            <strong>أكواب الضيافة: {account.gift_cups}</strong>
          </div>
          {isAdmin && (
            <label className="field">
              نوع العملية
              <select value={mode} onChange={(e) => setMode(e.target.value)}>
                <option value="spend">استخدام عند الكاشير</option>
                <option value="adjust">إضافة / تعويض / تصحيح (مدير)</option>
              </select>
            </label>
          )}
          <div className="form">
            <label className="field">
              المبلغ بالريال{mode === "adjust" ? " (السالب للتصحيح)" : ""}
              <input
                type="number"
                min={mode === "spend" ? 0 : undefined}
                max="1000000"
                step="0.01"
                value={money}
                onChange={(e) => setMoney(e.target.value)}
              />
            </label>
            <label className="field">
              عدد أكواب الضيافة{mode === "adjust" ? " (السالب للتصحيح)" : ""}
              <input
                type="number"
                min={mode === "spend" ? 0 : undefined}
                max="10000"
                step="1"
                value={cups}
                onChange={(e) => setCups(Number(e.target.value))}
              />
            </label>
            {mode === "spend" && cups > 0 && (
              <label className="field">
                القهوة المشمولة
                <select value={item} onChange={(e) => setItem(e.target.value)}>
                  <option value="">اختر القهوة</option>
                  {coffees.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.nameAr}
                    </option>
                  ))}
                </select>
                <small>
                  العدد يخص هذا النوع. لأنواع مختلفة سجّل كل نوع بعملية مستقلة.
                </small>
              </label>
            )}
            <label className="field">
              السبب / مرجع الفاتورة
              <input
                value={reason}
                maxLength={300}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <button
              type="button"
              className="btn btn--primary"
              disabled={
                busy ||
                !reason.trim() ||
                (!Number(money) && !cups) ||
                (mode === "spend" && cups > 0 && !item)
              }
              onClick={() => void submit()}
            >
              {busy
                ? "جارٍ الحفظ…"
                : mode === "spend"
                  ? "تأكيد الاستخدام"
                  : "حفظ الإضافة أو التصحيح"}
            </button>
          </div>
          {ok && <Alert tone="success">تم تسجيل العملية</Alert>}
          {error && <Alert tone="error">{error}</Alert>}
          <details>
            <summary>سجل الرصيد والأكواب</summary>
            <ul className="benefits-history">
              {account.movements.map((m) => (
                <li key={m.id}>
                  <span>
                    {m.reason}
                    {m.actor_name ? ` · ${m.actor_name}` : ""}
                  </span>
                  <small>
                    {new Date(m.created_at).toLocaleString("ar-SA")}
                  </small>
                  <span>
                    {riyals(m.amount_halalas)} · {m.cups} كوب
                  </span>
                </li>
              ))}
            </ul>
          </details>
        </>
      )}
    </section>
  );
}
