import type { CapacitorConfig } from "@capacitor/cli";

/**
 * HOLLOW Coffee iOS app. The app bundles the same React build as the website
 * (dist/client) and talks to the production Worker over HTTPS.
 */
const config: CapacitorConfig = {
  appId: "com.hollowzulfi.coffee",
  appName: "HOLLOW",
  webDir: "dist/client",
  backgroundColor: "#f4ede0",
  ios: {
    contentInset: "never",
    backgroundColor: "#f4ede0",
    preferredContentMode: "mobile",
    scheme: "HOLLOW",
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 700,
      launchAutoHide: true,
      backgroundColor: "#f4ede0",
      showSpinner: false,
    },
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"],
    },
  },
};

export default config;
