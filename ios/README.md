# TableRead Native iOS

This directory contains the native SwiftUI client for TableRead.

## Current milestone

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
- Unit-test target
- XcodeGen project generation
- GitHub macOS/Xcode build-for-testing validation

No solver or real-time decision recommendation logic is included in the live HUD.

## Generate the Xcode project

Install XcodeGen, then from this directory run:

```bash
xcodegen generate
open TableReadApp.xcodeproj
```

The generated `.xcodeproj` is intentionally not committed; `project.yml` is the source of truth.

## Release roadmap

The next native milestones are:

1. Define an authenticated native sync API that does not depend on ChatGPT Sites request headers.
2. Add Sign in with Apple and secure token storage in Keychain.
3. Add bidirectional player/session synchronization with the existing TableRead backend.
4. Add network reachability and durable mutation retry semantics.
5. Add native player/table management and result history parity with the web application.
6. Add app icons, launch assets, accessibility/UI tests, and TestFlight signing configuration.
7. Validate on a physical iPhone before App Store/TestFlight distribution.
