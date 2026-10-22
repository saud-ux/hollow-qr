import Capacitor
import CoreLocation
import UIKit
import UserNotifications

/// Nearby alerts: when a customer who turned them on comes near HOLLOW while
/// it is open, a local notification invites them in, at most once every 12
/// hours. Location stays on the phone: iOS watches one circle round the café
/// and wakes the app when the customer enters it.
enum HollowGeofenceConfig {
    static let radiusMeters: CLLocationDistance = 300
    static let cooldownSeconds: TimeInterval = 12 * 60 * 60
    static let identifier = "hollow-zulfi-main"
    static let coordinate = CLLocationCoordinate2D(latitude: 26.303045, longitude: 44.832762)
    static let timeZone = TimeZone(identifier: "Asia/Riyadh") ?? .current
}

/// One day of the shop's week as the menu sends it (index 0 = Sunday).
/// "HH:MM" in Asia/Riyadh; a close time at or before the open time runs past midnight.
struct ShopDayHours: Codable {
    let closed: Bool
    let opensAt: String
    let closesAt: String
}

/// The opening hours, kept on the phone so an entry at night can be checked
/// without the app or a network connection.
enum ShopHours {
    private static let key = "hollow.geofence.weeklyHours"

    static func save(_ week: [ShopDayHours]) {
        guard week.count == 7, let data = try? JSONEncoder().encode(week) else { return }
        UserDefaults.standard.set(data, forKey: key)
    }

    static var known: Bool { load() != nil }

    private static func load() -> [ShopDayHours]? {
        guard let data = UserDefaults.standard.data(forKey: key),
              let week = try? JSONDecoder().decode([ShopDayHours].self, from: data),
              week.count == 7 else { return nil }
        return week
    }

    private static func minutes(_ hhmm: String) -> Int {
        let parts = hhmm.split(separator: ":").map { Int($0) ?? 0 }
        return (parts.first ?? 0) * 60 + (parts.count > 1 ? parts[1] : 0)
    }

    /// The same rule as the server's shop_is_open (its opening hours, without the ordering pause).
    /// Unknown hours count as closed, so nobody is invited in at night.
    static func isOpen(at date: Date = Date()) -> Bool {
        guard let week = load() else { return false }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = HollowGeofenceConfig.timeZone
        let parts = calendar.dateComponents([.weekday, .hour, .minute], from: date)
        let day = ((parts.weekday ?? 1) - 1 + 7) % 7
        let now = (parts.hour ?? 0) * 60 + (parts.minute ?? 0)

        let today = week[day]
        if !today.closed {
            let opens = minutes(today.opensAt), closes = minutes(today.closesAt)
            if closes > opens {
                if now >= opens && now < closes { return true }
            } else if now >= opens {
                return true // An overnight shift that started today.
            }
        }
        // An overnight shift that started yesterday and is still running.
        let yesterday = week[(day + 6) % 7]
        return !yesterday.closed && minutes(yesterday.closesAt) <= minutes(yesterday.opensAt) && now < minutes(yesterday.closesAt)
    }
}

/// The alert's language: the one the app shows (it sends it at launch and on
/// every change), or before that the phone's, Arabic for Arabic and English otherwise.
enum NearbyLanguage {
    private static let key = "hollow.geofence.lang"

    static func save(_ lang: String) {
        UserDefaults.standard.set(lang, forKey: key)
    }

    static var english: Bool {
        if let lang = UserDefaults.standard.string(forKey: key) { return lang == "en" }
        return !(Locale.preferredLanguages.first ?? "ar").lowercased().hasPrefix("ar")
    }
}

/// Lives independently of the web view so a location wake-up can be handled.
final class HollowGeofenceManager: NSObject, CLLocationManagerDelegate {
    static let shared = HollowGeofenceManager()
    private let location = CLLocationManager()
    private let defaults = UserDefaults.standard
    private let enabledKey = "hollow.geofence.enabled"
    private let lastKey = "hollow.geofence.lastNotification"
    private let notificationID = "hollow.geofence"
    private var lastError = ""
    private var sending = false

    private override init() {
        super.init()
        location.delegate = self
    }

    var enabled: Bool { defaults.bool(forKey: enabledKey) }

    func restore() {
        if enabled { monitor() }
    }

    func start() {
        defaults.set(true, forKey: enabledKey)
        lastError = ""
        if location.authorizationStatus == .notDetermined {
            location.requestWhenInUseAuthorization()
        } else if location.authorizationStatus == .authorizedWhenInUse {
            location.requestAlwaysAuthorization()
        }
        monitor()
    }

    func stop() {
        defaults.set(false, forKey: enabledKey)
        for region in location.monitoredRegions where region.identifier == HollowGeofenceConfig.identifier {
            location.stopMonitoring(for: region)
        }
        // Only our own local request: never touch order/APNs notifications.
        UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: [notificationID])
    }

    private func monitor() {
        guard enabled else { return }
        guard CLLocationManager.isMonitoringAvailable(for: CLCircularRegion.self) else {
            lastError = NearbyLanguage.english ? "Nearby alerts aren't supported on this phone." : "تنبيهات القرب غير مدعومة على هذا الجوال."
            return
        }
        guard location.authorizationStatus == .authorizedAlways else { return }
        // Keep a region that already matches; replace one from an older build (the test's 75 m circle).
        if let existing = location.monitoredRegions.first(where: { $0.identifier == HollowGeofenceConfig.identifier }) as? CLCircularRegion {
            if existing.notifyOnEntry && !existing.notifyOnExit && existing.radius == HollowGeofenceConfig.radiusMeters { return }
            location.stopMonitoring(for: existing)
        }
        let region = CLCircularRegion(center: HollowGeofenceConfig.coordinate,
                                     radius: HollowGeofenceConfig.radiusMeters,
                                     identifier: HollowGeofenceConfig.identifier)
        region.notifyOnEntry = true
        region.notifyOnExit = false
        location.startMonitoring(for: region)
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        switch manager.authorizationStatus {
        case .authorizedAlways:
            restore()
        case .authorizedWhenInUse where enabled:
            // Right after "While Using" is allowed, ask for "Always" too (iOS shows it once).
            manager.requestAlwaysAuthorization()
        default:
            break
        }
    }

    func locationManager(_ manager: CLLocationManager, didEnterRegion region: CLRegion) {
        guard region.identifier == HollowGeofenceConfig.identifier else { return }
        notifyIfInvited()
    }

    func locationManager(_ manager: CLLocationManager, monitoringDidFailFor region: CLRegion?, withError error: Error) {
        if region == nil || region?.identifier == HollowGeofenceConfig.identifier {
            lastError = error.localizedDescription
        }
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        lastError = error.localizedDescription
    }

    /// One alert on entry, only while HOLLOW is open and at most once every 12 hours.
    /// An entry while closed is dropped and does not use up the 12 hours.
    private func notifyIfInvited() {
        guard enabled, !sending, ShopHours.isOpen() else { return }
        let now = Date().timeIntervalSince1970
        guard now - defaults.double(forKey: lastKey) >= HollowGeofenceConfig.cooldownSeconds else { return }
        sending = true
        let content = UNMutableNotificationContent()
        let english = NearbyLanguage.english
        content.title = english ? "Mood reset 💆🏻‍♂️✨" : "تعديل مزاج💆🏻‍♂️✨"
        content.body = english ? "Between errands, grab a smooth cup of coffee and take a breather." : "بين المشاوير، خذ لك كوب قهوة رايق يخفف عليك."
        content.sound = .default
        content.userInfo = ["kind": "geofence"]
        let request = UNNotificationRequest(identifier: notificationID, content: content,
                                            trigger: UNTimeIntervalNotificationTrigger(timeInterval: 1, repeats: false))
        // Do not replace UNUserNotificationCenter's delegate; Capacitor owns it.
        UNUserNotificationCenter.current().add(request) { error in
            DispatchQueue.main.async {
                self.sending = false
                if let error = error {
                    self.lastError = error.localizedDescription
                    return
                }
                self.defaults.set(now, forKey: self.lastKey)
                self.lastError = ""
                // A stop may have happened while the request was being added.
                if !self.enabled {
                    UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: [self.notificationID])
                }
            }
        }
    }

    func status(_ completion: @escaping ([String: Any]) -> Void) {
        let authorization: String
        switch location.authorizationStatus {
        case .authorizedAlways: authorization = "always"
        case .authorizedWhenInUse: authorization = "whenInUse"
        case .denied: authorization = "denied"
        case .restricted: authorization = "restricted"
        default: authorization = "notDetermined"
        }
        var result: [String: Any] = [
            "enabled": enabled,
            "authorization": authorization,
            "locationServices": CLLocationManager.locationServicesEnabled(),
            "monitoring": location.monitoredRegions.contains { $0.identifier == HollowGeofenceConfig.identifier },
            "hoursKnown": ShopHours.known,
            "error": lastError
        ]
        UNUserNotificationCenter.current().getNotificationSettings { settings in
            result["notificationsAllowed"] = settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional
            DispatchQueue.main.async { completion(result) }
        }
    }
}

/// Use Capacitor's local route; leave APNs and the notification-center delegate intact.
private final class HollowGeofenceNotificationHandler: NSObject, NotificationHandlerProtocol {
    let previous: NotificationHandlerProtocol?
    init(previous: NotificationHandlerProtocol?) { self.previous = previous }

    private func ours(_ notification: UNNotification) -> Bool {
        notification.request.content.userInfo["kind"] as? String == "geofence"
    }

    func willPresent(notification: UNNotification) -> UNNotificationPresentationOptions {
        if ours(notification) { return [.banner, .list, .sound] }
        return previous?.willPresent(notification: notification) ?? []
    }

    func didReceive(response: UNNotificationResponse) {
        if !ours(response.notification) { previous?.didReceive(response: response) }
    }
}

@objc(HollowGeofencePlugin)
public class HollowGeofencePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "HollowGeofencePlugin"
    public let jsName = "HollowGeofence"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setHours", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setLanguage", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openSettings", returnType: CAPPluginReturnPromise)
    ]
    private var localHandler: HollowGeofenceNotificationHandler?

    public override func load() {
        guard let router = bridge?.notificationRouter else { return }
        let handler = HollowGeofenceNotificationHandler(previous: router.localNotificationHandler)
        localHandler = handler // Capacitor keeps only a weak reference.
        router.localNotificationHandler = handler
    }

    @objc func getStatus(_ call: CAPPluginCall) {
        DispatchQueue.main.async { HollowGeofenceManager.shared.status { call.resolve($0) } }
    }
    @objc func start(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            HollowGeofenceManager.shared.start()
            UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { _, error in
                DispatchQueue.main.async {
                    if let error = error { call.reject(error.localizedDescription); return }
                    HollowGeofenceManager.shared.status { call.resolve($0) }
                }
            }
        }
    }
    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            HollowGeofenceManager.shared.stop()
            HollowGeofenceManager.shared.status { call.resolve($0) }
        }
    }
    /// The shop's weekly hours, sent by the app whenever it loads the menu.
    @objc func setHours(_ call: CAPPluginCall) {
        guard let days = call.getArray("weeklyHours", JSObject.self), days.count == 7 else {
            call.reject("weeklyHours must have 7 days"); return
        }
        ShopHours.save(days.map {
            ShopDayHours(closed: $0["closed"] as? Bool ?? true, opensAt: $0["open"] as? String ?? "00:00", closesAt: $0["close"] as? String ?? "00:00")
        })
        call.resolve()
    }
    /// The app's language ("ar" or "en"), sent at launch and whenever the customer changes it.
    @objc func setLanguage(_ call: CAPPluginCall) {
        guard let lang = call.getString("lang"), lang == "ar" || lang == "en" else {
            call.reject("lang must be ar or en"); return
        }
        NearbyLanguage.save(lang)
        call.resolve()
    }
    @objc func openSettings(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let url = URL(string: UIApplication.openSettingsURLString) else { call.reject("UNAVAILABLE"); return }
            UIApplication.shared.open(url) { opened in call.resolve(["opened": opened]) }
        }
    }
}
