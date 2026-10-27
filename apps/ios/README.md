# Belay for iPhone

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

The project carries the HealthKit entitlement (`App/App.entitlements`), with no
team in it. Xcode's automatic signing adds HealthKit to your free team's App ID
at the next **Run**; there is nothing to tick. `pnpm ios:sim` builds unsigned,
without the entitlement, so Health refuses that build: to see Health at work,
**Run** from Xcode, on a simulator or on the phone.

iOS keeps the permissions in **Settings › Health › Data Access & Devices ›
Belay**. That path is still to be confirmed on iOS 18, where Health sits under
**Settings › Apps › Health**. Turning the setting off, or deleting the
account, removes nothing from Health: delete what is there in the Health app.

### Check on the phone

1. Open **Settings › Apple Health** in the app: the page answers with the
   status of Health.
2. Turn the setting on with the phone in French, then in English: the iOS
   sheet asks in that language.
3. Finish a session: it shows in Health and Fitness as a traditional strength
   training workout ("Musculation traditionnelle" in French), source Belay, no
   energy.
4. Edit that session's end in Belay: Health shows the new end. Delete the
   session: it leaves Health.
5. Log a weigh-in: Health's weight shows it at 08:00. Edit it, then delete it:
   Health follows both.
6. Turn on **Import weigh-ins**, add a weight in the Health app, then bring
   Belay back to the foreground: the weigh-in arrives in Belay.
7. With a watch or a workout app at hand, record a workout over the span of a
   session: Belay does not add a second one. Without one, note this line as
   not checked on a device.
8. Find where iOS 18 keeps Belay's Health permissions, for the page's help
   text.

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
