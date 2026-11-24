import Foundation

/// How the core reaches a server: one request, its body and the HTTP answer. Tests stand a fake in
/// its place.
public protocol HTTPClient: Sendable {
  func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse)
}

/// The system's HTTP stack, without cookies or cache: the session is the bearer token alone, and
/// nothing a server answers is kept on disk. A redirect is not followed: it would carry the token to
/// an address nobody checked, so it comes back as the answer and reads as a refusal.
public struct URLSessionClient: HTTPClient {
  private let session: URLSession

  /// Ephemeral, with no cookie store at all and no cache.
  static var configuration: URLSessionConfiguration {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.httpCookieStorage = nil
    configuration.httpShouldSetCookies = false
    configuration.httpCookieAcceptPolicy = .never
    configuration.urlCache = nil
    return configuration
  }

  public init() {
    session = URLSession(configuration: Self.configuration)
  }

  public func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
    let (data, response) = try await session.data(for: request, delegate: NoRedirect())
    guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
    return (data, http)
  }
}

final class NoRedirect: NSObject, URLSessionTaskDelegate, Sendable {
  func urlSession(
    _ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
    newRequest request: URLRequest
  ) async -> URLRequest? {
    nil
  }
}

/// Why an address is not taken as an instance, each said in its own sentence on the sign-in screen.
public enum InstanceError: Error, Sendable, Equatable {
  /// Not an address at all, or one with a name and password in it.
  case invalid
  /// Plain http, which only a debug build may use, and only to this machine.
  case insecure
  /// The phone has no network.
  case offline
  /// Nothing answered in time.
  case unreachable
  /// Something answered, but not as a Belay instance.
  case notBelay
  /// A Belay instance on a later contract version than this build's: the app needs an update.
  case instanceAhead
  /// A Belay instance on an earlier contract version: the instance needs an update.
  case instanceBehind
}

/// How an instance's contract version stands against this build's.
public enum VersionAnswer: Sendable, Equatable {
  case same, instanceAhead, instanceBehind

  /// Nil for a version that is not a whole number from 1: no Belay instance answers that.
  public init?(api: Double) {
    self.init(api: api, against: Bounds.apiVersion)
  }

  /// Against `ours` rather than this build's version, so a test can stand an earlier instance
  /// while this build is on the first version.
  init?(api: Double, against ours: Int) {
    guard let version = Int(exactly: api), version >= 1 else { return nil }
    self = version == ours ? .same : version > ours ? .instanceAhead : .instanceBehind
  }
}

/// A Belay instance: the origin it says it is served at, scheme, host and port only.
public struct Instance: Sendable, Equatable {
  public let origin: URL

  init(uncheckedOrigin origin: URL) {
    self.origin = origin
  }

  /// Plain http reaches a server run on the developer's own computer, from a debug build only; a
  /// release build reaches an instance over https or not at all.
  #if DEBUG
    public static let allowsLoopbackByDefault = true
  #else
    public static let allowsLoopbackByDefault = false
  #endif

  /// The hosts plain http may reach in a debug build.
  private static let loopback: Set<String> = ["localhost", "127.0.0.1"]

  /// A server that does not answer in this time is reported unreachable rather than left spinning.
  static let checkTimeout: TimeInterval = 10

  /// An origin kept from an earlier sign-in, taken back only if it still reads as one.
  public init?(storedOrigin: String, allowsLoopback: Bool = Instance.allowsLoopbackByDefault) {
    guard case .success(let origin) = Self.origin(of: storedOrigin, allowsLoopback: allowsLoopback),
      origin.absoluteString == storedOrigin
    else { return nil }
    self.origin = origin
  }

  /// What the person typed, asked whether a Belay instance answers there. The instance is taken at
  /// the origin it names itself, which must be an address this check accepts as typed.
  public static func check(
    _ address: String, using client: HTTPClient,
    allowsLoopback: Bool = Instance.allowsLoopbackByDefault
  ) async -> Result<Instance, InstanceError> {
    let typed: URL
    switch origin(of: address, allowsLoopback: allowsLoopback) {
    case .success(let origin): typed = origin
    case .failure(let error): return .failure(error)
    }
    let answer: (origin: String, version: VersionAnswer)
    switch await ask(typed, using: client) {
    case .success(let answered): answer = answered
    case .failure(let error): return .failure(error)
    }
    guard let served = Instance(storedOrigin: answer.origin, allowsLoopback: allowsLoopback)
    else { return .failure(.notBelay) }
    switch answer.version {
    case .same: return .success(served)
    case .instanceAhead: return .failure(.instanceAhead)
    case .instanceBehind: return .failure(.instanceBehind)
    }
  }

  /// How the contract version of `instance` stands against this build's; nil when the instance was
  /// not reached or did not answer as Belay. Asked without a session: the answer is public.
  public static func version(at instance: Instance, using client: HTTPClient) async
    -> VersionAnswer?
  {
    try? await ask(instance.origin, using: client).get().version
  }

  /// `GET api/instance` at `origin`: the origin and version a Belay instance says it has.
  private static func ask(_ origin: URL, using client: HTTPClient) async
    -> Result<(origin: String, version: VersionAnswer), InstanceError>
  {
    var request = URLRequest(url: origin.appending(path: "api/instance"))
    request.timeoutInterval = checkTimeout
    let data: Data
    let response: HTTPURLResponse
    do {
      (data, response) = try await client.send(request)
    } catch let error as URLError where offline.contains(error.code) {
      return .failure(.offline)
    } catch {
      return .failure(.unreachable)
    }
    struct Answer: Decodable {
      let app: String
      let api: Double
      let origin: String
    }
    guard response.statusCode == 200,
      let answer = try? JSONDecoder().decode(Answer.self, from: data),
      answer.app == "belay", let version = VersionAnswer(api: answer.api)
    else { return .failure(.notBelay) }
    return .success((answer.origin, version))
  }

  /// The errors that mean this phone is offline, rather than the server out of reach.
  private static let offline: Set<URLError.Code> = [
    .notConnectedToInternet, .dataNotAllowed, .internationalRoamingOff,
  ]

  /// `address` as an instance origin: https added when no scheme is given, any path dropped, as
  /// Belay is served at the root of its address. The same rule as the web app's address check.
  static func origin(of address: String, allowsLoopback: Bool) -> Result<URL, InstanceError> {
    let text = address.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty else { return .failure(.invalid) }
    let hasScheme = text.range(of: #"^[a-z][a-z\d+.-]*://"#, options: [.regularExpression, .caseInsensitive]) != nil
    guard let parts = URLComponents(string: hasScheme ? text : "https://\(text)"),
      parts.user == nil, parts.password == nil,
      let scheme = parts.scheme?.lowercased(),
      let host = parts.host?.lowercased(), !host.isEmpty
    else { return .failure(.invalid) }
    guard scheme == "https" || scheme == "http" else { return .failure(.invalid) }
    if scheme == "http", !(allowsLoopback && loopback.contains(host)) { return .failure(.insecure) }

    var origin = URLComponents()
    origin.scheme = scheme
    origin.host = host
    let standard = scheme == "https" ? 443 : 80
    if let port = parts.port, port != standard { origin.port = port }
    guard let url = origin.url else { return .failure(.invalid) }
    return .success(url)
  }

  /// `path` on this instance, below its root.
  func url(_ path: String) -> URL {
    origin.appending(path: path)
  }
}
