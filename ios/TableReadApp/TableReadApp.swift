import SwiftUI

@main
@MainActor
struct TableReadApp: App {
    @StateObject private var store = TrackerStore()

    var body: some Scene {
        WindowGroup {
            ContentView(store: store)
        }
    }
}
