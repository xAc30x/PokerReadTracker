import Combine
import Foundation

@MainActor
final class TrackerStore: ObservableObject {
    @Published private(set) var snapshot: AppSnapshot
    @Published var persistenceError: String?

    private let fileURL: URL
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder

    init(persistenceURL: URL? = nil, fileManager: FileManager = .default) {
        if let persistenceURL {
            self.fileURL = persistenceURL
            try? fileManager.createDirectory(
                at: persistenceURL.deletingLastPathComponent(),
                withIntermediateDirectories: true
            )
        } else {
            let base = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
            let directory = base.appendingPathComponent("TableRead", isDirectory: true)
            try? fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
            self.fileURL = directory.appendingPathComponent("tracker.json")
        }

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
        ensureSyncIdentifiers()
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
        if snapshot.currentHandID == nil { snapshot.currentHandID = UUID() }
        let effectiveStreet = street ?? snapshot.currentStreet
        let observation = PokerObservation(
            playerID: playerID,
            street: effectiveStreet,
            action: action,
            handNumber: snapshot.handNumber,
            handID: snapshot.currentHandID
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
        let removed = snapshot.observations.remove(at: index)
        var pending = snapshot.pendingUndoIDs ?? []
        if !pending.contains(removed.id) { pending.append(removed.id) }
        snapshot.pendingUndoIDs = pending
        rebuildStats(for: playerID)
        persist()
    }

    func nextHand() {
        snapshot.handNumber += 1
        snapshot.currentStreet = .preflop
        snapshot.currentHandID = UUID()
        persist()
    }

    func ensureSyncIdentifiers() {
        if snapshot.currentHandID == nil { snapshot.currentHandID = UUID() }
        if snapshot.pendingUndoIDs == nil { snapshot.pendingUndoIDs = [] }

        var handIDs: [Int: UUID] = [:]
        for observation in snapshot.observations where observation.handID != nil {
            handIDs[observation.handNumber] = observation.handID
        }
        for index in snapshot.observations.indices where snapshot.observations[index].handID == nil {
            let handNumber = snapshot.observations[index].handNumber
            let handID = handIDs[handNumber] ?? UUID()
            handIDs[handNumber] = handID
            snapshot.observations[index].handID = handID
        }
        persist()
    }

    func applyServerSnapshot(players remotePlayers: [Player], observations remoteObservations: [PokerObservation]) {
        let localByID = Dictionary(uniqueKeysWithValues: snapshot.players.map { ($0.id, $0) })
        snapshot.players = remotePlayers.map { remote in
            guard let local = localByID[remote.id] else { return remote }
            var merged = remote
            merged.stack = local.stack
            merged.wallet = local.wallet
            merged.tag = local.tag
            merged.sessionNote = local.sessionNote
            return merged
        }
        snapshot.observations = remoteObservations
        snapshot.pendingUndoIDs = []

        if let selected = snapshot.selectedPlayerID,
           !snapshot.players.contains(where: { $0.id == selected }) {
            snapshot.selectedPlayerID = snapshot.players.first?.id
        } else if snapshot.selectedPlayerID == nil {
            snapshot.selectedPlayerID = snapshot.players.first?.id
        }

        rebuildAllStats()
        persist()
    }

    private func rebuildAllStats() {
        for index in snapshot.players.indices {
            snapshot.players[index].vpipHands = 0
            snapshot.players[index].pfrHands = 0
            snapshot.players[index].threeBetHands = 0
            snapshot.players[index].observedHands = 0
        }
        for player in snapshot.players {
            rebuildStats(for: player.id)
        }
    }

    private func rebuildStats(for playerID: UUID) {
        guard let index = snapshot.players.firstIndex(where: { $0.id == playerID }) else { return }
        let preflop = snapshot.observations.filter { $0.playerID == playerID && $0.street == .preflop }
        let hands = Dictionary(grouping: preflop, by: { $0.handID?.uuidString ?? "legacy-\($0.handNumber)" })

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
