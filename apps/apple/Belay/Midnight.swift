import Foundation

/// Runs `turn` a second past each local midnight in `timeZone` by the `now` clock, until the task
/// is cancelled: a model on screen reads its day again as the day turns.
@MainActor
func everyMidnight(
    now: @escaping @Sendable () -> Date, timeZone: TimeZone, _ turn: @escaping @MainActor () -> Void
) -> Task<Void, Never> {
    Task {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        while !Task.isCancelled {
            let at = now()
            let next = calendar.nextDate(
                after: at, matching: DateComponents(hour: 0, minute: 0, second: 0), matchingPolicy: .nextTime)
            // A second past midnight, so the day read is surely the new one.
            let wait = (next ?? at.addingTimeInterval(3_600)).timeIntervalSince(at) + 1
            try? await Task.sleep(for: .seconds(wait))
            guard !Task.isCancelled else { return }
            turn()
        }
    }
}
