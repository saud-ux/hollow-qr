import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { AuthProvider } from "./lib/auth";
import { CartProvider } from "./lib/cart";
import { ConfigContext, fetchPublicConfig } from "./lib/config";
import { getSupabase } from "./lib/supabase";
import { captureEmailCallback } from "./lib/email-callback";
import { initLang, tr } from "./lib/i18n";
import { initTheme } from "./lib/theme";
import { installWesternDigits } from "./lib/digits";
import "./styles.css";

initTheme();
initLang();
installWesternDigits();
const root = createRoot(document.getElementById("root")!);

function renderMessage(text: string, retry?: () => void) {
  root.render(
    <div className="boot-error" role="alert">
      <img src="/brand/wordmark-espresso.png" alt="HOLLOW" width={180} />
      <p>{text}</p>
      {retry && (
        <button type="button" className="btn btn--primary" onClick={retry}>
          {tr("أعد المحاولة", "Try again")}
        </button>
      )}
    </div>,
  );
}

function boot() {
  fetchPublicConfig()
    .then((config) => {
      if (!config.supabaseUrl || !config.supabaseAnonKey) {
        renderMessage(tr("الخدمة غير مهيأة بعد.", "The service isn't set up yet."));
        return;
      }
      const emailCallback = captureEmailCallback(config.appUrl);
      const supabase = getSupabase(config, !emailCallback);
      root.render(
        <StrictMode>
          <ConfigContext.Provider value={config}>
            <AuthProvider supabase={supabase}>
              <CartProvider>
                <App />
              </CartProvider>
            </AuthProvider>
          </ConfigContext.Provider>
        </StrictMode>,
      );
    })
    .catch(() => {
      // Opened without a connection (or the server didn't answer): try again from a button, or by itself once back online.
      window.addEventListener("online", boot, { once: true });
      renderMessage(tr("تعذّر تحميل الخدمة. تأكد من اتصالك بالإنترنت وحاول مرة ثانية.", "Couldn't load the app. Check your connection and try again."), () => {
        window.removeEventListener("online", boot);
        boot();
      });
    });
}

boot();
