import SwiftUI

struct ContentView: View {
    @ObservedObject var store: TrackerStore
    @State private var newPlayerName = ""

    private let preflopActions = ["Fold", "Limp", "Call", "Open", "3-Bet", "4-Bet+", "Squeeze", "All-In"]
    private let postflopActions = ["Check", "Bet", "Call", "Raise", "Fold", "Check-Raise", "Donk", "All-In"]
    private let showdownActions = ["Bluff", "Value", "Draw", "Muck"]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    sessionHeader
                    playerSwitcher
                    if store.selectedPlayer != nil {
                        selectedPlayerCard
                        if !store.snapshot.gameMode {
                            playerEditor
                        }
                        actionPanel
                        if !store.snapshot.gameMode {
                            showdownPanel
                        }
                    } else {
                        emptyState
                    }
                }
                .padding()
            }
            .background(Color(uiColor: .systemGroupedBackground))
            .navigationTitle("TableRead")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button(store.snapshot.gameMode ? "Exit Game" : "Game Mode") {
                        store.setGameMode(!store.snapshot.gameMode)
                    }
                }
            }
            .safeAreaInset(edge: .bottom) {
                handFooter
            }
            .alert("Storage Error", isPresented: Binding(
                get: { store.persistenceError != nil },
                set: { if !$0 { store.persistenceError = nil } }
            )) {
                Button("OK", role: .cancel) { store.persistenceError = nil }
            } message: {
                Text(store.persistenceError ?? "Unknown storage error")
            }
        }
    }

    private var sessionHeader: some View {
        VStack(spacing: 10) {
            Picker("Session", selection: Binding(
                get: { store.snapshot.sessionKind },
                set: { store.setSessionKind($0) }
            )) {
                ForEach(SessionKind.allCases) { kind in
                    Text(kind.title).tag(kind)
                }
            }
            .pickerStyle(.segmented)

            HStack {
                Label("Hand #\(store.snapshot.handNumber)", systemImage: "suit.spade.fill")
                Spacer()
                Text(store.snapshot.gameMode ? "Game Mode" : "Full HUD")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
            }
        }
        .padding()
        .background(.background, in: RoundedRectangle(cornerRadius: 18))
    }

    private var playerSwitcher: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("Players").font(.headline)
                Spacer()
                Text("\(store.snapshot.players.count)").foregroundStyle(.secondary)
            }

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 10) {
                    ForEach(store.snapshot.players) { player in
                        Button {
                            store.select(player.id)
                        } label: {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(player.name).font(.subheadline.weight(.semibold))
                                Text(player.stack.isEmpty ? player.playStyle : player.stack)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            .frame(minWidth: 112, alignment: .leading)
                            .padding(12)
                            .background(
                                store.snapshot.selectedPlayerID == player.id
                                    ? Color.accentColor.opacity(0.16)
                                    : Color(uiColor: .secondarySystemGroupedBackground),
                                in: RoundedRectangle(cornerRadius: 14)
                            )
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }

    private var selectedPlayerCard: some View {
        Group {
            if let player = store.selectedPlayer {
                VStack(alignment: .leading, spacing: 12) {
                    HStack {
                        VStack(alignment: .leading) {
                            Text(player.name).font(.title2.bold())
                            Text(player.playStyle).foregroundStyle(.secondary)
                        }
                        Spacer()
                        if !player.wallet.isEmpty {
                            VStack(alignment: .trailing) {
                                Text("Wallet").font(.caption).foregroundStyle(.secondary)
                                Text(player.wallet).font(.headline)
                            }
                        }
                    }

                    HStack(spacing: 12) {
                        stat("VPIP", player.vpipPercent.map(String.init) ?? "—")
                        stat("PFR", player.pfrPercent.map(String.init) ?? "—")
                        stat("3B", player.observedHands > 0 ? String(player.threeBetHands) : "—")
                        stat("Hands", String(player.observedHands))
                    }
                }
                .padding()
                .background(.background, in: RoundedRectangle(cornerRadius: 18))
            }
        }
    }

    private var playerEditor: some View {
        Group {
            if let player = store.selectedPlayer {
                VStack(spacing: 12) {
                    TextField("Play style", text: Binding(
                        get: { player.playStyle },
                        set: { value in store.updateSelectedPlayer { $0.playStyle = String(value.prefix(40)) } }
                    ))
                    .textFieldStyle(.roundedBorder)

                    HStack {
                        TextField("Stack, e.g. 82 BB", text: Binding(
                            get: { player.stack },
                            set: { value in store.updateSelectedPlayer { $0.stack = String(value.prefix(24)) } }
                        ))
                        .textFieldStyle(.roundedBorder)

                        TextField("Wallet / chips", text: Binding(
                            get: { player.wallet },
                            set: { value in store.updateSelectedPlayer { $0.wallet = String(value.prefix(24)) } }
                        ))
                        .textFieldStyle(.roundedBorder)
                    }

                    TextField("Session-specific read", text: Binding(
                        get: { player.sessionNote },
                        set: { value in store.updateSelectedPlayer { $0.sessionNote = String(value.prefix(1200)) } }
                    ), axis: .vertical)
                    .lineLimit(2...5)
                    .textFieldStyle(.roundedBorder)
                }
                .padding()
                .background(.background, in: RoundedRectangle(cornerRadius: 18))
            }
        }
    }

    private var actionPanel: some View {
        VStack(alignment: .leading, spacing: 12) {
            Picker("Street", selection: Binding(
                get: { store.snapshot.currentStreet },
                set: { store.setStreet($0) }
            )) {
                ForEach([Street.preflop, .flop, .turn, .river]) { street in
                    Text(street.title).tag(street)
                }
            }
            .pickerStyle(.segmented)

            let actions = store.snapshot.currentStreet == .preflop ? preflopActions : postflopActions
            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                ForEach(actions, id: \.self) { action in
                    Button(action) { store.log(action: action) }
                        .buttonStyle(.borderedProminent)
                        .controlSize(.large)
                        .frame(maxWidth: .infinity)
                }
            }
        }
        .padding()
        .background(.background, in: RoundedRectangle(cornerRadius: 18))
    }

    private var showdownPanel: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Showdown Evidence").font(.headline)
            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                ForEach(showdownActions, id: \.self) { action in
                    Button(action) { store.log(action: action, street: .showdown) }
                        .buttonStyle(.bordered)
                        .frame(maxWidth: .infinity)
                }
            }
        }
        .padding()
        .background(.background, in: RoundedRectangle(cornerRadius: 18))
    }

    private var emptyState: some View {
        VStack(spacing: 12) {
            Image(systemName: "person.3.fill").font(.system(size: 40)).foregroundStyle(.secondary)
            Text("Add your first player").font(.headline)
            TextField("Player name", text: $newPlayerName)
                .textFieldStyle(.roundedBorder)
                .textInputAutapitalization(.words)
            Button("Add Player") {
                store.addPlayer(name: newPlayerName)
                newPlayerName = ""
            }
            .buttonStyle(.borderedProminent)
            .disabled(newPlayerName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
        .padding(24)
        .background(.background, in: RoundedRectangle(cornerRadius: 18))
    }

    private var handFooter: some View {
        HStack(spacing: 14) {
            Button("Undo") { store.undoLastObservation() }
                .buttonStyle(.bordered)
            Spacer()
            Button("Next Hand") { store.nextHand() }
                .buttonStyle(.borderedProminent)
        }
        .padding()
        .background(.ultraThinMaterial)
    }

    private func stat(_ label: String, _ value: String) -> some View {
        VStack(spacing: 2) {
            Text(value).font(.headline.monospacedDigit())
            Text(label).font(.caption2).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
    }
}
