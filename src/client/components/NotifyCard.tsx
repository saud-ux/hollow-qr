import { useEffect, useState } from "react";
import { tr } from "../lib/i18n";
import { homeScreenHintSeen } from "../lib/pwa";
import { prepareWebPush, turnOnWebPush, webPushState, type WebPushState } from "../lib/webpush";
import { HomeScreenHint } from "./HomeScreenHint";

const ASKED_KEY = "hollow.webpush.asked";

function wasAsked(): boolean {
  try {
    return localStorage.getItem(ASKED_KEY) === "1";
  } catch {
    return true;
  }
}

function markAsked() {
  try {
    localStorage.setItem(ASKED_KEY, "1");
  } catch {
    // storage blocked: the card may show again, which is harmless
  }
}

/**
 * Website: after placing an order, offer to notify the customer as it moves
 * on (the app asks iOS at checkout instead). Browsers only allow the prompt
 * from a tap, hence the button. On an iPhone not yet added to the home
 * screen, the button explains how, once.
 */
export function NotifyCard() {
  const [state, setState] = useState<WebPushState | null>(null);
  const [result, setResult] = useState<"on" | "blocked" | "no" | null>(null);
  const [hint, setHint] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (wasAsked()) return;
    let alive = true;
    void webPushState().then((s) => {
      if (!alive) return;
      if (s === "home-screen" && homeScreenHintSeen()) return;
      setState(s);
      // Ready the subscription now, so the tap can ask straight away.
      if (s === "off") void prepareWebPush().catch(() => undefined);
    });
    return () => {
      alive = false;
    };
  }, []);

  if (result) {
    return (
      <p className="offers-prompt__done muted small center" role="status">
        {result === "on" && tr("تم! بنعلمك أول ما يجهز طلبك.", "Done! We'll let you know as soon as it's ready.")}
        {result === "blocked" &&
          tr("المتصفح قفل الإشعارات لهذا الموقع. تقدر تفعّلها من إعدادات المتصفح.", "Your browser blocked notifications for this site. You can allow them in its settings.")}
        {result === "no" && tr("تمام. تقدر تفعّلها متى ما بغيت من «حسابي».", "No problem. You can turn them on anytime under Account.")}
      </p>
    );
  }
  if (state !== "off" && state !== "home-screen") return null;

  function yes() {
    markAsked();
    if (state === "home-screen") {
      setHint(true);
      return;
    }
    setBusy(true);
    void turnOnWebPush()
      .then((s) => setResult(s === "on" ? "on" : s === "blocked" ? "blocked" : "no"))
      .finally(() => setBusy(false));
  }

  function no() {
    markAsked();
    setResult("no");
  }

  return (
    <>
      <section className="sheet offers-prompt" aria-labelledby="notify-card-title">
        <span className="offers-prompt__icon" aria-hidden="true">
          🔔
        </span>
        <div className="offers-prompt__text">
          <h2 id="notify-card-title">{tr("تبينا نعلمك أول ما يجهز؟", "Want a heads-up when it's ready?")}</h2>
          <p>{tr("نرسل لك إشعار مع كل تحديث على طلبك.", "We'll notify you each time your order moves on.")}</p>
        </div>
        <div className="offers-prompt__actions">
          <button type="button" className="btn btn--primary btn--small" onClick={yes} disabled={busy}>
            {tr("فعّل الإشعارات", "Turn on notifications")}
          </button>
          <button type="button" className="btn btn--ghost btn--small" onClick={no} disabled={busy}>
            {tr("لا، شكرًا", "No, thanks")}
          </button>
        </div>
      </section>
      <HomeScreenHint
        open={hint}
        onClose={() => {
          setHint(false);
          setState(null);
        }}
      />
    </>
  );
}
