import Foundation

/// The phone's own check before a change enters its queue, the web's rule ported: stricter than
/// what the server accepts, so a queued change is never refused for its shape, which would block
/// the whole queue. `now` is the phone's clock, for the kinds dated by the local day; neither
/// a session nor a set is, so their verdict never depends on it.
public func isValid(_ change: Change, now: Date) -> Bool {
  switch change {
  case .workout(let c):
    return Instant.isCanonical(c.at) && isId(c.id) && isValid(c.edit, at: c.at)
  case .set(let c):
    return Instant.isCanonical(c.at) && isId(c.id) && isId(c.workoutId)
      && isValid(c.edit, at: c.at)
  }
}

private func isValid(_ edit: WorkoutChange.Edit, at: String) -> Bool {
  switch edit {
  case .start(let start):
    return isSessionCode(start.sessionCode)
      && (start.sessionId.value.map(isId) ?? true)
      && (start.sessionName.value.map(isSessionName) ?? true)
      && isPlan(start.plan)
      && isTime(start.startedAt, of: at)
  case .plan(let plan): return isPlan(plan)
  case .startedAt(let time): return isTime(time, of: at)
  case .ended(let time): return time.map { isTime($0, of: at) } ?? true
  case .note(let note): return note.map { isNote($0) && !isBlank($0) } ?? true
  case .exerciseNotes(let notes): return isExerciseNotes(notes)
  case .removed: return true
  }
}

private func isValid(_ edit: SetChange.Edit, at: String) -> Bool {
  switch edit {
  case .create(let c):
    // Positions 0 to 2 are the warm-ups (no RIR, in reps), the work sets come after them.
    return (0..<Bounds.maxSlots).contains(c.slotIndex)
      && (0...Bounds.maxPosition).contains(c.position)
      && c.warmup == (c.position < Bounds.maxWarmups)
      && isExerciseId(c.exerciseId)
      && isLoad(c.values)
      && (!c.warmup || (c.values.rir == nil && c.values.seconds.value == nil))
      && isTime(c.doneAt, of: at)
  case .values(let values): return isLoad(values)
  case .removed: return true
  }
}

/// Lower case, as the phone writes ids (UUID v7), and inside what the server's uuid check takes.
func isId(_ text: String) -> Bool {
  let bytes = Array(text.utf8)
  guard bytes.count == 36 else { return false }
  for (i, byte) in bytes.enumerated() {
    switch i {
    case 8, 13, 18, 23: guard byte == UInt8(ascii: "-") else { return false }
    case 14: guard (UInt8(ascii: "1")...UInt8(ascii: "8")).contains(byte) else { return false }
    case 19: guard "89ab".utf8.contains(byte) else { return false }
    default: guard isHex(byte) else { return false }
    }
  }
  return true
}

private func isHex(_ byte: UInt8) -> Bool {
  (UInt8(ascii: "0")...UInt8(ascii: "9")).contains(byte)
    || (UInt8(ascii: "a")...UInt8(ascii: "f")).contains(byte)
}

private func isDigit(_ byte: UInt8) -> Bool {
  (UInt8(ascii: "0")...UInt8(ascii: "9")).contains(byte)
}

/// `ds:<dataset id>` or `belay:<slug>`, the slug in lower-case letters, digits and dashes.
func isExerciseId(_ id: String) -> Bool {
  let name: Substring
  if id.hasPrefix("ds:") {
    name = id.dropFirst(3)
  } else if id.hasPrefix("belay:") {
    name = id.dropFirst(6)
  } else {
    return false
  }
  return (1...Bounds.exerciseNameMax).contains(name.utf8.count)
    && name.utf8.allSatisfy {
      isDigit($0) || (UInt8(ascii: "a")...UInt8(ascii: "z")).contains($0) || $0 == UInt8(ascii: "-")
    }
}

private func isSessionCode(_ code: String) -> Bool {
  code.utf8.count == 1
    && code.utf8.allSatisfy { (UInt8(ascii: "A")...UInt8(ascii: "Z")).contains($0) }
}

/// A session's time is never before 1900, nor after the time of its change (the phone's clock).
/// Both are compared as text, as the web compares them: the canonical form sorts as time does.
private func isTime(_ time: String, of at: String) -> Bool {
  Instant.isCanonical(time) && time >= Bounds.minTime && time <= at
}

/// 0 to 500 kg on the grid; the tolerance absorbs binary noise.
func isSetKg(_ kg: Double) -> Bool {
  let steps = kg / Bounds.setKgStep
  return kg.isFinite && kg >= Bounds.setKgMin && kg <= Bounds.setKgMax
    && abs(steps - steps.rounded()) < 1e-6
}

/// Reps or seconds, never both, and a timed set has no RIR. No seconds at all is a set in reps,
/// as every set was before timed ones.
private func isLoad(_ v: SetValues) -> Bool {
  guard isSetKg(v.weightKg), v.rir.map({ (0...Bounds.rirMax).contains($0) }) ?? true else {
    return false
  }
  guard let seconds = v.seconds.value else {
    return v.reps.map { (0...Bounds.repsMax).contains($0) } ?? false
  }
  return v.reps == nil && (0...Bounds.secondsMax).contains(seconds) && v.rir == nil
}

/// Counted in UTF-16 units, as the web counts them, so never more than the database holds.
private func isNote(_ note: String) -> Bool { note.utf16.count <= Bounds.noteMax }

/// What JavaScript's `trim()` takes away: its white space and line terminators.
private func isJSSpace(_ scalar: Unicode.Scalar) -> Bool {
  switch scalar.value {
  case 0x09...0x0D, 0x20, 0xA0, 0x2028, 0x2029, 0xFEFF: return true
  default: return scalar.properties.generalCategory == .spaceSeparator
  }
}

private func isBlank(_ text: String) -> Bool { text.unicodeScalars.allSatisfy(isJSSpace) }

/// 1 to 40 units, nothing `trim()` would take away, no control character.
func isSessionName(_ name: String) -> Bool {
  guard let first = name.unicodeScalars.first, let last = name.unicodeScalars.last else {
    return false
  }
  return name.utf16.count <= Bounds.sessionNameMax && !isJSSpace(first) && !isJSSpace(last)
    && !name.unicodeScalars.contains { $0.properties.generalCategory == .control }
}

/// An exercise note per slot index, "0" to "29", each 1 to 500 units.
private func isExerciseNotes(_ notes: [String: String]) -> Bool {
  notes.allSatisfy { key, text in
    let digits = Array(key.utf8)
    let isIndex =
      (digits == [UInt8(ascii: "0")])
      || (1...2).contains(digits.count) && digits[0] != UInt8(ascii: "0")
        && digits.allSatisfy(isDigit)
    return isIndex && Int(key).map { $0 < Bounds.maxSlots } == true && !text.isEmpty
      && isNote(text)
  }
}

private func isRange(_ range: [Int], _ bounds: ClosedRange<Int>) -> Bool {
  range.count == 2 && bounds.contains(range[0]) && range[0] <= range[1]
    && range[1] <= bounds.upperBound
}

private func isSlot(_ slot: Slot) -> Bool {
  isExerciseId(slot.exerciseId)
    && (1...Bounds.slotSets).contains(slot.sets)
    && isRange(slot.repRange, 1...(slot.measure == .seconds ? Bounds.slotSeconds : Bounds.slotReps))
    && isRange(slot.rirTarget, 0...Bounds.rirMax)
    && (0...Bounds.slotRestSec).contains(slot.restSec)
    && (0...Bounds.maxWarmups).contains(slot.warmupSets)
    && (slot.groupKey.map(isGroupKey) ?? true)
    && slot.added != false
    // Only the values this version knows: one read from a newer server is never sent back.
    && (slot.measure.map { $0 == .seconds } ?? true)
    && (slot.rule.map { $0 == .noClimbing } ?? true)
}

private func isGroupKey(_ key: String) -> Bool {
  (1...Bounds.groupKeyMax).contains(key.utf8.count)
    && key.utf8.allSatisfy {
      isDigit($0) || (UInt8(ascii: "a")...UInt8(ascii: "z")).contains($0)
        || (UInt8(ascii: "A")...UInt8(ascii: "Z")).contains($0)
    }
}

private func isPlan(_ plan: [Slot]) -> Bool {
  (1...Bounds.maxSlots).contains(plan.count) && plan.allSatisfy(isSlot)
    && planBytes(plan) <= Bounds.planMaxBytes
}

/// The size PostgreSQL gives the plan as text: jsonb writes ": " and ", " where JSON.stringify
/// writes ":" and ",", so each separator counts one more byte. Read on valid slots only, whose
/// text is ASCII and needs no escape, so the encoder's bytes are JSON.stringify's.
private func planBytes(_ plan: [Slot]) -> Int {
  let encoder = JSONEncoder()
  encoder.outputFormatting = [.withoutEscapingSlashes]
  guard let text = try? encoder.encode(plan) else { return .max }
  var separators = 0
  var inString = false
  for byte in text {
    if byte == UInt8(ascii: "\"") {
      inString.toggle()
    } else if !inString && (byte == UInt8(ascii: ":") || byte == UInt8(ascii: ",")) {
      separators += 1
    }
  }
  return text.count + separators
}
