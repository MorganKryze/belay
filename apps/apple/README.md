# Belay for iPhone

The native iPhone app: SwiftUI, iOS 26.1 and later, Swift 6 with the main actor as the default
isolation. It talks to any Belay instance of this release or a later one, keeps what it needs on
the phone to work offline, and syncs when it can. Its rules and its store live in `BelayCore`, a
Swift package tested against cases the shared TypeScript rules compute. The **BelayActivity**
extension draws the session on the lock screen.

## Build for the simulator

It needs Xcode 27.2 or later, for the iOS 27 SDK. Nothing else to set up, the build needs no
signing:

```sh
xcodebuild -project apps/apple/Belay.xcodeproj -scheme Belay -configuration Debug \
  -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath "$HOME/belay-dd" CODE_SIGNING_ALLOWED=NO build -quiet
```

## Run the tests

The core's tests run on the Mac, with no simulator:

```sh
swift test --package-path apps/apple/BelayCore
```

Part of them read cases computed by the shared rules in `packages/shared`, written as JSON under
`BelayCore/Tests/BelayCoreTests/Vectors`. When a shared rule changes, regenerate them from the root
of the repository; the check fails when they are stale, and CI runs it:

```sh
pnpm vectors
pnpm vectors:check
```

The UI tests run on a simulator, one class at a time:

```sh
xcodebuild test -project apps/apple/Belay.xcodeproj -scheme Belay \
  -destination 'platform=iOS Simulator,name=<an installed iPhone simulator>' \
  -derivedDataPath "$HOME/belay-dd" -only-testing:BelayUITests/ShellTests CODE_SIGNING_ALLOWED=NO
```

## Install on your phone from the command line

1. Copy `local.example.xcconfig` to `local.xcconfig` and put your own team id in it. The file is
   ignored by git.
2. Plug the phone in, unlock it, and find its identifier with `xcrun devicectl list devices`.
3. Build for the device. Keep the derived data folder outside the repository:

   ```sh
   xcodebuild -project apps/apple/Belay.xcodeproj -scheme Belay -configuration Debug \
     -destination 'generic/platform=iOS' -derivedDataPath "$HOME/belay-dd-device" \
     -allowProvisioningUpdates build -quiet
   ```

4. Install and launch:

   ```sh
   xcrun devicectl device install app --device <identifier> \
     "$HOME/belay-dd-device/Build/Products/Debug-iphoneos/Belay.app"
   xcrun devicectl device process launch --device <identifier> cloud.libresoftware.belay
   ```

The bundle id is `cloud.libresoftware.belay`, the same as the previous app, so the new one installs
in its place and keeps its icon slot.

## Re-install every 7 days

With a free developer account, the profile that signs the app expires after 7 days and the app
stops opening. Run steps 3 and 4 again; nothing stored on the phone is lost by installing over the
top. A paid account lasts a year.

## Apple Health

**Settings › Apple Health** in the app writes each session you finish and each weigh-in to Health,
from the moment it is on. **Import weigh-ins from Health** brings the whole weigh-in history the
first time, then each new one, and never replaces a weigh-in already in Belay. **Import steps from
Health** brings the totals of today and the 6 days before; a day further back keeps the total it
had when it left that window.

The app carries the HealthKit entitlement (`Belay/Belay.entitlements`), with no team in it. The
simulator build above is unsigned, so Health refuses it: to see Health at work, install a signed
build. iOS keeps the permissions in the Health app: tap your picture, then **Privacy › Apps ›
Belay**. Turning the setting off, or deleting the account, removes nothing from Health.

## CI

The `ios` workflow (`.github/workflows/ios.yml`) runs one job on a macOS runner with Xcode 27.2: the
core's tests, then the simulator build above, unsigned and with no secret. It starts only when a
pull request or a push to `main` changes `apps/apple`, `packages/shared`,
`scripts/swift-vectors.ts` or the workflow itself. A newer push cancels the older run, and the job
stops at 30 minutes. The UI tests stay off CI: the suite takes about 85 minutes, so they run on a
Mac before a merge.

Never make this job a required check. A pull request that changes none of those paths starts no
run, and GitHub then leaves a required check pending forever, which blocks the merge of every such
pull request.
