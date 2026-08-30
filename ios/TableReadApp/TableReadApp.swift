import SwiftUI

@main
struct TableReadApp: App {
    @State private var store = TrackerStore()

    var body: some Scene {
        WindowGroup {
            ContentView(store: store)
        }
    }
}
