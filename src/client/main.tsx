import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { AuthProvider } from "./lib/auth";
import { CartProvider } from "./lib/cart";
import { ConfigContext, fetchPublicConfig } from "./lib/config";
import { getSupabase } from "./lib/supabase";
import { initTheme } from "./lib/theme";
import "./styles.css";

initTheme();
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
      renderMessage("الخدمة غير مهيأة بعد (SUPABASE_URL / SUPABASE_ANON_KEY).");
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
  .catch(() => renderMessage("تعذّر تحميل الخدمة. حاول مرة أخرى بعد قليل."));
