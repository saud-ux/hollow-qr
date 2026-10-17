import { Capacitor, registerPlugin } from "@capacitor/core";
import { useEffect, useState } from "react";
import { tr } from "../lib/i18n";

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

  return (
    <section className="acct-sec" aria-label={tr("اختبار القرب من هولو", "HOLLOW geofence test")}>
      <h2 className="acct-sec__title">{tr("اختبار القرب من هولو", "HOLLOW geofence test")}</h2>
      <p className="muted small">{tr(
        "اختبار اختياري على هذا الجهاز: إشعار عند دخول نطاق هولو أو مغادرته، حتى بالخلفية. لا يتم إرسال موقعك للخادم.",
        "Optional test on this device: alerts when entering or leaving HOLLOW, including in the background. Your location is not sent to the server.",
      )}</p>
      <p className="muted small">{status.radiusMeters} m · {tr("فاصل الإشعارات", "Notification cooldown")}: {status.cooldownSeconds} s</p>
      <p role="status" className="muted small">{status.monitoring && status.authorization === "always" && status.locationServices
        ? tr("مراقبة النطاق مفعلة", "Region monitoring active")
        : status.enabled ? tr("بانتظار إذن الموقع «دائمًا» وتفعيل خدمات الموقع", "Waiting for Always location permission and Location Services")
          : tr("الاختبار متوقف", "Test stopped")}</p>
      {status.enabled && status.authorization !== "always" && <p className="muted small">{tr(
        "اسمح بالموقع أثناء الاستخدام أولًا، ثم اضغط «السماح دائمًا». إذا لم يظهر الطلب، افتح إعدادات HOLLOW واختر الموقع ← دائمًا.",
        "Allow location while using first, then tap Allow Always. If no prompt appears, open HOLLOW settings and choose Location → Always.",
      )}</p>}
      {!status.notificationsAllowed && <p className="muted small">{tr("فعّل الإشعارات من إعدادات HOLLOW لاستلام التنبيهات.", "Enable notifications in HOLLOW settings to receive alerts.")}</p>}
      <div className="acct-hero__actions">
        <button type="button" className="btn btn--secondary btn--small" disabled={busy} onClick={() => void act(() => status.enabled ? Geofence.stop() : Geofence.start())}>
          {status.enabled ? tr("إيقاف الاختبار", "Stop test") : tr("تفعيل الاختبار", "Enable test")}
        </button>
        {status.enabled && status.authorization === "whenInUse" && <button type="button" className="btn btn--secondary btn--small" disabled={busy} onClick={() => void act(() => Geofence.start())}>{tr("السماح دائمًا", "Allow Always")}</button>}
        <button type="button" className="btn btn--ghost btn--small" disabled={busy} onClick={() => void act(() => Geofence.openSettings())}>{tr("إعدادات HOLLOW", "HOLLOW settings")}</button>
        <button type="button" className="btn btn--ghost btn--small" disabled={busy} onClick={() => void act(async () => {
          const result = await Geofence.testNotification();
          if (result.scheduled) setMessage(tr("تمت جدولة الإشعار؛ يفترض ظهوره خلال لحظة، حتى والتطبيق مفتوح. إذا لم يظهر، تحقق من التركيز وإعدادات عرض الإشعارات.", "Notification scheduled; it should appear shortly, including while the app is open. If absent, check Focus and notification presentation settings."));
        })}>{tr("إشعار تجريبي", "Test notification")}</button>
      </div>
      <p className="muted small">{tr("الإشعار التجريبي يعمل حتى والاختبار متوقف. تنبيه النطاق عند الدخول أو الخروج فقط، وليس كل ٣ ثوانٍ وأنت ثابت. دقة وتوقيت التنبيه تعتمد على iOS؛ اختبر والجهاز مقفل بعد تجاوز حدود النطاق.", "Manual notifications work even when monitoring is stopped. Region alerts occur on entry/exit, not every 3 seconds while stationary. iOS controls accuracy and timing; Test with the device locked after crossing the boundary.")}</p>
      {message && <p role="status" className="muted small">{message}</p>}
      {status.lastEvent && <p className="muted small" dir="ltr">{status.lastEvent}</p>}
      {(error || status.error) && <p role="alert" className="muted small">{error || status.error}</p>}
    </section>
  );
}
