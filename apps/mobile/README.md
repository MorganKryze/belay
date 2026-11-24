# Belay for Android

This folder builds Belay as an Android app that talks to any Belay instance. It
wraps the web app in `apps/web`, the same one the browser runs, with the native
plugins it needs. You build it on your computer and install it from the command
line; the instance needs no setting beyond this release of Belay or a later one.
The iPhone app is native and lives in [`apps/apple`](../apple/README.md).

**Android v1 is tested on the emulator, not on a real phone.** The list of what
nobody has checked on a phone is at the end of this page. The debug build
below is meant for the emulator until a release build exists.

## Requirements

- Android Studio, for its SDK Manager and its emulator. Install the **Android
  16 (API 36)** platform, its system image (Google Play) and the **Android SDK
  Command-line Tools**. The build looks for the SDK in `~/Library/Android/sdk`;
  set `ANDROID_HOME` if yours is elsewhere.
- A JDK 21 (Gradle 8.14 takes 21 to 24 and refuses Android Studio's newer one
  as soon as a build script changes). If `JAVA_HOME` does not point at one, set
  `BELAY_JAVA_HOME` to a JDK 21's home, for example in your shell profile.
- Node 26 and pnpm.
- An emulator image, or a phone on Android 9 or later with **Android System
  WebView** 111 or later (Play updates it).

## Build and run

From the root of the repository:

```bash
pnpm install
pnpm android:build   # builds the web app and copies it into the Android project
pnpm android:run     # installs the debug app on the running emulator or phone, then starts it
pnpm android:check   # the Kotlin unit tests
```

`pnpm android:apk` builds the debug APK without installing it. Install and run
from the command line, never with Android Studio's **Run**. Never run
`cap add android`: the project is committed, and `pnpm android:build` only
copies the web app into it.

Open Belay, type your instance's address and sign in. The sign-in opens in a
private browser tab: Chrome 137 or later shows it as an Auth Tab, and any other
browser shows a Custom Tab.

## On a phone

1. Open **Settings › About phone** and tap **Build number** seven times, then
   open **Settings › System › Developer options** and turn on **USB debugging**.
2. Plug the phone in and accept the computer's key when it asks.
3. Run `pnpm android:run`.

The build is signed with the debug key Android Studio keeps in
`~/.android/debug.keystore`. On a new computer that key is new, and Android
refuses to update an app signed with another one: uninstall Belay first, which
erases its data on the phone (what is synced stays on your instance).

A debug build lets anyone with the cable, or anyone who gets `adb`, open the
app's private files (`adb shell run-as cloud.libresoftware.belay`), and its web
view can be inspected over USB. That is why this README keeps Belay to the
emulator until the release build exists. If you install it on your own phone,
you accept that.

## The ongoing notification

While a session is open, Belay keeps one ongoing notification, **Séance en
cours** (in English, **Session in progress**): the exercise, the set, the
session's clock, and the rest counting down by itself. It never shows a load or
a body figure. Tapping it opens the app; swiping it away keeps it away for that
session, and finishing the session removes it.

On Android 16 it becomes a **Live Update**: a chip in the status bar with the
clock (or the status word while the session is paused), then the top of the
shade and the lock screen. Earlier versions show a plain ongoing notification.

Its switches, all in Android's own settings:

- **Notification permission** (Android 13 and later): Belay asks once, when you
  start a session. Refuse and nothing is posted; allow it later in **Settings ›
  Apps › Belay › Notifications**.
- **Settings › Apps › Belay › Notifications** lists three channels: **Séance en
  cours** (silent, no badge), **Fin de repos** (the rest's end, with Belay's
  tone) and **Fin de repos (sans son)** (the same, silent). Turn one off there.
- **Live updates** (Android 16): the switch for promoting it is on the same
  page. Its exact wording depends on the phone and has not been read on one.

## Rest alert, exact alarms and the battery

The end of a rest rings on time with the app in the background, even in deep
sleep. Belay declares `USE_EXACT_ALARM` (granted at install on Android 13 and
later, and the plugin's `SCHEDULE_EXACT_ALARM` up to Android 12L), so there is
nothing to allow.

Some makers add a battery saver of their own, on Samsung and Xiaomi phones in
particular, that delays alarms or stops the app. If the alert comes late, set
the app's battery use to **Unrestricted** (Samsung: **Settings › Apps › Belay ›
Battery**; Xiaomi: **Battery saver › No restrictions** for Belay, and allow
autostart). This is unchecked without such a phone.

## Health Connect

With **Settings › Health Connect** turned on in the app, Belay writes to Health
Connect:

- an exercise session (strength training) for each finished session, with its
  start and end, without energy, sets or loads;
- a weight record for each weigh-in, timed 08:00 on its day (or the moment it is
  written, when that is earlier).

It reads two things. Exercise sessions from other apps, only to check whether
one already covers a session, so a session your watch recorded is not added
twice; those are neither kept nor sent anywhere. And weight, only once you turn
on **Import weigh-ins** and accept the sheet that names your instance: those
weigh-ins then sync to your instance like typed ones.

The import takes weigh-ins dated from the day you turn it on, and **Import
history from Health Connect** brings the older ones once, under the same rules:
the first reading of each day comes in, and a weigh-in typed, edited or deleted in
Belay stays as it is. Health Connect gives an app nothing older than 30 days before
its first permission, unless the app holds the history permission, which only
recent versions offer. Where it is offered, Belay asks for it when you tap the
action, and nowhere else, then reads what Health Connect gives whatever your
answer. If you refuse, the done row names the 30-day window and offers
**Import older weigh-ins**. On a version without the permission, the row says
that too, and offers nothing more.

Android 14 and later include Health Connect. On Android 9 to 13, install the
**Health Connect** app from Google Play first; Belay does not install it for
you. Belay asks for its permissions from the switches and the history action
only, in Health Connect's own screen, and the app's privacy dialog opens from
there.

The permissions live in Health Connect's settings, under **App permissions ›
Belay**. The one for older weigh-ins is further down that page, at **App
permissions › Belay › Additional access › Access past data**. That path was read
on the API 36.1 emulator, not on a phone. Turning the setting off, or deleting
the account, removes nothing from Health Connect: delete what is there in its
**Data** tab.

### Check the weigh-in history

An old weigh-in arriving through the history permission has not been seen yet,
on a phone or on the emulator: Google's Health Connect Toolbox, the test app that
adds one, does not install on the API 36.1 emulator. There, the permission
screens, the rows and the settings path were checked with a read that found
nothing. This list is what is left to run, with the Toolbox:

1. Add a weight dated 60 days back with the Toolbox, then turn on **Import
   weigh-ins**.
2. Tap **Import history from Health Connect**: on API 36.1 the history permission
   comes on a screen of its own, after any data permission Belay does not hold
   yet. Allow it: the weigh-in arrives in Belay.
3. Start again with a new emulator data set and refuse: the row shows the
   30-day window and **Import older weigh-ins**.
4. In Health Connect's settings, go to **App permissions › Belay › Additional
   access**, turn on **Access past data**, then tap that action: the weigh-in
   arrives.
5. After each request, check that write access is still granted.
6. Note what the image reports for the history feature: without it, the row
   says this version does not give older weigh-ins.

## On the emulator

- Create an emulator from the API 36 image (Google Play). API 35 works too and
  shows the plain notification.
- To test the rest alert in deep sleep, put the app in the background, then
  run `adb shell dumpsys deviceidle force-idle` (the `adb` is in
  `~/Library/Android/sdk/platform-tools`). The alert should still ring at the end
  of the rest.
- To see an app writing to Health Connect, or to put data there as another app,
  install Google's **Health Connect Toolbox**.
- The Auth Tab needs Chrome 137 or later; an older Chrome uses a Custom Tab.
- Kill the app during a rest with `adb shell am kill cloud.libresoftware.belay`:
  the notification turns to "Rest over" at the end.

## Never checked on a real phone

- OEM battery killers and their settings.
- Sound and vibration on a locked real device, and Do Not Disturb.
- StrongBox, the hardware-backed key store.
- OEM Live Update criteria (Samsung's Now Bar).
- The identity provider with passkeys or biometrics.
- Samsung Health or Fitbit showing the strength session.
- Android 9 to 13 with the Health Connect app from Play.
- Health Connect's history permission, and an old weigh-in arriving through it,
  which the emulator has not shown either.
- The feel of system back with gesture navigation.
- A release build signed with a kept keystore.
