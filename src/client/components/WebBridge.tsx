import { useEffect } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "../lib/auth";
import { initMotion } from "../lib/motion";
import { isNative } from "../lib/native";
import { watchInstallPrompt } from "../lib/pwa";
import { onNotificationOpen, prepareWebPush, syncWebPush } from "../lib/webpush";

/** Website glue (the app has NativeBridge): motion, install prompt, notification taps. Renders nothing. */
export function WebBridge() {
  const navigate = useNavigate();
  const { session } = useAuth();
  const userId = session?.user.id;

  useEffect(() => {
    if (isNative) return;
    initMotion();
    watchInstallPrompt();
    return onNotificationOpen((url) => void navigate(url));
  }, [navigate]);

  // Signing in on a browser that already allowed notifications links it to
  // this user. This also runs after a language change (the site re-renders
  // keyed by language), so notifications follow the site's language.
  useEffect(() => {
    if (isNative || !userId) return;
    void prepareWebPush()
      .then(() => syncWebPush())
      .catch(() => undefined);
  }, [userId]);

  return null;
}
