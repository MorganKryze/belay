import Foundation
import HealthKit

// Belay's finished sessions and weigh-ins in Apple Health, and the weigh-ins other apps wrote
// there. Which session, which version, which day: the page decides all of it from the phone's
// data; this side carries out one decoded request and answers object by object.
enum Health {
    private static let store = HKHealthStore()
    private static let workouts = HKObjectType.workoutType()
    private static let bodyMass = HKQuantityType(.bodyMass)
    private static let kilograms = HKUnit.gramUnit(with: .kilo)
    // Carried by every workout Belay writes, so a later watch app can recognise them.
    static let sessionKey = "BelaySessionID"

    static func handle(_ request: HealthRequest) async throws -> [String: Any] {
        switch request {
        case .status:
            return status()
        case .authorize(let scope):
            try await authorize(scope)
            return status()
        case .apply(let objects):
            var outcomes: [String] = []
            for object in objects { outcomes.append(await apply(object).rawValue) }
            return ["outcomes": outcomes]
        case .readWeighings(let anchor, let since):
            return try await readWeighings(anchor: anchor, since: since)
        }
    }

    // Write access per type. iOS never tells an app whether it may read.
    static func status() -> [String: Any] {
        guard HKHealthStore.isHealthDataAvailable() else {
            return ["available": false, "workouts": "undetermined", "weighings": "undetermined"]
        }
        return ["available": true, "workouts": access(workouts), "weighings": access(bodyMass)]
    }

    private static func access(_ type: HKObjectType) -> String {
        switch store.authorizationStatus(for: type) {
        case .sharingAuthorized: return "allowed"
        case .sharingDenied: return "denied"
        default: return "undetermined"
        }
    }

    // iOS shows its sheet only for the types never asked: writing both, reading workouts for the
    // overlap check; the import asks to read body mass on its own, after the page's consent.
    private static func authorize(_ scope: HealthScope) async throws {
        guard HKHealthStore.isHealthDataAvailable() else { return }
        switch scope {
        case .write:
            try await store.requestAuthorization(toShare: [workouts, bodyMass], read: [workouts])
        case .import:
            try await store.requestAuthorization(toShare: [], read: [bodyMass])
        }
    }

    private static func allowed(_ type: HKObjectType) -> Bool {
        store.authorizationStatus(for: type) == .sharingAuthorized
    }

    private static func apply(_ object: HealthObject) async -> HealthOutcome {
        do {
            switch object {
            case .workout(let w):
                guard allowed(workouts) else { return .denied }
                if await overlapped(w) { return .overlap }
                try await save(w)
                return .written
            case .workoutRemoved(let w):
                guard allowed(workouts) else { return .denied }
                try await delete(workouts, "belay-session-\(w.id)")
                return .removed
            case .weighing(let w):
                guard allowed(bodyMass) else { return .denied }
                try await store.save(sample(w))
                return .written
            case .weighingRemoved(let w):
                guard allowed(bodyMass) else { return .denied }
                try await delete(bodyMass, "belay-weighing-\(w.date)")
                return .removed
            }
        } catch {
            return outcome(of: error)
        }
    }

    // A locked phone keeps Health's store closed: the object waits for the next run.
    private static func outcome(of error: Error) -> HealthOutcome {
        guard let error = error as? HKError else { return .failed }
        switch error.code {
        case .errorAuthorizationDenied, .errorAuthorizationNotDetermined: return .denied
        case .errorDatabaseInaccessible, .errorHealthDataUnavailable, .errorHealthDataRestricted:
            return .unavailable
        default: return .failed
        }
    }

    // The session's start and end and nothing measured: no energy, no heart rate, no events. The
    // sync identifier and a greater version make a second save replace the first.
    private static func save(_ w: HealthWorkout) async throws {
        let configuration = HKWorkoutConfiguration()
        configuration.activityType = .traditionalStrengthTraining
        configuration.locationType = .indoor
        let builder = HKWorkoutBuilder(healthStore: store, configuration: configuration, device: .local())
        try await builder.beginCollection(at: w.startedAt)
        try await builder.addMetadata([
            HKMetadataKeySyncIdentifier: "belay-session-\(w.id)",
            HKMetadataKeySyncVersion: NSNumber(value: w.version),
            HKMetadataKeyIndoorWorkout: true,
            sessionKey: w.id,
        ])
        try await builder.endCollection(at: w.endedAt)
        _ = try await builder.finishWorkout()
    }

    private static func sample(_ w: HealthWeighing) -> HKQuantitySample {
        HKQuantitySample(
            type: bodyMass,
            quantity: HKQuantity(unit: kilograms, doubleValue: w.kg),
            start: w.at,
            end: w.at,
            metadata: [
                HKMetadataKeySyncIdentifier: "belay-weighing-\(w.date)",
                HKMetadataKeySyncVersion: NSNumber(value: w.version),
                HKMetadataKeyWasUserEntered: true,
            ]
        )
    }

    // Only Belay's own objects carry its sync identifiers, and iOS lets an app delete only what it
    // wrote; the source is matched too, so neither rule alone decides. Nothing left to match (the
    // person already deleted it in Health) is the same outcome, not a failure retried at every run.
    private static func delete(_ type: HKObjectType, _ syncIdentifier: String) async throws {
        let predicate = NSCompoundPredicate(andPredicateWithSubpredicates: [
            HKQuery.predicateForObjects(withMetadataKey: HKMetadataKeySyncIdentifier, allowedValues: [syncIdentifier]),
            HKQuery.predicateForObjects(from: HKSource.default()),
        ])
        do {
            _ = try await store.deleteObjects(of: type, predicate: predicate)
        } catch let error as HKError where error.code == .errorNoData {
            return
        }
    }

    // Another source's workout covering half the session or more. A refused read answers as an
    // empty Health, and so does a failed query: the session is then written.
    private static func overlapped(_ w: HealthWorkout) async -> Bool {
        let predicate = HKQuery.predicateForSamples(withStart: w.startedAt, end: w.endedAt, options: [])
        let found: [HKSample] = await withCheckedContinuation { done in
            store.execute(HKSampleQuery(
                sampleType: workouts, predicate: predicate, limit: HKObjectQueryNoLimit,
                sortDescriptors: nil
            ) { _, samples, _ in done.resume(returning: samples ?? []) })
        }
        let own = HKSource.default()
        let others = found
            .filter { $0.sourceRevision.source != own && $0.metadata?[sessionKey] == nil }
            .map { DateInterval(start: $0.startDate, end: $0.endDate) }
        return HealthRules.overlaps(DateInterval(start: w.startedAt, end: w.endedAt), others)
    }

    // Body-mass samples from `since` that Health received after the anchor, Belay's own left out.
    // Deletions are not followed: a weigh-in once in Belay stays the person's there.
    private static func readWeighings(anchor: String?, since: Date) async throws -> [String: Any] {
        let start = anchor
            .flatMap { Data(base64Encoded: $0) }
            .flatMap { try? NSKeyedUnarchiver.unarchivedObject(ofClass: HKQueryAnchor.self, from: $0) }
        let predicate = HKQuery.predicateForSamples(withStart: since, end: nil, options: .strictStartDate)
        let (samples, next): ([HKSample], HKQueryAnchor?) = try await withCheckedThrowingContinuation { done in
            store.execute(HKAnchoredObjectQuery(
                type: bodyMass, predicate: predicate, anchor: start, limit: HKObjectQueryNoLimit
            ) { _, samples, _, next, error in
                if let error { return done.resume(throwing: error) }
                done.resume(returning: (samples ?? [], next))
            })
        }
        let own = HKSource.default()
        let read: [[String: Any]] = samples.compactMap { $0 as? HKQuantitySample }
            .filter { sample in
                let id = sample.metadata?[HKMetadataKeySyncIdentifier] as? String
                return sample.sourceRevision.source != own && !(id?.hasPrefix("belay-weighing-") ?? false)
            }
            .map { ["startedAt": ($0.startDate.timeIntervalSince1970 * 1000).rounded(),
                    "kg": $0.quantity.doubleValue(for: kilograms)] }
        let kept = try next.map {
            try NSKeyedArchiver.archivedData(withRootObject: $0, requiringSecureCoding: true).base64EncodedString()
        }
        return ["samples": read, "anchor": kept ?? anchor ?? ""]
    }
}
