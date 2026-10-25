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
2. Select the **App** target, then **Signing & Capabilities**. Under **Team**,
   choose "<your name> (Personal Team)". Keep the bundle identifier
   `cloud.libresoftware.belay`; if Xcode says it is taken, add a suffix of your
   own (`cloud.libresoftware.belay.yourname`).
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

## Limits of a free team

- 7 days per install, as above.
- 3 devices at most.
- 10 app identifiers per 7 days: changing the bundle identifier often uses
  them up.
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
- **No iPhone at hand**: `pnpm ios:sim` builds the app for the simulator,
  without signing.
- **A server on this Mac**: the app only reaches instances over https. To
  try it against a local server at `http://localhost`, build with
  `BELAY_LOOPBACK=1 pnpm ios:build`, and never install that build anywhere
  else.
