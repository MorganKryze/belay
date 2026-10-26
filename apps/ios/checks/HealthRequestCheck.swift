import Foundation

// The Health bridge's page-facing rules, run on a Mac without a simulator:
// `pnpm --filter @belay/ios check:swift` compiles this file with HealthRequest.swift.
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

    static let id = "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7d01"
    static func workout(_ extra: String = "", ended: Int = 3_600_000, version: Int = 5) -> String {
        #"{"kind":"workout","id":"\#(id)","startedAt":0,"endedAt":\#(ended),"version":\#(version)\#(extra)}"#
    }

    static func main() {
        check("status decodes", decodes(#"{"op":"status"}"#) == .status)
        check("an unknown key is refused", decodes(#"{"op":"status","x":1}"#) == nil)
        check("an unknown operation is refused", decodes(#"{"op":"delete"}"#) == nil)
        check("authorize import decodes", decodes(#"{"op":"authorize","scope":"import"}"#) == .authorize(.import))
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

        let hundred = Array(repeating: workout(), count: 100).joined(separator: ",")
        check("100 objects decode", decodes(#"{"op":"apply","objects":[\#(hundred)]}"#) != nil)
        check("101 objects are refused",
              decodes(#"{"op":"apply","objects":[\#(hundred),\#(workout())]}"#) == nil)

        let weighing = #"{"kind":"weighing","date":"2026-10-26","kg":80.4,"at":0,"version":1}"#
        check("a weighing decodes", decodes(#"{"op":"apply","objects":[\#(weighing)]}"#) != nil)
        check("19.9 kg is refused", decodes(#"{"op":"apply","objects":[{"kind":"weighing","date":"2026-10-26","kg":19.9,"at":0,"version":1}]}"#) == nil)
        check("month 13 is refused", decodes(#"{"op":"apply","objects":[{"kind":"weighingRemoved","date":"2026-13-01"}]}"#) == nil)
        check("a day followed by a line break is refused", decodes(#"{"op":"apply","objects":[{"kind":"weighingRemoved","date":"2026-10-26\n"}]}"#) == nil)
        check("a day in other digits is refused", decodes(#"{"op":"apply","objects":[{"kind":"weighingRemoved","date":"٢٠٢٦-10-26"}]}"#) == nil)

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

        print(failures == 0 ? "health request check passed" : "\(failures) failed")
        exit(failures == 0 ? 0 : 1)
    }
}
