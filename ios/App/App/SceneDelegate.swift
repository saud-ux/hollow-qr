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
