import Foundation

// The Health bridge's page-facing rules, run on a Mac without a simulator:
// `pnpm --filter @belay/mobile check:swift` compiles this file with HealthRequest.swift.
@main
struct HealthRequestCheck {
    static var failures = 0

    static func check(_ name: String, _ ok: Bool) {
        print("\(ok ? "ok" : "FAIL")  \(name)")
        if !ok { failures += 1 }
    }

    static func decodes(_ json: String) -> HealthRequest? {
        let value = try? JSONSerialization.jsonObject(with: Data(json.utf8))
        return try? HealthRequest.from(value)
    }

    // Why a request was refused, as the decoder words it.
    static func refusal(_ json: String) -> String? {
        let value = try? JSONSerialization.jsonObject(with: Data(json.utf8))
        do { _ = try HealthRequest.from(value) } catch let DecodingError.dataCorrupted(context) {
            return context.debugDescription
        } catch { return "\(error)" }
        return nil
    }

    static let id = "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7d01"
    static func workout(
        _ extra: String = "", started: Int64 = 0, ended: Int64 = 3_600_000, version: Int = 5
    ) -> String {
        #"{"kind":"workout","id":"\#(id)","startedAt":\#(started),"endedAt":\#(ended),"version":\#(version)\#(extra)}"#
    }
    static let owner = "0a1b2c3d"
    static func weighing(at: Int64) -> String {
        #"{"kind":"weighing","owner":"\#(owner)","date":"1900-01-01","kg":80,"at":\#(at),"version":1}"#
    }
    static func apply(_ objects: String...) -> HealthRequest? {
        decodes(#"{"op":"apply","objects":[\#(objects.joined(separator: ","))]}"#)
    }

    static func main() {
        check("status decodes", decodes(#"{"op":"status"}"#) == .status)
        check("an unknown key is refused", decodes(#"{"op":"status","x":1}"#) == nil)
        check("an unknown operation is refused", decodes(#"{"op":"delete"}"#) == nil)
        check("authorize import decodes", decodes(#"{"op":"authorize","scope":"import"}"#) == .authorize(.import))
        check("authorize history decodes", decodes(#"{"op":"authorize","scope":"history"}"#) == .authorize(.history))
        check("an unknown scope is refused", decodes(#"{"op":"authorize","scope":"read"}"#) == nil)

        let one = decodes(#"{"op":"apply","objects":[\#(workout())]}"#)
        check("a workout decodes with its times in milliseconds", one == .apply([.workout(HealthWorkout(
            kind: .workout, id: id, startedAt: Date(timeIntervalSince1970: 0),
            endedAt: Date(timeIntervalSince1970: 3600), version: 5))]))
        check("a workout ending at its start is refused",
              decodes(#"{"op":"apply","objects":[\#(workout(ended: 0))]}"#) == nil)
        check("a workout with version 0 is refused",
              decodes(#"{"op":"apply","objects":[\#(workout(version: 0))]}"#) == nil)
        check("a workout with a name is refused",
              decodes(#"{"op":"apply","objects":[\#(workout(#","name":"A""#))]}"#) == nil)
        check("an id that is no session id is refused",
              decodes(#"{"op":"apply","objects":[{"kind":"workoutRemoved","id":"../x"}]}"#) == nil)

        // A NUL as JSON escapes it: UUID(uuidString:) stops reading there.
        check("an id followed by a NUL and more text is refused",
              decodes(#"{"op":"apply","objects":[{"kind":"workoutRemoved","id":"\#(id)\u0000../x"}]}"#) == nil)
        check("an uppercase id is refused",
              decodes(#"{"op":"apply","objects":[{"kind":"workoutRemoved","id":"\#(id.uppercased())"}]}"#) == nil)
        check("a workout with an uppercase id is refused",
              decodes(#"{"op":"apply","objects":[\#(workout().replacingOccurrences(of: id, with: id.uppercased()))]}"#) == nil)
        check("a removal with a lowercase id decodes",
              decodes(#"{"op":"apply","objects":[{"kind":"workoutRemoved","id":"\#(id)"}]}"#) != nil)

        // The page dates weigh-ins and sessions from 1900-01-01; 08:00 that day east of UTC is
        // still 1899-12-31 in UTC.
        let floor: Int64 = -2_209_075_200_000 // 1899-12-31T00:00:00Z, the page's Date.UTC(1899, 11, 31)
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        let hour: Int64 = 3_600_000
        check("a weigh-in at 08:00 on 1900-01-01 in Tokyo decodes", apply(weighing(at: floor + 23 * hour)) != nil)
        check("a weigh-in at 1899-12-31T00:00Z exactly decodes", apply(weighing(at: floor)) != nil)
        check("a weigh-in before 1899-12-31 is refused", apply(weighing(at: floor - 1)) == nil)
        check("a weigh-in two days ahead is refused", apply(weighing(at: now + 48 * hour)) == nil)
        check("a weigh-in an hour ahead decodes", apply(weighing(at: now + hour)) != nil)
        check("a workout starting before 1899-12-31 is refused",
              apply(workout(started: floor - 1, ended: floor + hour)) == nil)
        check("a workout ending two days ahead is refused",
              apply(workout(started: now, ended: now + 48 * hour)) == nil)
        check("a workout ending an hour ahead decodes", apply(workout(started: now, ended: now + hour)) != nil)
        check("a workout of 24 hours decodes", apply(workout(ended: 24 * hour)) != nil)
        check("a workout of more than 24 hours is refused", apply(workout(ended: 24 * hour + 1)) == nil)
        check("readWeighings since before 1899-12-31 is refused",
              decodes(#"{"op":"readWeighings","anchor":null,"since":\#(floor - 1)}"#) == nil)
        check("readWeighings since two days ahead is refused",
              decodes(#"{"op":"readWeighings","anchor":null,"since":\#(now + 48 * hour)}"#) == nil)

        check("readWeighings since at the floor decodes",
              decodes(#"{"op":"readWeighings","anchor":null,"since":\#(floor)}"#)
                == .readWeighings(anchor: nil, since: Date(timeIntervalSince1970: Double(floor) / 1000)))

        let hundred = Array(repeating: workout(), count: 100).joined(separator: ",")
        check("100 objects decode", decodes(#"{"op":"apply","objects":[\#(hundred)]}"#) != nil)
        check("101 objects are refused",
              decodes(#"{"op":"apply","objects":[\#(hundred),\#(workout())]}"#) == nil)

        let broken = Array(repeating: "{}", count: 101).joined(separator: ",")
        check("101 objects are counted before any is decoded",
              refusal(#"{"op":"apply","objects":[\#(broken)]}"#) == "too many objects")

        let anchor = { (length: Int) in
            #"{"op":"readWeighings","anchor":"\#(String(repeating: "A", count: length))","since":0}"#
        }
        check("an anchor of 4096 characters decodes", decodes(anchor(4096)) != nil)
        check("an anchor of 4097 characters is refused", decodes(anchor(4097)) == nil)

        let weighing = #"{"kind":"weighing","owner":"\#(owner)","date":"2026-10-26","kg":80.4,"at":0,"version":1}"#
        check("a weighing decodes", decodes(#"{"op":"apply","objects":[\#(weighing)]}"#) != nil)
        check("19.9 kg is refused", decodes(#"{"op":"apply","objects":[\#(weighing.replacingOccurrences(of: "80.4", with: "19.9"))]}"#) == nil)
        let removal = { (owner: String, date: String) in
            #"{"op":"apply","objects":[{"kind":"weighingRemoved","owner":"\#(owner)","date":"\#(date)"}]}"#
        }
        check("a removal decodes", decodes(removal(owner, "2026-10-26")) != nil)
        check("month 13 is refused", decodes(removal(owner, "2026-13-01")) == nil)
        check("a day followed by a line break is refused", decodes(removal(owner, "2026-10-26\\n")) == nil)
        check("a day in other digits is refused", decodes(removal(owner, "٢٠٢٦-10-26")) == nil)

        // Health keeps one store for the whole phone: each account's weigh-ins carry its own tag.
        check("a weighing without its owner is refused",
              decodes(#"{"op":"apply","objects":[{"kind":"weighing","date":"2026-10-26","kg":80.4,"at":0,"version":1}]}"#) == nil)
        check("a removal without its owner is refused",
              decodes(#"{"op":"apply","objects":[{"kind":"weighingRemoved","date":"2026-10-26"}]}"#) == nil)
        for bad in ["0A1B2C3D", "0a1b2c3", "0a1b2c3d4", "../x/../", ""] {
            check("the owner \"\(bad)\" is refused", decodes(removal(bad, "2026-10-26")) == nil)
        }
        let ids = ["0a1b2c3d", "ffff0000"].compactMap { tag -> String? in
            guard case .apply(let objects)? = decodes(removal(tag, "2026-10-26")),
                  case .weighingRemoved(let w)? = objects.first else { return nil }
            return w.syncID
        }
        check("two accounts get two sync identifiers for one day, under Belay's prefix",
              ids == ["belay-weighing-0a1b2c3d-2026-10-26", "belay-weighing-ffff0000-2026-10-26"])
        if case .apply(let objects)? = decodes(#"{"op":"apply","objects":[\#(weighing)]}"#),
           case .weighing(let w)? = objects.first {
            check("a weighing and its removal share one sync identifier", w.syncID == ids.first)
        } else {
            check("a weighing and its removal share one sync identifier", false)
        }

        check("readWeighings with no anchor decodes",
              decodes(#"{"op":"readWeighings","anchor":null,"since":1000}"#)
                == .readWeighings(anchor: nil, since: Date(timeIntervalSince1970: 1)))

        let session = DateInterval(start: Date(timeIntervalSince1970: 0), duration: 3600)
        let other = { (start: Double, end: Double) in
            DateInterval(start: Date(timeIntervalSince1970: start), end: Date(timeIntervalSince1970: end))
        }
        check("a workout covering half the session overlaps", HealthRules.overlaps(session, [other(1800, 4000)]))
        check("one covering less than half does not", !HealthRules.overlaps(session, [other(1801, 4000)]))
        check("one ending as the session starts does not", !HealthRules.overlaps(session, [other(-600, 0)]))
        check("no other workout, no overlap", !HealthRules.overlaps(session, []))

        let write = HealthRules.requested(.write), imports = HealthRules.requested(.import)
        check("both scopes ask to write sessions and weigh-ins",
              write.share == [.workouts, .weighings] && imports.share == write.share)
        check("history asks what the import asks", HealthRules.requested(.history) == imports)
        check("weigh-ins are read only once the import asks", !write.read.contains(.weighings)
              && imports.read == [.workouts, .weighings])

        print(failures == 0 ? "health request check passed" : "\(failures) failed")
        exit(failures == 0 ? 0 : 1)
    }
}
