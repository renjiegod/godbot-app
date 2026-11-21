# Godbot for Android

The Godbot phone app. It controls the Godbot team that runs in dsh on your computer; nothing runs on the phone. The connection is end-to-end encrypted (Noise IK) through a relay ([godbot-server](https://github.com/renjiegod/dsh-godbot/tree/main/src/link)), which only forwards ciphertext. The plan is in godbot-server's `IMPLEMENTATION_PLAN.md`, the wire protocol in its `docs/protocol.md`.

Pair the app with your computer: in Godbot, open Settings → Phone, enter the relay address (`wss://<your relay>/v1/link`), turn phone access on and show the QR code. Scan it in the app, or open the `godbot://pair?…` link on the phone.

This app is a fork of the DS Bot phone app (Apache-2.0, `5e9b7da`); see [NOTICE](NOTICE).

## Layout

| Path | What it is |
|---|---|
| `src/` | The app: connection, screens, team state, push, keep-alive, updates |
| `godbot/` | Code copied from dsh-godbot by `scripts/sync-godbot.mjs`: the encrypted link (`link/`), themes, characters and the dictionary (`client/`), IM platforms and chunked downloads (`shared/`). Never edit it by hand |
| `modules/godbot-native/` | Local Expo module (Kotlin): the foreground service for "Keep connected in background" (with its boot receiver and headless task), the battery-optimization and auto-start pages, file SHA-256 and the APK installer |
| `plugins/` | Expo config plugins: release signing, the cleartext allow-list, optional Firebase |
| `e2e/` | Emulator checks driven with adb and uiautomator: pairing and a chat (`android.mjs`), every page against a real Godbot (`pages.mjs`), an outdated computer (`incompatible.mjs`), "Keep connected in background" (`keepalive.mjs`), the demo build and the in-app update |

## Run

Needs Node 24, JDK 17 and the Android SDK (`ANDROID_HOME`). Expo Go is not supported: the app has its own native module.

```sh
npm ci
npm run sync:godbot      # copy the shared code from ../dsh-godbot-wt/phone-link-push or GODBOT_SRC
npm run typecheck
npm test
npx expo run:android     # build, install and start a debug build
```

`EXPO_PUBLIC_GODBOT_DEMO=1` skips pairing and fills the app with a demo team. It is only active when the flag is set while the bundle is built.

### Release build

```sh
npx expo prebuild -p android --clean
cd android && ./gradlew assembleRelease
```

The release is signed with the keystore that `GODBOT_ANDROID_KEYSTORE`, `GODBOT_ANDROID_KEYSTORE_PASSWORD`, `GODBOT_ANDROID_KEY_ALIAS` and `GODBOT_ANDROID_KEY_PASSWORD` name, else with the debug key.

`EXPO_PUBLIC_GODBOT_DEMO` is not a Gradle input: after building a demo bundle, force a fresh one or the release keeps the demo team:

```sh
./gradlew :app:createBundleReleaseJsAndAssets --rerun assembleRelease
```

### Push

End-to-end encrypted push needs Firebase: point `GODBOT_GOOGLE_SERVICES_JSON` at your project's `google-services.json` before `expo prebuild`, and give godbot-server the matching service account. Without it the app builds and works; the computer just cannot reach it while the app is closed. "Keep connected in background" in Settings works without Firebase.

How "Keep connected in background" holds up: the encrypted link lives outside React (`src/team/link-manager.ts`), so it survives the app being swiped away from Recents while the foreground service keeps the process. The service is sticky and starts again after a reboot or an app update if it was on, and brings the link back with no screen (a headless JS task, `src/team/keepalive-task.ts`). React Native runs no JS timers in the background, so the service sends a beat every 30 s and when the network or the screen comes back, and the link manager retries or drops a silent link by the clock. On phones from Xiaomi, Huawei, Honor, OPPO, vivo and others the person still has to let the app run: Settings shows "Battery optimization" and "Auto-start and lock" while the setting is on. A force stop in system settings, or a phone maker's cleaner when the app is not allowed to run, still ends it until the app is opened again: nothing reaches the phone while the app is not running (see FCM above).

A long press on Settings → About → Phone app shows a test notification sealed and opened the same way as a real push.

### Updates

The app checks `https://<relay>/app/latest.json` on the relay of the active computer (Settings → About → Check for app updates), downloads the APK, verifies its size and SHA-256 and hands it to the system installer.

## End-to-end check

```sh
GODBOT_E2E_PAIRING_URI='godbot://pair?…' GODBOT_E2E_RELAY_PORT=8787 node e2e/android.mjs
```

It installs the release APK on the running emulator, maps the relay port with `adb reverse`, opens the pairing link, confirms it, waits for the team list and sends a message.

Without a Godbot computer, `e2e/fake-host.mjs` stands in for one: it runs the same `HostLink` Godbot bundles, with a one-Bot team, and prints a `PAIRING godbot://pair?…` line and every message it receives (`SENT …`). Start a relay (godbot-server's `godbot-relay` with `GODBOT_RELAY_PORT=0`), then:

```sh
node e2e/fake-host.mjs ws://127.0.0.1:<relay port>/v1/link
```

`node e2e/demo-check.mjs <demo apk>` checks a demo-mode build on the emulator: the main screens, the hidden test push, and the keep-alive service starting and stopping. Screenshots and UI dumps go to `e2e/artifacts/`.

`GODBOT_E2E_RELAY_BIN=<godbot-relay> node e2e/update.mjs` checks the in-app update: it starts a relay that serves `/app/latest.json` and the APK, pairs with the stand-in computer, finds the newer version on About, downloads and verifies it, and confirms the system installer replaced the app.

`GODBOT_E2E_CONTROL=http://127.0.0.1:47781 node e2e/pages.mjs` goes through every page against a real Godbot whose test harness serves a control endpoint (`GET /info`, `POST /pair`, `POST /channel`). It pairs through a fresh link, then on each page reads, writes, and asks the computer's team channel whether the write arrived: Bots, group chats, memory, schedules, the working folder, usage, the Bot browser, secrets, model providers, connectors, capabilities, updates, diagnostics and About. Gated writes ask for the screen lock, so the script sets the PIN 1234 for the run and clears it at the end. It never installs an update and never opens the computer's folder picker. Results go to `e2e/artifacts/pages-results.json`, one screenshot per page to `pages-<page>.png`.

`node e2e/keepalive.mjs <apk>` checks "Keep connected in background" with a relay (`GODBOT_RELAY_BIN`, default: a godbot-server checkout next to this one) and the stand-in computer, which raises approvals on demand (a `NOTICE <text>` line on its stdin). With the setting on, each approval must become a system notification: with the app in the background, after it is swiped away from Recents, after its process is killed (a notice raised meanwhile comes with the catch-up), and after a reboot. It also opens the battery-optimization and auto-start pages from Settings. It needs an emulator image without Google Play, to kill the process as root.

`node e2e/incompatible.mjs` pairs with a stand-in computer whose Godbot is too old (`fake-host.mjs --incompatible`, `hello` answers `api: null`) and checks the upgrade hint and the growing delay between handshakes (2 s, 4 s, 8 s, 16 s).

The scripts read the screen with `uiautomator dump`, which cannot read it while the on-screen keyboard is up (it waits for an idle screen that never comes). The helpers in `e2e/adb.mjs` close the keyboard before each read.

The full check against a real Godbot (an isolated DSH Web, the packaged plugin and a relay) is dsh-godbot's `PHONE-ANDROID` case:

```sh
GODBOT_RELAY_BIN=<godbot-relay> GODBOT_ANDROID_E2E=$PWD npm --prefix <dsh-godbot> run test:e2e -- --case PHONE-ANDROID
```

## CI

`.github/workflows/ci.yml` runs the typecheck and tests, checks `godbot/` against the dsh-godbot commit in `godbot/SOURCE.json` (skipped with a warning while it records uncommitted changes), and builds the release APK. Set the secrets `GODBOT_ANDROID_KEYSTORE_BASE64`, `GODBOT_ANDROID_KEYSTORE_PASSWORD`, `GODBOT_ANDROID_KEY_ALIAS` and `GODBOT_ANDROID_KEY_PASSWORD` to sign it with the release key; without them it is signed with the debug key.
