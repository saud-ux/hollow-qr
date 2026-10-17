# HOLLOW iOS geofencing test mode

The Account screen in the native iOS app has an optional **HOLLOW geofence test** panel. It is absent on the website and Android. No server, APNs token, account, ordering, or notification-preference changes are required. This is a device setting, independent of login; use **Stop test** to turn it off.

The authoritative constants are in `ios/App/App/HollowGeofencePlugin.swift`:

| Setting | Value |
| --- | --- |
| GEOFENCE_TEST_MODE | true (also in TestFlight/Release) |
| GEOFENCE_RADIUS_METERS | 75 |
| GEOFENCE_COOLDOWN_SECONDS | 3 |
| GEOFENCE_IDENTIFIER | hollow-zulfi-main |
| Latitude | 26.303045 |
| Longitude | 44.832762 |

Location stays on the device. Core Location region entry/exit callbacks schedule local notifications. There is no continuous GPS polling, background timer, or request to upload coordinates. No notification-center delegate is replaced. Only this feature's region and pending local notification are removed when stopped. Monitoring opt-in and the shared notification cooldown survive relaunch. Entry, exit, and manual test notifications share that cooldown; suppressed events are not queued for later.

## Device verification

1. Build/sync the current React bundle into iOS and install on a physical iPhone. Existing iOS 15 deployment settings are preserved.
2. Open Account → HOLLOW geofence test → Enable test. Grant notifications and location While Using. Tap Allow Always (or choose Location → Always in HOLLOW settings). Keep Precise Location enabled for a useful small-radius test.
3. Confirm “Region monitoring active.” If permissions were denied, use the settings button. Enable Location Services and Background App Refresh in system settings if needed.
4. Tap Test notification with the app open and confirm a banner. Repeat with the device locked/backgrounded. This button requests notification permission and works even with monitoring stopped and no location permission. Scheduling errors and cooldown rejections are shown in the panel; a scheduling confirmation does not prove delivery (check Focus and system notification settings). Wait at least 3 seconds before the next event. A local handler registered with Capacitor presents only geofence notifications in the foreground and forwards unrelated local notifications to the previous handler. The push handler and notification-center delegate are unchanged.
5. Start outside the region, walk well inside, and then well outside. Confirm entry and exit alerts, waiting at least 3 seconds between events. iOS applies boundary cushions and may delay callbacks; 75 m is the configured radius, not a guaranteed precise trigger distance. There is no repeating three-second alert while stationary. Force-quitting can prevent background delivery until the app is reopened.
6. Stop test; verify monitoring stops and no further geofence alerts arrive. Relaunch with the test enabled and confirm it restores without new permission prompts.
7. Recheck order push/tap navigation, Wallet, widgets, login/logout, ordering, staff/admin pages, and browser account settings.

The unsigned `iOS build check` workflow compiles the native app and widgets. Device permission dialogs, background delivery, and real boundary crossings still require physical-device verification. Before shipping outside testing, set `GEOFENCE_TEST_MODE` to false and review the release behavior; false hides the panel and prevents monitoring/notifications.
