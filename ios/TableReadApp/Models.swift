import Foundation

enum SessionKind: String, Codable, CaseIterable, Identifiable {
    case cash
    case tournament

    var id: String { rawValue }
    var title: String { rawValue.capitalized }
}

enum Street: String, Codable, CaseIterable, Identifiable {
    case preflop
    case flop
    case turn
    case river
    case showdown

    var id: String { rawValue }
    var title: String { rawValue.capitalized }
}

enum PlayerTag: String, Codable, CaseIterable, Identifiable {
    case neutral
    case green
    case yellow
    case orange
    case red
    case blue

    var id: String { rawValue }
}

struct Player: Codable, Identifiable, Equatable {
    var id: UUID
    var name: String
    var playStyle: String
    var stack: String
    var wallet: String
    var tag: PlayerTag
    var sessionNote: String
    var vpipHands: Int
    var pfrHands: Int
    var threeBetHands: Int
    var observedHands: Int

    init(
        id: UUID = UUID(),
        name: String,
        playStyle: String = "Unknown",
        stack: String = "",
        wallet: String = "",
        tag: PlayerTag = .neutral,
        sessionNote: String = "",
        vpipHands: Int = 0,
        pfrHands: Int = 0,
        threeBetHands: Int = 0,
        observedHands: Int = 0
    ) {
        self.id = id
        self.name = name
        self.playStyle = playStyle
        self.stack = stack
        self.wallet = wallet
        self.tag = tag
        self.sessionNote = sessionNote
        self.vpipHands = vpipHands
        self.pfrHands = pfrHands
        self.threeBetHands = threeBetHands
        self.observedHands = observedHands
    }

    var vpipPercent: Int? {
        guard observedHands > 0 else { return nil }
        return Int((Double(vpipHands) / Double(observedHands) * 100).rounded())
    }

    var pfrPercent: Int? {
        guard observedHands > 0 else { return nil }
        return Int((Double(pfrHands) / Double(observedHands) * 100).rounded())
    }
}

struct PokerObservation: Codable, Identifiable, Equatable {
    var id: UUID
    var playerID: UUID
    var street: Street
    var action: String
    var handNumber: Int
    var handID: UUID?
    var createdAt: Date

    init(
        id: UUID = UUID(),
        playerID: UUID,
        street: Street,
        action: String,
        handNumber: Int,
        handID: UUID? = nil,
        createdAt: Date = Date()
    ) {
        self.id = id
        self.playerID = playerID
        self.street = street
        self.action = action
        self.handNumber = handNumber
        self.handID = handID
        self.createdAt = createdAt
    }
}

struct AppSnapshot: Codable, Equatable {
    var players: [Player]
    var observations: [PokerObservation]
    var selectedPlayerID: UUID?
    var sessionKind: SessionKind
    var currentStreet: Street
    var handNumber: Int
    var gameMode: Bool
    var currentHandID: UUID?
    var pendingUndoIDs: [UUID]?

    static let empty = AppSnapshot(
        players: [],
        observations: [],
        selectedPlayerID: nil,
        sessionKind: .cash,
        currentStreet: .preflop,
        handNumber: 1,
        gameMode: false,
        currentHandID: UUID(),
        pendingUndoIDs: []
    )
}
