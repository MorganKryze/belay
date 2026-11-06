import Foundation
import Testing

@testable import BelayCore

/// The HTTP stack keeps nothing between requests and never carries the bearer to a redirect.
@Suite struct HTTPClientTests {
  @Test func refusesEveryRedirect() async throws {
    let url = try #require(URL(string: "https://belay.example.org/api/me"))
    let session = URLSession(configuration: .ephemeral)
    let task = session.dataTask(with: url)
    for status in [301, 302, 303, 307, 308] {
      let response = try #require(
        HTTPURLResponse(
          url: url, statusCode: status, httpVersion: nil,
          headerFields: ["Location": "https://elsewhere.example.org/"]))
      let next = URLRequest(url: try #require(URL(string: "https://elsewhere.example.org/")))
      let followed = await NoRedirect().urlSession(
        session, task: task, willPerformHTTPRedirection: response, newRequest: next)
      #expect(followed == nil, "redirect \(status) followed")
    }
    session.invalidateAndCancel()
  }

  @Test func keepsNoCookieCacheOrSharedCredential() {
    let configuration = URLSessionClient.configuration
    #expect(configuration.httpCookieStorage == nil)
    #expect(configuration.httpShouldSetCookies == false)
    #expect(configuration.httpCookieAcceptPolicy == .never)
    #expect(configuration.urlCache == nil)
    // Ephemeral: its credentials live in memory, never in the shared store a default session uses.
    #expect(configuration.urlCredentialStorage !== URLCredentialStorage.shared)
  }
}
