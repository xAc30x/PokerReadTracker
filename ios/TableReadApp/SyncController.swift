import Combine
import Foundation
import UIKit

@MainActor
final class SyncController: ObservableObject {
    @Published private(set) var isPaired: Bool
    @Published private(set) var isSyncing = false
    @Published private(set) var status = "Offline"
    @Published var errorMessage: String?

    private let session: URLSession
    private let baseURL: URL
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    init(session: URLSession = .shared, baseURL: URL? = nil) {
        self.session = session
        if let baseURL {
            self.baseURL = baseURL
        } else if let configured = Bundle.main.object(forInfoDictionaryKey: "TableReadAPIBaseURL") as? String,
                  let configuredURL = URL(string: configured) {
            self.baseURL = configuredURL
        } else {
            self.baseURL = URL(string: "https://table-read-poker-tracker.xac30x.chatgpt.site")!
        }
        self.isPaired = KeychainStore.loadToken() != nil
        encoder.dateEncodingStrategy = .iso8601
    }

    func pair(code: String, store: TrackerStore) async {
        guard !isSyncing else { return }
        isSyncing = true
        errorMessage = nil
        status = "Pairing…"

        do {
            let payload = PairRequest(code: code, deviceName: UIDevice.current.name)
            let body = try encoder.encode(payload)
            let responseData = try await request(path: "/api/mobile/exchange", method: "POST", body: body, token: nil)
            let response = try decoder.decode(PairResponse.self, from: responseData)
            try KeychainStore.saveToken(response.token)
            isPaired = true
            status = "Paired"
            isSyncing = false
            await sync(store: store)
        } catch {
            isSyncing = false
            isPaired = KeychainStore.loadToken() != nil
            status = "Pairing failed"
            errorMessage = error.localizedDescription
        }
    }

    func sync(store: TrackerStore) async {
        guard !isSyncing else { return }
        guard let token = KeychainStore.loadToken() else {
            isPaired = false
            status = "Offline"
            return
        }

        isSyncing = true
        errorMessage = nil
        status = "Syncing…"
        defer { isSyncing = false }

        do {
            store.ensureSyncIdentifiers()
            let payload = SyncRequest(
                players: store.snapshot.players.map { SyncPlayer(id: $0.id.uuidString, name: $0.name) },
                observations: try store.snapshot.observations.map(makeSyncObservation),
                deletedObservationIds: (store.snapshot.pendingUndoIDs ?? []).map(\.uuidString)
            )
            let body = try encoder.encode(payload)
            let responseData = try await request(path: "/api/mobile/sync", method: "POST", body: body, token: token)
            let response = try decoder.decode(SyncResponse.self, from: responseData)
            guard !response.truncated else { throw SyncError.historyLimitReached }

            let players = response.players.compactMap(makePlayer)
            let observations = response.observations.compactMap(makeObservation)
            store.applyServerSnapshot(players: players, observations: observations)
            isPaired = true
            status = "Synced"
        } catch SyncError.unauthorized {
            KeychainStore.deleteToken()
            isPaired = false
            status = "Pair again"
            errorMessage = SyncError.unauthorized.localizedDescription
        } catch {
            isPaired = true
            status = "Offline changes saved"
            errorMessage = error.localizedDescription
        }
    }

    func signOut() async {
        let token = KeychainStore.loadToken()
        KeychainStore.deleteToken()
        isPaired = false
        status = "Offline"
        errorMessage = nil

        guard let token else { return }
        _ = try? await request(path: "/api/mobile/revoke", method: "POST", body: Data("{}".utf8), token: token)
    }

    private func request(path: String, method: String, body: Data?, token: String?) async throws -> Data {
        guard let url = URL(string: path, relativeTo: baseURL)?.absoluteURL else { throw SyncError.invalidURL }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.timeoutInterval = 25
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if body != nil { request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        request.httpBody = body

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw SyncError.invalidResponse }
        if http.statusCode == 401 { throw SyncError.unauthorized }
        guard (200..<300).contains(http.statusCode) else {
            let apiError = try? decoder.decode(APIError.self, from: data)
            throw SyncError.server(apiError?.error ?? "Server returned HTTP \(http.statusCode).")
        }
        return data
    }

    private func makeSyncObservation(_ observation: PokerObservation) throws -> SyncObservation {
        guard let handID = observation.handID else { throw SyncError.missingHandID }
        let mapping = serverMapping(street: observation.street, action: observation.action)
        return SyncObservation(
            id: observation.id.uuidString,
            playerId: observation.playerID.uuidString,
            phase: mapping.phase,
            street: mapping.street,
            action: mapping.action,
            handId: handID.uuidString,
            handNumber: observation.handNumber,
            createdAt: observation.createdAt
        )
    }

    private func serverMapping(street: Street, action: String) -> (phase: String, street: String?, action: String) {
        if street == .preflop {
            let actionMap = [
                "Fold": "fold", "Limp": "limp", "Call": "call", "Open": "open-raise",
                "3-Bet": "three-bet", "4-Bet+": "four-bet-plus", "Squeeze": "squeeze", "All-In": "all-in",
            ]
            return ("preflop", nil, actionMap[action] ?? "fold")
        }
        if street == .showdown {
            let actionMap = ["Bluff": "bluff-shown", "Value": "value-shown", "Draw": "draw-shown", "Muck": "mucked-unknown"]
            return ("showdown", nil, actionMap[action] ?? "mucked-unknown")
        }
        let actionMap = [
            "Check": "check", "Bet": "bet", "Call": "call", "Raise": "postflop-raise",
            "Fold": "postflop-fold", "Check-Raise": "check-raise", "Donk": "donk-bet", "All-In": "postflop-all-in",
        ]
        return ("postflop", street.rawValue, actionMap[action] ?? "check")
    }

    private func makePlayer(_ remote: RemotePlayer) -> Player? {
        guard let id = UUID(uuidString: remote.id) else { return nil }
        return Player(id: id, name: remote.name, playStyle: remote.playStyle.capitalized)
    }

    private func makeObservation(_ remote: RemoteObservation) -> PokerObservation? {
        guard let id = UUID(uuidString: remote.id),
              let playerID = UUID(uuidString: remote.playerId) else { return nil }
        let street: Street
        switch remote.phase {
        case "preflop": street = .preflop
        case "showdown": street = .showdown
        case "postflop": street = Street(rawValue: remote.street ?? "") ?? .flop
        default: return nil
        }
        return PokerObservation(
            id: id,
            playerID: playerID,
            street: street,
            action: nativeAction(phase: remote.phase, action: remote.action),
            handNumber: remote.handNumber,
            handID: UUID(uuidString: remote.handId),
            createdAt: parseServerDate(remote.createdAt)
        )
    }

    private func nativeAction(phase: String, action: String) -> String {
        let map: [String: String] = [
            "fold": "Fold", "limp": "Limp", "call": "Call", "open-raise": "Open", "three-bet": "3-Bet",
            "four-bet-plus": "4-Bet+", "squeeze": "Squeeze", "all-in": "All-In", "check": "Check", "bet": "Bet",
            "postflop-raise": "Raise", "postflop-fold": "Fold", "check-raise": "Check-Raise", "donk-bet": "Donk",
            "postflop-all-in": "All-In", "bluff-shown": "Bluff", "value-shown": "Value", "draw-shown": "Draw",
            "mucked-unknown": "Muck",
        ]
        return map[action] ?? (phase == "showdown" ? "Muck" : "Check")
    }

    private func parseServerDate(_ value: String) -> Date {
        let iso = ISO8601DateFormatter()
        if let date = iso.date(from: value) { return date }
        let sql = DateFormatter()
        sql.locale = Locale(identifier: "en_US_POSIX")
        sql.timeZone = TimeZone(secondsFromGMT: 0)
        sql.dateFormat = "yyyy-MM-dd HH:mm:ss"
        return sql.date(from: value) ?? Date()
    }
}

private struct PairRequest: Encodable {
    let code: String
    let deviceName: String
}

private struct PairResponse: Decodable {
    let token: String
    let sessionId: String
}

private struct SyncRequest: Encodable {
    let players: [SyncPlayer]
    let observations: [SyncObservation]
    let deletedObservationIds: [String]
}

private struct SyncPlayer: Encodable {
    let id: String
    let name: String
}

private struct SyncObservation: Encodable {
    let id: String
    let playerId: String
    let phase: String
    let street: String?
    let action: String
    let handId: String
    let handNumber: Int
    let createdAt: Date
}

private struct SyncResponse: Decodable {
    let players: [RemotePlayer]
    let observations: [RemoteObservation]
    let truncated: Bool
}

private struct RemotePlayer: Decodable {
    let id: String
    let name: String
    let playStyle: String
}

private struct RemoteObservation: Decodable {
    let id: String
    let playerId: String
    let phase: String
    let street: String?
    let action: String
    let handId: String
    let handNumber: Int
    let createdAt: String
}

private struct APIError: Decodable {
    let error: String
}

enum SyncError: LocalizedError {
    case invalidURL
    case invalidResponse
    case unauthorized
    case missingHandID
    case historyLimitReached
    case server(String)

    var errorDescription: String? {
        switch self {
        case .invalidURL: return "The TableRead API URL is invalid."
        case .invalidResponse: return "The TableRead server returned an invalid response."
        case .unauthorized: return "This iPhone session is no longer authorized. Pair the app again."
        case .missingHandID: return "An offline hand is missing its synchronization identifier."
        case .historyLimitReached: return "The server history exceeds the current mobile synchronization limit."
        case .server(let message): return message
        }
    }
}
