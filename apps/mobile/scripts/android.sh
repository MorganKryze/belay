#!/bin/sh
# Runs the Android build from the command line: `android.sh gradle <tasks>` or `android.sh launch`.
# Gradle 8.14 needs JDK 21 to 24: a newer one (Android Studio's own) runs a cached build but fails
# as soon as a build script changes, so the JDK is picked here rather than left to JAVA_HOME.
set -eu

cd "$(dirname "$0")/.."
ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export ANDROID_HOME

java_major() {
  "$1/bin/java" -version 2>&1 | sed -n 's/.*version "\([0-9]*\).*/\1/p' | head -n 1
}

pick_jdk() {
  if [ -n "${BELAY_JAVA_HOME:-}" ]; then
    echo "$BELAY_JAVA_HOME"
    return
  fi
  if [ -n "${JAVA_HOME:-}" ] && [ -x "$JAVA_HOME/bin/java" ]; then
    major="$(java_major "$JAVA_HOME")"
    if [ -n "$major" ] && [ "$major" -ge 21 ] && [ "$major" -le 24 ]; then
      echo "$JAVA_HOME"
      return
    fi
  fi
  if [ -x /usr/libexec/java_home ] && home="$(/usr/libexec/java_home -v 21 2>/dev/null)"; then
    echo "$home"
    return
  fi
  for home in "$HOME"/.gradle/jdks/*21*/jdk-*/Contents/Home; do
    if [ -x "$home/bin/java" ]; then
      echo "$home"
      return
    fi
  done
  echo "Gradle needs JDK 21: set BELAY_JAVA_HOME (apps/mobile/README.md, Belay for Android)" >&2
  exit 1
}

case "${1:-}" in
  gradle)
    shift
    JAVA_HOME="$(pick_jdk)"
    export JAVA_HOME
    cd android
    exec ./gradlew --no-daemon "$@"
    ;;
  launch)
    exec "$ANDROID_HOME/platform-tools/adb" shell am start -n cloud.libresoftware.belay/.MainActivity
    ;;
  *)
    echo "usage: android.sh gradle <tasks> | android.sh launch" >&2
    exit 2
    ;;
esac
