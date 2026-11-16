import Foundation
import Testing

@testable import BelayCore

// The tools' bounds and the birth year's: one set, from the contract's `Bounds`, and one reading
// of a local day's year.

@Suite struct ToolBoundsTests {
  @Test func rangesComeFromTheContract() {
    #expect(ageRangeYears == Bounds.ageYears.asDoubles)
    #expect(heightRangeCm == Bounds.heightCm.asDoubles)
  }

  @Test func ageAndBirthYearsReadTheSameYear() {
    for today in ["2026-11-16", "1999-01-01", "", "abcd-01-01"] {
      let year = calendarYear(today)
      #expect(ageIn(birthYear: 1990, today: today) == year - 1990, "\(today)")
      #expect(
        birthYearRange(today: today).upperBound == year - Bounds.ageYears.lowerBound, "\(today)")
    }
    #expect(calendarYear("2026-11-16") == 2026)
  }
}
