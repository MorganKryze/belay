# Belay for iPhone

## Moving from `apps/ios`

The folder was renamed from `apps/ios` to `apps/mobile`. Copy your signing file once:
`mv apps/ios/ios/local.xcconfig apps/mobile/ios/`, then delete the leftover `apps/ios`
folder (only ignored build files remain in it).

This folder builds Belay as an iPhone app that talks to any Belay instance.
You build it on a Mac and install it on your own iPhone with a free Apple ID;
the instance needs no setting. A free install lasts 7 days, then you run it again.

## Requirements

- A Mac with Xcode 26 or later.
- Node 24 and pnpm.
- An iPhone on iOS 16.4 or later, and its cable.
- A free Apple ID. No paid developer account is needed.

## Build

From the root of the repository:

```bash
pnpm install
pnpm ios:build
pnpm ios:open
```

`pnpm ios:build` builds the web app and copies it into the iPhone project;
`pnpm ios:open` opens that project in Xcode.

## Install with a free Personal Team

1. In Xcode, open **Settings › Accounts** and add your Apple ID.
2. Keep your team out of git: copy `ios/local.example.xcconfig` to `ios/local.xcconfig`
   (ignored) and put your Team ID there; both targets read it. Your Team ID is the
   Organizational Unit of your "Apple Development" certificate in Keychain Access. Don't pick the team under
   **Signing & Capabilities**: Xcode writes it into the tracked project. Keep the bundle identifier
   `cloud.libresoftware.belay`; if Xcode says it is taken, add a suffix of your
   own (`cloud.libresoftware.belay.yourname`), and give the lock screen
   extension the same one (see [its identifier](#the-extensions-identifier)).
3. Plug the iPhone in and tap **Trust** when it asks about this computer.
4. On the iPhone, open **Settings › Privacy & Security › Developer Mode**, turn
   it on and let the phone restart.
5. In Xcode, choose the iPhone as the run destination, then **Run**.
6. The first launch is refused until you trust yourself as a developer: on the
   iPhone, open **Settings › General › VPN & Device Management**, select your
   Apple ID and trust it.
7. Open Belay, type your instance's address and sign in.

## Every 7 days

A free profile expires after 7 days, and the app then stops opening. To renew
it, plug the iPhone in and run, from the root of the repository:

```bash
git pull
pnpm install
pnpm ios:build
```

Then **Run** again in Xcode. Your data stays on the phone, and the app picks up
the newest web app at the same time.

## The session on the lock screen

While a session is open in the app, the iPhone's lock screen shows it, and so
does the Dynamic Island on phones that have one. A paired Apple Watch shows it
too, in its Smart Stack. There is nothing to set up:
iOS asks once whether Belay may show Live Activities, and
**Settings › Belay › Live Activities** turns them off.

| When                                  | What shows                                                                                  |
| ------------------------------------- | ------------------------------------------------------------------------------------------- |
| A set is due                          | The exercise, "Set 2 of 4 · Session A" and the session's time                               |
| A rest runs                           | "Rest", the next set, the time left counting down and a bar emptying over the planned rest  |
| The rest is over                      | "Rest over" and "Back to it" with the next set, even with the app closed                    |
| The session is paused                 | "Paused" with the times standing still; under "Rest continues" the rest keeps counting down |
| Every set is done                     | "Every set done", the session and its time, until you finish it                             |
| Six hours without a word from the app | The last content and "Open Belay to carry on"; after a rest that ran out, "Rest over" stays |

Every word comes in the app's language. The lock screen shows the exercise and
the set, never a load, a weight or a body figure. Tapping it opens the app
where it was.

### The extension's identifier

The lock screen is drawn by an app extension, the **BelayActivity** target,
whose identifier is `cloud.libresoftware.belay.activity`. It is a second app
identifier, counted in the free team's 10 per 7 days. If you add a suffix to
the app's identifier, put the same one in the extension's, before `.activity`
(`cloud.libresoftware.belay.yourname.activity`): iOS refuses an extension
whose identifier does not start with its app's.

Never run `cap add ios`: it renames every identifier in the Xcode project.
`pnpm ios:build` only copies the web app and leaves the project as it is.

### On the simulator

`pnpm ios:sim` builds the app with its extension. To see a state without a
session, add `-BelayActivityDemo rest` (or `due`, `paused`, `paused-running`,
`paused-no-rest`, `done`, `stale`, `end`) to the scheme's launch arguments, under
**Product › Scheme › Edit Scheme › Run › Arguments**, or from this folder:

```bash
xcrun simctl install booted ios/DerivedData/Build/Products/Debug-iphonesimulator/App.app
xcrun simctl launch --terminate-running-process booted cloud.libresoftware.belay -BelayActivityDemo rest
```

Then go to the home screen to see it in the Dynamic Island. `end` closes it,
and the demo session then stays closed until the app is installed again. The
argument works in Debug builds only.

### Check on the phone

1. Start a session, then lock the phone: the exercise and the set show.
2. Unlock, log a set and lock again: the rest counts down and its bar empties.
3. Wait for the end of the rest: "Rest over" shows without opening the app.
4. Pause the session: the times stand still, or the rest goes on under
   "Rest continues".
5. Switch to another session: the lock screen moves to the new one.
6. Swipe the session away on the lock screen, then log a set: it does not come
   back for that session.
7. Finish the session: the lock screen lets it go.

## Apple Health

With **Settings › Apple Health** turned on in the app, Belay writes to the
iPhone's Health app:

- a traditional strength training workout for each finished session, with its
  start and end, marked indoor, without energy, sets or loads;
- a body mass sample for each weigh-in, timed 08:00 on its day (or the moment
  it is written, when that is earlier).

It reads two things. Workouts from other apps, only to check whether one
already covers a session, so a session your watch recorded is not added twice;
those are neither kept nor sent anywhere. And body mass, only once you turn on
**Import weigh-ins** and accept the sheet that names your instance: those
weigh-ins then sync to your instance like typed ones.

The import takes weigh-ins dated from the day you turn it on, whenever they
reach Health. **Import history from Health**, under the switch, brings the older
ones once, under the same rules: the first reading of each day comes in, and a
weigh-in typed, edited or deleted in Belay stays as it is. The read follows the
next sync, so offline the row keeps saying **Importing history…**. Once it says
**History imported**, the action comes back only after you turn the import off
and on. Turning the import off keeps what the history brought.

The project carries the HealthKit entitlement (`App/App.entitlements`), with no
team in it. Xcode's automatic signing adds HealthKit to your free team's App ID
at the next **Run**; there is nothing to tick. `pnpm ios:sim` builds unsigned,
without the entitlement, so Health refuses that build: to see Health at work,
**Run** from Xcode, on a simulator or on the phone.

iOS keeps the permissions in the Health app: tap your picture, then **Privacy ›
Apps › Belay**. The page shows what Belay may write and read, and **Data from
"Belay"** lists what it wrote there. Turning the setting off, or deleting the
account, removes nothing from Health: delete what is there in the Health app.

### Check on the phone

1. Open **Settings › Apple Health** in the app: the page answers with the
   status of Health.
2. Turn the setting on with the phone in French, then in English: the iOS
   sheet asks in that language.
3. Finish a session: it shows in Health and Fitness as a traditional strength
   training workout ("Musculation traditionnelle" in French), source Belay, no
   energy.
4. Move that session to another day in Belay: Health shows it on that day,
   once. Delete the session: it leaves Health.
5. Log a weigh-in: Health's weight shows it at 08:00. Edit it, then delete it:
   Health follows both.
6. Turn on **Import weigh-ins**, then, on a day with no weigh-in typed,
   edited or deleted in Belay, add a weight in the Health app and bring Belay
   back to the foreground: the weigh-in arrives in Belay. Health still lists
   Weight under what Belay may write.
7. With a watch or a workout app at hand, record a workout over the span of a
   session: Belay does not add a second one. Without one, note this line as
   not checked on a device.
8. Open the permissions page above: its path matches the page's help text.

## Limits of a free team

- 7 days per install, as above.
- 3 devices at most.
- 10 app identifiers per 7 days. Belay uses two, `cloud.libresoftware.belay`
  and its extension's `cloud.libresoftware.belay.activity`; changing the
  bundle identifier often uses them up.
- No push notifications.
- The end-of-rest notification follows the Silent switch: with the phone on
  silent, it shows without a sound.
- The app carries the web app of its build: it updates when you build it
  again, not when your instance updates.
- iOS may clear the data of an app left unopened for a long time; opening it
  counts as use, and everything already synced is still on your instance.

## Troubleshooting

- **"Untrusted Developer"**: step 6 was skipped. Trust your Apple ID in
  **Settings › General › VPN & Device Management**, then open the app again.
- **"Developer Mode required"**: turn on Developer Mode (step 4); the option
  only appears once the iPhone has been plugged into Xcode.
- **Signing errors in Xcode**: check that the Team is your Personal Team, and
  give the bundle identifier a suffix of your own if it is taken. "Maximum
  number of apps" means the free team's limits above: wait for the 7 days to
  pass, or reuse an identifier you already registered.
- **"Failed to show Widget 'cloud.libresoftware.belay.activity'"**: Xcode ran the
  extension's scheme. Choose the **App** scheme next to the run destination,
  then **Run**; it installs the extension with the app.
- **Signing error on "BelayActivity"**: put your Team ID in
  `ios/local.xcconfig` (step 2), which both targets read. Choosing the team
  under **Signing & Capabilities** writes it into the tracked Xcode project.
- **A Run fails on the HealthKit capability**: open **Signing &
  Capabilities** once, without changing the team, and Xcode regenerates the
  profile with HealthKit; then **Run** again.
- **No iPhone at hand**: `pnpm ios:sim` builds the app for the simulator,
  without signing.
- **A server on this Mac**: the app only reaches instances over https. To
  try it against a local server at `http://localhost`, build with
  `BELAY_LOOPBACK=1 pnpm ios:build`, and never install that build anywhere
  else.

# Belay for Android

The same folder builds Belay as an Android app that talks to any Belay instance.
You build it on your computer and install it from the command line; the instance
needs no setting beyond this release of Belay or a later one.

**Android v1 is tested on the emulator, not on a real phone.** The list of what
nobody has checked on a phone is at the end of this section. The debug build
below is meant for the emulator until a release build exists.

## Android requirements

- Android Studio, for its SDK Manager and its emulator. Install the **Android
  16 (API 36)** platform, its system image (Google Play) and the **Android SDK
  Command-line Tools**. The build looks for the SDK in `~/Library/Android/sdk`;
  set `ANDROID_HOME` if yours is elsewhere.
- A JDK 21 (Gradle 8.14 takes 21 to 24 and refuses Android Studio's newer one
  as soon as a build script changes). If `JAVA_HOME` does not point at one, set
  `BELAY_JAVA_HOME` to a JDK 21's home, for example in your shell profile.
- Node 24 and pnpm.
- An emulator image, or a phone on Android 9 or later with **Android System
  WebView** 111 or later (Play updates it).

## Android build and run

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
session's clock, and the rest counting down by itself. It is the counterpart of
the iPhone's lock screen. It never shows a load or a body figure. Tapping it
opens the app; swiping it away keeps it away for that session, and finishing the
session removes it.

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
history from Health Connect** brings the older ones once, under the same rules
as on the iPhone. Health Connect gives an app nothing older than 30 days before
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
