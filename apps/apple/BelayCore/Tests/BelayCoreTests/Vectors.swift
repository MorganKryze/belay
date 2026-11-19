import Foundation
import Testing

// The vector files `pnpm vectors` writes from the shared rules, read the one way every suite does.

/// The bytes of `Vectors/<name>.json`.
func vectorData(_ name: String) throws -> Data {
  let url = try #require(
    Bundle.module.url(forResource: name, withExtension: "json", subdirectory: "Vectors"))
  return try Data(contentsOf: url)
}

/// `Vectors/<name>.json` decoded as `type`.
func load<T: Decodable>(_ name: String, as type: T.Type = T.self) throws -> T {
  try JSONDecoder().decode(T.self, from: vectorData(name))
}
