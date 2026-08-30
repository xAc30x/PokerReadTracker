import SwiftUI

@main
@MainActor
struct TableReadApp: App {
    @StateObject private var store = TrackerStore()
    @StateObject private var sync = SyncController()

    var body: some Scene {
        WindowGroup {
            ContentView(store: store, sync: sync)
                .task {
                    if sync.isPaired {
                        await sync.sync(store: store)
                    }
                }
        }
    }
}
