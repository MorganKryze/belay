public import Foundation

/// Mon matériel: a preset, or the person's own bar and plates. The presets never change;
/// « Modifier » copies one into the custom set.
public struct EquipmentChoice: Codable, Sendable, Equatable {
  public enum Preset: String, Codable, Sendable, CaseIterable {
    case competition, gym, custom
  }

  /// Salle, as on the web.
  public var preset: Preset
  /// The custom set, the gym's until the person makes it theirs.
  public var custom: Plates

  public init(preset: Preset = .gym, custom: Plates = .gym) {
    self.preset = preset
    self.custom = custom
  }

  /// What Disques and Montée en charge load with.
  public var plates: Plates {
    switch preset {
    case .competition: .competition
    case .gym: .gym
    case .custom: custom
    }
  }
}

/// What the tools remember for one account on this phone: each tool's fields as last typed, by the
/// tool's id then the field's, Mon matériel, the activity level and the protein goal. It is never
/// sent: a height, a weight and girths are health data, and the web keeps its own copy per browser.
public struct ToolMemory: Codable, Sendable, Equatable {
  public var inputs: [String: [String: String]]
  public var equipment: EquipmentChoice?
  public var palId: String?
  public var proteinGoal: ProteinGoal?

  public init(
    inputs: [String: [String: String]] = [:], equipment: EquipmentChoice? = nil,
    palId: String? = nil, proteinGoal: ProteinGoal? = nil
  ) {
    self.inputs = inputs
    self.equipment = equipment
    self.palId = palId
    self.proteinGoal = proteinGoal
  }

  /// The activity level chosen, else the web's default, « sédentaire ».
  public var pal: PalLevel {
    palLevels.first { $0.id == palId } ?? palLevels.first { $0.id == "sedentary" }!
  }

  /// The protein goal chosen, else the web's default, maintenance.
  public var goal: ProteinGoal { proteinGoal ?? .maintain }
}

/// The memory's file: one per account and instance, beside the account's store, named as the store
/// is and under the same protection class. Not a store table, so nothing in it can reach the queue.
public enum ToolMemoryFile {
  /// The store's own class: readable once the phone was unlocked after a restart.
  static let options: Data.WritingOptions = [.atomic, .completeFileProtectionUntilFirstUserAuthentication]

  public static func url(userId: String, origin: URL, in folder: URL) -> URL {
    AccountStore.fileURL(userId: userId, origin: origin, in: folder)
      .deletingPathExtension().appendingPathExtension("tools.json")
  }

  /// The memory at `url`; empty when there is none yet or it no longer reads, so a tool opens as
  /// on a new phone rather than not at all.
  public static func read(_ url: URL) -> ToolMemory {
    guard let data = try? Data(contentsOf: url),
      let memory = try? JSONDecoder().decode(ToolMemory.self, from: data)
    else { return ToolMemory() }
    return memory
  }

  public static func write(_ m: ToolMemory, to url: URL) throws {
    try FileManager.default.createDirectory(
      at: url.deletingLastPathComponent(), withIntermediateDirectories: true,
      attributes: [.protectionKey: AccountStore.protection])
    try JSONEncoder().encode(m).write(to: url, options: options)
  }

  /// Sign-out's: the memory of `userId` on `origin` goes. A file already gone is the usual case;
  /// one that will not go is emptied instead, so no input outlives the sign-out.
  public static func remove(userId: String, origin: URL, in folder: URL) {
    let url = url(userId: userId, origin: origin, in: folder)
    guard FileManager.default.fileExists(atPath: url.path) else { return }
    do {
      try FileManager.default.removeItem(at: url)
    } catch {
      try? JSONEncoder().encode(ToolMemory()).write(to: url, options: options)
    }
  }
}
