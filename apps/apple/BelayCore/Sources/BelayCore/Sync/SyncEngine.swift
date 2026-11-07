import Foundation
import Synchronization
import os

/// Sends one account's queue to its instance and stores what comes back, one run at a time, with
/// the same rounds as the web app's sync.
public actor SyncEngine {
  /// A server answering `hasMore` forever must not spin the phone: the next trigger goes on.
  static let maxRounds = 50

  private let userId: String
  private let store: AccountStore
  private let transport: SyncTransport
  private let debounce: Duration
  private let onLanded: @Sendable () async -> Void

  public private(set) var status: SyncStatus = .idle
  /// The run going, which every sync asked meanwhile waits for.
  private var running: Task<Void, Never>?
  /// A sync was asked during the run: its pull may predate what the asker wants to see.
  private var again = false
  /// Set once the account closes: a run under way ends at its next step, and none starts.
  private var stopped = false
  private var timer: Task<Void, Never>?

  /// The status as last told, and who listens; read outside the actor by `statuses()`.
  private let listeners = Mutex<(last: SyncStatus, all: [UUID: AsyncStream<SyncStatus>.Continuation])>(
    (.idle, [:]))

  private static let log = Logger(subsystem: "cloud.libresoftware.belay", category: "sync")

  /// `onLanded` runs after each run that reached the server and the end of its rows, with the
  /// queue empty: what is stored then is current.
  public init(
    userId: String, store: AccountStore, transport: SyncTransport,
    debounce: Duration = .seconds(1), onLanded: @escaping @Sendable () async -> Void
  ) {
    self.userId = userId
    self.store = store
    self.transport = transport
    self.debounce = debounce
    self.onLanded = onLanded
  }

  /// Syncs now. A call during a run waits for it, and one more run follows it.
  public func sync() async {
    guard !stopped else { return }
    if let running {
      again = true
      return await running.value
    }
    let run = Task {
      repeat {
        again = false
        await rounds()
      } while again && !stopped
      running = nil
    }
    running = run
    await run.value
  }

  /// The run going if any, its pull fresh enough, else a new one: opening a screen with the app
  /// must not sync twice.
  public func refresh() async {
    if let running { return await running.value }
    await sync()
  }

  /// Syncs once writes have paused for the debounce.
  public func schedule() {
    guard !stopped else { return }
    timer?.cancel()
    let debounce = debounce
    timer = Task {
      try? await Task.sleep(for: debounce)
      guard !Task.isCancelled else { return }
      await sync()
    }
  }

  /// For good, right before the account closes its store. The batch out stays queued: the next
  /// sign-in sends it again, which the server's merge makes a no-op once taken.
  public func stop() {
    stopped = true
    timer?.cancel()
    timer = nil
    running?.cancel()
    let all = listeners.withLock { state in
      defer { state.all = [:] }
      return state.all.values
    }
    for listener in all { listener.finish() }
  }

  /// The current status, then each change, until `stop()`.
  public nonisolated func statuses() -> AsyncStream<SyncStatus> {
    let (stream, continuation) = AsyncStream.makeStream(of: SyncStatus.self)
    let id = UUID()
    listeners.withLock { state in
      continuation.yield(state.last)
      state.all[id] = continuation
    }
    continuation.onTermination = { [weak self] _ in
      self?.listeners.withLock { _ = $0.all.removeValue(forKey: id) }
    }
    return stream
  }

  private func set(_ next: SyncStatus) {
    guard next != status else { return }
    status = next
    listeners.withLock { state in
      state.last = next
      for listener in state.all.values { listener.yield(next) }
    }
  }

  /// Oldest changes first, with the cursor; on a 200 the sent ones leave the queue. Again while
  /// the queue holds changes (written meanwhile, or beyond one request) or the server has more.
  private func rounds() async {
    guard !stopped else { return }
    set(.syncing)
    do {
      var complete = false
      for _ in 0..<Self.maxRounds {
        let (batch, cursor) = try store.syncBatch(limit: Bounds.maxChanges)
        if stopped { return }
        let result = await transport.send(
          SyncRequest(
            account: userId, cursor: cursor, changes: batch.map { RawChange(bytes: $0.bytes) }))
        // The batch stays queued: the next sync sends it again, a no-op once merged.
        if stopped { return }
        guard case .ok(let response) = result else { return set(result.status) }
        try store.applyServer(sent: batch, response: response)
        if !response.hasMore, try store.outbox(limit: 1).isEmpty {
          complete = true
          break
        }
      }
      set(.idle)
      // Only after a pull that reached the end: rows come in the server's order, and a session
      // pulled without its last sets would look forgotten.
      if complete { await onLanded() }
    } catch {
      if stopped { return }
      // The store failed and rolled its write back: the queue is as it was.
      Self.log.error("sync: store failed: \(AccountStore.logLabel(error), privacy: .public)")
      set(.failed)
    }
  }
}
