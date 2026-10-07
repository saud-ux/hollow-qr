import Foundation
import Capacitor
import WidgetKit
#if canImport(ActivityKit)
import ActivityKit
#endif

/// Feeds the home-screen widget and runs the lock-screen order tracker.
///
/// - sync({ json }): stores the widget state (card, current order, language,
///   refresh token) in the shared keychain item and redraws the widgets.
/// - clear(): sign-out; forgets the state and ends any tracker.
/// - startOrderActivity({...}): starts the Live Activity for an order. Its push
///   token arrives as an "activityToken" event for the page to send to the server.
/// - endOrderActivity({ orderId }): removes the tracker of an order.
@objc(HollowWidgetPlugin)
public class HollowWidgetPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "HollowWidgetPlugin"
    public let jsName = "HollowWidget"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "sync", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clear", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startOrderActivity", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "endOrderActivity", returnType: CAPPluginReturnPromise),
    ]

    @objc func sync(_ call: CAPPluginCall) {
        guard let json = call.getString("json"), let data = json.data(using: .utf8),
              var state = try? JSONDecoder().decode(HollowWidgetState.self, from: data) else {
            call.reject("INVALID_STATE")
            return
        }
        state.updatedAt = Date()
        HollowSharedStore.write(state)
        WidgetCenter.shared.reloadAllTimelines()
        call.resolve()
    }

    @objc func clear(_ call: CAPPluginCall) {
        HollowSharedStore.clear()
        WidgetCenter.shared.reloadAllTimelines()
        if #available(iOS 16.2, *) {
            Task {
                for activity in Activity<HollowOrderAttributes>.activities {
                    await activity.end(nil, dismissalPolicy: .immediate)
                }
            }
        }
        call.resolve()
    }

    @objc func startOrderActivity(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else {
            call.resolve(["started": false])
            return
        }
        guard let orderId = call.getString("orderId"), let number = call.getInt("orderNumber"),
              let fulfillment = call.getString("fulfillment"), let status = call.getString("status") else {
            call.reject("INVALID_ORDER")
            return
        }
        guard ActivityAuthorizationInfo().areActivitiesEnabled else {
            call.resolve(["started": false])
            return
        }
        let lang = call.getString("lang") ?? "ar"
        let flow = HollowText.flow(fulfillment)
        let state = HollowOrderAttributes.ContentState(
            status: status,
            label: HollowText.status(status, fulfillment: fulfillment, arabic: lang != "en"),
            step: max(flow.firstIndex(of: status) ?? 0, 0),
            steps: flow.count
        )

        // Already showing this order: just make sure the server has its token.
        if let existing = Activity<HollowOrderAttributes>.activities.first(where: { $0.attributes.orderId == orderId }) {
            watchToken(existing, orderId: orderId)
            call.resolve(["started": false])
            return
        }
        do {
            let attributes = HollowOrderAttributes(orderId: orderId, orderNumber: number, fulfillment: fulfillment, lang: lang)
            let activity = try Activity.request(attributes: attributes, content: ActivityContent(state: state, staleDate: nil), pushType: .token)
            watchToken(activity, orderId: orderId)
            call.resolve(["started": true])
        } catch {
            call.resolve(["started": false])
        }
    }

    @objc func endOrderActivity(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *), let orderId = call.getString("orderId") else {
            call.resolve()
            return
        }
        Task {
            for activity in Activity<HollowOrderAttributes>.activities where activity.attributes.orderId == orderId {
                await activity.end(nil, dismissalPolicy: .default)
            }
        }
        call.resolve()
    }

    @available(iOS 16.2, *)
    private func watchToken(_ activity: Activity<HollowOrderAttributes>, orderId: String) {
        if let token = activity.pushToken {
            notifyListeners("activityToken", data: ["orderId": orderId, "token": token.hexString])
        }
        Task { [weak self] in
            for await token in activity.pushTokenUpdates {
                self?.notifyListeners("activityToken", data: ["orderId": orderId, "token": token.hexString])
            }
        }
    }
}

private extension Data {
    var hexString: String { map { String(format: "%02x", $0) }.joined() }
}
