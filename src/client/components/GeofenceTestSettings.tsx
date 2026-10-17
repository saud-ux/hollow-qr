import { Capacitor, registerPlugin } from "@capacitor/core";
import { useEffect, useState } from "react";
import { tr } from "../lib/i18n";
import { AccountIcon } from "./AccountIcons";
import "./GeofenceTestSettings.css";

interface GeofenceStatus {
  testMode: boolean;
  enabled: boolean;
  authorization: string;
  locationServices: boolean;
  notificationsAllowed: boolean;
  monitoring: boolean;
  radiusMeters: number;
  cooldownSeconds: number;
  lastEvent: string;
  error: string;
}
interface GeofencePlugin {
  getStatus(): Promise<GeofenceStatus>;
  start(): Promise<GeofenceStatus>;
  stop(): Promise<GeofenceStatus>;
  testNotification(): Promise<{ scheduled: boolean }>;
  openSettings(): Promise<{ opened: boolean }>;
}
const Geofence = registerPlugin<GeofencePlugin>("HollowGeofence");
const available = Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios" && Capacitor.isPluginAvailable("HollowGeofence");

/** Explicit device opt-in; never invokes a native plugin from the website. */
export function GeofenceTestSettings() {
  const [status, setStatus] = useState<GeofenceStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!available) return;
    let alive = true;
    const refresh = () => void Geofence.getStatus().then((s) => { if (alive) setStatus(s); }).catch(() => {
      if (alive) setError(tr("تعذر قراءة حالة اختبار الموقع", "Unable to read geofence status"));
    });
    refresh();
    const timer = window.setInterval(refresh, 3000);
    window.addEventListener("focus", refresh);
    return () => { alive = false; window.clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, []);

  if (!available || !status?.testMode) return null;

  async function act(action: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await action();
      setStatus(await Geofence.getStatus());
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("تعذر تنفيذ اختبار الموقع. تحقق من الأذونات.", "Geofence action failed. Check permissions."));
    } finally {
      setBusy(false);
    }
  }

  const active = status.monitoring && status.authorization === "always" && status.locationServices;
  const needsPermission = status.enabled && !active;
  const number = (value: number) => new Intl.NumberFormat(tr("ar-SA", "en-US")).format(value);

  return (
    <section className="geofence-card" aria-labelledby="geofence-title" aria-busy={busy}>
      <div className="geofence-card__header">
        <div className="geofence-card__identity">
          <span className="geofence-card__pin"><AccountIcon name="pin" /></span>
          <div>
            <span className="geofence-card__badge">{tr("تجريبي", "Test mode")}</span>
            <h2 id="geofence-title">{tr("تنبيهات القرب", "Nearby alerts")}</h2>
          </div>
        </div>
        <input
          type="checkbox"
          role="switch"
          className="switch geofence-card__switch"
          aria-label={tr("تفعيل تنبيهات القرب", "Enable nearby alerts")}
          checked={status.enabled}
          disabled={busy}
          onChange={() => void act(() => status.enabled ? Geofence.stop() : Geofence.start())}
        />
      </div>
      <p className="geofence-card__intro">{tr("ننبّهك إذا صرت قريب من هولو", "A little reminder when you're near HOLLOW")}</p>
      <p className={`geofence-card__state ${active ? "is-active" : ""}`} role="status">
        <span aria-hidden="true" />
        {active ? tr("تنبيهات القرب مفعّلة", "Nearby alerts active")
          : needsPermission ? tr("باقي خطوة: السماح بالموقع دائمًا", "One more step: allow Always location")
            : tr("غير مفعّل", "Not enabled")}
      </p>

      <div className="geofence-card__metrics">
        <div className="geofence-card__metric">
          <GeofenceIcon kind="range" />
          <div><strong>{number(status.radiusMeters)} {tr("متر", "m")}</strong><span>{tr("نطاق القرب", "Nearby radius")}</span></div>
        </div>
        <div className="geofence-card__metric">
          <GeofenceIcon kind="clock" />
          <div><strong>{number(status.cooldownSeconds)} {tr("ثوانٍ", "sec")}</strong><span>{tr("بين الإشعارات", "Between alerts")}</span></div>
        </div>
      </div>

      {needsPermission && <div className="geofence-card__notice">
        <p>{tr("اسمح بالموقع «دائمًا» وفعّل خدمات الموقع لإكمال التفعيل.", "Allow Always location and turn on Location Services to finish setup.")}</p>
        {status.authorization === "whenInUse" && <button type="button" disabled={busy} onClick={() => void act(() => Geofence.start())}>
          {tr("السماح دائمًا", "Allow Always")}
        </button>}
      </div>}
      {!status.notificationsAllowed && <p className="geofence-card__notice">{tr("اسمح بالإشعارات عند التجربة أو من إعدادات HOLLOW.", "Allow notifications when testing or in HOLLOW settings.")}</p>}

      <button type="button" className="geofence-card__test" disabled={busy} onClick={() => void act(async () => {
        const result = await Geofence.testNotification();
        if (result.scheduled) setMessage(tr("تمت جدولة الإشعار. بيظهر خلال لحظة.", "Notification scheduled. It should appear shortly."));
      })}>
        <GeofenceIcon kind="send" />
        {busy ? tr("لحظة…", "One moment…") : tr("إرسال إشعار تجريبي", "Send a test notification")}
      </button>
      {message && <p role="status" className="geofence-card__feedback">{message}</p>}
      {(error || status.error) && <p role="alert" className="geofence-card__feedback geofence-card__feedback--error">{error || status.error}</p>}

      <button type="button" className="geofence-card__settings" disabled={busy} onClick={() => void act(() => Geofence.openSettings())}>
        <GeofenceIcon kind="settings" />{tr("الأذونات والإعدادات", "Permissions & settings")}
      </button>
      <details className="geofence-card__details">
        <summary>{tr("تفاصيل الاختبار", "Test details")}</summary>
        <p>{tr("التجربة اختيارية على هذا الجهاز، ولا نرسل موقعك للخادم. الإشعار التجريبي يعمل حتى لو تنبيهات القرب متوقفة.", "This test is optional and stays on your device. Your location is not sent to the server. Manual notifications also work when nearby alerts are off.")}</p>
        <p>{tr("تنبيه الموقع عند دخول النطاق فقط، ولا نرسل إشعارًا عند المغادرة. الفاصل يمنع تكرار التنبيهات بسرعة؛ ما يعني إرسال إشعار كل ٣ ثوانٍ وأنت ثابت. دقة وتوقيت التنبيه تعتمد على iOS.", "Location alerts occur on entry only; no notification is sent on exit. The cooldown limits frequent alerts; it does not repeat notifications every 3 seconds while stationary. iOS controls accuracy and timing.")}</p>
        <p>{tr("للتجربة: اسمح بالموقع أثناء الاستخدام، ثم اختر دائمًا. فعّل الموقع الدقيق واختبر الدخول والخروج والجهاز مقفل. إذا ما ظهر الإشعار، تحقق من التركيز وإعدادات عرض الإشعارات.", "To test: allow While Using, then Always location. Enable Precise Location and cross the boundary with the device locked. If an alert is missing, check Focus and notification presentation settings.")}</p>
        {status.lastEvent && <p dir="ltr">{status.lastEvent}</p>}
      </details>
    </section>
  );
}

function GeofenceIcon({ kind }: { kind: "range" | "clock" | "send" | "settings" }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {kind === "range" && <path d="m21 3-6.5 18-3.3-8.2L3 9.5 21 3Z" />}
      {kind === "clock" && <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>}
      {kind === "send" && <><path d="m22 2-7 20-4-9-9-4L22 2Z" /><path d="m22 2-11 11" /></>}
      {kind === "settings" && <><path d="m10 3-.6 2.2-2 .9-2-.6-2 3.5 1.6 1.6v2.8L3.4 15l2 3.5 2-.6 2 .9.6 2.2h4l.6-2.2 2-.9 2 .6 2-3.5-1.6-1.6v-2.8L20.6 9l-2-3.5-2 .6-2-.9L14 3h-4Z" /><circle cx="12" cy="12" r="3" /></>}
    </svg>
  );
}
