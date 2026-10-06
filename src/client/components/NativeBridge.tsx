import { useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import { apiPost } from "../lib/api";
import { useAuth } from "../lib/auth";
import { initMotion } from "../lib/motion";
import { initNativePush, initNativeShell, isNative, refreshPushIfAllowed } from "../lib/native";

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
        if (signedIn.current) void apiPost("/api/me/push-devices", { token }).catch(() => undefined);
      },
      open: (orderId) => void navigate(`/orders/${orderId}`),
    }).catch(() => undefined);
  }, [navigate]);

  // Signing in on a phone that already allowed notifications links it to this user.
  useEffect(() => {
    if (isNative && userId) void refreshPushIfAllowed().catch(() => undefined);
  }, [userId]);

  return null;
}
