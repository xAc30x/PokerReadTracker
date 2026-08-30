# TableRead Native iOS

This directory contains the native SwiftUI client for TableRead.

## Current state

The native app is intentionally offline-first and observational. It includes:

- SwiftUI application shell
- Cash / Tournament session context
- Fast player switching
- Pre-Flop, Flop, Turn, River, and Showdown logging
- Stack and wallet fields
- Session-specific player notes
- VPIP/PFR/3-bet observational stats
- Undo and Next Hand controls
- Compact Game Mode
- Atomic JSON persistence in Application Support
- Hand-based preflop sample accounting
- One-time device pairing through the production Cloudflare API
- Revocable bearer sessions stored in Keychain
- Offline-safe player and observation synchronization
- Unit-test target
- XcodeGen project generation
- GitHub macOS/Xcode build-for-testing validation
- Production app icon and privacy manifest
- Release archive/export automation
- App Store Connect validation and TestFlight upload workflow

No solver or real-time decision recommendation logic is included in the live HUD.

## Generate the Xcode project

Install XcodeGen, then from this directory run:

```bash
xcodegen generate
open TableReadApp.xcodeproj
```

The generated `.xcodeproj` is intentionally not committed; `project.yml` is the source of truth.

## TestFlight release

The `TestFlight Release` GitHub Actions workflow creates a signed Release archive, exports an IPA, validates it with App Store Connect, uploads it to TestFlight, and retains the signed IPA artifact for 14 days. Signing files are decoded only on the ephemeral macOS runner and removed after the archive completes.

The workflow runs only from `main`. Keep the `testflight` environment restricted to `main` and require a deployment reviewer if more than one person can write to the repository.

Create a protected GitHub environment named `testflight` and add these environment secrets:

- `APPLE_DISTRIBUTION_CERTIFICATE_BASE64` — Base64-encoded Apple Distribution `.p12` certificate.
- `APPLE_DISTRIBUTION_CERTIFICATE_PASSWORD` — Password used when exporting the `.p12`.
- `APPLE_PROVISIONING_PROFILE_BASE64` — Base64-encoded App Store distribution `.mobileprovision` for the TableRead bundle ID.
- `APP_STORE_CONNECT_API_KEY_ID` — App Store Connect team API key ID.
- `APP_STORE_CONNECT_API_ISSUER_ID` — Issuer ID for that API key.
- `APP_STORE_CONNECT_API_PRIVATE_KEY_BASE64` — Base64-encoded `AuthKey_<KEY_ID>.p8` file.

The provisioning profile is the release source of truth for the team ID and bundle ID. The workflow rejects development profiles, mismatched signing material, missing secrets, invalid version strings, or archives that App Store Connect does not accept.

Run the workflow manually and choose whether to upload. Every attempt receives a unique `CFBundleVersion` based on the GitHub Actions run and attempt numbers.

Before the first upload, the matching explicit bundle ID and TableRead app record must exist in Apple Developer and App Store Connect. The App Store distribution profile supplies the production bundle ID and team ID, so the workflow cannot accidentally archive under the repository's development defaults.

## Release roadmap

After the first successful TestFlight upload, the remaining native release milestones are:

1. Install the TestFlight build on a physical iPhone.
2. Validate pairing, offline persistence, reconnect sync, undo, revocation, safe areas, keyboard behavior, and relaunch persistence.
3. Add accessibility and end-to-end UI tests.
4. Add native player/table management and result-history parity with the web application.
5. Complete the App Store privacy questionnaire, public privacy policy, support URL, screenshots, and review metadata before external beta or App Store review.
