import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { AuthProvider } from "./lib/auth";
import { CartProvider } from "./lib/cart";
import { ConfigContext, fetchPublicConfig } from "./lib/config";
import { getSupabase } from "./lib/supabase";
import { initLang, tr } from "./lib/i18n";
import { initTheme } from "./lib/theme";
import "./styles.css";

initTheme();
initLang();
const root = createRoot(document.getElementById("root")!);

function renderMessage(text: string) {
  root.render(
    <div className="boot-error" role="alert">
      <img src="/brand/wordmark-espresso.png" alt="HOLLOW" width={180} />
      <p>{text}</p>
    </div>,
  );
}

fetchPublicConfig()
  .then((config) => {
    if (!config.supabaseUrl || !config.supabaseAnonKey) {
      renderMessage(tr("الخدمة غير مهيأة بعد.", "The service isn't set up yet."));
      return;
    }
    const supabase = getSupabase(config);
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
  .catch(() => renderMessage(tr("تعذّر تحميل الخدمة. حاول مرة أخرى بعد قليل.", "Couldn't load the app. Please try again shortly.")));
