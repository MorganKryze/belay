public import Foundation

/// Every action on the open session, each one write of the store that reads the session as
/// stored at that moment. The screens, the lock screen and, later, the Watch call these and
/// nothing else writes a session.
public struct SessionActions: Sendable {
  let store: AccountStore
  let ctx: SessionContext

  public init(
    store: AccountStore, library: ExerciseLibrary, bar: Plates = .gym,
    now: @escaping @Sendable () -> Date, newId: @escaping @Sendable (Date) -> String
  ) {
    self.store = store
    ctx = SessionContext(library: library, bar: bar, now: now, newId: newId)
  }

  /// Logs the set due; nil when nothing is due or `expecting` names another set. A set already
  /// at `expecting` is corrected, so two taps for one set leave one.
  @discardableResult
  public func logNext(count: Int?, weightKg: Double?, expecting: SetPlace?) throws -> SetChange? {
    try store.logNext(count: count, weightKg: weightKg, expecting: expecting, ctx)
  }

  public func answerRIR(setId: String, rir: Int) throws {
    try store.answerRIR(setId: setId, rir: rir, ctx)
  }

  public func correct(setId: String, weightKg: Double, count: Int, rir: Int?) throws {
    try store.correct(setId: setId, weightKg: weightKg, count: count, rir: rir, ctx)
  }

  public func remove(setId: String) throws { try store.remove(setId: setId, ctx) }

  /// Whether a rest was running to lengthen.
  @discardableResult
  public func addRest(seconds: Int) throws -> Bool {
    try store.addRest(seconds: seconds, ctx)
  }

  public func skipRest() throws { try store.skipRest(ctx) }

  public func choose(weightKg: Double?, count: Int?) throws {
    try store.choose(weightKg: weightKg, count: count, ctx)
  }

  public func startHold() throws { try store.startHold(ctx) }
  public func stopHold() throws { try store.stopHold(ctx) }
  public func pause() throws { try store.pause(ctx) }
  public func resume() throws { try store.resume(ctx) }

  public func replace(slotIndex: Int, with exerciseId: String) throws {
    try store.replace(slotIndex: slotIndex, with: exerciseId, ctx)
  }

  public func leaveOut(slotIndex: Int, _ out: Bool) throws {
    try store.leaveOut(slotIndex: slotIndex, out, ctx)
  }

  /// Throws `PlanError.full` past `Bounds.maxSlots`.
  public func addExercise(_ exerciseId: String) throws { try store.addExercise(exerciseId, ctx) }

  /// Throws `SessionError.noPositionLeft` past `Bounds.maxPosition`.
  public func addSet(slotIndex: Int) throws { try store.addSet(slotIndex: slotIndex, ctx) }

  public func noteExercise(slotIndex: Int, text: String) throws {
    try store.noteExercise(slotIndex: slotIndex, text: text, ctx)
  }

  public func noteSession(workoutId: String, text: String) throws {
    try store.noteSession(workoutId: workoutId, text: text, ctx)
  }

  /// The finished session's id.
  public func finish() throws -> String { try store.finish(ctx) }

  /// Throws `SessionError.notEmpty` when a set is stored by the time of the write.
  public func stopEmpty() throws { try store.stopEmpty(ctx) }

  // For the lock screen: the same writes, held to the session it showed.
  func logShown(_ place: SetPlace, workoutId: String) throws -> Bool {
    try store.logNext(
      count: nil, weightKg: nil, expecting: place, workoutId: workoutId, lockScreen: true, ctx)
      != nil
  }

  func addThirty(workoutId: String) throws -> Bool {
    try store.addRest(seconds: 30, workoutId: workoutId, ctx)
  }
}
