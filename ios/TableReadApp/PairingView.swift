import SwiftUI

struct PairingView: View {
    @ObservedObject var store: TrackerStore
    @ObservedObject var sync: SyncController
    @Environment(\.dismiss) private var dismiss
    @State private var code = ""

    var body: some View {
        NavigationStack {
            Form {
                if sync.isPaired {
                    Section("This iPhone") {
                        Label("Paired with TableRead", systemImage: "checkmark.shield.fill")
                        LabeledContent("Status", value: sync.status)
                        Button("Sync now") {
                            Task { await sync.sync(store: store) }
                        }
                        .disabled(sync.isSyncing)
                    }

                    Section {
                        Button("Unpair this iPhone", role: .destructive) {
                            Task {
                                await sync.signOut()
                                dismiss()
                            }
                        }
                    }
                } else {
                    Section("Pair this iPhone") {
                        Text("Open TableRead's /pair page while signed in, generate a one-time code, then enter it below.")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)

                        TextField("8-character code", text: $code)
                            .textInputAutocapitalization(.characters)
                            .autocorrectionDisabled()
                            .font(.title3.monospaced())
                            .onChange(of: code) { _, value in
                                let clean = value.uppercased().filter { $0.isLetter || $0.isNumber }
                                if clean != value || clean.count > 8 {
                                    code = String(clean.prefix(8))
                                }
                            }

                        Button(sync.isSyncing ? "Pairing…" : "Pair iPhone") {
                            Task {
                                await sync.pair(code: code, store: store)
                                if sync.isPaired { dismiss() }
                            }
                        }
                        .disabled(code.count != 8 || sync.isSyncing)
                    }
                }

                if let error = sync.errorMessage {
                    Section("Last sync issue") {
                        Text(error).foregroundStyle(.secondary)
                    }
                }
            }
            .navigationTitle("TableRead Account")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }
}
