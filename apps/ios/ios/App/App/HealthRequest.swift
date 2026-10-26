import Foundation

// What the page may ask of Apple Health, decoded against fixed shapes: an operation the app does
// not know, a key it does not expect, a value out of range or more than 100 objects is refused
// before Health is touched. Foundation only, so these rules also run in a plain check on a Mac.

enum HealthOp: String, Decodable { case status, authorize, apply, readWeighings }
enum HealthScope: String, Decodable { case write, `import` }
enum HealthKind: String, Decodable { case workout, workoutRemoved, weighing, weighingRemoved }
enum HealthOutcome: String { case written, removed, overlap, denied, unavailable, failed }

// The objects, field for field as the page writes them (epoch milliseconds, YYYY-MM-DD, kg).
struct HealthWorkout: Decodable, Equatable {
    let kind: HealthKind
    let id: String
    let startedAt: Date
    let endedAt: Date
    let version: Int64
}
struct HealthWorkoutRemoved: Decodable, Equatable {
    let kind: HealthKind
    let id: String
}
struct HealthWeighing: Decodable, Equatable {
    let kind: HealthKind
    let date: String
    let kg: Double
    let at: Date
    let version: Int64
}
struct HealthWeighingRemoved: Decodable, Equatable {
    let kind: HealthKind
    let date: String
}

enum HealthObject: Equatable {
    case workout(HealthWorkout)
    case workoutRemoved(HealthWorkoutRemoved)
    case weighing(HealthWeighing)
    case weighingRemoved(HealthWeighingRemoved)
}

enum HealthRequest: Equatable {
    case status
    case authorize(HealthScope)
    case apply([HealthObject])
    case readWeighings(anchor: String?, since: Date)

    static let maxObjects = 100
    // The anchor is an archived HKQueryAnchor this side handed out, in base64: a fixed ceiling
    // keeps any other string from reaching the unarchiver at whatever size.
    static let maxAnchor = 4_096

    static func from(_ value: Any?) throws -> HealthRequest {
        // JSONSerialization raises an Objective-C exception, not a Swift error, on a value it
        // cannot write, so the check comes first.
        guard let value, JSONSerialization.isValidJSONObject(value) else {
            throw CocoaError(.coderInvalidValue)
        }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .millisecondsSince1970
        return try decoder.decode(HealthRequest.self, from: JSONSerialization.data(withJSONObject: value))
    }
}

// Every key a container holds, the unexpected ones included.
private struct AnyKey: CodingKey {
    let stringValue: String
    var intValue: Int? { nil }
    init(stringValue: String) { self.stringValue = stringValue }
    init?(intValue: Int) { nil }
}

private func refuse(_ decoder: Decoder, _ why: String) -> DecodingError {
    .dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: why))
}

private func expectKeys(_ decoder: Decoder, _ keys: Set<String>) throws {
    let found = Set(try decoder.container(keyedBy: AnyKey.self).allKeys.map(\.stringValue))
    guard found == keys else { throw refuse(decoder, "unexpected keys") }
}

// The day becomes part of a sync identifier, so ASCII digits only: `\d` takes any script's digits.
private func isDay(_ date: String) -> Bool {
    date.range(of: #"^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$"#, options: .regularExpression) != nil
}

// The id becomes part of a sync identifier, so only the form the page writes: a UUID parser alone
// would accept the same id in capitals (a second identifier for one session) or followed by a NUL.
private func isSessionID(_ id: String) -> Bool {
    UUID(uuidString: id)?.uuidString.lowercased() == id
}

// The page dates sessions and weigh-ins from 1900-01-01, and 08:00 on that day east of UTC is still
// 1899-12-31 in UTC. Nothing is more than a day ahead of this phone's clock, and a workout lasts a
// day at most.
private let earliest = Date(timeIntervalSince1970: -2_209_161_600) // 1899-12-31T00:00:00Z
private let day: TimeInterval = 86_400

private func isTime(_ date: Date) -> Bool {
    date >= earliest && date <= Date().addingTimeInterval(day)
}

extension HealthObject: Decodable {
    private enum Keys: String, CodingKey { case kind }

    init(from decoder: Decoder) throws {
        switch try decoder.container(keyedBy: Keys.self).decode(HealthKind.self, forKey: .kind) {
        case .workout:
            try expectKeys(decoder, ["kind", "id", "startedAt", "endedAt", "version"])
            let w = try HealthWorkout(from: decoder)
            guard isSessionID(w.id), isTime(w.startedAt), isTime(w.endedAt), w.endedAt > w.startedAt,
                  w.endedAt.timeIntervalSince(w.startedAt) <= day, w.version > 0
            else {
                throw refuse(decoder, "workout out of range")
            }
            self = .workout(w)
        case .workoutRemoved:
            try expectKeys(decoder, ["kind", "id"])
            let w = try HealthWorkoutRemoved(from: decoder)
            guard isSessionID(w.id) else { throw refuse(decoder, "id invalid") }
            self = .workoutRemoved(w)
        case .weighing:
            try expectKeys(decoder, ["kind", "date", "kg", "at", "version"])
            let w = try HealthWeighing(from: decoder)
            guard isDay(w.date), w.kg.isFinite, (20...400).contains(w.kg), isTime(w.at), w.version > 0 else {
                throw refuse(decoder, "weighing out of range")
            }
            self = .weighing(w)
        case .weighingRemoved:
            try expectKeys(decoder, ["kind", "date"])
            let w = try HealthWeighingRemoved(from: decoder)
            guard isDay(w.date) else { throw refuse(decoder, "date invalid") }
            self = .weighingRemoved(w)
        }
    }
}

extension HealthRequest: Decodable {
    private enum Keys: String, CodingKey { case op, scope, objects, anchor, since }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Keys.self)
        switch try c.decode(HealthOp.self, forKey: .op) {
        case .status:
            try expectKeys(decoder, ["op"])
            self = .status
        case .authorize:
            try expectKeys(decoder, ["op", "scope"])
            self = .authorize(try c.decode(HealthScope.self, forKey: .scope))
        case .apply:
            try expectKeys(decoder, ["op", "objects"])
            // Counted before any object is decoded, so an oversized batch costs nothing.
            var list = try c.nestedUnkeyedContainer(forKey: .objects)
            guard let count = list.count, count <= Self.maxObjects else {
                throw refuse(decoder, "too many objects")
            }
            var objects: [HealthObject] = []
            while !list.isAtEnd { objects.append(try list.decode(HealthObject.self)) }
            self = .apply(objects)
        case .readWeighings:
            try expectKeys(decoder, ["op", "anchor", "since"])
            let since = try c.decode(Date.self, forKey: .since)
            guard isTime(since) else { throw refuse(decoder, "since out of range") }
            let anchor = try c.decodeIfPresent(String.self, forKey: .anchor)
            guard (anchor?.count ?? 0) <= Self.maxAnchor else { throw refuse(decoder, "anchor too long") }
            self = .readWeighings(anchor: anchor, since: since)
        }
    }
}

// The one rule of Belay's on this side: another app's workout covering at least half of the
// session means a watch (or another app) already recorded it, and Fitness would list it twice.
// A walk to the gym that ends as the session starts covers a few percent and changes nothing.
enum HealthRules {
    static let overlapShare = 0.5

    static func overlaps(_ session: DateInterval, _ others: [DateInterval]) -> Bool {
        others.contains { other in
            (session.intersection(with: other)?.duration ?? 0) >= overlapShare * session.duration
        }
    }
}
