# HOLLOW iOS nearby alerts

Customers can turn on **تنبيهات القرب / Nearby alerts** under Account → Notifications in the iOS app. It is off until they turn it on, and it doesn't exist on the website or Android. When a customer who turned it on comes near HOLLOW while it's open, the app shows a local notification inviting them in:

- Title: «تعديل مزاج💆🏻‍♂️✨»
- Body: «بين المشاوير، خذ لك كوب قهوة رايق يخفف عليك.»

The alert is in Arabic on every phone, whatever the phone's or the app's language, like the order notifications. So is the first-open message below.

The constants are in `ios/App/App/HollowGeofencePlugin.swift` (`HollowGeofenceConfig`):

| Setting | Value |
| --- | --- |
| Radius | 300 m |
| At most one alert every | 12 hours |
| Region identifier | hollow-zulfi-main |
| Latitude, longitude | 26.303045, 44.832762 |
| Opening hours time zone | Asia/Riyadh |

## How it works

- **Location stays on the phone.** iOS watches one circle round the café and wakes the app when the customer enters it. There is no GPS polling, no timer, and nothing about the customer's location is sent to the server.
- **Entry only.** Leaving the circle does nothing.
- **Opening hours only.** The app sends the shop's weekly hours (from `/api/menu`) to the plugin whenever it loads the menu (`syncShopHours` in `src/client/lib/geofence.ts`), and the plugin keeps them on the phone. An entry is checked against them with the same rule as the database's `shop_is_open` (opening hours, overnight shifts included; the ordering pause is ignored). Until the hours have been received once, every entry counts as closed. An entry while closed is dropped and doesn't use up the 12 hours.
- **12 hours between alerts.** After an alert, entries are ignored for 12 hours.
- **Permissions.** Turning the switch on asks for notifications and for location While Using, then Always: as soon as While Using is allowed, the plugin asks for Always too (iOS shows that once). Until both are allowed, a line under the switch says what's missing, with a button that opens HOLLOW's page in Settings. For Always too it goes straight to Settings, because iOS shows its own Always prompt only once and asking again would do nothing.
- **First-open message.** The first time the iOS app shows the menu on a phone, a message (`src/client/components/NearbyIntro.tsx`) appears after about a second: a little map round HOLLOW with the alert it sends, «لا تفوّت كوبك وأنت قريب», and two buttons, «شغّل تنبيهات القرب» (the same as turning the switch on) and «مو الحين». It shows once per phone (`hollow.nearby.introduced` in local storage), and not at all if the alerts are already on.
- **Upgrading from the test build.** A customer who turned on the old test keeps it on. The test's 75 m region is replaced by the 300 m one the next time the app starts.
- Only this feature's region and pending notification are touched. Order pushes, the notification-center delegate and other local notifications are left alone: a Capacitor local-notification handler presents only alerts whose `kind` is `geofence` and forwards the rest.

## Checking on a phone

The unsigned **iOS build check** workflow compiles the app, but permission dialogs, background delivery and real boundary crossings need a physical iPhone:

1. Install the TestFlight build and open it: the first-open message appears on the menu. Tap «شغّل تنبيهات القرب» (or tap «مو الحين», then open Account → Notifications → Nearby alerts and turn it on). Allow notifications, then location While Using, then tap **Allow Always** (or set Location → Always in HOLLOW's settings). Keep Precise Location on.
2. During opening hours, start well outside 300 m, walk or drive in, and check for the alert. iOS adds its own margin round the circle and can be late by a few minutes, so 300 m is the configured radius, not an exact trigger distance. Force-quitting the app can stop background delivery until it's opened again.
3. Go out and back in within 12 hours: no second alert.
4. Outside opening hours, enter the circle: no alert.
5. Turn the switch off: no more alerts.
