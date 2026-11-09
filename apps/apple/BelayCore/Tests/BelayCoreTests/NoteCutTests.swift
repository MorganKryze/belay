import Testing

@testable import BelayCore

// A note typed or pasted past the bound is cut to it, never left longer: a longer one is refused
// by the store, and the person's text would be lost.

@Suite struct NoteCutTests {
  @Test func aNoteWithinTheBoundIsKept() {
    let note = String(repeating: "a", count: Bounds.noteMax)
    #expect(fitNote(note) == note)
    #expect(fitNote("Bonne forme") == "Bonne forme")
  }

  @Test func aCutThroughASurrogatePairStopsBeforeIt() {
    let note = String(repeating: "a", count: Bounds.noteMax - 1) + "😀"
    #expect(note.utf16.count == Bounds.noteMax + 1)
    let cut = fitNote(note)
    #expect(cut == String(repeating: "a", count: Bounds.noteMax - 1))
    #expect(cut.utf16.count <= Bounds.noteMax)
  }

  @Test func aLongPasteIsCutToTheBound() {
    let note = String(repeating: "é😀", count: 400)
    let cut = fitNote(note)
    #expect(cut.utf16.count <= Bounds.noteMax)
    #expect(cut.utf16.count >= Bounds.noteMax - 1)
    #expect(note.hasPrefix(cut))
  }
}
