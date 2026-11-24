import Foundation
import Testing

@testable import BelayCore

// The tools' memory: per account and instance on this phone, beside the store, under its
// protection class, gone at sign-out.

@Suite struct ToolMemoryTests {
  private let origin = URL(string: "https://belay.example.org")!

  private let typed = ToolMemory(
    inputs: ["energy": ["age": "34", "height": "178", "weight": "80,2"]],
    equipment: EquipmentChoice(preset: .competition), palId: "active", proteinGoal: .cut)

  @Test func keptPerAccount() throws {
    let folder = try Fixture.folder()
    let mine = ToolMemoryFile.url(userId: "u1", origin: origin, in: folder)
    let theirs = ToolMemoryFile.url(userId: "u2", origin: origin, in: folder)
    let elsewhere = ToolMemoryFile.url(
      userId: "u1", origin: URL(string: "https://other.example.org")!, in: folder)
    #expect(Set([mine, theirs, elsewhere]).count == 3)

    try ToolMemoryFile.write(typed, to: mine)
    #expect(ToolMemoryFile.read(mine) == typed)
    #expect(ToolMemoryFile.read(theirs) == ToolMemory())
    #expect(ToolMemoryFile.read(elsewhere) == ToolMemory())

    var later = typed
    later.inputs["bmi"] = ["weight": "79"]
    try ToolMemoryFile.write(later, to: mine)
    #expect(ToolMemoryFile.read(mine) == later)
  }

  @Test(.enabled(if: VolumeProtection.kept, VolumeProtection.reason))
  func fileBesideStoreWithProtection() throws {
    let folder = try Fixture.folder()
    let url = ToolMemoryFile.url(userId: "u1", origin: origin, in: folder)
    let store = AccountStore.fileURL(userId: "u1", origin: origin, in: folder)
    #expect(url.deletingLastPathComponent().standardizedFileURL == folder.standardizedFileURL)
    #expect(url.lastPathComponent.hasPrefix(store.deletingPathExtension().lastPathComponent))
    #expect(url != store)

    // A new file takes its folder's class unless the write names one, and the store's class is
    // also the usual default. In a folder of another class, only a write that names the store's
    // own lands under it, so the check reads the file back on the Mac too.
    let other = folder.appendingPathComponent("unless-open", isDirectory: true)
    try FileManager.default.createDirectory(
      at: other, withIntermediateDirectories: false,
      attributes: [.protectionKey: FileProtectionType.completeUnlessOpen])
    let inOther = ToolMemoryFile.url(userId: "u1", origin: origin, in: other)
    let unnamed = other.appendingPathComponent("unnamed.json")
    try Data("{}".utf8).write(to: unnamed, options: .atomic)
    try #require(
      try protection(of: unnamed) == .completeUnlessOpen,
      "this volume keeps protection classes, so the read-back below can tell them apart")

    try ToolMemoryFile.write(typed, to: inOther)
    #expect(try protection(of: inOther) == AccountStore.protection)
    #expect(ToolMemoryFile.read(inOther) == typed)
    // The second write replaces the file: it keeps the class too.
    try ToolMemoryFile.write(ToolMemory(), to: inOther)
    #expect(try protection(of: inOther) == AccountStore.protection)
  }

  private func protection(of url: URL) throws -> FileProtectionType? {
    try FileManager.default.attributesOfItem(atPath: url.path)[.protectionKey]
      as? FileProtectionType
  }

  @Test func removedAtSignOut() throws {
    let folder = try Fixture.folder()
    let mine = ToolMemoryFile.url(userId: "u1", origin: origin, in: folder)
    let theirs = ToolMemoryFile.url(userId: "u2", origin: origin, in: folder)
    try ToolMemoryFile.write(typed, to: mine)
    try ToolMemoryFile.write(typed, to: theirs)

    ToolMemoryFile.remove(userId: "u1", origin: origin, in: folder)
    #expect(!FileManager.default.fileExists(atPath: mine.path))
    #expect(ToolMemoryFile.read(mine) == ToolMemory())
    // Another account's memory stays.
    #expect(ToolMemoryFile.read(theirs) == typed)
    // Signing out twice finds nothing to remove.
    ToolMemoryFile.remove(userId: "u1", origin: origin, in: folder)
    #expect(!FileManager.default.fileExists(atPath: mine.path))
  }

  @Test func unreadableFileIsEmpty() throws {
    let folder = try Fixture.folder()
    let url = ToolMemoryFile.url(userId: "u1", origin: origin, in: folder)
    try Data("{\"inputs\": 3".utf8).write(to: url)
    #expect(ToolMemoryFile.read(url) == ToolMemory())
    #expect(ToolMemoryFile.read(folder.appendingPathComponent("none.json")) == ToolMemory())
  }

  @Test func choicesDefaultToSedentaryAndMaintain() {
    #expect(ToolMemory().pal == PalLevel(id: "sedentary", pal: 1.55))
    #expect(ToolMemory().goal == .maintain)
    #expect(typed.pal == PalLevel(id: "active", pal: 1.75))
    #expect(typed.goal == .cut)
    // A level this version does not know falls back as an absent one does.
    #expect(ToolMemory(palId: "athlete").pal.id == "sedentary")
  }
}
