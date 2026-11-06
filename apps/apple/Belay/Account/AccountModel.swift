import AuthenticationServices
import BelayCore
import Foundation
import os

/// The person signed in: who they are on which instance, and the session token that proves it.
struct Account {
    let userId: String
    let instance: Instance
    let token: String
}

/// Signs in to an instance, keeps the session across launches and ends it.
@MainActor @Observable
final class AccountModel {
    enum State {
        case signedOut(SignInFailure?)
        case signingIn
        case signedIn(Account)
    }

    private(set) var state: State = .signedOut(nil)
    /// Why the address typed last was not taken, said apart from a sign-in's own failures.
    private(set) var addressProblem: InstanceError?

    private let session: StoredSession
    private let http: HTTPClient
    private let sheet: SignInSheet
    private let defaults: UserDefaults

    /// The person's id, kept beside the instance so a launch without network opens signed in.
    private static let userKey = "belay.user"
    private static let log = Logger(subsystem: "cloud.libresoftware.belay", category: "account")

    init(
        store: SecretStore = KeychainStore(), http: HTTPClient = URLSessionClient(),
        sheet: SignInSheet = SystemSignInSheet(), defaults: UserDefaults = .standard
    ) {
        session = StoredSession(store: store, defaults: defaults)
        self.http = http
        self.sheet = sheet
        self.defaults = defaults
        if let instance = storedInstance, let token = session.token(origin: instance.origin.absoluteString),
           let userId = defaults.string(forKey: Self.userKey) {
            state = .signedIn(Account(userId: userId, instance: instance, token: token))
        }
    }

    /// The instance last signed in to, as the web screens' links find it.
    private var storedInstance: Instance? {
        defaults.string(forKey: StoredInstance.key).flatMap { Instance(storedOrigin: $0) }
    }

    /// The address to show in the field: the last instance, without its https://.
    var lastAddress: String {
        guard let origin = storedInstance?.origin.absoluteString else { return "" }
        return origin.hasPrefix("https://") ? String(origin.dropFirst("https://".count)) : origin
    }

    /// A session the previous app kept has no id beside it: the instance names its owner once.
    func finishRestore() async {
        guard case .signedOut(nil) = state, let instance = storedInstance,
              let token = session.token(origin: instance.origin.absoluteString)
        else { return }
        state = .signingIn
        await open(token: token, at: instance)
    }

    func signIn(address: String) async {
        if case .signingIn = state { return }
        addressProblem = nil
        state = .signingIn
        let instance: Instance
        switch await Instance.check(address, using: http) {
        case .success(let checked): instance = checked
        case .failure(let problem):
            Self.log.info("address refused: \(String(describing: problem), privacy: .public)")
            addressProblem = problem
            state = .signedOut(nil)
            return
        }
        // The verifier stays here: only its hash goes to the sheet, and the verifier itself only to
        // the exchange that proves this app asked for the code.
        let verifier = PKCE.verifier()
        let start = SignInFlow.startURL(instance, challenge: PKCE.challenge(of: verifier))
        let token: String
        switch await sheet.open(start).flatMap(SignInFlow.callback) {
        case .success(let code):
            switch await SignInFlow.exchange(code: code, verifier: verifier, at: instance, using: http) {
            case .success(let earned): token = earned
            case .failure(let failure): return fail(failure)
            }
        case .failure(let failure): return fail(failure)
        }
        do {
            try session.keep(origin: instance.origin.absoluteString, token: token)
        } catch {
            Self.log.error("token not kept: \(String(describing: error), privacy: .public)")
            await logout(token: token, at: instance, using: http)
            return fail(.failed)
        }
        defaults.set(instance.origin.absoluteString, forKey: StoredInstance.key)
        await open(token: token, at: instance)
    }

    /// Signed in once the instance names who `token` belongs to; a token it refuses is dropped.
    private func open(token: String, at instance: Instance) async {
        switch await me(token: token, at: instance, using: http) {
        case .success(let me):
            defaults.set(me.id, forKey: Self.userKey)
            state = .signedIn(Account(userId: me.id, instance: instance, token: token))
        case .failure(.unavailable):
            // The token stays: the next try, or the next launch, may reach the instance.
            fail(.unavailable)
        case .failure(let failure):
            forget()
            await logout(token: token, at: instance, using: http)
            fail(failure)
        }
    }

    /// Signed out at once; the server is told after, and a failure there changes nothing here.
    func signOut() async {
        guard case .signedIn(let account) = state else { return }
        forget()
        state = .signedOut(nil)
        await logout(token: account.token, at: account.instance, using: http)
    }

    /// Drops the token and the id; the instance stays, so the field shows it at the next sign-in.
    /// A token the Keychain fails to drop is still never restored: the sign-out is marked first.
    private func forget() {
        defaults.removeObject(forKey: Self.userKey)
        do {
            try session.drop()
        } catch {
            Self.log.error("token not dropped: \(String(describing: error), privacy: .public)")
        }
    }

    private func fail(_ failure: SignInFailure) {
        Self.log.info("sign-in ended: \(String(describing: failure), privacy: .public)")
        state = .signedOut(failure)
    }
}

/// The system's sign-in sheet on a start address, answering with the callback it was sent to.
protocol SignInSheet {
    func open(_ url: URL) async -> Result<URL, SignInFailure>
}

/// A private sheet: no cookie of the identity provider outlives it, so signing out of the app is
/// complete, and iOS shows no consent alert before opening it.
final class SystemSignInSheet: NSObject, SignInSheet, ASWebAuthenticationPresentationContextProviding {
    // Kept alive until the sheet answers: the system drops a session nobody holds.
    private var session: ASWebAuthenticationSession?
    /// The window the sheet rises over, found before it starts.
    private var window: UIWindow?

    func open(_ url: URL) async -> Result<URL, SignInFailure> {
        guard session == nil, let window = Self.keyWindow() else { return .failure(.failed) }
        self.window = window
        defer {
            session = nil
            self.window = nil
        }
        return await withCheckedContinuation { continuation in
            // Sendable and off the main actor: the system may answer on any queue.
            let session = ASWebAuthenticationSession(
                url: url, callback: .customScheme(SignInFlow.callbackScheme)
            ) { @Sendable callback, error in
                if let callback { return continuation.resume(returning: .success(callback)) }
                let cancelled = (error as? ASWebAuthenticationSessionError)?.code == .canceledLogin
                continuation.resume(returning: .failure(cancelled ? .cancelled : .failed))
            }
            session.prefersEphemeralWebBrowserSession = true
            session.presentationContextProvider = self
            self.session = session
            if !session.start() { continuation.resume(returning: .failure(.failed)) }
        }
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        // Set before the session starts and cleared only once it has answered.
        window!
    }

    private static func keyWindow() -> UIWindow? {
        let windows = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.flatMap(\.windows)
        return windows.first(where: \.isKeyWindow) ?? windows.first
    }
}
