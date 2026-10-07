import Foundation
#if canImport(ActivityKit)
import ActivityKit
#endif

/// What the app hands the home-screen widget: the loyalty card, the order in
/// progress, the app's language, and a read-only token so the widget can
/// refresh both from the server on its own (GET /api/widget).
struct HollowWidgetState: Codable {
    struct Card: Codable {
        var name: String
        var stamps: Int
        var max: Int
        var reward: Bool
        var active: Bool
        var qr: String
    }

    struct Order: Codable {
        var id: String
        var number: Int
        var status: String
        var fulfillment: String
    }

    var card: Card?
    var order: Order?
    var lang: String
    var token: String?
    var apiBase: String?
    var updatedAt: Date?

    var isArabic: Bool { lang != "en" }
}

/// The server's part of the state (the body of GET /api/widget).
struct HollowWidgetData: Codable {
    var card: HollowWidgetState.Card?
    var order: HollowWidgetState.Order?
}

/// A keychain item shared by the app and the widget (Keychain Sharing, so no
/// App Group is needed). The app writes it; the widget reads and refreshes it.
enum HollowSharedStore {
    static let accessGroup = "N2KXQ7MVY3.com.hollowzulfi.coffee.shared"
    private static let service = "com.hollowzulfi.coffee.widget"
    private static let account = "state"

    private static var query: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecAttrAccessGroup as String: accessGroup,
        ]
    }

    static func read() -> HollowWidgetState? {
        var q = query
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &item) == errSecSuccess, let data = item as? Data else { return nil }
        return try? JSONDecoder().decode(HollowWidgetState.self, from: data)
    }

    static func write(_ state: HollowWidgetState) {
        guard let data = try? JSONEncoder().encode(state) else { return }
        let update: [String: Any] = [kSecValueData as String: data]
        if SecItemUpdate(query as CFDictionary, update as CFDictionary) == errSecItemNotFound {
            var add = query
            add[kSecValueData as String] = data
            // The widget reads it in the background, so it must be readable after the first unlock.
            add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
            SecItemAdd(add as CFDictionary, nil)
        }
    }

    static func clear() {
        SecItemDelete(query as CFDictionary)
    }
}

/// Words shown by the widget and the lock-screen tracker.
enum HollowText {
    static func status(_ status: String, fulfillment: String, arabic: Bool) -> String {
        switch status {
        case "new": return arabic ? "استلمنا طلبك" : "Order received"
        case "preparing": return arabic ? "نحضّر طلبك" : "Preparing your order"
        case "ready":
            if fulfillment == "pickup" { return arabic ? "جاهز، استلمه من الكاشير" : "Ready, pick it up at the counter" }
            if fulfillment == "curbside" { return arabic ? "جاهز، نطلّعه لك" : "Ready, we'll bring it out" }
            // Delivery has no ready step for the customer: still being prepared.
            return arabic ? "نحضّر طلبك" : "Preparing your order"
        case "out_for_delivery": return arabic ? "خرج للتوصيل" : "Out for delivery"
        case "completed":
            if fulfillment == "delivery" { return arabic ? "تم التوصيل، بالعافية!" : "Delivered, enjoy!" }
            return arabic ? "تم الاستلام، بالعافية!" : "Picked up, enjoy!"
        case "cancelled": return arabic ? "تم إلغاء الطلب" : "Order cancelled"
        default: return ""
        }
    }

    /// The steps of an order, as on the order screen (orderFlow in src/shared/ordering.ts).
    static func flow(_ fulfillment: String) -> [String] {
        fulfillment == "delivery"
            ? ["new", "preparing", "out_for_delivery", "completed"]
            : ["new", "preparing", "ready", "completed"]
    }

    /// Where the order is in its flow; a delivery waiting for the driver still shows as preparing.
    static func step(_ status: String, fulfillment: String) -> Int {
        let shown = fulfillment == "delivery" && status == "ready" ? "preparing" : status
        return flow(fulfillment).firstIndex(of: shown) ?? 0
    }
}

#if canImport(ActivityKit)
/// The lock-screen order tracker. The server pushes ContentState updates, so
/// its JSON keys must match LiveActivityState in src/server/push/app-push.ts.
@available(iOS 16.1, *)
struct HollowOrderAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        var status: String
        var label: String
        var step: Int
        var steps: Int
    }

    var orderId: String
    var orderNumber: Int
    var fulfillment: String
    var lang: String
}
#endif
