import type { CapacitorConfig } from "@capacitor/cli";

/**
 * HOLLOW Coffee iOS app. The app bundles the same React build as the website
 * (dist/client) and talks to the production Worker over HTTPS.
 */
const config: CapacitorConfig = {
  appId: "com.hollowzulfi.coffee",
  appName: "HOLLOW",
  webDir: "dist/client",
  backgroundColor: "#2b1e16",
  ios: {
    contentInset: "never",
    backgroundColor: "#2b1e16",
    preferredContentMode: "mobile",
    scheme: "HOLLOW",
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 700,
      launchAutoHide: true,
      backgroundColor: "#2b1e16",
      showSpinner: false,
    },
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"],
    },
  },
};

export default config;
