import AuthenticationServices
import BelayCore
import Foundation
import Network
import os

/// The person signed in: who they are on which instance, and the session token that proves it.
struct Account: Equatable {
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

    private(set) var state: State = .signedOut(nil) {
        didSet { followState() }
    }
    /// The signed-in account's records on this phone; nil while signed out, or when its file did
    /// not open (`openStore` tries again).
    private(set) var store: AccountStore?
    /// Why the address typed last was not taken, said apart from a sign-in's own failures.
    private(set) var addressProblem: InstanceError?
    /// What the screen says of the open store's sync: a run under way keeps the last line, so it
    /// never blinks; idle while signed out.
    private(set) var syncStatus: SyncStatus = .idle
    /// How the instance names the person, for Accueil's greeting; nil before it has said so.
    private(set) var displayName: String?

    /// Whom the open store and its sync were opened for. Another person, instance or token closes
    /// both first, so one account's queue never goes out under another's token.
    private var openedFor: Account?
    private var engine: SyncEngine?
    private var following: Task<Void, Never>?
    /// A sign-in again is under way: a second tap waits for its sheet.
    private var reconnecting = false
    /// The network coming back is a trigger: the queue may have waited for it.
    private let path = NWPathMonitor()

    private let session: StoredSession
    private let http: HTTPClient
    private let sheet: SignInSheet
    private let defaults: UserDefaults
    /// Where each account's store lives: the app's own Application Support, never a shared container.
    private let storeFolder: URL
    private let health: any HealthWriting
    /// One Health run at a time; a trigger during a run gives one more run after it.
    private var healthRunning = false
    private var healthAgain = false

    private static let log = Logger(subsystem: "cloud.libresoftware.belay", category: "account")

    init(
        secrets: SecretStore = KeychainStore(), http: HTTPClient = URLSessionClient(),
        sheet: SignInSheet = SystemSignInSheet(), defaults: UserDefaults = .standard,
        storeFolder: URL = URL.applicationSupportDirectory.appending(path: "Stores", directoryHint: .isDirectory),
        health: any HealthWriting = HealthKitWriter()
    ) {
        session = StoredSession(store: secrets, defaults: defaults)
        self.http = http
        self.sheet = sheet
        self.defaults = defaults
        self.storeFolder = storeFolder
        self.health = health
        if let instance = storedInstance, let token = session.token(origin: instance.origin.absoluteString),
           let userId = session.userId {
            state = .signedIn(Account(userId: userId, instance: instance, token: token))
            displayName = session.displayName
        }
        // An assignment in init does not run didSet.
        followState()
        path.pathUpdateHandler = { [weak self] path in
            guard path.status == .satisfied else { return }
            Task { @MainActor in self?.refresh() }
        }
        path.start(queue: .main)
    }

    /// The store and its sync are open exactly while signed in. Signing out closes them and keeps
    /// the file, queue included, for that account's next sign-in.
    private func followState() {
        guard case .signedIn(let account) = state else { return closeStore() }
        if openedFor != account { closeStore() }
        if store == nil { openStore() }
    }

    /// Opens the signed-in account's store and syncs it; on failure the app says so and offers to
    /// try again.
    func openStore() {
        guard case .signedIn(let account) = state, store == nil else { return }
        let store: AccountStore
        do {
            store = try AccountStore.open(userId: account.userId, origin: account.instance.origin, in: storeFolder)
        } catch {
            Self.log.error("store not opened: \(AccountStore.logLabel(error), privacy: .public)")
            return
        }
        self.store = store
        openedFor = account
        let engine = SyncEngine(
            userId: account.userId, store: store,
            transport: HTTPTransport(instance: account.instance, token: account.token, client: http),
            onLanded: { [weak self] in await self?.landed(store) })
        self.engine = engine
        following = Task { [weak self] in
            for await status in engine.statuses() {
                guard let self else { return }
                syncStatus = status.noticed(after: syncStatus)
            }
        }
        Task { await engine.sync() }
    }

    private func closeStore() {
        if let engine { Task { await engine.stop() } }
        engine = nil
        following?.cancel()
        following = nil
        store = nil
        openedFor = nil
        syncStatus = .idle
    }

    /// After a write to the store: the sync follows once writes pause.
    func didWrite() {
        guard let engine else { return }
        Task { await engine.schedule() }
    }

    /// Back in front, or the network back: the run going, if any, is fresh enough.
    func refresh() {
        guard let engine else { return }
        Task { await engine.refresh() }
    }

    /// A complete pull: what is stored is current, so a session left open elsewhere can be closed.
    private func landed(_ store: AccountStore) {
        // A sync of the store just closed lands nowhere: its account is gone from this screen.
        guard store === self.store else { return }
        do {
            if try store.closeForgotten(now: Date()) { didWrite() }
        } catch {
            Self.log.error("forgotten sessions not closed: \(AccountStore.logLabel(error), privacy: .public)")
        }
        // What other devices finished, changed or removed is here now.
        runHealth()
    }

    /// Brings Health in line with the open store: after a landed sync, a finish and a summary left.
    /// Each run reads the store as it is, so a trigger missed is caught by the next one.
    func runHealth() {
        guard let store, case .signedIn(let account) = state else { return }
        if healthRunning {
            healthAgain = true
            return
        }
        healthRunning = true
        let owner = ownerOf(account.userId)
        let health = health
        Task { [weak self] in
            repeat {
                self?.healthAgain = false
                await BelayCore.runHealth(store: store, writer: health, owner: owner, now: Date())
            } while self?.healthAgain == true && self?.store === store
            self?.healthRunning = false
        }
    }

    /// The Santé switch turned on: iOS is asked now, never at launch, and the switch stays on only
    /// when it lets Belay write workouts. Whether it did.
    func turnHealthOn() async -> Bool {
        guard let store else { return false }
        do {
            try await health.authorize()
        } catch {
            Self.log.error("health not asked: \(AccountStore.logLabel(error), privacy: .public)")
        }
        let access = await health.access()
        guard access.available, access.workouts == .allowed else { return false }
        do {
            try store.setHealthOn(true, now: Date())
        } catch {
            Self.log.error("health switch not kept: \(AccountStore.logLabel(error), privacy: .public)")
            return false
        }
        runHealth()
        return true
    }

    /// Off stops every write and deletion and leaves what Health holds. Whether it was kept.
    func turnHealthOff() -> Bool {
        do {
            try store?.setHealthOn(false, now: Date())
            return true
        } catch {
            Self.log.error("health switch not kept: \(AccountStore.logLabel(error), privacy: .public)")
            return false
        }
    }

    /// The token was refused: the sheet opens on the same instance while the store stays open, so
    /// the person keeps logging. The account changes only once the instance names the new token's
    /// owner, and the refused token is then ended on the instance; a sheet closed or a sign-in that
    /// fails leaves all of it as it was, the notice still offering to try again.
    func reconnect() async {
        guard case .signedIn(let account) = state, !reconnecting else { return }
        reconnecting = true
        defer { reconnecting = false }
        let instance = account.instance
        let renewal: SignInFlow.Renewal
        switch await SignInFlow.renew(at: instance, using: http, open: openSheet) {
        case .success(let renewed): renewal = renewed
        case .failure(let failure):
            Self.log.info("reconnect ended: \(String(describing: failure), privacy: .public)")
            return
        }
        // Signed out while the sheet was up: the new session has no account to go to.
        guard case .signedIn(account) = state else {
            return await logout(token: renewal.token, at: instance, using: http)
        }
        do {
            try await SignInFlow.replace(account.token, with: renewal, at: instance, using: http) { [self] in
                try session.keep(origin: instance.origin.absoluteString, token: renewal.token)
                remember(renewal.me)
                // Another person signing in here gets their own store: the new account differs, so
                // the store and its sync reopen for it.
                state = .signedIn(Account(userId: renewal.me.id, instance: instance, token: renewal.token))
            }
        } catch {
            Self.log.error("token not kept: \(String(describing: error), privacy: .public)")
        }
    }

    /// The system sheet, from the core's sign-in steps.
    private var openSheet: @Sendable (URL) async -> Result<URL, SignInFailure> {
        { @MainActor [self] url in await sheet.open(url) }
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

    /// A sign-in the instance could not answer for (`open` met it unreachable) kept its token with
    /// no owner beside it: at the next launch the instance names the owner once. The app before
    /// this one kept its address elsewhere, so its token is never taken up here: the person signs
    /// in once after the replacement.
    func finishSignIn() async {
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
        let token: String
        switch await SignInFlow.authorize(at: instance, using: http, open: openSheet) {
        case .success(let earned): token = earned
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

    private func remember(_ me: Me) {
        session.remember(userId: me.id, displayName: me.displayName)
        displayName = me.displayName
    }

    /// Signed in once the instance names who `token` belongs to; a token it refuses is dropped.
    private func open(token: String, at instance: Instance) async {
        switch await me(token: token, at: instance, using: http) {
        case .success(let me):
            remember(me)
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
        displayName = nil
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
