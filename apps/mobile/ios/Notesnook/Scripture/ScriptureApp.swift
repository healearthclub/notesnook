// Generated from the standalone Scripture app by integrate_apps.py.
import SwiftUI

@available(iOS 17.0, *)
extension Color {
    static let paper = Color(uiColor: UIColor { traits in
        traits.userInterfaceStyle == .dark ? UIColor(red: 0.10, green: 0.09, blue: 0.08, alpha: 1)
            : UIColor(red: 0.98, green: 0.96, blue: 0.93, alpha: 1)
    })
    static let panel = Color(uiColor: UIColor { traits in
        traits.userInterfaceStyle == .dark ? UIColor(red: 0.16, green: 0.14, blue: 0.13, alpha: 1)
            : UIColor(red: 0.95, green: 0.92, blue: 0.87, alpha: 1)
    })
    static let ink = Color(uiColor: UIColor { traits in
        traits.userInterfaceStyle == .dark ? UIColor(red: 0.97, green: 0.94, blue: 0.89, alpha: 1)
            : UIColor(red: 0.16, green: 0.13, blue: 0.11, alpha: 1)
    })
    static let mutedInk = Color(uiColor: UIColor { traits in
        traits.userInterfaceStyle == .dark ? UIColor(red: 0.77, green: 0.72, blue: 0.66, alpha: 1)
            : UIColor(red: 0.39, green: 0.35, blue: 0.30, alpha: 1)
    })
    static let clay = Color(uiColor: UIColor { traits in
        traits.userInterfaceStyle == .dark ? UIColor(red: 0.95, green: 0.67, blue: 0.49, alpha: 1)
            : UIColor(red: 0.56, green: 0.28, blue: 0.17, alpha: 1)
    })
}

@available(iOS 17.0, *)
struct ScriptureTabs: View {
    let scripture: Scripture
    @EnvironmentObject private var study: StudyStore
    @EnvironmentObject private var audio: ScriptureAudio
    @StateObject private var reader: ReaderModel
    @State private var tab = 0

    init(scripture: Scripture) {
        self.scripture = scripture
        _reader = StateObject(wrappedValue: ReaderModel(scripture: scripture))
    }

    var body: some View {
        TabView(selection: $tab) {
            NavigationStack {
                ReaderScreen(model: reader)
            }
            .tabItem { Label("Read", systemImage: "book") }
            .tag(0)

            SearchScreen(scripture: scripture)
                .tabItem { Label("Search", systemImage: "magnifyingglass") }
                .tag(1)

            SavedScreen(scripture: scripture)
                .tabItem { Label("Saved", systemImage: "bookmark") }
                .tag(2)
        }
        .safeAreaInset(edge: .bottom, spacing: 0) { AudioBar() }
        .alert("Saved items", isPresented: Binding(get: { study.error != nil }, set: { if !$0 { study.error = nil } })) {
            Button("OK", role: .cancel) { study.error = nil }
        } message: {
            Text(study.error ?? "")
        }
    }
}

@available(iOS 17.0, *)
struct DestinationReader: View {
    @StateObject private var model: ReaderModel

    init(scripture: Scripture, destination: Destination) {
        _model = StateObject(wrappedValue: ReaderModel(scripture: scripture, destination: destination))
    }

    var body: some View { ReaderScreen(model: model) }
}

@available(iOS 17.0, *)
struct SettingsScreen: View {
    @Environment(\.dismiss) private var dismiss
    @AppStorage("appearance") private var appearance = "System"
    @AppStorage("readerSize") private var size = 0.0

    var body: some View {
        NavigationStack {
            Form {
                Section("Reading") {
                    Picker("Appearance", selection: $appearance) {
                        ForEach(["System", "Light", "Dark"], id: \.self) { Text($0) }
                    }
                    Stepper("Text size: \(size == 0 ? "Default" : size.formatted(.number.sign(strategy: .always())))",
                            value: $size, in: -2...8, step: 2)
                }
                Section("About the translations") {
                    ForEach(Edition.allCases) { edition in
                        Link(destination: edition.source) {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(edition.title)
                                Text("English · Public domain").font(.caption).foregroundStyle(.secondary)
                            }
                        }
                    }
                    Link("WEB audio · Basil Sands", destination: URL(string: "https://ebible.org/engwebu/mp3/")!)
                    Link("BSB audio · Bob Souer", destination: URL(string: "https://bereanbible.com/audio/")!)
                }
                Section("Saved items") {
                    Text("Bookmarks, highlights, and notes are stored on this device. Removing the app can remove your saved items.")
                }
            }
            .scrollContentBackground(.hidden)
            .background(Color.paper)
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
    }
}
