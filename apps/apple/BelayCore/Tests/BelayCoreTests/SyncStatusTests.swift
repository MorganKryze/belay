import Testing

@testable import BelayCore

/// What the screen says as statuses arrive: a run under way keeps the last line, so a trigger while
/// offline never hides the line and shows it again.
@Suite struct SyncStatusTests {
  @Test(arguments: [SyncStatus.offline, .expired, .failed])
  func aRunKeepsTheLastLine(_ shown: SyncStatus) {
    #expect(SyncStatus.syncing.noticed(after: shown) == shown)
  }

  @Test func aRunFromIdleSaysNothing() {
    #expect(SyncStatus.syncing.noticed(after: .idle) == .idle)
  }

  @Test(arguments: [SyncStatus.idle, .offline, .expired, .failed])
  func theRunsEndReplacesIt(_ next: SyncStatus) {
    for shown in [SyncStatus.idle, .offline, .expired, .failed] {
      #expect(next.noticed(after: shown) == next)
    }
  }
}
