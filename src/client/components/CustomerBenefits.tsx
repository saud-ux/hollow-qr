import { useEffect, useState } from "react";
import { Link } from "react-router";
import { apiGet, apiPost, errorText } from "../lib/api";
import { newIdempotencyKey } from "../lib/hooks";
import { useBenefits } from "../lib/benefits";
import { riyals } from "../lib/menu";
import { tr } from "../lib/i18n";
import { Dialog } from "./Dialog";
import { Alert } from "./Field";

export function CustomerBenefits() {
  const [version, setVersion] = useState(0);
  const { account, error } = useBenefits(true, undefined, version);
  const [ready, setReady] = useState(false);
  const [payBusy, setPayBusy] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState<{ amount: number; id: string } | null>(
    null,
  );
  useEffect(() => {
    void apiGet<{ ready: boolean }>("/api/topups/config")
      .then((c) => setReady(c.ready))
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    const id =
      new URLSearchParams(window.location.search).get("topup") ??
      localStorage.getItem("hollow.pendingTopup");
    if (!id) return;
    const verify = () => {
      void apiPost<{ credited: boolean }>(
        `/api/topups/${encodeURIComponent(id)}/verify`,
      )
        .then((r) => {
          if (r.credited) {
            localStorage.removeItem("hollow.pendingTopup");
            setVersion((v) => v + 1);
          }
        })
        .catch(() => undefined);
    };
    verify();
    window.addEventListener("focus", verify);
    document.addEventListener("visibilitychange", verify);
    return () => {
      window.removeEventListener("focus", verify);
      document.removeEventListener("visibilitychange", verify);
    };
  }, []);
  async function pay() {
    const halalas = Math.round(Number(amount) * 100);
    if (
      !ready ||
      payBusy ||
      !Number.isFinite(halalas) ||
      halalas < 100 ||
      halalas > 1000000
    )
      return;
    const id = attempt?.amount === halalas ? attempt.id : newIdempotencyKey();
    setAttempt({ amount: halalas, id });
    setPayBusy(true);
    setPayError(null);
    try {
      const r = await apiPost<{ id: string; url: string }>("/api/topups", {
        id,
        amountHalalas: halalas,
      });
      localStorage.setItem("hollow.pendingTopup", r.id);
      window.location.assign(r.url);
    } catch (e) {
      setPayError(errorText(e));
      setPayBusy(false);
    }
  }

  const [history, setHistory] = useState(false);
  const [topup, setTopup] = useState(false);
  const [amount, setAmount] = useState("50");
  if (error) return <Alert tone="error">{error}</Alert>;
  if (!account) return null;
  return (
    <>
      <section className="sheet benefits-account">
        <div className="benefits-row">
          <div>
            <span className="pass-label">{tr("رصيدي", "My balance")}</span>
            <h2>{riyals(account.balance_halalas)}</h2>
          </div>
          <button className="btn btn--secondary" onClick={() => setTopup(true)}>
            {tr("إضافة رصيد", "Add balance")}
          </button>
        </div>
        <button className="btn btn--ghost" onClick={() => setHistory(true)}>
          {tr("سجل العمليات", "Transaction history")}
        </button>
      </section>
      {account.gift_cups > 0 && (
        <section className="sheet benefits-gift">
          <div className="benefits-row">
            <div>
              <h2>{tr("لك أكواب ضيافة من هولو", "Coffee on HOLLOW")}</h2>
              <p>
                {tr(
                  `المتبقي ${account.gift_cups} كوب · قهوة اليوم أو المقطرة، حارة أو باردة`,
                  `${account.gift_cups} cups left · Daily coffee or V60, hot or iced`,
                )}
              </p>
            </div>
            <Link className="btn btn--secondary" to="/menu">
              {tr("اطلب بهديتك", "Use gift")}
            </Link>
          </div>
        </section>
      )}
      <Dialog
        open={history}
        title={tr("سجل الرصيد والأكواب", "Balance and gift history")}
        onClose={() => setHistory(false)}
      >
        {account.movements.length === 0 ? (
          <p>{tr("لا توجد عمليات بعد", "No transactions yet")}</p>
        ) : (
          <ul className="benefits-history">
            {account.movements.map((m) => (
              <li key={m.id}>
                <span>{m.reason}</span>
                <small>{new Date(m.created_at).toLocaleString()}</small>
                {m.amount_halalas !== 0 && (
                  <strong dir="ltr">
                    {m.amount_halalas > 0 ? "+" : ""}
                    {riyals(m.amount_halalas)}
                  </strong>
                )}
                {m.cups !== 0 && (
                  <span>
                    {tr(
                      `${m.cups > 0 ? "+" : ""}${m.cups} كوب`,
                      `${m.cups > 0 ? "+" : ""}${m.cups} cups`,
                    )}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Dialog>
      <Dialog
        open={topup}
        title={tr("إضافة رصيد", "Add balance")}
        onClose={() => setTopup(false)}
      >
        <div className="benefits-presets">
          {[20, 50, 100].map((n) => (
            <button
              key={n}
              className={`btn ${amount === String(n) ? "btn--primary" : "btn--secondary"}`}
              onClick={() => setAmount(String(n))}
            >
              {riyals(n * 100)}
            </button>
          ))}
          <button className="btn btn--ghost" onClick={() => setAmount("")}>
            {tr("مبلغ آخر", "Other amount")}
          </button>
        </div>
        <label className="field">
          {tr("المبلغ بالريال", "Amount in SAR")}
          <input
            type="number"
            min="1"
            max="10000"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
        <p className="muted">
          {ready
            ? tr(
                "تُضاف القيمة بعد تأكيد الدفع عبر ميسر.",
                "Balance is added after Moyasar confirms payment.",
              )
            : tr(
                "شحن الرصيد عبر ميسر سيتاح بعد تفعيل الدفع الإلكتروني.",
                "Top-ups through Moyasar will be available once online payments are activated.",
              )}
        </p>
        {payError && <Alert tone="error">{payError}</Alert>}
        <button
          className="btn btn--primary"
          disabled={
            !ready || payBusy || Number(amount) < 1 || Number(amount) > 10000
          }
          onClick={() => void pay()}
        >
          {ready
            ? tr("الدفع عبر ميسر", "Pay with Moyasar")
            : tr("الدفع الإلكتروني قريبًا", "Online payment coming soon")}
        </button>
      </Dialog>
    </>
  );
}
