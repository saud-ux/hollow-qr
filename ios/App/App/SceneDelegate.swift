import UIKit
import Capacitor
import PassKit

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = HollowBridgeViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}

/// Registers the app's own plugins with the Capacitor bridge.
class HollowBridgeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(HollowWalletPlugin())
        bridge?.registerPluginInstance(HollowWidgetPlugin())
        bridge?.registerPluginInstance(HollowGeofencePlugin())
        hideKeyboardAccessoryBar()
    }

    /// Takes away the bar of arrows and ✓ that iOS puts above the keyboard in
    /// web pages: the app's forms don't need it, and over the menu search it
    /// only hid the results. It is the accessory view of the web view's
    /// private content view, so that view is given none. Unlike the Keyboard
    /// plugin, this leaves WebKit's own keyboard handling as it is.
    private func hideKeyboardAccessoryBar() {
        let selector = #selector(getter: UIResponder.inputAccessoryView)
        guard let contentView = NSClassFromString(["WK", "Content", "View"].joined()),
              let method = class_getInstanceMethod(contentView, selector) else { return }
        let none: @convention(block) (AnyObject) -> UIView? = { _ in nil }
        let implementation = imp_implementationWithBlock(none)
        // Override it on that view only, never on UIResponder itself.
        if !class_addMethod(contentView, selector, implementation, method_getTypeEncoding(method)) {
            method_setImplementation(method, implementation)
        }
    }
}

/// Adds the signed HOLLOW Rewards pass to Apple Wallet from inside the app.
/// The web view cannot open .pkpass files itself, so the page hands us the
/// short-lived signed download URL and we present Apple's "Add" sheet.
@objc(HollowWalletPlugin)
public class HollowWalletPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "HollowWalletPlugin"
    public let jsName = "HollowWallet"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "addPass", returnType: CAPPluginReturnPromise),
    ]

    @objc func isAvailable(_ call: CAPPluginCall) {
        call.resolve(["available": PKAddPassesViewController.canAddPasses()])
    }

    @objc func addPass(_ call: CAPPluginCall) {
        guard let raw = call.getString("url"), let url = URL(string: raw), url.scheme == "https" else {
            call.reject("INVALID_URL")
            return
        }
        URLSession.shared.dataTask(with: url) { data, response, error in
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            guard error == nil, status == 200, let data = data else {
                call.reject("DOWNLOAD_FAILED")
                return
            }
            DispatchQueue.main.async {
                guard let pass = try? PKPass(data: data) else {
                    call.reject("INVALID_PASS")
                    return
                }
                if PKPassLibrary().containsPass(pass) {
                    call.resolve(["added": true, "alreadyInWallet": true])
                    return
                }
                guard let sheet = PKAddPassesViewController(pass: pass),
                      let presenter = self.bridge?.viewController else {
                    call.reject("UNAVAILABLE")
                    return
                }
                presenter.present(sheet, animated: true) {
                    call.resolve(["added": true, "alreadyInWallet": false])
                }
            }
        }.resume()
    }
}
