import { useState } from "react";
import { Alert } from "../../components/Field";
import { apiGet, errorText } from "../../lib/api";

interface CheckResult {
  enabled: boolean;
  ok?: boolean;
  error?: string;
  fallbackItemFound?: boolean;
  fallbackItemName?: string;
  unmatchedCount?: number;
  items?: { name: string; matched: boolean; options: { name: string; ownVariant: boolean }[] }[];
}

const ERRORS: Record<string, string> = {
  LOYVERSE_PAYMENT_TYPE_MISSING: "ما لقيت نوع الدفع «تطبيق» في Loyverse. أضفه من الإعدادات ← أنواع الدفع.",
  LOYVERSE_WALLET_PAYMENT_TYPE_MISSING: "ما لقيت نوع الدفع الخاص برصيد التطبيق في Loyverse.",
  LOYVERSE_NO_STORE: "حساب Loyverse ما فيه أي متجر.",
  LOYVERSE_SET_STORE_ID: "عندك أكثر من متجر في Loyverse: لازم نحدد المتجر (LOYVERSE_STORE_ID).",
  LOYVERSE_UNREACHABLE: "ما قدرنا نتصل بـ Loyverse. جرّب بعد شوي.",
  LOYVERSE_HTTP_401: "رمز الوصول غير صحيح أو محذوف. أنشئ رمز جديد من Loyverse.",
};

/** ربط الكاشير: shows whether completed orders can go to Loyverse, and which menu items match. */
export function LoyversePanel() {
  const [result, setResult] = useState<CheckResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function check() {
    setBusy(true);
    setError(null);
    try {
      setResult(await apiGet<CheckResult>("/api/admin/loyverse/check"));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const code = result?.error?.split(":")[0] ?? "";
  return (
    <section className="panel">
      <h2>ربط الكاشير (Loyverse)</h2>
      <p className="muted">
        لما تضغط «مكتمل» على الطلب، يروح للكاشير كإيصال بنوع الدفع «تطبيق». لا تدخل طلبات التطبيق يدوي في الكاشير عشان ما تنحسب مرتين.
      </p>
      <button type="button" className="btn btn--secondary" disabled={busy} onClick={() => void check()}>
        {busy ? "جارٍ الفحص…" : "فحص الربط"}
      </button>
      {error && <Alert tone="error">{error}</Alert>}
      {result && !result.enabled && <Alert tone="error">الربط مو مفعّل: رمز الوصول LOYVERSE_ACCESS_TOKEN مو مضاف في Cloudflare.</Alert>}
      {result?.enabled && result.ok === false && <Alert tone="error">{ERRORS[code] ?? `خطأ من Loyverse: ${result.error}`}</Alert>}
      {result?.ok && (
        <>
          {result.unmatchedCount === 0 ? (
            <Alert tone="success">الربط شغّال، وكل أصناف المنيو لها مقابل في Loyverse.</Alert>
          ) : (
            <Alert tone={result.fallbackItemFound ? "warning" : "error"}>
              {result.unmatchedCount} صنف ما له نفس الاسم في Loyverse.{" "}
              {result.fallbackItemFound
                ? `بتنسجل تحت «${result.fallbackItemName}» واسمها في الملاحظة.`
                : `أنشئ صنف «${result.fallbackItemName}» بسعر متغيّر في Loyverse، أو وحّد الأسماء، وإلا الطلب ما يوصل.`}
            </Alert>
          )}
          {!result.fallbackItemFound && result.unmatchedCount === 0 && (
            <p className="muted small">رسوم التوصيل تحتاج صنف «{result.fallbackItemName}» بسعر متغيّر في Loyverse.</p>
          )}
          <ul>
            {result.items?.map((item) => (
              <li key={item.name}>
                {item.matched ? "✅" : "⚠️"} {item.name}
                {item.matched && item.options.length > 0 && (
                  <span className="muted small">
                    {" "}— {item.options.map((o) => `${o.name}${o.ownVariant ? "" : " (في الملاحظة)"}`).join("، ")}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
