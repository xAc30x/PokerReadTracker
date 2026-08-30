import Foundation
import Observation

@MainActor
@Observable
final class TrackerStore {
    private(set) var snapshot: AppSnapshot
    var persistenceError: String?

    private let fileURL: URL
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder

    init(fileManager: FileManager = .default) {
        let base = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        let directory = base.appendingPathComponent("TableRead", isDirectory: true)
        try? fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
        self.fileURL = directory.appendingPathComponent("tracker.json")
        self.encoder = JSONEncoder()
        self.decoder = JSONDecoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        encoder.dateEncodingStrategy = .iso8601
        decoder.dateDecodingStrategy = .iso8601

        if let data = try? Data(contentsOf: fileURL),
           let restored = try? decoder.decode(AppSnapshot.self, from: data) {
            self.snapshot = restored
        } else {
            self.snapshot = .empty
        }
    }

    var selectedPlayer: Player? {
        guard let id = snapshot.selectedPlayerID else { return nil }
        return snapshot.players.first(where: { $0.id == id })
    }

    func addPlayer(name: String) {
        let clean = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !clean.isEmpty else { return }
        let player = Player(name: String(clean.prefix(80)))
        snapshot.players.append(player)
        snapshot.selectedPlayerID = player.id
        persist()
    }

    func select(_ playerID: UUID) {
        guard snapshot.players.contains(where: { $0.id == playerID }) else { return }
        snapshot.selectedPlayerID = playerID
        persist()
    }

    func updateSelectedPlayer(_ mutation: (inout Player) -> Void) {
        guard let id = snapshot.selectedPlayerID,
              let index = snapshot.players.firstIndex(where: { $0.id == id }) else { return }
        mutation(&snapshot.players[index])
        persist()
    }

    func setSessionKind(_ kind: SessionKind) {
        snapshot.sessionKind = kind
        persist()
    }

    func setStreet(_ street: Street) {
        snapshot.currentStreet = street
        persist()
    }

    func setGameMode(_ enabled: Bool) {
        snapshot.gameMode = enabled
        persist()
    }

    func log(action: String, street: Street? = nil) {
        guard let playerID = snapshot.selectedPlayerID else { return }
        let effectiveStreet = street ?? snapshot.currentStreet
        let observation = Observation(
            playerID: playerID,
            street: effectiveStreet,
            action: action,
            handNumber: snapshot.handNumber
        )
        snapshot.observations.append(observation)
        if effectiveStreet == .preflop {
            rebuildStats(for: playerID)
        }
        persist()
    }

    func undoLastObservation() {
        guard let playerID = snapshot.selectedPlayerID,
              let index = snapshot.observations.lastIndex(where: { $0.playerID == playerID }) else { return }
        snapshot.observations.remove(at: index)
        rebuildStats(for: playerID)
        persist()
    }

    func nextHand() {
        snapshot.handNumber += 1
        snapshot.currentStreet = .preflop
        persist()
    }

    private func rebuildStats(for playerID: UUID) {
        guard let index = snapshot.players.firstIndex(where: { $0.id == playerID }) else { return }
        let preflop = snapshot.observations.filter { $0.playerID == playerID && $0.street == .preflop }
        let hands = Dictionary(grouping: preflop, by: \.handNumber)

        snapshot.players[index].observedHands = hands.count
        snapshot.players[index].vpipHands = hands.values.reduce(into: 0) { total, actions in
            if actions.contains(where: { $0.action != "Fold" }) { total += 1 }
        }
        snapshot.players[index].pfrHands = hands.values.reduce(into: 0) { total, actions in
            if actions.contains(where: { ["Open", "3-Bet", "4-Bet+", "All-In", "Squeeze"].contains($0.action) }) {
                total += 1
            }
        }
        snapshot.players[index].threeBetHands = hands.values.reduce(into: 0) { total, actions in
            if actions.contains(where: { $0.action == "3-Bet" || $0.action == "Squeeze" }) {
                total += 1
            }
        }
    }

    private func persist() {
        do {
            let data = try encoder.encode(snapshot)
            try data.write(to: fileURL, options: .atomic)
            persistenceError = nil
        } catch {
            persistenceError = error.localizedDescription
        }
    }
}
