# Belay for iPhone

The native iPhone app. SwiftUI, iOS 26.1 and later, Swift 6 with the main actor as the default
isolation. Tabs that are not built natively yet say they are on the web for now and link to your
instance in Safari.

## Build for the simulator

Nothing to set up, the build needs no signing:

```sh
xcodebuild -project apps/apple/Belay.xcodeproj -scheme Belay -configuration Debug \
  -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath "$HOME/belay-dd" CODE_SIGNING_ALLOWED=NO build -quiet
```

Run the UI test:

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
