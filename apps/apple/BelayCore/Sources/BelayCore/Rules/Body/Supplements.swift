// The supplements' suggestions and creatine's own band on the weight chart, ported from the
// shared rules.

/// The suggestions of Réglages › Mes compléments, as string keys. Belay notes what is taken,
/// never a dose or advice.
public let supplementSuggestions = [
  "creatine", "vitaminD", "omega3", "magnesium", "iron", "zinc", "caffeine", "melatonin",
]

/// "Créatine", "creatine", "CREATINE monohydrate": case and accents aside, the word creatine.
public func isCreatineName(_ name: String) -> Bool {
  let plain = Array(fold(name).unicodeScalars)
  let word = Array("creatine".unicodeScalars)
  let isLetter = { (s: Unicode.Scalar) in ("a"..."z").contains(s) }
  guard plain.count >= word.count else { return false }
  return (0...(plain.count - word.count)).contains { i in
    Array(plain[i..<(i + word.count)]) == word
      && (i == 0 || !isLetter(plain[i - 1]))
      && (i + word.count == plain.count || !isLetter(plain[i + word.count]))
  }
}

/// Two names compared as the web's `plain` compares them: through the shared `fold`, the spaces
/// around aside, so « oméga-3 » is « Oméga-3 » and « Straße » stays apart from « strasse ».
public func sameSupplementName(_ a: String, _ b: String) -> Bool {
  let plain = { (name: String) in fold(name.trimmingCharacters(in: .whitespacesAndNewlines)) }
  return plain(a) == plain(b)
}

/// A heuristic: a course of creatine starts on a day ticked after at least 14 days without; its
/// first 14 days are marked, when the weight often rises by 1 to 2 kg of water.
public let creatineDays = 14

/// Days from `start` to `end`, both included.
public struct DateSpan: Codable, Sendable, Equatable {
  public var start: String
  public var end: String
}

/// The marked windows, oldest first: each start is a ticked day with no ticked day in the 14 days
/// before it, and the window runs 14 days, the start included. Days after `today` (a time zone
/// change) are left out.
public func creatineWindows(_ takenDays: [String], today: String) -> [DateSpan] {
  let days = Set(takenDays).filter { $0 <= today }.sorted()
  var out: [DateSpan] = []
  var previous: String?
  for day in days {
    if previous.map({ day > addDays($0, creatineDays) }) ?? true {
      out.append(DateSpan(start: day, end: addDays(day, creatineDays - 1)))
    }
    previous = day
  }
  return out
}
