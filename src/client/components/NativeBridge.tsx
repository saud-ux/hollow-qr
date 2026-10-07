import { useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import { apiPost } from "../lib/api";
import { useAuth } from "../lib/auth";
import { initMotion } from "../lib/motion";
import { currentLang } from "../lib/i18n";
import { initNativePush, initNativeShell, isNative, openWebsite, refreshPushIfAllowed } from "../lib/native";

/** iOS app glue: push registration and notification taps. Renders nothing. */
export function NativeBridge() {
  const navigate = useNavigate();
  const { session } = useAuth();
  const signedIn = useRef(false);
  const userId = session?.user.id;
  useEffect(() => {
    signedIn.current = Boolean(userId);
  }, [userId]);

  useEffect(() => {
    if (!isNative) return;
    initNativeShell();
    initMotion();
    void initNativePush({
      register: (token) => {
        if (signedIn.current) void apiPost("/api/me/push-devices", { token, lang: currentLang() }).catch(() => undefined);
      },
      open: (target) => {
        if (target.kind === "order") void navigate(`/orders/${target.orderId}`);
        else if (target.kind === "menu") void navigate("/menu");
        else openWebsite("/staff/orders");
      },
    }).catch(() => undefined);
  }, [navigate]);

  // Signing in on a phone that already allowed notifications links it to this
  // user. This also runs after a language change (the app re-renders keyed by
  // language), so order notifications follow the app's language.
  useEffect(() => {
    if (isNative && userId) void refreshPushIfAllowed().catch(() => undefined);
  }, [userId]);

  return null;
}
