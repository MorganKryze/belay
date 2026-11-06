import Foundation
import os

/// `POST /api/sync` on the account's instance with its bearer token.
public struct HTTPTransport: SyncTransport {
  private let instance: Instance
  private let token: String
  private let client: HTTPClient
  /// Takes lines that name a status or an error code, never the token, the body or the answer.
  private let log: @Sendable (String) -> Void

  /// A request that hangs, as behind a captive portal at the gym, would hold the sync for good.
  static let timeout: TimeInterval = 20

  private static let logger = Logger(subsystem: "cloud.libresoftware.belay", category: "sync")

  public init(instance: Instance, token: String, client: HTTPClient) {
    self.init(instance: instance, token: token, client: client) { line in
      Self.logger.info("\(line, privacy: .public)")
    }
  }

  init(
    instance: Instance, token: String, client: HTTPClient,
    log: @escaping @Sendable (String) -> Void
  ) {
    self.instance = instance
    self.token = token
    self.client = client
    self.log = log
  }

  public func send(_ request: SyncRequest) async -> SendResult {
    var http = BelayCore.request("api/sync", token: token, at: instance)
    http.httpMethod = "POST"
    http.timeoutInterval = Self.timeout
    http.setValue("application/json", forHTTPHeaderField: "Content-Type")
    let data: Data
    let response: HTTPURLResponse
    do {
      http.httpBody = try request.body()
      (data, response) = try await client.send(http)
    } catch {
      // A lost answer, a timeout or no network alike: the batch stays queued for the next sync.
      log("sync not answered: \(Self.label(error))")
      return .offline
    }
    let status = response.statusCode
    // 409: the token now belongs to another account than this queue's. Either way, sign in again.
    if status == 401 || status == 409 {
      log("sync refused the session: \(status)")
      return .expired
    }
    guard (200..<300).contains(status) else {
      log("sync answered \(status)")
      return .failed
    }
    guard let decoded = try? JSONDecoder().decode(SyncResponse.self, from: data) else {
      log("sync answered \(status) without rows")
      return .failed
    }
    log("sync answered \(status)")
    return .ok(decoded)
  }

  /// An error's domain and code: its text may carry the address, which names the instance.
  private static func label(_ error: any Error) -> String {
    let error = error as NSError
    return "\(error.domain) \(error.code)"
  }
}
