import Foundation

/// Times as the contract writes them: UTC with milliseconds and a `Z`, exactly as JavaScript's
/// `Date#toISOString()` does, so a time written here compares as text with one written on the web.
public enum Instant {
  /// The largest distance from the epoch a JavaScript Date holds, in milliseconds.
  private static let limitMs: Int64 = 8_640_000_000_000_000

  /// `date` as `toISOString()` writes it: below a millisecond the time is cut, as a JavaScript
  /// Date holds whole milliseconds.
  public static func string(_ date: Date) -> String {
    string(ms: milliseconds(date))
  }

  /// The instant `text` names, read as `Date.parse` reads the ISO forms the contract meets:
  /// with or without seconds and their fraction, in UTC or with an offset. Nil otherwise.
  public static func date(_ text: String) -> Date? {
    milliseconds(text).map { Date(timeIntervalSince1970: Double($0) / 1000) }
  }

  /// Whether `text` is exactly what `toISOString()` writes for its instant.
  static func isCanonical(_ text: String) -> Bool {
    milliseconds(text).map { string(ms: $0) == text } ?? false
  }

  /// Whole milliseconds since the epoch. A date made from a millisecond count can land a hair
  /// below it in floating point; that hair is not a millisecond less.
  static func milliseconds(_ date: Date) -> Int64 {
    let ms = date.timeIntervalSince1970 * 1000
    let nearest = ms.rounded()
    return Int64(abs(ms - nearest) < 1e-3 ? nearest : ms.rounded(.down))
  }

  static func string(ms: Int64) -> String {
    let (days, inDay) = floorDivide(ms, 86_400_000)
    let (year, month, day) = civil(days: days)
    let yearText =
      (0...9999).contains(year)
      ? pad(year, 4) : (year < 0 ? "-" : "+") + pad(abs(year), 6)
    return
      "\(yearText)-\(pad(month, 2))-\(pad(day, 2))T\(pad(inDay / 3_600_000, 2)):"
      + "\(pad(inDay / 60_000 % 60, 2)):\(pad(inDay / 1000 % 60, 2)).\(pad(inDay % 1000, 3))Z"
  }

  /// Milliseconds since the epoch of an ISO 8601 date and time, or nil.
  static func milliseconds(_ text: String) -> Int64? {
    var reader = Reader(bytes: Array(text.utf8))
    guard let year = reader.year(),
      reader.skip("-"), let month = reader.number(2), (1...12).contains(month),
      reader.skip("-"), let day = reader.number(2), (1...31).contains(day),
      reader.skip("T"), let hour = reader.number(2), hour <= 24,
      reader.skip(":"), let minute = reader.number(2), minute <= 59
    else { return nil }
    var second: Int64 = 0
    var millisecond: Int64 = 0
    if reader.skip(":") {
      guard let s = reader.number(2), s <= 59 else { return nil }
      second = s
      if reader.skip(".") {
        guard let fraction = reader.fraction() else { return nil }
        millisecond = fraction
      }
    }
    // 24:00 is the end of the day, the next one's midnight; no later time that hour.
    if hour == 24 && (minute != 0 || second != 0 || millisecond != 0) { return nil }
    guard let offset = reader.offset(), reader.isAtEnd else { return nil }
    // A day past the month's end rolls over, as Date.parse rolls it over.
    let days = Self.days(year: year, month: month, day: day)
    let ms =
      ((days * 24 + hour) * 60 + minute - offset) * 60_000 + second * 1000 + millisecond
    return abs(ms) <= limitMs ? ms : nil
  }

  private static func pad(_ value: Int64, _ width: Int) -> String {
    let digits = String(value)
    return String(repeating: "0", count: max(0, width - digits.count)) + digits
  }

  private static func floorDivide(_ a: Int64, _ b: Int64) -> (Int64, Int64) {
    let r = a % b
    return r < 0 ? (a / b - 1, r + b) : (a / b, r)
  }

  // Days from 1970-01-01 to a proleptic Gregorian date and back, as JavaScript counts them
  // (no Julian calendar before 1582): Howard Hinnant's civil algorithms.
  private static func days(year: Int64, month: Int64, day: Int64) -> Int64 {
    let y = month <= 2 ? year - 1 : year
    let era = (y >= 0 ? y : y - 399) / 400
    let yearOfEra = y - era * 400
    let dayOfYear = (153 * (month + (month > 2 ? -3 : 9)) + 2) / 5 + day - 1
    let dayOfEra = yearOfEra * 365 + yearOfEra / 4 - yearOfEra / 100 + dayOfYear
    return era * 146_097 + dayOfEra - 719_468
  }

  private static func civil(days: Int64) -> (Int64, Int64, Int64) {
    let z = days + 719_468
    let era = (z >= 0 ? z : z - 146_096) / 146_097
    let dayOfEra = z - era * 146_097
    let yearOfEra =
      (dayOfEra - dayOfEra / 1460 + dayOfEra / 36_524 - dayOfEra / 146_096) / 365
    let dayOfYear = dayOfEra - (365 * yearOfEra + yearOfEra / 4 - yearOfEra / 100)
    let mp = (5 * dayOfYear + 2) / 153
    let day = dayOfYear - (153 * mp + 2) / 5 + 1
    let month = mp < 10 ? mp + 3 : mp - 9
    return (yearOfEra + era * 400 + (month <= 2 ? 1 : 0), month, day)
  }

  /// Reads ASCII fields off the front of a time's text.
  private struct Reader {
    let bytes: [UInt8]
    var index = 0

    var isAtEnd: Bool { index == bytes.count }

    mutating func skip(_ character: Character) -> Bool {
      guard index < bytes.count, bytes[index] == character.asciiValue else { return false }
      index += 1
      return true
    }

    mutating func number(_ width: Int) -> Int64? {
      guard index + width <= bytes.count else { return nil }
      var value: Int64 = 0
      for byte in bytes[index..<index + width] {
        guard (48...57).contains(byte) else { return nil }
        value = value * 10 + Int64(byte - 48)
      }
      index += width
      return value
    }

    /// Four digits, or a sign and six: the extended years `toISOString()` writes.
    mutating func year() -> Int64? {
      if skip("+") { return number(6) }
      if skip("-") {
        // There is no year minus zero.
        guard let year = number(6), year != 0 else { return nil }
        return -year
      }
      return number(4)
    }

    /// One digit or more after the point; past the third they are cut, as Date.parse cuts them.
    mutating func fraction() -> Int64? {
      var digits = 0
      var value: Int64 = 0
      while index < bytes.count, (48...57).contains(bytes[index]) {
        if digits < 3 { value = value * 10 + Int64(bytes[index] - 48) }
        digits += 1
        index += 1
      }
      guard digits > 0 else { return nil }
      for _ in digits..<max(digits, 3) { value *= 10 }
      return value
    }

    /// The offset from UTC in minutes: `Z`, or a sign and `HH:MM`.
    mutating func offset() -> Int64? {
      if skip("Z") { return 0 }
      let sign: Int64
      if skip("+") {
        sign = 1
      } else if skip("-") {
        sign = -1
      } else {
        return nil
      }
      guard let hours = number(2), hours <= 23, skip(":"), let minutes = number(2), minutes <= 59
      else { return nil }
      return sign * (hours * 60 + minutes)
    }
  }
}
