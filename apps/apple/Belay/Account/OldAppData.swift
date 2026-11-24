import Foundation
import WebKit
import os

/// What the app before this one left in its web view: cookies, local storage, databases and
/// caches, among them its session. This app never opens a web view, so it all goes, once, at the
/// first launch after the update. Only the web view's own data types are removed: the Keychain,
/// the account's store, its loops and the phone's preferences are not web data.
@MainActor
enum OldAppData {
    static let doneKey = "belay.oldWebDataErased"

    enum Outcome: Equatable {
        case erased(records: Int)
        case skipped
        case failed
    }

    private static let log = Logger(subsystem: "cloud.libresoftware.belay", category: "old-app-data")

    /// Removes every web data record from `store` unless it was done before; the key is set only
    /// once nothing is left, so a removal that falls short runs again at the next launch.
    @discardableResult
    static func eraseOnce(
        in store: WKWebsiteDataStore = .default(), defaults: UserDefaults = .standard
    ) async -> Outcome {
        guard !defaults.bool(forKey: doneKey) else { return .skipped }
        let types = WKWebsiteDataStore.allWebsiteDataTypes()
        let records = await store.dataRecords(ofTypes: types)
        await store.removeData(ofTypes: types, for: records)
        // WebKit reports no error for a removal: what it leaves behind is the only sign of one.
        let left = await store.dataRecords(ofTypes: types)
        guard left.isEmpty else {
            log.error("old web data not erased: records remain after the removal")
            return .failed
        }
        defaults.set(true, forKey: doneKey)
        return .erased(records: records.count)
    }
}
