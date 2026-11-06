// swift-tools-version: 6.2
import PackageDescription

// The rules and the store the iPhone app and, later, the Watch share: no screen code, so it
// builds for watchOS and its tests run on the Mac.
let package = Package(
  name: "BelayCore",
  platforms: [.iOS(.v26), .watchOS(.v26), .macOS(.v15)],
  products: [.library(name: "BelayCore", targets: ["BelayCore"])],
  dependencies: [
    // Pinned exact: the store's format and its migrations follow this one version.
    .package(url: "https://github.com/groue/GRDB.swift.git", exact: "7.12.0")
  ],
  targets: [
    .target(
      name: "BelayCore",
      dependencies: [.product(name: "GRDB", package: "GRDB.swift")],
      resources: [.copy("Resources/seed.json")],
      swiftSettings: [
        .treatAllWarnings(as: .error),
        .treatWarning("DeprecatedDeclaration", as: .warning),
      ]
    ),
    .testTarget(
      name: "BelayCoreTests",
      dependencies: ["BelayCore"],
      resources: [.copy("Vectors")],
      swiftSettings: [.treatAllWarnings(as: .error)]
    ),
  ],
  swiftLanguageModes: [.v6]
)
