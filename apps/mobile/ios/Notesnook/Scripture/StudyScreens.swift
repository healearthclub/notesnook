// Generated from the standalone Scripture app by integrate_apps.py.
import SwiftUI

@available(iOS 17.0, *)
struct PassagePicker: View {
    @ObservedObject var model: ReaderModel
    @Environment(\.dismiss) private var dismiss
    @State private var filter = ""
    @State private var path: [PickerRoute] = []

    var body: some View {
        NavigationStack(path: $path) {
            List {
                ForEach([false, true], id: \.self) { newTestament in
                    let books = model.books.filter {
                        ($0.order > 39) == newTestament &&
                            (filter.isEmpty || $0.name.localizedCaseInsensitiveContains(filter))
                    }
                    if !books.isEmpty {
                        Section(newTestament ? "New Testament" : "Old Testament") {
                            ForEach(books) { book in
                                NavigationLink(book.name, value: PickerRoute.book(book.id))
                            }
                        }
                    }
                }
            }
            .searchable(text: $filter, prompt: "Find a book")
            .navigationTitle("Choose a passage")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
            .navigationDestination(for: PickerRoute.self) { route in
                switch route {
                case .book(let code):
                    if let book = model.books.first(where: { $0.id == code }) { chapterList(book) }
                case .chapter(let passage):
                    if let book = model.books.first(where: { $0.id == passage.book }) {
                        VersePicker(scripture: model.scripture, passage: passage, book: book) { target in
                            model.open(target)
                            dismiss()
                        }
                    }
                }
            }
        }
    }

    private func chapterList(_ book: Book) -> some View {
        List(1...book.chapters, id: \.self) { number in
            let passage = Passage(edition: model.passage.edition, book: book.id, chapter: number)
            NavigationLink("Chapter \(number)", value: PickerRoute.chapter(passage))
        }
        .navigationTitle(book.name)
    }
}

@available(iOS 17.0, *)
private enum PickerRoute: Hashable {
    case book(String)
    case chapter(Passage)
}

@available(iOS 17.0, *)
private struct VersePicker: View {
    let scripture: Scripture
    let passage: Passage
    let book: Book
    let open: (Destination) -> Void
    @State private var verses: [Verse] = []

    var body: some View {
        List {
            Button { open(Destination(passage: passage)) } label: {
                Label("Open chapter", systemImage: "book")
            }
            Section("Jump to a verse") {
                ForEach(verses) { verse in
                    Button("Verse \(verse.key.label)") {
                        open(Destination(passage: passage, labels: [verse.key.label]))
                    }
                }
            }
        }
        .navigationTitle("\(book.name) \(passage.chapter)")
        .task { verses = (try? scripture.chapter(passage)) ?? [] }
    }
}

@available(iOS 17.0, *)
struct ComparisonScreen: View {
    @ObservedObject var model: ReaderModel
    let fullChapter: Bool
    @Environment(\.dismiss) private var dismiss
    @Environment(\.dynamicTypeSize) private var type
    @State private var groups: [ComparisonGroup] = []
    @State private var problem = false

    var body: some View {
        NavigationStack {
            GeometryReader { geometry in
                ScrollView {
                    let columns = fullChapter && geometry.size.width > 570 && !type.isAccessibilitySize
                    LazyVStack(alignment: .leading, spacing: 0) {
                        if problem {
                            ContentUnavailableView {
                                Label("Comparison unavailable", systemImage: "book.closed")
                            } actions: {
                                Button("Try again", action: load)
                            }
                        }
                        ForEach(groups) { group in
                            if columns {
                                HStack(alignment: .top, spacing: 20) {
                                    passageColumn(model.passage.edition, group.primary)
                                    passageColumn(model.passage.edition.other, group.secondary)
                                }
                            } else {
                                VStack(alignment: .leading, spacing: 14) {
                                    passageColumn(model.passage.edition, group.primary)
                                    passageColumn(model.passage.edition.other, group.secondary)
                                }
                            }
                            Divider().padding(.vertical, 12)
                        }
                    }
                    .padding(22)
                }
                .background(Color.paper)
            }
            .navigationTitle(fullChapter ? model.chapterTitle : "Compare translations")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .task { load() }
        }
    }

    private func passageColumn(_ edition: Edition, _ verses: [Verse]) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            Text(edition.title).font(.caption.weight(.semibold)).foregroundStyle(Color.clay)
            if verses.isEmpty {
                Text("Passage unavailable in this edition").foregroundStyle(.secondary)
            }
            ForEach(verses) { verse in
                let label = verse.key.passage.chapter == model.passage.chapter ? verse.key.label : model.reference(verse.key)
                Text("\(label)  \(verse.displayText)")
                    .font(.system(.body, design: .serif))
                    .lineSpacing(3)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func load() {
        do {
            var otherPassage = model.passage
            otherPassage.edition = otherPassage.edition.other
            let allOther = try model.scripture.chapter(otherPassage)
            let selected = fullChapter ? model.verses : model.selection
            let map = try model.scripture.counterparts(model.passage)
            var targetByRow = Dictionary(uniqueKeysWithValues: allOther.map { ($0.row, $0) })
            for row in Set(selected.flatMap { map[$0.row] ?? [] }) where targetByRow[row] == nil {
                if let verse = try model.scripture.verse(row: row) { targetByRow[row] = verse }
            }
            var result: [ComparisonGroup] = []
            var emitted: Set<Int> = []
            for verse in selected {
                let target = Set(map[verse.row] ?? [])
                if !target.isEmpty, let last = result.indices.last,
                   !target.isDisjoint(with: result[last].secondary.map(\.row)) {
                    let additions = target.subtracting(emitted).sorted().compactMap { targetByRow[$0] }
                    result[last].primary.append(verse)
                    result[last].secondary.append(contentsOf: additions)
                } else {
                    let others = target.subtracting(emitted).sorted().compactMap { targetByRow[$0] }
                    result.append(ComparisonGroup(primary: [verse], secondary: others))
                }
                emitted.formUnion(target)
            }
            if fullChapter {
                result.append(contentsOf: allOther.filter { !emitted.contains($0.row) }
                    .map { ComparisonGroup(primary: [], secondary: [$0]) })
                result.sort { $0.firstNumber < $1.firstNumber }
            }
            groups = result
            problem = false
        } catch {
            groups = []
            problem = true
        }
    }
}

@available(iOS 17.0, *)
private struct ComparisonGroup: Identifiable {
    var primary: [Verse]
    var secondary: [Verse]
    var id: Int { primary.first?.row ?? secondary.first?.row ?? 0 }
    var firstNumber: Int { (primary.first ?? secondary.first).flatMap { Verse.numbers($0.key.label)?.lowerBound } ?? 0 }
}

@available(iOS 17.0, *)
struct FootnotesScreen: View {
    let verse: Verse
    let reference: String
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                Section(reference) {
                    ForEach(verse.notes.indices, id: \.self) { index in
                        Text(verse.notes[index]).textSelection(.enabled)
                    }
                }
            }
            .navigationTitle("Source notes")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
    }
}

@available(iOS 17.0, *)
struct NoteEditor: View {
    let verse: Verse
    let reference: String
    @EnvironmentObject private var study: StudyStore
    @Environment(\.dismiss) private var dismiss
    @State private var draft = ""
    @State private var saveFailed = false
    @FocusState private var focused: Bool

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 14) {
                Text(reference).font(.subheadline.weight(.semibold)).foregroundStyle(Color.clay)
                Text(verse.displayText).font(.system(.body, design: .serif)).lineLimit(4)
                if saveFailed {
                    Label("The note couldn’t be saved. Please try again.", systemImage: "exclamationmark.circle")
                        .font(.subheadline).foregroundStyle(Color.clay)
                }
                TextEditor(text: $draft)
                    .focused($focused)
                    .accessibilityLabel("Note")
                    .accessibilityIdentifier("note-editor")
                    .scrollContentBackground(.hidden)
                    .padding(8)
                    .background(Color.panel, in: RoundedRectangle(cornerRadius: 14))
            }
            .padding()
            .background(Color.paper)
            .navigationTitle("Study note")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        if study.save(.note, value: draft, verses: [verse], reportError: false, reference: { _ in reference }) {
                            dismiss()
                        } else {
                            saveFailed = true
                        }
                    }
                    .disabled(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
            .onAppear {
                draft = study.item(verse.key, .note)?.value ?? ""
                focused = true
            }
        }
    }
}

@available(iOS 17.0, *)
struct SavedScreen: View {
    let scripture: Scripture
    @EnvironmentObject private var study: StudyStore
    @State private var filter = StudyKind.bookmark
    @State private var edit: StudyItem?
    @State private var delete: StudyItem?
    @State private var path: [Destination] = []

    var body: some View {
        NavigationStack(path: $path) {
            List {
                Picker("Saved items", selection: $filter) {
                    ForEach(StudyKind.allCases) { kind in Text(kind.title).tag(kind) }
                }
                .pickerStyle(.segmented)
                .listRowSeparator(.hidden)
                let displayed = study.items.filter { $0.kind == filter }
                if displayed.isEmpty {
                    ContentUnavailableView("No \(filter.title.lowercased())", systemImage: filter.icon,
                                           description: Text("Select a verse in the reader to save it here."))
                }
                ForEach(displayed) { item in
                    let available = (try? scripture.verse(item.key)) != nil
                    HStack(alignment: .top) {
                        Button {
                            path.append(Destination(passage: item.key.passage, labels: [item.key.label]))
                        } label: {
                            VStack(alignment: .leading, spacing: 6) {
                                Text("\(item.reference) · \(item.key.passage.edition.rawValue)")
                                    .font(.subheadline.weight(.semibold)).foregroundStyle(Color.clay)
                                Text(item.excerpt).font(.system(.body, design: .serif)).lineLimit(3)
                                if item.kind == .note { Text(item.value).font(.subheadline).lineLimit(3) }
                                if item.kind == .highlight, let color = Highlight(rawValue: item.value) {
                                    Label(color.title, systemImage: "circle.fill")
                                        .font(.caption).foregroundStyle(Color.clay)
                                }
                                if !available { Text("Passage unavailable").font(.caption) }
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.vertical, 6)
                        }
                        .buttonStyle(.plain)
                        .disabled(!available)
                        Menu {
                            if item.kind == .note && available { Button("Edit note") { edit = item } }
                            Button(item.kind == .note ? "Delete note" : "Remove", role: .destructive) {
                                if item.kind == .note { delete = item }
                                else { study.remove(item.kind, keys: [item.key]) }
                            }
                        } label: {
                            Image(systemName: "ellipsis").frame(width: 44, height: 44)
                        }
                        .accessibilityLabel("Manage \(item.reference)")
                    }
                }
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .background(Color.paper)
            .navigationTitle("Saved")
            .navigationDestination(for: Destination.self) { DestinationReader(scripture: scripture, destination: $0) }
            .sheet(item: $edit) { item in
                if let verse = try? scripture.verse(item.key) { NoteEditor(verse: verse, reference: item.reference) }
            }
            .alert("Delete this note?", isPresented: Binding(get: { delete != nil }, set: { if !$0 { delete = nil } }),
                   presenting: delete) { item in
                Button("Delete note", role: .destructive) { study.remove(.note, keys: [item.key]) }
                Button("Cancel", role: .cancel) {}
            }
        }
    }
}
