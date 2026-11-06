import Foundation

/// Record ids as the web makes them: UUID v7 in lower case, time-ordered, made offline on any
/// device and safe as a sync key.
public enum UUIDv7 {
  /// A new id whose first 48 bits are `date` in milliseconds since the epoch (RFC 9562 §5.7).
  public static func make(at date: Date) -> String {
    var generator = SystemRandomNumberGenerator()
    var bytes = (0..<16).map { _ in UInt8.random(in: .min ... .max, using: &generator) }
    // No time before the epoch fits the field; ids are only made for now.
    let ms = UInt64(max(0, Instant.milliseconds(date)))
    for i in 0..<6 { bytes[i] = UInt8(truncatingIfNeeded: ms >> (8 * (5 - i))) }
    bytes[6] = 0x70 | (bytes[6] & 0x0F)
    bytes[8] = 0x80 | (bytes[8] & 0x3F)
    let hex = bytes.map { byte in
      let digits = String(byte, radix: 16)
      return digits.count == 1 ? "0" + digits : digits
    }
    return [0..<4, 4..<6, 6..<8, 8..<10, 10..<16].map { hex[$0].joined() }.joined(separator: "-")
  }
}
