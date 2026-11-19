// Generated from the standalone Scripture app by integrate_apps.py.
import Foundation

@MainActor
@available(iOS 17.0, *)
final class ReaderModel: ObservableObject {
    @Published private(set) var passage: Passage
    @Published private(set) var verses: [Verse] = []
    @Published private(set) var books: [Book] = []
    @Published private(set) var jump = UUID()
    @Published var selected: Set<String> = []
    @Published var notice: String?
    @Published var error: String?
    private(set) var visibleLabel: String?
    private(set) var markedLabels: Set<String> = []
    private var saveTask: Task<Void, Never>?
    let scripture: Scripture

    init(scripture: Scripture, destination: Destination? = nil) {
        self.scripture = scripture
        let saved = ScripturePreferences.defaults.data(forKey: "readingPosition")
            .flatMap { try? JSONDecoder().decode(VerseKey.self, from: $0) }
        let start = destination ?? Destination(passage: saved?.passage ?? .start, labels: saved.map { [$0.label] } ?? [])
        passage = start.passage
        load(start, mark: destination != nil, restore: true)
    }

    var currentBook: Book? { books.first { $0.id == passage.book } }
    var chapterTitle: String { "\(currentBook?.name ?? passage.book) \(passage.chapter)" }
    var selection: [Verse] { verses.filter { selected.contains($0.key.label) } }

    func reference(_ key: VerseKey) -> String {
        let name = books.first { $0.id == key.passage.book }?.name ?? key.passage.book
        return "\(name) \(key.passage.chapter):\(key.label)"
    }

    func open(_ destination: Destination) {
        load(destination, mark: true)
    }

    func retry() {
        load(Destination(passage: passage, labels: visibleLabel.map { [$0] } ?? []), mark: false)
    }

    func adjacent(_ direction: Int) -> Passage? {
        guard let index = books.firstIndex(where: { $0.id == passage.book }) else { return nil }
        let chapter = passage.chapter + direction
        if (1...books[index].chapters).contains(chapter) {
            return Passage(edition: passage.edition, book: passage.book, chapter: chapter)
        }
        let otherIndex = index + direction
        guard books.indices.contains(otherIndex) else { return nil }
        let other = books[otherIndex]
        return Passage(edition: passage.edition, book: other.id, chapter: direction < 0 ? other.chapters : 1)
    }

    func switchVersion(_ edition: Edition) {
        guard edition != passage.edition else { return }
        do {
            let target = Passage(edition: edition, book: passage.book, chapter: passage.chapter)
            let targetVerses = try scripture.chapter(target)
            guard !targetVerses.isEmpty else {
                notice = "This chapter is unavailable in \(edition.title)."
                return
            }
            let anchor = verses.first { $0.key.label == visibleLabel }
            let alignment = try scripture.counterparts(passage)
            let mapped: Verse?
            if let anchor, let row = alignment[anchor.row]?.first {
                mapped = try scripture.verse(row: row)
            } else {
                mapped = nil
            }
            load(Destination(passage: mapped?.key.passage ?? target, labels: mapped.map { [$0.key.label] } ?? []), mark: false)
            if anchor != nil && mapped == nil {
                notice = "This verse is unavailable in \(edition.title). The reader opened the start of the chapter."
            }
        } catch {
            notice = "This translation couldn't be opened. Please try again."
        }
    }

    func updateVisible(_ label: String) {
        guard visibleLabel != label else { return }
        visibleLabel = label
        saveTask?.cancel()
        saveTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(220))
            if !Task.isCancelled { self?.persist() }
        }
    }

    func persist() {
        saveTask?.cancel()
        saveTask = nil
        guard let visibleLabel, !verses.isEmpty,
              let data = try? JSONEncoder().encode(VerseKey(passage: passage, label: visibleLabel)) else { return }
        ScripturePreferences.defaults.set(data, forKey: "readingPosition")
        ScripturePreferences.defaults.set(passage.edition.rawValue, forKey: "readingEdition")
    }

    private func load(_ destination: Destination, mark: Bool, restore: Bool = false) {
        saveTask?.cancel()
        saveTask = nil
        error = nil
        notice = nil
        do {
            var target = destination.passage
            let targetBooks = try scripture.books(target.edition)
            var rows = try scripture.chapter(target)
            if restore && rows.isEmpty {
                target = targetBooks.contains { $0.id == target.book }
                    ? Passage(edition: target.edition, book: target.book, chapter: 1) : .start
                rows = try scripture.chapter(target)
            }
            guard !rows.isEmpty else {
                error = "This passage is unavailable."
                return
            }
            passage = target
            books = targetBooks
            verses = rows
            selected = []
            let requested = destination.labels.first
            let number = requested.flatMap(Verse.numbers)?.lowerBound
            let nearest = number.flatMap { number in
                rows.min { lhs, rhs in
                    abs((Verse.numbers(lhs.key.label)?.lowerBound ?? 0) - number)
                        < abs((Verse.numbers(rhs.key.label)?.lowerBound ?? 0) - number)
                }
            }
            visibleLabel = rows.first { $0.key.label == requested }?.key.label
                ?? (restore ? nearest?.key.label : nil) ?? rows.first?.key.label
            markedLabels = mark ? Set(destination.labels) : []
            jump = UUID()
            persist()
        } catch {
            self.error = "The passage couldn't be loaded. Please try again."
        }
    }
}
