// A day's measures, ported from the shared rules: the bounds, the last of each, a week's waist.

/// Within the field's bounds, kept to the tenth of a centimetre; the tolerance absorbs binary
/// noise.
public func isMeasureCm(_ field: MeasureField, _ value: Double) -> Bool {
  let bounds = Bounds.measureCm(field)
  let tenths = value * 10
  return value.isFinite && value >= bounds.lowerBound && value <= bounds.upperBound
    && abs(tenths - jsRound(tenths)) < 1e-6
}

/// A measure's last value, with its day.
public struct LatestMeasure: Codable, Sendable, Equatable {
  public var cm: Double
  public var date: String
}

private func measure(_ m: MeasureRow, _ field: MeasureField) -> Double? {
  switch field {
  case .waist: m.waistCm
  case .neck: m.neckCm
  case .hip: m.hipCm
  }
}

/// The last value of each measure, with its day; of two on one day, the first listed.
public func latestMeasures(_ measures: [MeasureRow]) -> [MeasureField: LatestMeasure] {
  var out: [MeasureField: LatestMeasure] = [:]
  for m in measures {
    for field in MeasureField.allCases {
      guard let cm = measure(m, field) else { continue }
      if let known = out[field], m.date <= known.date { continue }
      out[field] = LatestMeasure(cm: cm, date: m.date)
    }
  }
  return out
}

/// The waist of the week from Monday `weekStart`: its last value, or nil.
public func weeklyWaist(_ measures: [MeasureRow], weekStart: String) -> Double? {
  let end = addDays(weekStart, 6)
  return latestMeasures(measures.filter { $0.date >= weekStart && $0.date <= end })[.waist]?.cm
}
