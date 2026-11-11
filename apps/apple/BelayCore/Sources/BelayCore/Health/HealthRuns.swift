public import Foundation

/// One Health run at a time for the open store. A trigger during a run gives one more run after
/// it; closing the store cancels its run between two objects, and a trigger for the next store
/// that came meanwhile gets its run once the cancelled one has stopped.
@MainActor public final class HealthRuns {
  private let writer: any HealthWriting
  private let now: @Sendable () -> Date
  private var running: (store: AccountStore, task: Task<Void, Never>)?
  private var next: (store: AccountStore, owner: String)?

  public init(writer: any HealthWriting, now: @escaping @Sendable () -> Date = { Date() }) {
    self.writer = writer
    self.now = now
  }

  /// A run for `store`, whose `ownerOf` is `owner`, now or once the run going has stopped.
  public func trigger(store: AccountStore, owner: String) {
    guard running == nil else {
      next = (store, owner)
      return
    }
    start(store, owner)
  }

  /// The store closed: its run stops between two objects, and no run waits for it.
  public func cancel() {
    running?.task.cancel()
    next = nil
  }

  /// Returns once no run is going nor waiting.
  func idle() async {
    while let task = running?.task { await task.value }
  }

  private func start(_ store: AccountStore, _ owner: String) {
    let writer = writer
    let now = now
    let task = Task { [weak self] in
      await runHealth(store: store, writer: writer, owner: owner, now: now())
      self?.ended()
    }
    running = (store, task)
  }

  private func ended() {
    running = nil
    guard let next else { return }
    self.next = nil
    start(next.store, next.owner)
  }
}
