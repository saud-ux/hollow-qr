import { useEffect, useState } from "react";
import type { NotificationPrefs } from "../../shared/ordering";
import type { AppRole } from "../../shared/types";
import { apiGet, apiSend, errorText } from "../lib/api";
import { isNative } from "../lib/native";
import { enableNotifications } from "../lib/notify";
import { prepareWebPush, turnOffWebPush, turnOnWebPush, webPushState, type WebPushState } from "../lib/webpush";
import { tr } from "../lib/i18n";
import { HomeScreenHint } from "./HomeScreenHint";
import { NearbyAlerts } from "./NearbyAlerts";

type Key = keyof NotificationPrefs;

/**
 * Push switches in the account settings. Offers are opt-in (App Store
 * guideline 4.5.4); staff and admins also choose their order alerts. On the
 * website, a first switch turns notifications on for this browser.
 */
export function NotificationSettings({ role }: { role: AppRole }) {
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [device, setDevice] = useState<WebPushState | null>(isNative ? null : "off");

  useEffect(() => {
    apiGet<{ prefs: NotificationPrefs }>("/api/me/notification-prefs")
      .then((r) => setPrefs(r.prefs))
      .catch(() => setPrefs(null));
  }, []);

  useEffect(() => {
    if (isNative) return;
    void webPushState().then((s) => {
      setDevice(s);
      if (s === "off") void prepareWebPush().catch(() => undefined);
    });
  }, []);

  if (!prefs) return null;

  async function toggle(key: Key, on: boolean) {
    // Turning one on is when asking for permission makes sense; it has to start inside the tap.
    const asking = on && device !== "on" ? enableNotifications() : null;
    const before = prefs;
    setPrefs((p) => (p ? { ...p, [key]: on } : p));
    setError(null);
    try {
      const r = await apiSend<{ prefs: NotificationPrefs }>("PUT", "/api/me/notification-prefs", { [key]: on });
      setPrefs(r.prefs);
      if (asking) {
        const ok = await asking;
        if (isNative) setBlocked(!ok);
        else setDevice(await webPushState());
      }
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
      {!isNative && device && <BrowserRow state={device} onChange={setDevice} />}
      <div className="settings" role="group" aria-label={tr("الإشعارات", "Notifications")}>
        {rows.map((r) => (
          <label key={r.key} className="settings__row settings__row--switch">
            <span>
              {r.label}
              <small>{r.hint}</small>
            </span>
            <input
              type="checkbox"
              role="switch"
              className="switch"
              checked={prefs[r.key]}
              onChange={(e) => void toggle(r.key, e.target.checked)}
            />
          </label>
        ))}
      </div>
      <NearbyAlerts />
      {blocked && <p className="muted small">
          {tr("الإشعارات مقفلة لتطبيق HOLLOW. فعّلها من الإعدادات ← HOLLOW ← الإشعارات.", "Notifications are off for HOLLOW. Turn them on in Settings → HOLLOW → Notifications.")}
        </p>}
      {error && <p className="muted small">{error}</p>}
    </>
  );
}

/** Website: notifications on this browser (order updates, and offers if chosen above). */
function BrowserRow({ state, onChange }: { state: WebPushState; onChange: (s: WebPushState) => void }) {
  const [hint, setHint] = useState(false);
  const [busy, setBusy] = useState(false);

  if (state === "unsupported") {
    return <p className="muted small">{tr("متصفحك ما يدعم الإشعارات. جرّب كروم أو سفاري.", "This browser doesn't support notifications. Try Chrome or Safari.")}</p>;
  }
  if (state === "home-screen") {
    return (
      <div className="settings">
        <div className="settings__row settings__row--switch">
          <span>
            {tr("إشعارات حالة الطلب", "Order updates")}
            <small>{tr("على الآيفون تشتغل بعد ما تضيف HOLLOW للشاشة الرئيسية.", "On iPhone they work once HOLLOW is on your Home Screen.")}</small>
          </span>
          <button type="button" className="btn btn--secondary btn--small" onClick={() => setHint(true)}>
            {tr("كيف؟", "How?")}
          </button>
        </div>
        <HomeScreenHint open={hint} onClose={() => setHint(false)} />
      </div>
    );
  }

  function flip(on: boolean) {
    setBusy(true);
    const done = on ? turnOnWebPush() : turnOffWebPush().then(() => "off" as const);
    void done.then(onChange).finally(() => setBusy(false));
  }

  return (
    <>
      <div className="settings">
        <label className="settings__row settings__row--switch">
          <span>
            {tr("إشعارات حالة الطلب", "Order updates")}
            <small>{tr("على هذا الجهاز: نعلمك أول ما يجهز طلبك", "On this device: we'll tell you when your order is ready")}</small>
          </span>
          <input type="checkbox" role="switch" className="switch" checked={state === "on"} disabled={busy || state === "blocked"} onChange={(e) => flip(e.target.checked)} />
        </label>
      </div>
      {state === "blocked" && (
        <p className="muted small">
          {tr("المتصفح قفل الإشعارات لهذا الموقع. فعّلها من إعدادات المتصفح، وبعدها ارجع هنا.", "Your browser blocked notifications for this site. Allow them in its settings, then come back here.")}
        </p>
      )}
    </>
  );
}
