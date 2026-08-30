import XCTest
@testable import TableReadApp

@MainActor
final class TrackerStoreTests: XCTestCase {
    private func makeStore() throws -> TrackerStore {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return TrackerStore(persistenceURL: directory.appendingPathComponent("tracker.json"))
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
        XCTAssertEqual(store.snapshot.observations[0].handID, store.snapshot.observations[1].handID)

        let firstHandID = store.snapshot.observations[0].handID
        store.nextHand()
        store.log(action: "Fold", street: .preflop)

        XCTAssertEqual(store.selectedPlayer?.observedHands, 2)
        XCTAssertEqual(store.selectedPlayer?.vpipHands, 1)
        XCTAssertNotEqual(store.snapshot.observations.last?.handID, firstHandID)
    }

    func testUndoRebuildsStatsAndQueuesRemoteDelete() throws {
        let store = try makeStore()
        store.addPlayer(name: "Villain")
        store.log(action: "Open", street: .preflop)
        let observationID = try XCTUnwrap(store.snapshot.observations.last?.id)
        XCTAssertEqual(store.selectedPlayer?.pfrHands, 1)

        store.undoLastObservation()
        XCTAssertEqual(store.selectedPlayer?.observedHands, 0)
        XCTAssertEqual(store.selectedPlayer?.pfrHands, 0)
        XCTAssertEqual(store.snapshot.pendingUndoIDs, [observationID])
    }

    func testLegacyObservationsReceiveStableHandIDs() throws {
        let store = try makeStore()
        store.addPlayer(name: "Villain")
        let playerID = try XCTUnwrap(store.selectedPlayer?.id)
        let first = PokerObservation(playerID: playerID, street: .flop, action: "Bet", handNumber: 4)
        let second = PokerObservation(playerID: playerID, street: .turn, action: "Check", handNumber: 4)
        store.applyServerSnapshot(players: store.snapshot.players, observations: [first, second])
        store.ensureSyncIdentifiers()

        XCTAssertNotNil(store.snapshot.observations[0].handID)
        XCTAssertEqual(store.snapshot.observations[0].handID, store.snapshot.observations[1].handID)
    }
}
