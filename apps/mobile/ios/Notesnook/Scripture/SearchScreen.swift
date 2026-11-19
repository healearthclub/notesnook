// Generated from the standalone Scripture app by integrate_apps.py.
import SwiftUI

@available(iOS 17.0, *)
enum PassageQuery {
    case reference(Destination)
    case invalidReference
    case text(String)
    case empty

    static func parse(_ query: String, edition: Edition, scripture: Scripture) throws -> Self {
        let cleaned = query.trimmingCharacters(in: .whitespacesAndNewlines)
        let pattern = #"^\s*((?:[123]\s*|I{1,3}\s+)?[\p{L}][\p{L} .’']*?)\s*(\d+)(?:(?:\s*:\s*)(\d+[a-zA-Z]?)(?:\s*[-–—]\s*(\d+[a-zA-Z]?))?)?\s*$"#
        let books = try scripture.books(edition)
        if let groups = captures(pattern, in: cleaned) {
            let prefix = bookName(groups[1])
            if let book = books.first(where: { bookName($0.name) == prefix || bookName($0.id) == prefix || aliases[$0.id]?.contains(prefix) == true }) {
                guard let chapter = Int(groups[2]), (1...book.chapters).contains(chapter) else { return .invalidReference }
                let passage = Passage(edition: edition, book: book.id, chapter: chapter)
                guard !groups[3].isEmpty else { return .reference(Destination(passage: passage)) }
                let rows = try scripture.chapter(passage)
                guard let start = index(groups[3], in: rows) else { return .invalidReference }
                let endText = groups[4].isEmpty ? groups[3] : groups[4]
                guard let end = index(endText, in: rows, last: true), end >= start else { return .invalidReference }
                if let first = Verse.numbers(groups[3])?.lowerBound, let last = Verse.numbers(endText)?.upperBound,
                   first > last { return .invalidReference }
                return .reference(Destination(passage: passage, labels: rows[start...end].map { $0.key.label }))
            }
        }

        let phrasePattern = #""([^"]+)"|([\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*)"#
        let regex = try NSRegularExpression(pattern: phrasePattern)
        let source = cleaned as NSString
        let terms = regex.matches(in: cleaned, range: NSRange(location: 0, length: source.length))
            .compactMap { match -> String? in
                let value = source.substring(with: match.range(at: match.range(at: 1).location == NSNotFound ? 2 : 1))
                guard value.rangeOfCharacter(from: .alphanumerics) != nil else { return nil }
                return "\"" + value.replacingOccurrences(of: "’", with: "'") + "\""
            }
        return terms.isEmpty ? .empty : .text(terms.joined(separator: " AND "))
    }

    private static func index(_ label: String, in rows: [Verse], last: Bool = false) -> Int? {
        let suffix = label.last?.isLetter == true
        let number = Verse.numbers(label)?.lowerBound
        let matches = rows.indices.filter { index in
            let candidate = rows[index].key.label
            if suffix { return candidate.localizedCaseInsensitiveCompare(label) == .orderedSame }
            return number.map { Verse.numbers(candidate)?.contains($0) == true } ?? false
        }
        return last ? matches.last : matches.first
    }

    private static func bookName(_ name: String) -> String {
        var normalized = name.lowercased().trimmingCharacters(in: .whitespacesAndNewlines)
        for (roman, arabic) in [("iii ", "3"), ("ii ", "2"), ("i ", "1")] where normalized.hasPrefix(roman) {
            normalized = arabic + normalized.dropFirst(roman.count)
            break
        }
        return String(normalized.filter(\.isLetterOrNumber))
    }

    private static func captures(_ pattern: String, in value: String) -> [String]? {
        let source = value as NSString
        guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]),
              let match = regex.firstMatch(in: value, range: NSRange(location: 0, length: source.length))
        else { return nil }
        return (0..<match.numberOfRanges).map { index in
            let range = match.range(at: index)
            return range.location == NSNotFound ? "" : source.substring(with: range)
        }
    }

    private static let aliases: [String: Set<String>] = [
        "GEN": ["ge", "gn"], "EXO": ["ex", "exod"], "LEV": ["le", "lv"], "NUM": ["nu", "nm"],
        "DEU": ["dt", "deut"], "JOS": ["josh"], "JDG": ["judg", "jg"], "RUT": ["ru"],
        "1SA": ["1sam"], "2SA": ["2sam"], "1KI": ["1kgs"], "2KI": ["2kgs"],
        "1CH": ["1chr", "1chron"], "2CH": ["2chr", "2chron"], "NEH": ["ne"], "EST": ["esth"],
        "PSA": ["ps", "psalm", "pss"], "PRO": ["prov", "pr"], "ECC": ["eccl"], "SNG": ["song", "songofsongs", "songofsolomon", "sos", "ss"],
        "ISA": ["is"], "JER": ["je"], "EZK": ["ez", "eze", "ezek"], "DAN": ["da", "dn"],
        "HOS": ["ho"], "JOL": ["jl", "joel"], "AMO": ["am"], "OBA": ["ob", "obad"],
        "JON": ["jonah"], "NAM": ["na", "nah"], "MIC": ["mi"], "ZEP": ["zeph"], "HAG": ["hg"],
        "ZEC": ["zech"], "MAT": ["mt", "matt"], "MRK": ["mk", "mar"], "LUK": ["lk", "lu"],
        "JHN": ["jn", "joh"], "ACT": ["ac"], "ROM": ["ro"], "1CO": ["1cor"], "2CO": ["2cor"],
        "PHP": ["phil", "ph"], "1TH": ["1thess", "1thes"], "2TH": ["2thess", "2thes"],
        "1TI": ["1tim"], "2TI": ["2tim"], "PHM": ["philem", "phile"], "HEB": ["he"],
        "JAS": ["jam", "jm"], "1PE": ["1pet", "1pt"], "2PE": ["2pet", "2pt"],
        "1JN": ["1jhn", "1joh"], "2JN": ["2jhn", "2joh"], "3JN": ["3jhn", "3joh"],
        "JUD": ["jd"], "REV": ["re", "apocalypse"]
    ]
}

@available(iOS 17.0, *)
private extension Character {
    var isLetterOrNumber: Bool { isLetter || isNumber }
}

@available(iOS 17.0, *)
struct SearchScreen: View {
    let scripture: Scripture
    @AppStorage("readingEdition") private var readingEdition = Edition.web
    @State private var editionOverride: Edition?
    @State private var queryEdition: Edition?
    @State private var query = ""
    @State private var searched = false
    @State private var loading = false
    @State private var problem: String?
    @State private var destination: Destination?
    @State private var results: [SearchHit] = []
    @State private var more = false
    @State private var expression = ""
    @State private var retry = UUID()
    @State private var page = 0
    @State private var path: [Destination] = []
    @State private var names: [String: String] = [:]
    private var edition: Edition { editionOverride ?? queryEdition ?? readingEdition }
    private var request: SearchRequest { SearchRequest(query: query, edition: edition, retry: retry, page: page) }

    var body: some View {
        NavigationStack(path: $path) {
            List {
                if let destination {
                    Button {
                        path.append(destination)
                    } label: {
                        Label(reference(destination), systemImage: "arrow.turn.down.right")
                            .font(.headline)
                    }
                    .accessibilityIdentifier("reference-result")
                } else if let problem {
                    VStack(alignment: .leading, spacing: 12) {
                        Text(problem)
                        if problem == "Search couldn’t be completed." {
                            Button("Try again") { retry = UUID() }
                        }
                    }
                } else if searched && results.isEmpty && !loading {
                    ContentUnavailableView.search(text: query)
                } else if !searched && !loading {
                    ContentUnavailableView("Find Scripture", systemImage: "magnifyingglass",
                                           description: Text("Enter a reference like John 3:16 or search for words in a verse."))
                }
                ForEach(results) { hit in
                    Button {
                        path.append(Destination(passage: hit.verse.key.passage, labels: [hit.verse.key.label]))
                    } label: {
                        VStack(alignment: .leading, spacing: 6) {
                            Text(reference(Destination(passage: hit.verse.key.passage, labels: [hit.verse.key.label])))
                                .font(.subheadline.weight(.semibold)).foregroundStyle(Color.clay)
                            Text(emphasized(hit.marked))
                                .font(.system(.body, design: .serif)).foregroundStyle(Color.ink)
                                .lineLimit(4)
                        }
                        .padding(.vertical, 5)
                    }
                }
                if loading { ProgressView().frame(maxWidth: .infinity) }
                else if more {
                    Button("Load more") { page += 1 }
                }
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .background(Color.paper)
            .navigationTitle("Search")
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Reference or words")
            .accessibilityIdentifier("search-screen")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Picker("Search translation", selection: Binding(
                            get: { edition }, set: { editionOverride = $0 }
                        )) {
                            ForEach(Edition.allCases) { Text($0.title).tag($0) }
                        }
                    } label: { Text(edition.rawValue).font(.subheadline.weight(.semibold)) }
                    .accessibilityLabel("Search translation, \(edition.title)")
                }
            }
            .navigationDestination(for: Destination.self) { DestinationReader(scripture: scripture, destination: $0) }
            .onChange(of: query) { _, newValue in
                queryEdition = newValue.isEmpty ? nil : (queryEdition ?? readingEdition)
                reset()
            }
            .onChange(of: edition) { _, _ in
                if path.isEmpty { reset() }
            }
            .task(id: request) {
                let current = request
                guard path.isEmpty else { return }
                await run(current)
            }
        }
    }

    private func reset() {
        page = 0
        results = []
        more = false
        problem = nil
        destination = nil
        searched = false
    }

    private func run(_ current: SearchRequest) async {
        guard !current.query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            loading = false
            return
        }
        loading = true
        problem = nil
        let scripture = scripture
        let previous = expression
        do {
            if current.page == 0 { try await Task.sleep(for: .milliseconds(220)) }
            let worker = Task.detached(priority: .userInitiated) {
                let names = Dictionary(uniqueKeysWithValues: try scripture.books(current.edition).map { ($0.id, $0.name) })
                let parsed = current.page == 0
                    ? try PassageQuery.parse(current.query, edition: current.edition, scripture: scripture)
                    : .text(previous)
                let hits: [SearchHit]
                if case .text(let terms) = parsed {
                    hits = try scripture.search(terms, edition: current.edition, offset: current.page * 50)
                } else {
                    hits = []
                }
                return (parsed, hits, names)
            }
            let output = try await withTaskCancellationHandler {
                try await worker.value
            } onCancel: {
                worker.cancel()
            }
            guard !Task.isCancelled, current == request else { return }
            names = output.2
            switch output.0 {
            case .reference(let target): destination = target
            case .invalidReference: problem = "That passage doesn’t exist in \(current.edition.title)."
            case .text(let terms):
                expression = terms
                let batch = Array(output.1.prefix(50))
                results = Array(results.prefix(current.page * 50)) + batch
                more = output.1.count > 50
                searched = true
            case .empty: searched = false
            }
        } catch {
            guard !Task.isCancelled, current == request else { return }
            problem = "Search couldn’t be completed."
        }
        loading = false
    }

    private func reference(_ target: Destination) -> String {
        let start = "\(names[target.passage.book] ?? target.passage.book) \(target.passage.chapter)"
        guard let first = target.labels.first else { return start }
        if let last = target.labels.last, first != last { return "\(start):\(first)–\(last)" }
        return "\(start):\(first)"
    }

    private func emphasized(_ marked: String) -> AttributedString {
        let pieces = marked.replacingOccurrences(of: "\u{2}", with: "\u{1}").components(separatedBy: "\u{1}")
        var value = AttributedString()
        for (index, piece) in pieces.enumerated() {
            var run = AttributedString(piece)
            if index.isMultiple(of: 2) == false { run.inlinePresentationIntent = .stronglyEmphasized }
            value += run
        }
        return value
    }
}

@available(iOS 17.0, *)
private struct SearchRequest: Equatable {
    let query: String
    let edition: Edition
    let retry: UUID
    let page: Int
}
