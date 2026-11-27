# Godbot for Android development

[Install and pair](../README.md) · [简体中文](../README.zh-CN.md)

## Build from source

Use Node.js 24, JDK 17, and the Android SDK with platform 36. Set `ANDROID_HOME` to the SDK path. Use a development build because Godbot includes a local Expo native module.

```sh
npm ci
npm run typecheck
npm test
npm run android
```

The shared link, UI definitions, and file-transfer code in `godbot/` are checked in. To refresh them, run `GODBOT_SRC=/path/to/dsh-godbot npm run sync:godbot` from a committed desktop checkout with the link sources. Run `npm run check:godbot` to check the copies. [`godbot/SOURCE.json`](../godbot/SOURCE.json) records the source revision and file hashes.

### Build a release APK

```sh
npx expo prebuild --platform android --clean
(cd android && ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a)
```

The APK is written to `android/app/build/outputs/apk/release/app-release.apk`. Provide `GODBOT_ANDROID_KEYSTORE`, `GODBOT_ANDROID_KEYSTORE_PASSWORD`, `GODBOT_ANDROID_KEY_ALIAS`, and `GODBOT_ANDROID_KEY_PASSWORD` to use a release key. Local builds default to debug signing and are for testing only: Android installs an update in place only when it is signed with the same key, so every distributed APK is signed with the release certificate pinned in [`release/signing-cert.sha256`](../release/signing-cert.sha256). `node scripts/release-apk.mjs check-signature <apk>` checks an APK against it (needs `ANDROID_HOME` and Java).

Set `EXPO_PUBLIC_GODBOT_DEMO=1` at build time to open the built-in team without pairing. After a demo build, unset the flag and force Metro to regenerate the release bundle with `./gradlew :app:createBundleReleaseJsAndAssets --rerun assembleRelease` from `android/`.

For encrypted Firebase push, set `GODBOT_GOOGLE_SERVICES_JSON` to your project's `google-services.json` before running Expo prebuild and configure the matching service account on the relay. Long-press **Phone app** in **Settings → About Godbot** to trigger a local test of the encrypted notification.

### Tests and CI

The [CI workflow](../.github/workflows/ci.yml) runs type checking and tests, checks the shared files against their recorded revision, and builds the APK and checksum. Builds of `main` must be signed with the release key from the four signing secrets listed in the workflow (including `GODBOT_ANDROID_KEYSTORE_BASE64` for the keystore): without them, or with an APK that is not signed by the pinned certificate, the build fails instead of falling back to the debug key, and shared files synced from uncommitted desktop changes fail it too. Pull requests build a debug-signed APK, uploaded as `godbot-android-debug-signed`. CI artifacts are not releases.

### Releases

A release APK is built once and the published APK is the one that was verified:

1. Set `version` in `package.json` (the versionCode follows from it, see `app.config.js`), sync `godbot/` from a committed desktop revision, and merge to `main`.
2. Run **Release Godbot for Android** ([release.yml](../.github/workflows/release.yml)) from the Actions tab with the commit's full SHA. It builds the release-signed APK and stages it on a draft release with its checksum, the gzip copy the relay serves, and `app-metadata.json` (version, versionCode, signing certificate, SHA-256). It refuses an APK that is not signed with the pinned certificate, whose versionCode does not come after the last release, or whose last release was signed with another key.
3. The release tool (godbot-server `release/`) verifies the draft APK — its digest, the certificate, the versionCode against GitHub and the relay, an upgrade install over the last public APK on an emulator — and attaches `verification.json` to the draft.
4. Push the tag that names the version, for example `v0.1.1`, on the candidate's commit. The `promote` job publishes the draft only when the tag, the APK bytes, the `.sha256`, the gzip copy, `app-metadata.json` and `verification.json` agree; it never rebuilds, and a published release is never changed.
5. The relay's `/app/latest.json` is switched to the published APK last (`godbot-relay app publish` on the relay machine), and read back from `/app/latest.json` and `/download/latest`.

The [end-to-end scripts](../e2e/) require `adb` and an Android emulator. Pairing tests accept `GODBOT_E2E_APK` to override the APK path.

| Check | Run |
| --- | --- |
| Pair a standalone host, exercise a real PTY and verify background teardown on a dedicated emulator | `GODBOT_SRC=/path/to/dsh-godbot GODBOT_E2E_MACHINE_RELAY=ws://127.0.0.1:18793/v1/link GODBOT_E2E_APK=/path/to/app.apk ANDROID_SERIAL=emulator-5594 npm run e2e:remote` (start a local relay first) |
| Pair and send a message to a test computer | `GODBOT_E2E_PAIRING_URI='godbot://pair?…' npm run e2e:android` |
| Exercise settings and chat against a real Godbot test harness | `GODBOT_E2E_CONTROL=http://127.0.0.1:47781 npm run e2e:pages` |
| Check the upgrade prompt for an outdated computer | `npm run e2e:incompatible` |
| Check the demo UI | `npm run e2e:demo -- /path/to/demo.apk` |
| Test background reconnect and notifications | `GODBOT_RELAY_BIN=/path/to/godbot-relay node e2e/keepalive.mjs /path/to/app.apk` |
| Test APK download, verification, and installation | `GODBOT_E2E_RELAY_BIN=/path/to/godbot-relay node e2e/update.mjs` |

For graphical acceptance, pair the dedicated emulator with a graphical test host
and grant that phone view and control. Run `npm run e2e:remote-desktop` with
`ANDROID_SERIAL`, `GODBOT_E2E_DESKTOP_NAME`, `GODBOT_E2E_DESKTOP_POINT` (the
normalized x,y center of a text field), and `GODBOT_E2E_DESKTOP_RECEIPT` (a file
updated by that field). Set `GODBOT_E2E_DESKTOP_CONTAINER` if the receipt lives
inside your staging container. `GODBOT_E2E_FORCE_TURN=1` checks the selected RTC
candidate pair before exercising input.

For a local pairing test, start a relay and run `npm run e2e:fake-host -- ws://127.0.0.1:<port>/v1/link` to generate a pairing link and receive test messages. Set `GODBOT_E2E_RELAY_PORT` if the script needs to map the emulator's relay port with `adb reverse`. The desktop repository also provides the `PHONE-ANDROID` end-to-end case for the packaged Godbot plugin.
