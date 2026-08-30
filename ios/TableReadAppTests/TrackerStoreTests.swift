import XCTest
@testable import TableReadApp

@MainActor
final class TrackerStoreTests: XCTestCase {
    private func makeStore() throws -> TrackerStore {
        let manager = FileManager.default
        let directory = manager.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try manager.createDirectory(at: directory, withIntermediateDirectories: true)
        let suiteName = "TableReadTests-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suiteName) else {
            throw NSError(domain: "TableReadTests", code: 1)
        }
        defaults.removePersistentDomain(forName: suiteName)
        return TrackerStore(fileManager: TestFileManager(applicationSupportURL: directory))
    }

    func testAddingPlayerSelectsIt() throws {
        let store = try makeStore()
        store.addPlayer(name: "Villain")
        XCTAssertEqual(store.snapshot.players.count, 1)
        XCTAssertEqual(store.selectedPlayer?.name, "Villain")
    }

    func testPreflopStatsAreHandBased() throws {
        let store = try makeStore()
        store.addPlayer(name: "Villain")
        store.log(action: "Call", street: .preflop)
        store.log(action: "3-Bet", street: .preflop)

        XCTAssertEqual(store.selectedPlayer?.observedHands, 1)
        XCTAssertEqual(store.selectedPlayer?.vpipHands, 1)
        XCTAssertEqual(store.selectedPlayer?.pfrHands, 1)
        XCTAssertEqual(store.selectedPlayer?.threeBetHands, 1)

        store.nextHand()
        store.log(action: "Fold", street: .preflop)

        XCTAssertEqual(store.selectedPlayer?.observedHands, 2)
        XCTAssertEqual(store.selectedPlayer?.vpipHands, 1)
    }

    func testUndoRebuildsStats() throws {
        let store = try makeStore()
        store.addPlayer(name: "Villain")
        store.log(action: "Open", street: .preflop)
        XCTAssertEqual(store.selectedPlayer?.pfrHands, 1)

        store.undoLastObservation()
        XCTAssertEqual(store.selectedPlayer?.observedHands, 0)
        XCTAssertEqual(store.selectedPlayer?.pfrHands, 0)
    }
}

private final class TestFileManager: FileManager {
    private let applicationSupportURL: URL

    init(applicationSupportURL: URL) {
        self.applicationSupportURL = applicationSupportURL
        super.init()
    }

    override func urls(for directory: SearchPathDirectory, in domainMask: SearchPathDomainMask) -> [URL] {
        if directory == .applicationSupportDirectory {
            return [applicationSupportURL]
        }
        return super.urls(for: directory, in: domainMask)
    }
}
