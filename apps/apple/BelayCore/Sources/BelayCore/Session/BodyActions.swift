public import Foundation
import GRDB

/// The body entries as the screens read them (`AccountStore.body`).
public struct BodyRead: Sendable, Equatable {
  public var weights: [WeightRow]
  public var measures: [MeasureRow]
  public var intake: [IntakeRow]
  public var supplements: [SupplementRow]
  public var logs: [SupplementLogRow]
  public var annotations: [AnnotationRow]
  /// Nil: never written, the defaults apply.
  public var target: TargetRow?
  public var profile: ProfileRow?

  /// No entry yet: what a screen shows before its first read.
  public static let empty = BodyRead(
    weights: [], measures: [], intake: [], supplements: [], logs: [], annotations: [], target: nil,
    profile: nil)
}

/// An annotation as its sheet saves it: a new one takes a fresh id, an edit keeps its own.
public struct AnnotationInput: Sendable, Equatable {
  public var id: String
  public var date: String
  public var type: AnnotationKind
  /// Nil: no label.
  public var label: String?

  public init(id: String, date: String, type: AnnotationKind, label: String?) {
    self.id = id
    self.date = date
    self.type = type
    self.label = label
  }
}

/// Why a body action wrote nothing.
public enum BodyError: Error, Sendable, Equatable {
  /// No annotation of that id.
  case noSuchAnnotation
}

/// What Corps writes. Each action is one write of the store that reads the day as stored at that
/// moment, applies the change and queues it, offline as online. A value saved as the day already
/// holds it writes nothing: a change stamped now could overwrite a newer one from another device.
/// Dates are the person's days, never after today in `timeZone`.
public struct BodyActions: Sendable {
  let store: AccountStore
  let now: @Sendable () -> Date
  let timeZone: TimeZone

  public init(store: AccountStore, now: @escaping @Sendable () -> Date, timeZone: TimeZone) {
    self.store = store
    self.now = now
    self.timeZone = timeZone
  }

  /// The day's weigh-in; a second one the same day replaces it.
  public func weigh(date: String, kg: Double) throws {
    try write { db, at in
      guard try BodyRows.weight(db, date: date)?.weightKg != kg else { return [] }
      return [.weight(WeightChange(date: date, weightKg: kg, at: at))]
    }
  }

  /// The day's weigh-in goes; the day stays held, empty, so other devices learn of it.
  public func deleteWeight(date: String) throws {
    try write { db, at in
      guard try BodyRows.weight(db, date: date)?.weightKg != nil else { return [] }
      return [.weight(WeightChange(date: date, weightKg: nil, at: at))]
    }
  }

  /// The day's measures as the sheet holds them: a field left empty that the day holds is
  /// deleted, one never typed stays unwritten.
  public func measure(date: String, waist: Double?, neck: Double?, hip: Double?) throws {
    try write { db, at in
      let held = try BodyRows.measure(db, date: date) ?? MeasureRow(empty: date)
      let typed: [(MeasureField, Double?)] = [(.waist, waist), (.neck, neck), (.hip, hip)]
      return typed.compactMap { field, value in
        value == held[field].cm
          ? nil : .measure(MeasureChange(date: date, field: field, value: value, at: at))
      }
    }
  }

  /// The day's totals, which replace what the day held; empty fields as for `measure`.
  public func intake(date: String, kcal: Int?, protein: Int?) throws {
    try write { db, at in
      let held = try BodyRows.intake(db, date: date) ?? IntakeRow(empty: date)
      let typed: [(IntakeField, Int?)] = [(.kcal, kcal), (.protein, protein)]
      return typed.compactMap { field, value in
        value == held[field].value
          ? nil : .intake(IntakeChange(date: date, field: field, value: value, at: at))
      }
    }
  }

  /// A supplement's box of the day, one per supplement and day.
  public func take(supplementId: String, date: String, taken: Bool) throws {
    try write { db, at in
      let held = try BodyRows.log(db, supplementId: supplementId, date: date)?.taken ?? false
      guard held != taken else { return [] }
      return [
        .supplementLog(
          SupplementLogChange(supplementId: supplementId, date: date, taken: taken, at: at))
      ]
    }
  }

  /// A new annotation, or an edit of one: its day, type and label are written together.
  public func annotate(_ a: AnnotationInput) throws {
    try write { db, at in
      let held = try BodyRows.annotation(db, id: a.id)
      if let held, !held.removed, (held.date, held.type, held.label) == (a.date, a.type, a.label) {
        return []
      }
      return [
        .annotation(
          AnnotationChange(
            id: a.id, at: at, edit: .fields(date: a.date, type: a.type, label: a.label)))
      ]
    }
  }

  /// An annotation goes; one removed already writes nothing.
  public func removeAnnotation(id: String) throws {
    try write { db, at in
      guard let held = try BodyRows.annotation(db, id: id) else {
        throw BodyError.noSuchAnnotation
      }
      if held.removed { return [] }
      return [.annotation(AnnotationChange(id: id, at: at, edit: .removed(true)))]
    }
  }

  /// One write: the changes `decide` makes from the day as stored, checked, applied and queued.
  private func write(_ decide: (Database, String) throws -> [Change]) throws {
    let now = now()
    try store.writer.write { db in
      let changes = try decide(db, Instant.string(now))
      if changes.isEmpty { return }
      try AccountStore.writeBody(db, changes, now: now, timeZone: timeZone)
    }
  }
}
