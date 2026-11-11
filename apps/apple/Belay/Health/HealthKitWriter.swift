import BelayCore
import Foundation
import HealthKit

/// Apple Health for the core's run: a finished session as a workout, its effort as a score
/// related to it. Which session and which version is the core's call; this side carries out one
/// object and answers how it went. Nothing but the span, the identifiers, the version and the
/// score reaches Health.
nonisolated struct HealthKitWriter: HealthWriting {
    private static let store = HKHealthStore()
    private static let workouts = HKObjectType.workoutType()
    private static let effort = HKQuantityType(.workoutEffortScore)
    // Carried by every workout Belay writes, so a later watch app can recognise them.
    static let sessionKey = "BelaySessionID"
    // Another source's workout covering this share of the session or more means a watch, or
    // another app, already recorded it, and Fitness would list it twice. A walk to the gym that
    // ends as the session starts covers a few percent and changes nothing.
    static let overlapShare = 0.5

    /// Health exists on this device: an iPad without it shows no switch.
    static var available: Bool { HKHealthStore.isHealthDataAvailable() }

    func access() async -> HealthAccess {
        guard HKHealthStore.isHealthDataAvailable() else {
            return HealthAccess(available: false, workouts: .undetermined, effort: .undetermined)
        }
        return HealthAccess(
            available: true, workouts: Self.permission(Self.workouts), effort: Self.permission(Self.effort))
    }

    /// iOS shows its sheet only for the types never asked; the request still names every type each
    /// time, since one naming fewer types to write takes back the right to write the others.
    func authorize() async throws {
        guard HKHealthStore.isHealthDataAvailable() else { return }
        try await Self.store.requestAuthorization(
            toShare: Set(HealthAccessRequest.share.map(Self.sampleType)),
            read: Set(HealthAccessRequest.read.map(Self.sampleType)))
    }

    func save(_ w: HealthObject, syncId: String) async -> HealthOutcome {
        guard case .workout(let id, let startedAt, let endedAt, let version) = w else { return .failed }
        guard Self.permission(Self.workouts) == .allowed else { return .denied }
        do {
            let configuration = HKWorkoutConfiguration()
            configuration.activityType = .traditionalStrengthTraining
            configuration.locationType = .indoor
            let builder = HKWorkoutBuilder(healthStore: Self.store, configuration: configuration, device: .local())
            try await builder.beginCollection(at: Self.date(startedAt))
            // The sync identifier and a greater version make a second save replace the first.
            try await builder.addMetadata([
                HKMetadataKeySyncIdentifier: syncId,
                HKMetadataKeySyncVersion: NSNumber(value: version),
                HKMetadataKeyIndoorWorkout: true,
                Self.sessionKey: id,
            ])
            try await builder.endCollection(at: Self.date(endedAt))
            _ = try await builder.finishWorkout()
            return .written
        } catch {
            return Self.outcome(of: error)
        }
    }

    /// Only Belay's own workouts carry its sync identifiers, and iOS lets an app delete only what
    /// it wrote; the source is matched too, so neither rule alone decides. Nothing left to match
    /// (the person already deleted it in Health) is the same outcome, not a failure retried at
    /// every run.
    func delete(syncId: String) async -> HealthOutcome {
        guard Self.permission(Self.workouts) == .allowed else { return .denied }
        do {
            _ = try await Self.store.deleteObjects(of: Self.workouts, predicate: Self.own(syncId))
            return .removed
        } catch let error as HKError where error.code == .errorNoData {
            return .removed
        } catch {
            return Self.outcome(of: error)
        }
    }

    /// A refused read answers as an empty Health, and so does a failed query: the session is then
    /// written.
    func overlaps(startedAt: Int64, endedAt: Int64) async -> Bool {
        let span = DateInterval(start: Self.date(startedAt), end: Self.date(endedAt))
        let descriptor = HKSampleQueryDescriptor(
            predicates: [.workout(HKQuery.predicateForSamples(withStart: span.start, end: span.end))],
            sortDescriptors: [])
        let found = (try? await descriptor.result(for: Self.store)) ?? []
        let own = HKSource.default()
        return found.contains { other in
            guard other.sourceRevision.source != own, other.metadata?[Self.sessionKey] == nil else { return false }
            let covered = span.intersection(with: DateInterval(start: other.startDate, end: other.endDate))
            return (covered?.duration ?? 0) >= Self.overlapShare * span.duration
        }
    }

    /// The score as its own sample over the workout's span, related to the workout Belay wrote.
    /// The score left by an earlier try goes first: one saved but not related, one related but not
    /// recorded on the phone, or one related to a workout since replaced. Its sync identifier names
    /// it; the version, the time of this try, also has a later try replace it should one remain.
    func relateEffort(score: Int, syncId: String, effortSyncId: String) async -> HealthOutcome {
        guard Self.permission(Self.effort) == .allowed else { return .denied }
        do {
            let descriptor = HKSampleQueryDescriptor(
                predicates: [.workout(Self.own(syncId))], sortDescriptors: [], limit: 1)
            guard let workout = try await descriptor.result(for: Self.store).first else { return .failed }
            do {
                _ = try await Self.store.deleteObjects(of: Self.effort, predicate: Self.own(effortSyncId))
            } catch let error as HKError where error.code == .errorNoData {
                // Nothing left from an earlier try.
            }
            let sample = HKQuantitySample(
                type: Self.effort, quantity: HKQuantity(unit: .appleEffortScore(), doubleValue: Double(score)),
                start: workout.startDate, end: workout.endDate,
                metadata: [
                    HKMetadataKeySyncIdentifier: effortSyncId,
                    HKMetadataKeySyncVersion: NSNumber(value: Int64(Date().timeIntervalSince1970 * 1000)),
                ])
            try await Self.store.save(sample)
            _ = try await Self.store.relateWorkoutEffortSample(sample, with: workout, activity: nil)
            return .written
        } catch {
            return Self.outcome(of: error)
        }
    }

    private static func own(_ syncId: String) -> NSPredicate {
        NSCompoundPredicate(andPredicateWithSubpredicates: [
            HKQuery.predicateForObjects(withMetadataKey: HKMetadataKeySyncIdentifier, allowedValues: [syncId]),
            HKQuery.predicateForObjects(from: HKSource.default()),
        ])
    }

    private static func permission(_ type: HKObjectType) -> HealthPermission {
        switch store.authorizationStatus(for: type) {
        case .sharingAuthorized: .allowed
        case .sharingDenied: .denied
        default: .undetermined
        }
    }

    private static func sampleType(_ type: HealthType) -> HKSampleType {
        switch type {
        case .workouts: workouts
        case .effort: effort
        }
    }

    private static func date(_ ms: Int64) -> Date { Date(timeIntervalSince1970: Double(ms) / 1000) }

    /// A locked phone keeps Health's store closed: the object waits for the next run.
    private static func outcome(of error: any Error) -> HealthOutcome {
        guard let error = error as? HKError else { return .failed }
        switch error.code {
        case .errorAuthorizationDenied, .errorAuthorizationNotDetermined: return .denied
        case .errorDatabaseInaccessible, .errorHealthDataUnavailable, .errorHealthDataRestricted: return .unavailable
        default: return .failed
        }
    }
}
