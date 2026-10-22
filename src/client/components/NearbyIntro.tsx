import { useEffect, useState } from "react";
import { useLocation } from "react-router";
import { Nearby, nearbyAvailable } from "../lib/geofence";
import { tr } from "../lib/i18n";
import { Dialog } from "./Dialog";

const ASKED_KEY = "hollow.nearby.introduced";

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
    // storage blocked: the message may show again, which is harmless
  }
}

/** A circle round HOLLOW on a little map, and the alert it sends. */
function NearbyPreview() {
  return (
    <div className="nearby-preview" aria-hidden="true">
      <svg viewBox="0 0 360 190" preserveAspectRatio="xMidYMid slice">
        <rect width="360" height="190" fill="#efe5d3" />
        <g stroke="#e3d5bd" strokeWidth="14" strokeLinecap="round" fill="none">
          <path d="M-10 60 L380 40M60 -10 L110 200M250 -10 L230 200M-10 150 L380 175" />
        </g>
        <g stroke="#f7f0e4" strokeWidth="2" strokeDasharray="6 7" fill="none">
          <path d="M-10 60 L380 40M-10 150 L380 175" />
        </g>
        <circle cx="180" cy="70" r="64" fill="rgb(201 162 39 / 13%)" stroke="#c9a227" strokeWidth="2" strokeDasharray="5 6" />
        <circle cx="180" cy="70" r="36" fill="rgb(201 162 39 / 12%)" />
        <path transform="translate(180 70)" d="M0 18 C-14 4 -18 -4 -18 -12 a18 18 0 0 1 36 0 c0 8 -4 16 -18 30Z" fill="#2b1e16" />
        <circle cx="180" cy="58" r="10" fill="#c9a227" />
        <circle cx="262" cy="40" r="11" fill="#fff" stroke="#2b1e16" strokeWidth="2" />
        <circle cx="262" cy="40" r="4.5" fill="#2b1e16" />
      </svg>
      <div className="nearby-preview__alert">
        <img src="/brand/icon-192.png" alt="" />
        <div>
          <b>{tr("تعديل مزاج💆🏻‍♂️✨", "Mood reset 💆🏻‍♂️✨")}</b>
          <span>{tr("بين المشاوير، خذ لك كوب قهوة رايق يخفف عليك.", "Between errands, grab a smooth cup of coffee and take a breather.")}</span>
        </div>
        <small>{tr("الآن", "now")}</small>
      </div>
    </div>
  );
}

/**
 * The iOS app tells each phone about nearby alerts once, on the menu, a moment
 * after it opens. Nothing changes unless the customer turns them on here or
 * under Account → Notifications.
 */
export function NearbyIntro() {
  const { pathname } = useLocation();
  const onMenu = pathname === "/menu" || pathname.startsWith("/menu/");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!nearbyAvailable || !onMenu || wasAsked()) return;
    let alive = true;
    const timer = window.setTimeout(() => {
      Nearby.getStatus()
        .then((s) => {
          if (!alive) return;
          if (s.enabled) markAsked();
          else setOpen(true);
        })
        .catch(() => undefined);
    }, 1200);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [onMenu]);

  function close() {
    markAsked();
    setOpen(false);
  }

  async function turnOn() {
    markAsked();
    setBusy(true);
    try {
      // Asks for notifications and location; the plugin asks for "Always" right after.
      await Nearby.start();
    } catch {
      // A refused permission shows under the switch in Notifications.
    } finally {
      setBusy(false);
      setOpen(false);
    }
  }

  return (
    <Dialog
      open={open}
      title={tr("لا تفوّت كوبك وأنت قريب", "Don't miss your coffee when you're close")}
      lead={<NearbyPreview />}
      className="nearby-intro"
      focusDialog
      onClose={close}
      actions={
        <>
          <button type="button" className="btn btn--primary btn--block" disabled={busy} onClick={() => void turnOn()}>
            {busy ? tr("لحظة…", "One moment…") : tr("شغّل تنبيهات القرب", "Turn on nearby alerts")}
          </button>
          <button type="button" className="btn btn--ghost btn--block nearby-intro__later" disabled={busy} onClick={close}>
            {tr("مو الحين", "Not now")}
          </button>
        </>
      }
    >
      <p>
        {tr(
          "لما تمر جنب هولو وهو فاتح، يوصلك تنبيه مثل هذا، مرة كل ١٢ ساعة بالكثير. عشان يشتغل، اسمح بالموقع (دائمًا).",
          "When you pass by HOLLOW while it's open, you'll get an alert like this, at most once every 12 hours. For it to work, allow location (Always).",
        )}
      </p>
    </Dialog>
  );
}
