import Synchronization

/// What the Live Activity's buttons call. The app installs one at launch; the extension never
/// does, so a button run in the extension's process writes nothing.
public protocol LockScreenHandler: Sendable {
  /// Logs the set the Activity showed; false when nothing was written.
  func logShown(workoutId: String, place: SetPlace) async -> Bool
  /// 30 s more on the running rest; false when no rest ran.
  func addThirty(workoutId: String) async -> Bool
}

/// The process's one handler, set once at launch and read by the intents.
public enum LockScreen {
  private static let installed = Mutex<(any LockScreenHandler)?>(nil)

  /// A second call is ignored: the first handler is the one the launch meant.
  public static func install(_ handler: any LockScreenHandler) {
    installed.withLock { current in
      if current == nil { current = handler }
    }
  }

  public static var handler: (any LockScreenHandler)? { installed.withLock { $0 } }
}
