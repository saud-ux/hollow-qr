import { useCallback, useState } from "react";
import { useConfig } from "./config";

/** Turnstile token state for Supabase Auth calls (no-op when disabled). */
export function useCaptcha() {
  const config = useConfig();
  const enabled = config.turnstileEnabled && Boolean(config.turnstileSiteKey);
  const [token, setToken] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const reset = useCallback(() => setResetKey((k) => k + 1), []);
  return {
    enabled,
    siteKey: config.turnstileSiteKey ?? "",
    token,
    setToken,
    resetKey,
    reset,
    ready: !enabled || Boolean(token),
    options: enabled && token ? { captchaToken: token } : {},
  };
}
