// Generated from the standalone Scripture app by integrate_apps.py.
import SwiftUI

@available(iOS 17.0, *)
struct ReaderScreen: View {
    @ObservedObject var model: ReaderModel
    @EnvironmentObject private var study: StudyStore
    @EnvironmentObject private var audio: ScriptureAudio
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.dynamicTypeSize) private var typeSize
    @AppStorage("readerSize") private var size = 0.0
    @ScaledMetric(relativeTo: .body) private var bodySize = 20.0
    @AccessibilityFocusState private var focusedVerse: String?
    @State private var sheet: ReaderSheet?
    @State private var marked: Set<String> = []
    @State private var tracking = false
    @State private var readerVisible = false

    var body: some View {
        GeometryReader { geometry in
            VStack(spacing: 0) {
                controls(parallelAvailable: geometry.size.width > 600 && !typeSize.isAccessibilitySize)
                Rectangle().fill(Color.ink.opacity(0.10)).frame(height: 1)
                if let error = model.error {
                    ContentUnavailableView {
                        Label("Passage unavailable", systemImage: "book.closed")
                    } description: {
                        Text(error)
                    } actions: {
                        Button("Try again", action: model.retry)
                    }
                } else {
                    chapterReader
                }
            }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if !model.selection.isEmpty { actions }
        }
        .background(Color.paper)
        .foregroundStyle(Color.ink)
        .navigationBarTitleDisplayMode(.inline)
        .sheet(item: $sheet) { destination in
            switch destination {
            case .passages: PassagePicker(model: model)
            case .settings: SettingsScreen()
            case .comparison(let fullChapter): ComparisonScreen(model: model, fullChapter: fullChapter)
            case .note(let verse): NoteEditor(verse: verse, reference: model.reference(verse.key))
            case .footnotes(let verse): FootnotesScreen(verse: verse, reference: model.reference(verse.key))
            }
        }
        .alert("Reader", isPresented: Binding(get: { model.notice != nil }, set: { if !$0 { model.notice = nil } })) {
            Button("OK", role: .cancel) { model.notice = nil }
        } message: { Text(model.notice ?? "") }
        .onAppear { readerVisible = true }
        .onDisappear { readerVisible = false }
        .onChange(of: scenePhase) { _, phase in
            if phase == .background && readerVisible { model.persist() }
        }
    }

    private func controls(parallelAvailable: Bool) -> some View {
        Group {
            if typeSize.isAccessibilitySize {
                VStack(alignment: .leading, spacing: 4) {
                    passageButton
                    HStack(spacing: 8) { readerTools(parallelAvailable: false) }
                }
            } else {
                HStack(spacing: 8) {
                    passageButton
                    readerTools(parallelAvailable: parallelAvailable)
                }
            }
        }
        .buttonStyle(.plain)
        .padding(.horizontal, 20)
        .padding(.vertical, 8)
        .background(Color.paper)
    }

    private var passageButton: some View {
        Button { sheet = .passages } label: {
            HStack(spacing: 7) {
                Text(model.chapterTitle).font(.headline).lineLimit(typeSize.isAccessibilitySize ? nil : 1)
                Image(systemName: "chevron.down").font(.system(size: 10, weight: .semibold))
            }
            .frame(minHeight: 44)
            .padding(.horizontal, 12)
            .background(Color.panel, in: RoundedRectangle(cornerRadius: 13))
        }
        .accessibilityLabel("Choose passage, \(model.chapterTitle)")
        .accessibilityIdentifier("choose-passage")
    }

    private func readerTools(parallelAvailable: Bool) -> some View {
        Group {
            Menu {
                ForEach(Edition.allCases) { edition in
                    Button {
                        model.switchVersion(edition)
                    } label: {
                        if edition == model.passage.edition {
                            Label("\(edition.title) · Offline", systemImage: "checkmark")
                        } else {
                            Text("\(edition.title) · Offline")
                        }
                    }
                }
            } label: {
                Text(model.passage.edition.rawValue)
                    .font(.caption.weight(.bold))
                    .frame(minWidth: 47, minHeight: 44)
                    .background(Color.panel, in: RoundedRectangle(cornerRadius: 13))
            }
            .accessibilityLabel("Translation, \(model.passage.edition.title)")
            .accessibilityIdentifier("translation-picker")

            Spacer(minLength: 0)

            if audio.canPlay(model.passage) {
                Button {
                    audio.play(model.passage, title: model.chapterTitle)
                } label: {
                    Image(systemName: "headphones").font(.system(size: 19, weight: .medium))
                        .frame(width: 44, height: 44)
                }
                .accessibilityLabel("Listen to \(model.chapterTitle)")
            }
            if parallelAvailable {
                Button { sheet = .comparison(true) } label: {
                    Image(systemName: "rectangle.split.2x1")
                        .frame(width: 44, height: 44)
                }
                .accessibilityLabel("Parallel translations")
            }
            Button { sheet = .settings } label: {
                Image(systemName: "textformat.size").font(.system(size: 19, weight: .medium))
                    .frame(width: 44, height: 44)
            }
            .accessibilityLabel("Reading settings")
        }
    }

    private var chapterReader: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 5) {
                    chapterHeading
                    ForEach(model.verses) { verse in
                        verseBlock(verse)
                            .id(verse.key.label)
                            .background {
                                GeometryReader { proxy in
                                    Color.clear.preference(key: VersePositions.self, value: [
                                        verse.key.label: proxy.frame(in: .named("chapter")).minY
                                    ])
                                }
                            }
                    }
                    chapterNavigation
                }
                .frame(maxWidth: 660)
                .padding(.horizontal, 24)
                .frame(maxWidth: .infinity)
            }
            .coordinateSpace(name: "chapter")
            .accessibilityIdentifier("chapter-reader")
            .onPreferenceChange(VersePositions.self) { positions in
                guard tracking, readerVisible else { return }
                let top = positions.filter { $0.value <= 20 }.max { $0.value < $1.value }
                if let label = top?.key { model.updateVisible(label) }
            }
            .task(id: model.jump) {
                tracking = false
                marked = model.markedLabels
                await Task.yield()
                if let label = model.visibleLabel, label != model.verses.first?.key.label {
                    proxy.scrollTo(label, anchor: .top)
                } else {
                    proxy.scrollTo("heading", anchor: .top)
                }
                if let label = model.visibleLabel, marked.contains(label) { focusedVerse = label }
                try? await Task.sleep(for: .milliseconds(300))
                guard !Task.isCancelled else { return }
                tracking = true
                try? await Task.sleep(for: .seconds(2))
                if !Task.isCancelled { marked = [] }
            }
        }
    }

    private var chapterHeading: some View {
        VStack(alignment: .leading, spacing: 7) {
            Text((model.currentBook?.order ?? 40) > 39 ? "New Testament" : "Old Testament")
                .font(.caption.weight(.semibold))
                .foregroundStyle(Color.clay)
            Text(model.chapterTitle)
                .font(.system(.largeTitle, design: .serif, weight: .regular))
                .accessibilityAddTraits(.isHeader)
                .accessibilityIdentifier("chapter-heading")
            Text(model.passage.edition.title)
                .font(.subheadline)
                .foregroundStyle(Color.mutedInk)
        }
        .padding(.top, 27)
        .padding(.bottom, 23)
        .id("heading")
    }

    private func verseBlock(_ verse: Verse) -> some View {
        let selected = model.selected.contains(verse.key.label)
        let highlight = study.item(verse.key, .highlight).flatMap { Highlight(rawValue: $0.value) }
        return VStack(alignment: .leading, spacing: 5) {
            if !verse.heading.isEmpty {
                Text(verse.heading)
                    .font(.system(.headline, design: .serif))
                    .accessibilityAddTraits(.isHeader)
                    .padding(.top, 10)
            }
            HStack(alignment: .top, spacing: 6) {
                Button {
                    if selected { model.selected.remove(verse.key.label) }
                    else { model.selected.insert(verse.key.label) }
                } label: {
                    HStack(alignment: .firstTextBaseline, spacing: 9) {
                        Text(verse.key.label)
                            .font(.caption.monospacedDigit().weight(.semibold))
                            .foregroundStyle(Color.clay)
                            .frame(minWidth: 16, alignment: .leading)
                        Text(verse.displayText)
                            .font(.system(size: max(16, bodySize + size), design: .serif))
                            .lineSpacing(5)
                            .multilineTextAlignment(.leading)
                            .padding(.leading, verse.poetry > 0 ? 8 : 0)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        if study.item(verse.key, .bookmark) != nil {
                            Image(systemName: "bookmark.fill").font(.caption2).foregroundStyle(Color.clay)
                        }
                    }
                    .padding(.vertical, 5)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Verse \(verse.key.label). \(verse.displayText)")
                .accessibilityValue([selected ? "Selected" : nil, highlight.map { "\($0.title) highlight" },
                                     study.item(verse.key, .bookmark) == nil ? nil : "Bookmarked",
                                     study.item(verse.key, .note) == nil ? nil : "Has note"]
                    .compactMap { $0 }.joined(separator: ", "))
                .accessibilityAddTraits(selected ? [.isSelected] : [])
                .accessibilityFocused($focusedVerse, equals: verse.key.label)
                .accessibilityIdentifier("verse-\(verse.key.label)")

                if !verse.notes.isEmpty {
                    Button { sheet = .footnotes(verse) } label: {
                        Image(systemName: "asterisk.circle")
                            .font(.caption)
                            .frame(width: 44, height: 44)
                    }
                    .accessibilityLabel("Source notes for verse \(verse.key.label)")
                }
            }
            .background {
                RoundedRectangle(cornerRadius: 7)
                    .fill(highlight?.color.opacity(0.27) ?? Color.clear)
                if selected || marked.contains(verse.key.label) {
                    RoundedRectangle(cornerRadius: 7)
                        .fill(Color.clay.opacity(0.12))
                        .strokeBorder(Color.clay.opacity(0.36), lineWidth: 1)
                }
            }
        }
        .padding(.top, verse.paragraph && verse.key.label != model.verses.first?.key.label ? 10 : 0)
    }

    private var chapterNavigation: some View {
        ViewThatFits(in: .horizontal) {
            HStack { previousChapter; Spacer(); nextChapter }
            VStack(alignment: .leading) { previousChapter; nextChapter }
        }
        .buttonStyle(.bordered)
        .padding(.vertical, 24)
    }

    private var previousChapter: some View {
        Button {
            if let target = model.adjacent(-1) { model.open(Destination(passage: target)) }
        } label: { Label("Previous chapter", systemImage: "chevron.left") }
        .disabled(model.adjacent(-1) == nil)
    }

    private var nextChapter: some View {
        Button {
            if let target = model.adjacent(1) { model.open(Destination(passage: target)) }
        } label: { Label("Next chapter", systemImage: "chevron.right") }
        .disabled(model.adjacent(1) == nil)
    }

    private var actions: some View {
        let verses = model.selection
        let keys = verses.map(\.key)
        let allBookmarked = keys.allSatisfy { study.item($0, .bookmark) != nil }
        let share = verses.map { "\($0.text)\n\(model.reference($0.key)) (\(model.passage.edition.rawValue))" }
            .joined(separator: "\n\n")
        return VStack(alignment: .leading, spacing: 0) {
            HStack {
                let labels = keys.map(\.label).joined(separator: ", ")
                Text("\(model.chapterTitle):\(labels)").font(.subheadline.weight(.semibold)).lineLimit(1)
                Spacer()
                Button { model.selected = [] } label: {
                    Image(systemName: "xmark").frame(minWidth: 44, minHeight: 44)
                }
                .accessibilityLabel("Clear selection")
            }
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 14) {
                    Button { sheet = .comparison(false) } label: { Label("Compare", systemImage: "rectangle.split.2x1") }
                    Button {
                        if allBookmarked { study.remove(.bookmark, keys: keys) }
                        else { study.save(.bookmark, verses: verses, reference: model.reference) }
                    } label: { Label(allBookmarked ? "Remove bookmark" : "Bookmark", systemImage: "bookmark") }
                    Menu {
                        ForEach(Highlight.allCases) { color in
                            Button(color.title) { study.save(.highlight, value: color.rawValue, verses: verses, reference: model.reference) }
                        }
                        if keys.contains(where: { study.item($0, .highlight) != nil }) {
                            Button("Remove highlight", role: .destructive) { study.remove(.highlight, keys: keys) }
                        }
                    } label: { Label("Highlight", systemImage: "highlighter") }
                    if verses.count == 1, let verse = verses.first {
                        Button { sheet = .note(verse) } label: {
                            Label(study.item(verse.key, .note) == nil ? "Add note" : "Edit note", systemImage: "note.text")
                        }
                    }
                    Button {
                        UIPasteboard.general.string = share
                        UIAccessibility.post(notification: .announcement, argument: "Scripture copied")
                    } label: { Label("Copy", systemImage: "doc.on.doc") }
                    ShareLink(item: share) { Label("Share", systemImage: "square.and.arrow.up") }
                }
                .labelStyle(.titleAndIcon)
                .font(.subheadline.weight(.medium))
                .frame(minHeight: 44)
            }
        }
        .padding(.horizontal, 20)
        .padding(.bottom, 5)
        .background(Color.panel)
    }
}

@available(iOS 17.0, *)
private enum ReaderSheet: Identifiable {
    case passages, settings, comparison(Bool), note(Verse), footnotes(Verse)

    var id: String {
        switch self {
        case .passages: "passages"
        case .settings: "settings"
        case .comparison: "comparison"
        case .note: "note"
        case .footnotes: "footnotes"
        }
    }
}

@available(iOS 17.0, *)
private struct VersePositions: PreferenceKey {
    static let defaultValue: [String: CGFloat] = [:]
    static func reduce(value: inout [String: CGFloat], nextValue: () -> [String: CGFloat]) {
        value.merge(nextValue(), uniquingKeysWith: { _, last in last })
    }
}
