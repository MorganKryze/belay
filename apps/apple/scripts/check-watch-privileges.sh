#!/bin/sh
# The watch app will hold the iPhone's session token, so it asks for nothing past its screen: no
# health data, no background modes, no entitlements, and it never runs without its iPhone. Each
# of those can come from the watch's Info.plist, from a build setting merged into the generated
# Info.plist, or from an entitlements file named in the build settings. So this reads what Xcode
# produced and resolved, not one source file: the built app's Info.plist, and the watch target's
# settings in both configurations.
#
# Usage: check-watch-privileges.sh <the built Belay.app>
set -eu

plist="$1/Watch/BelayWatch.app/Info.plist"
project="$(dirname "$0")/../Belay.xcodeproj"
failed=0

refuse() {
  echo "watch privileges: $1" >&2
  failed=1
}

if [ ! -f "$plist" ]; then
  echo "watch privileges: no watch Info.plist at $plist" >&2
  exit 1
fi

keys=$(plutil -convert xml1 -o - "$plist" | sed -n 's|.*<key>\(.*\)</key>.*|\1|p')
for key in $(echo "$keys" | grep -E '^(NSHealth|WKBackgroundModes$)' || true); do
  refuse "the built Info.plist has $key"
done
independent=$(plutil -extract WKRunsIndependentlyOfCompanionApp raw -o - "$plist" 2>/dev/null || echo missing)
if [ "$independent" != false ]; then
  refuse "the built Info.plist has WKRunsIndependentlyOfCompanionApp $independent, not false"
fi

for configuration in Debug Release; do
  settings=$(xcodebuild -project "$project" -target BelayWatch -configuration "$configuration" -showBuildSettings)
  granted=$(echo "$settings" | sed -n -E 's/^ *((CODE_SIGN_ENTITLEMENTS|INFOPLIST_KEY_(NSHealth[A-Za-z]*|WKBackgroundModes|WKRunsIndependentlyOfCompanionApp)) = .+)$/\1/p')
  if [ -n "$granted" ]; then
    echo "$granted" | while IFS= read -r setting; do
      echo "watch privileges: $configuration sets $setting" >&2
    done
    failed=1
  fi
done

exit "$failed"
