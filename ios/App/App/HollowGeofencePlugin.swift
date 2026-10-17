import Capacitor
import CoreLocation
import UIKit
import UserNotifications

// Single source of truth, including Release/TestFlight builds for this test.
enum HollowGeofenceConfig {
    static let GEOFENCE_TEST_MODE = true
    static let GEOFENCE_RADIUS_METERS: CLLocationDistance = 75
    static let GEOFENCE_COOLDOWN_SECONDS: TimeInterval = 3
    static let GEOFENCE_IDENTIFIER = "hollow-zulfi-main"
    static let coordinate = CLLocationCoordinate2D(latitude: 26.303045, longitude: 44.832762)
}

/// Lives independently of the web view so a location wake-up can be handled.
final class HollowGeofenceManager: NSObject, CLLocationManagerDelegate {
    static let shared = HollowGeofenceManager()
    private let location = CLLocationManager()
    private let defaults = UserDefaults.standard
    private let enabledKey = "hollow.geofence.enabled"
    private let lastKey = "hollow.geofence.lastNotification"
    private let notificationID = "hollow.geofence.test"
    private var lastEvent = ""
    private var lastError = ""
    private var sending = false

    private override init() {
        super.init()
        location.delegate = self
    }

    var enabled: Bool { defaults.bool(forKey: enabledKey) }

    func restore() {
        guard HollowGeofenceConfig.GEOFENCE_TEST_MODE else { stop(); return }
        if enabled { monitor() }
    }

    func start() {
        guard HollowGeofenceConfig.GEOFENCE_TEST_MODE else { return }
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
        for region in location.monitoredRegions where region.identifier == HollowGeofenceConfig.GEOFENCE_IDENTIFIER {
            location.stopMonitoring(for: region)
        }
        // Only our own local request: never touch order/APNs notifications.
        UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: [notificationID])
    }

    private func monitor() {
        guard enabled, HollowGeofenceConfig.GEOFENCE_TEST_MODE else { return }
        guard CLLocationManager.isMonitoringAvailable(for: CLCircularRegion.self) else {
            lastError = "Region monitoring is unavailable on this device."
            return
        }
        guard location.authorizationStatus == .authorizedAlways else { return }
        guard !location.monitoredRegions.contains(where: { $0.identifier == HollowGeofenceConfig.GEOFENCE_IDENTIFIER }) else { return }
        let region = CLCircularRegion(center: HollowGeofenceConfig.coordinate,
                                     radius: HollowGeofenceConfig.GEOFENCE_RADIUS_METERS,
                                     identifier: HollowGeofenceConfig.GEOFENCE_IDENTIFIER)
        region.notifyOnEntry = true
        region.notifyOnExit = true
        location.startMonitoring(for: region)
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        // Permission escalation is a separate explicit tap in the test panel.
        if manager.authorizationStatus == .authorizedAlways { restore() }
    }

    func locationManager(_ manager: CLLocationManager, didEnterRegion region: CLRegion) {
        transition(region, event: "entry")
    }

    func locationManager(_ manager: CLLocationManager, didExitRegion region: CLRegion) {
        transition(region, event: "exit")
    }

    private func transition(_ region: CLRegion, event: String) {
        guard region.identifier == HollowGeofenceConfig.GEOFENCE_IDENTIFIER else { return }
        lastEvent = "\(event) · \(ISO8601DateFormatter().string(from: Date()))"
        notify(event: event)
    }

    func locationManager(_ manager: CLLocationManager, monitoringDidFailFor region: CLRegion?, withError error: Error) {
        if region == nil || region?.identifier == HollowGeofenceConfig.GEOFENCE_IDENTIFIER {
            lastError = error.localizedDescription
        }
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        lastError = error.localizedDescription
    }

    func testNotification(completion: @escaping (String?) -> Void) {
        // The manual check needs notifications only, not location or monitoring.
        notify(event: "manual", completion: completion)
    }

    private func notify(event: String, completion: @escaping (String?) -> Void = { _ in }) {
        guard HollowGeofenceConfig.GEOFENCE_TEST_MODE else {
            completion("وضع الاختبار غير مفعل في هذه النسخة."); return
        }
        guard event == "manual" || enabled else { return }
        guard !sending else {
            completion("جارٍ تجهيز إشعار آخر. حاول مجددًا."); return
        }
        let now = Date().timeIntervalSince1970
        guard now - defaults.double(forKey: lastKey) >= HollowGeofenceConfig.GEOFENCE_COOLDOWN_SECONDS else {
            lastError = "انتظر \(Int(HollowGeofenceConfig.GEOFENCE_COOLDOWN_SECONDS)) ثوانٍ بين الإشعارات."
            completion(lastError)
            return
        }
        sending = true
        let content = UNMutableNotificationContent()
        content.title = "HOLLOW · اختبار الموقع"
        content.body = event == "entry" ? "أنت قريب من هولو ☕ مرّنا لقهوة!" :
            event == "exit" ? "غادرت نطاق هولو — ننتظرك قريبًا ☕" : "إشعار تجريبي من هولو ☕"
        content.sound = .default
        content.userInfo = ["kind": "geofence-test", "event": event]
        let request = UNNotificationRequest(identifier: notificationID, content: content,
                                            trigger: UNTimeIntervalNotificationTrigger(timeInterval: 1, repeats: false))
        // Do not replace UNUserNotificationCenter's delegate; Capacitor owns it.
        UNUserNotificationCenter.current().add(request) { error in
            DispatchQueue.main.async {
                self.sending = false
                if let error = error {
                    self.lastError = error.localizedDescription
                    completion(error.localizedDescription)
                } else {
                    self.defaults.set(now, forKey: self.lastKey)
                    self.lastError = ""
                    // A stop may have happened while the request was being added.
                    if event != "manual" && !self.enabled {
                        UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: [self.notificationID])
                    }
                    completion(nil)
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
            "testMode": HollowGeofenceConfig.GEOFENCE_TEST_MODE,
            "enabled": enabled, "authorization": authorization,
            "locationServices": CLLocationManager.locationServicesEnabled(),
            "monitoring": location.monitoredRegions.contains { $0.identifier == HollowGeofenceConfig.GEOFENCE_IDENTIFIER },
            "radiusMeters": HollowGeofenceConfig.GEOFENCE_RADIUS_METERS,
            "cooldownSeconds": HollowGeofenceConfig.GEOFENCE_COOLDOWN_SECONDS,
            "identifier": HollowGeofenceConfig.GEOFENCE_IDENTIFIER,
            "lastEvent": lastEvent, "error": lastError
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

    func willPresent(notification: UNNotification) -> UNNotificationPresentationOptions {
        if notification.request.content.userInfo["kind"] as? String == "geofence-test" {
            return [.banner, .list, .sound]
        }
        return previous?.willPresent(notification: notification) ?? []
    }

    func didReceive(response: UNNotificationResponse) {
        if response.notification.request.content.userInfo["kind"] as? String != "geofence-test" {
            previous?.didReceive(response: response)
        }
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
        CAPPluginMethod(name: "testNotification", returnType: CAPPluginReturnPromise),
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
    @objc func testNotification(_ call: CAPPluginCall) {
        // Request permission on this tap even if region monitoring is stopped.
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { granted, error in
            DispatchQueue.main.async {
                if let error = error { call.reject(error.localizedDescription); return }
                guard granted else {
                    call.reject("الإشعارات غير مسموحة. فعّلها من إعدادات HOLLOW ← الإشعارات.")
                    return
                }
                HollowGeofenceManager.shared.testNotification { error in
                    if let error = error { call.reject(error); return }
                    call.resolve(["scheduled": true])
                }
            }
        }
    }
    @objc func openSettings(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let url = URL(string: UIApplication.openSettingsURLString) else { call.reject("UNAVAILABLE"); return }
            UIApplication.shared.open(url) { opened in call.resolve(["opened": opened]) }
        }
    }
}
