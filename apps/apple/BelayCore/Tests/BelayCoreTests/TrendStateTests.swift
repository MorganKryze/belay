import Foundation
import Testing

@testable import BelayCore

// The trend's series for S, M and A: 7, 30 and 365 days ending today, the weigh-ins as points,
// the 7-day average, creatine's band and the annotations, each on its day.

@Suite struct TrendStateTests {
  private func series(_ body: BodyRead, _ span: TrendSpan) -> TrendSeries {
    trendSeries(body, span: span, now: Bodies.now, timeZone: Days.paris)
  }

  /// One weigh-in a day for `days` days up to today.
  private func daily(_ days: Int) -> [WeightRow] {
    Bodies.weights((0..<days).reversed().map { addDays(Bodies.today, -$0) })
  }

  @Test func spansEndTodayOverSevenThirtyAndThreeHundredSixtyFiveDays() {
    let body = Bodies.body(weights: daily(400))
    let expected: [(TrendSpan, String)] = [
      (.week, "2026-11-07"), (.month, "2026-10-15"), (.year, "2025-11-14"),
    ]
    for (span, first) in expected {
      let s = series(body, span)
      #expect(s.points.first?.date == first)
      #expect(s.points.last?.date == Bodies.today)
      #expect(s.average.first?.date == first)
      #expect(s.average.last?.date == Bodies.today)
    }
    #expect(series(body, .week).points.count == 7)
    #expect(series(body, .month).points.count == 30)
  }

  @Test func atMostThreeHundredSixtyFivePoints() {
    let s = series(Bodies.body(weights: daily(800)), .year)
    #expect(s.points.count == 365)
    #expect(s.average.count == 365)
  }

  @Test func pointsLeaveOutADayAfterToday() {
    let body = Bodies.body(weights: Bodies.weights(["2026-11-12", "2026-11-14"], kg: 79.9))
    #expect(series(body, .week).points == [Point(date: "2026-11-12", value: 79.9)])
  }

  @Test func averageCountsWeighInsBeforeTheSpan() {
    // Four weigh-ins from the 4th to the 7th: the week's first day already has its average.
    let body = Bodies.body(
      weights: Bodies.weights(["2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07"], kg: 80))
    let s = series(body, .week)
    #expect(s.points == [Point(date: "2026-11-07", value: 80)])
    #expect(s.average.map(\.date) == ["2026-11-07", "2026-11-08", "2026-11-09", "2026-11-10"])
    #expect(s.average.allSatisfy { $0.value == 80 })
  }

  @Test func creatineBandFromCreatineBoxesOnlyClippedToTheSpan() {
    let body = Bodies.body(
      supplements: [
        Bodies.supplement(Bodies.creatine, "Créatine", kind: .creatine),
        Bodies.supplement(Bodies.omega, "Oméga 3", kind: .other),
      ],
      logs: [
        // A course from 1 September, long before the month; one from 5 November.
        Bodies.taken(Bodies.creatine, "2026-09-01"),
        Bodies.taken(Bodies.creatine, "2026-11-05"),
        Bodies.taken(Bodies.creatine, "2026-11-06"),
        // Another supplement's box starts no band.
        Bodies.taken(Bodies.omega, "2026-10-20"),
      ])
    #expect(series(body, .month).creatine == [DateSpan(start: "2026-11-05", end: "2026-11-13")])
    #expect(series(body, .week).creatine == [DateSpan(start: "2026-11-07", end: "2026-11-13")])
    #expect(
      series(body, .year).creatine == [
        DateSpan(start: "2026-09-01", end: "2026-09-14"),
        DateSpan(start: "2026-11-05", end: "2026-11-13"),
      ])
  }

  @Test func annotationsOnTheirDaysWithinTheSpan() {
    let a = "00000000-0000-7000-8000-0000000000a1"
    let b = "00000000-0000-7000-8000-0000000000a2"
    let c = "00000000-0000-7000-8000-0000000000a3"
    let body = Bodies.body(annotations: [
      Bodies.annotation(a, "2026-09-20", .dietBreak),
      Bodies.annotation(b, "2026-11-09", .deload),
      Bodies.annotation(c, "2026-11-11", .note, label: "Voyage"),
    ])
    #expect(
      series(body, .week).annotations == [
        AnnotationMark(id: b, date: "2026-11-09", kind: .deload, label: nil),
        AnnotationMark(id: c, date: "2026-11-11", kind: .note, label: "Voyage"),
      ])
    #expect(series(body, .year).annotations.map(\.id) == [a, b, c])
  }
}
