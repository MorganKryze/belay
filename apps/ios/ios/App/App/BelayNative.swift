import AuthenticationServices
import Capacitor
import Security
import UIKit

// The app's session, kept where the web page cannot lose it: the token in the Keychain, and the
// sign-in through the system sheet. The page reaches it as the "BelayNative" plugin.
@objc(BelayNativePlugin)
public class BelayNativePlugin: CAPPlugin, CAPBridgedPlugin, ASWebAuthenticationPresentationContextProviding {
    public let identifier = "BelayNativePlugin"
    public let jsName = "BelayNative"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "readToken", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "writeToken", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearToken", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "authenticate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setLiveActivity", returnType: CAPPluginReturnPromise),
    ]

    private static let service = "cloud.libresoftware.belay.session"

    // Kept alive until the sheet answers: the system drops a session nobody holds.
    private var signIn: ASWebAuthenticationSession?

    // One token per instance address. Readable only on this device once it has been unlocked
    // after a restart: never copied into a backup or onto another device.
    private func item(_ origin: String? = nil) -> [String: Any] {
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: Self.service,
        ]
        if let origin { query[kSecAttrAccount as String] = origin }
        return query
    }

    @objc func readToken(_ call: CAPPluginCall) {
        guard let origin = call.getString("origin") else { return call.reject("origin missing") }
        var query = item(origin)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return call.resolve(["token": NSNull()]) }
        guard status == errSecSuccess, let data = result as? Data,
              let token = String(data: data, encoding: .utf8)
        else { return call.reject("keychain read failed (\(status))") }
        call.resolve(["token": token])
    }

    // Every other item goes first: one token at a time, so a new instance never inherits the old
    // instance's session.
    @objc func writeToken(_ call: CAPPluginCall) {
        guard let origin = call.getString("origin"), let token = call.getString("token") else {
            return call.reject("origin or token missing")
        }
        SecItemDelete(item() as CFDictionary)
        var query = item(origin)
        query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        query[kSecValueData as String] = Data(token.utf8)
        let status = SecItemAdd(query as CFDictionary, nil)
        guard status == errSecSuccess else { return call.reject("keychain write failed (\(status))") }
        call.resolve()
    }

    @objc func clearToken(_ call: CAPPluginCall) {
        let status = SecItemDelete(item() as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            return call.reject("keychain delete failed (\(status))")
        }
        call.resolve()
    }

    @objc func authenticate(_ call: CAPPluginCall) {
        guard let address = call.getString("url"), let url = URL(string: address),
              let scheme = call.getString("callbackScheme")
        else { return call.reject("url or callbackScheme missing") }
        DispatchQueue.main.async {
            guard self.signIn == nil else { return call.reject("busy") }
            let session = ASWebAuthenticationSession(url: url, callbackURLScheme: scheme) { callback, error in
                self.signIn = nil
                if let callback { return call.resolve(["url": callback.absoluteString]) }
                if let error = error as? ASWebAuthenticationSessionError, error.code == .canceledLogin {
                    return call.reject("cancelled", "cancelled")
                }
                call.reject(error?.localizedDescription ?? "sign-in failed")
            }
            // A private sheet: no cookie of the identity provider outlives it, so signing out of
            // the app is complete, and iOS shows no consent alert before opening it.
            session.prefersEphemeralWebBrowserSession = true
            session.presentationContextProvider = self
            self.signIn = session
            if !session.start() {
                self.signIn = nil
                call.reject("sign-in sheet did not open")
            }
        }
    }

    // The page says which session it wants on the lock screen, never "start" or "stop": a page
    // that starts again describes the same session, finds its Activity and takes it over. The
    // promise settles once iOS has applied the change, so the page sends one description at a time.
    @objc func setLiveActivity(_ call: CAPPluginCall) {
        let payload: SessionActivityPayload?
        do {
            payload = try SessionActivityPayload.from(call.options["activity"])
        } catch {
            return call.reject("activity invalid")
        }
        #if DEBUG
        if ActivityDemo.isRunning { return call.resolve() }
        #endif
        Task {
            await LiveActivity.show(payload)
            call.resolve()
        }
    }

    public func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        bridge?.viewController?.view.window ?? ASPresentationAnchor()
    }
}

// The app's own plugin is not a package, so it is registered by hand once the bridge exists.
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(BelayNativePlugin())
    }
}
