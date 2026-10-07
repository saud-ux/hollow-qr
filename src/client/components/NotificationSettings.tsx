import { useEffect, useState } from "react";
import type { NotificationPrefs } from "../../shared/ordering";
import type { AppRole } from "../../shared/types";
import { apiGet, apiSend, errorText } from "../lib/api";
import { enablePush } from "../lib/native";
import { tr } from "../lib/i18n";

type Key = keyof NotificationPrefs;

/**
 * Push switches in the app's account settings. Offers are opt-in (App Store
 * guideline 4.5.4); staff and admins also choose their order alerts.
 */
export function NotificationSettings({ role }: { role: AppRole }) {
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    apiGet<{ prefs: NotificationPrefs }>("/api/me/notification-prefs")
      .then((r) => setPrefs(r.prefs))
      .catch(() => setPrefs(null));
  }, []);

  if (!prefs) return null;

  async function toggle(key: Key, on: boolean) {
    const before = prefs;
    setPrefs((p) => (p ? { ...p, [key]: on } : p));
    setError(null);
    try {
      const r = await apiSend<{ prefs: NotificationPrefs }>("PUT", "/api/me/notification-prefs", { [key]: on });
      setPrefs(r.prefs);
      // Turning one on is when asking iOS for permission makes sense.
      if (on) setBlocked(!(await enablePush().catch(() => false)));
    } catch (err) {
      setPrefs(before);
      setError(errorText(err));
    }
  }

  const rows: { key: Key; label: string; hint: string }[] = [
    { key: "offers", label: tr("العروض والجديد", "Offers & news"), hint: tr("نرسل لك إذا نزل عرض أو صنف جديد", "We'll tell you about offers and new items") },
  ];
  if (role === "staff" || role === "admin") {
    rows.push({ key: "newOrders", label: tr("تنبيه بكل طلب جديد", "New order alerts"), hint: tr("يرن جوالك مع كل طلب يوصل للكوفي", "Your phone rings for every new order") });
  }
  if (role === "admin") {
    rows.push({ key: "dailySummary", label: tr("ملخص اليوم", "Daily summary"), hint: tr("بعد الإغلاق: عدد الطلبات والمبيعات", "After closing: orders and sales") });
  }

  return (
    <>
      <div className="settings" role="group" aria-label={tr("الإشعارات", "Notifications")}>
        {rows.map((r) => (
          <label key={r.key} className="settings__row settings__row--switch">
            <span>
              {r.label}
              <small>{r.hint}</small>
            </span>
            <input type="checkbox" role="switch" className="switch" checked={prefs[r.key]} onChange={(e) => void toggle(r.key, e.target.checked)} />
          </label>
        ))}
      </div>
      {blocked && <p className="muted small">
          {tr("الإشعارات مقفلة لتطبيق HOLLOW. فعّلها من الإعدادات ← HOLLOW ← الإشعارات.", "Notifications are off for HOLLOW. Turn them on in Settings → HOLLOW → Notifications.")}
        </p>}
      {error && <p className="muted small">{error}</p>}
    </>
  );
}
