import { useEffect, useState } from "react";
import { Nearby, nearbyAvailable, type NearbyStatus } from "../lib/geofence";
import { tr } from "../lib/i18n";

/**
 * Notifications → Nearby alerts (iOS app only): one switch. Turning it on asks
 * for notifications and for location "Always"; until both are allowed, a line
 * under it says what's missing and opens the app's page in Settings.
 */
export function NearbyAlerts() {
  const [status, setStatus] = useState<NearbyStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!nearbyAvailable) return;
    let alive = true;
    // Permissions change in system dialogs and in Settings, so the status is read again while the page shows.
    const refresh = () =>
      void Nearby.getStatus()
        .then((s) => alive && setStatus(s))
        .catch(() => undefined);
    refresh();
    const timer = window.setInterval(refresh, 3000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      alive = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);

  if (!nearbyAvailable || !status) return null;

  async function act(action: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await action();
      setStatus(await Nearby.getStatus());
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("ما قدرنا نغيّر تنبيهات القرب. جرّب مرة ثانية.", "Couldn't change nearby alerts. Try again."));
    } finally {
      setBusy(false);
    }
  }

  const missing = !status.enabled
    ? null
    : !status.locationServices
      ? "services"
      : status.authorization === "whenInUse"
        ? "always"
        : status.authorization !== "always"
          ? "location"
          : !status.notificationsAllowed
            ? "notifications"
            : null;

  return (
    <>
      <div className="settings">
        <label className="settings__row settings__row--switch">
          <span>
            {tr("تنبيهات القرب", "Nearby alerts")}
            <small>{tr("ننبهك لما تكون قريب من هولو وهو فاتح، مرة كل ١٢ ساعة بالكثير. يحتاج الموقع (دائمًا)", "When you're near HOLLOW while it's open, at most once every 12 hours. Needs location (Always)")}</small>
          </span>
          <input
            type="checkbox"
            role="switch"
            className="switch"
            checked={status.enabled}
            disabled={busy}
            onChange={(e) => void act(() => (e.target.checked ? Nearby.start() : Nearby.stop()))}
          />
        </label>
      </div>
      {missing && (
        <div className="nearby-step" role="status">
          <p>
            {missing === "always"
              ? tr("باقي خطوة: اختر «دائمًا» من الإعدادات ← HOLLOW ← الموقع، عشان يعرف جوالك إنك قريب وهو في جيبك.", "One more step: choose Always in Settings → HOLLOW → Location, so your phone knows you're near even in your pocket.")
              : missing === "services"
                ? tr("خدمات الموقع مقفلة في جوالك. فعّلها من الإعدادات ← الخصوصية والأمن.", "Location Services are off on your phone. Turn them on in Settings → Privacy & Security.")
                : missing === "location"
                  ? tr("الموقع مقفل لتطبيق هولو. اسمح فيه «دائمًا» من الإعدادات ← HOLLOW ← الموقع.", "Location is off for HOLLOW. Allow it Always in Settings → HOLLOW → Location.")
                  : tr("الإشعارات مقفلة لتطبيق هولو. فعّلها من الإعدادات ← HOLLOW ← الإشعارات.", "Notifications are off for HOLLOW. Turn them on in Settings → HOLLOW → Notifications.")}
          </p>
          {/* Straight to Settings: iOS asks for Always only once, so asking again would do nothing. */}
          <button type="button" className="btn btn--secondary btn--small" disabled={busy} onClick={() => void act(() => Nearby.openSettings())}>
            {tr("فتح الإعدادات", "Open Settings")}
          </button>
        </div>
      )}
      {(error || (status.enabled && status.error)) && <p className="muted small">{error || status.error}</p>}
    </>
  );
}
