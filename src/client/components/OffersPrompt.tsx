import { useEffect, useState } from "react";
import type { NotificationPrefs } from "../../shared/ordering";
import { apiGet, apiSend } from "../lib/api";
import { tr } from "../lib/i18n";
import { enablePush, isNative } from "../lib/native";

const ASKED_KEY = "hollow.offers.asked";

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
 * After an order, the app asks once whether the customer wants offers.
 * Offers stay opt-in (App Store guideline 4.5.4): nothing is sent unless they
 * tap yes, and My card keeps the switch to change it later.
 */
export function OffersPrompt() {
  const [show, setShow] = useState(false);
  const [done, setDone] = useState<"yes" | "no" | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isNative || wasAsked()) return;
    let alive = true;
    apiGet<{ prefs: NotificationPrefs }>("/api/me/notification-prefs")
      .then(({ prefs }) => {
        if (!alive) return;
        if (prefs.offers) markAsked();
        else setShow(true);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  if (!show) return null;

  async function answer(yes: boolean) {
    markAsked();
    if (!yes) {
      setDone("no");
      return;
    }
    setBusy(true);
    try {
      await apiSend("PUT", "/api/me/notification-prefs", { offers: true });
      await enablePush().catch(() => false);
      setDone("yes");
    } catch {
      setDone("no");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <p className="offers-prompt__done muted small center" role="status">
        {done === "yes"
          ? tr("تم! بنرسل لك أول ما ينزل عرض.", "Done! We'll let you know when there's an offer.")
          : tr("تمام. تقدر تفعّلها متى ما بغيت من «حسابي».", "No problem. You can turn them on anytime under Account.")}
      </p>
    );
  }

  return (
    <section className="sheet offers-prompt" aria-labelledby="offers-prompt-title">
      <span className="offers-prompt__icon" aria-hidden="true">
        🎁
      </span>
      <div className="offers-prompt__text">
        <h2 id="offers-prompt-title">{tr("تبي يوصلك إشعار بالعروض؟", "Want to hear about offers?")}</h2>
        <p>{tr("نرسل لك إذا نزل عرض أو صنف جديد.", "We'll tell you about offers and new items.")}</p>
      </div>
      <div className="offers-prompt__actions">
        <button type="button" className="btn btn--primary btn--small" onClick={() => void answer(true)} disabled={busy}>
          {tr("نعم، أبي", "Yes, please")}
        </button>
        <button type="button" className="btn btn--ghost btn--small" onClick={() => void answer(false)} disabled={busy}>
          {tr("لا، شكرًا", "No, thanks")}
        </button>
      </div>
    </section>
  );
}
