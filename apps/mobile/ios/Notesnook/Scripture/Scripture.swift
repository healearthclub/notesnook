// Generated from the standalone Scripture app by integrate_apps.py.
import Foundation
import SQLite3

@available(iOS 17.0, *)
enum Edition: String, CaseIterable, Codable, Identifiable, Sendable {
    case web = "WEB", bsb = "BSB"

    var id: String { rawValue }
    var title: String { self == .web ? "World English Bible" : "Berean Standard Bible" }
    var other: Self { self == .web ? .bsb : .web }
    var source: URL {
        switch self {
        case .web: URL(string: "https://ebible.org/engwebp/copyright.htm")!
        case .bsb: URL(string: "https://berean.bible/terms.htm")!
        }
    }
}

@available(iOS 17.0, *)
struct Passage: Codable, Hashable, Sendable {
    var edition: Edition
    var book: String
    var chapter: Int

    static let start = Passage(edition: .web, book: "JHN", chapter: 1)
}

@available(iOS 17.0, *)
struct Destination: Hashable, Sendable {
    var passage: Passage
    var labels: [String] = []
}

@available(iOS 17.0, *)
struct VerseKey: Hashable, Codable, Sendable {
    var passage: Passage
    var label: String
}

@available(iOS 17.0, *)
struct Book: Identifiable, Sendable {
    let id: String
    let name: String
    let order: Int
    let chapters: Int
}

@available(iOS 17.0, *)
struct Verse: Identifiable, Equatable, Sendable {
    let row: Int
    let key: VerseKey
    let text: String
    let heading: String
    let paragraph: Bool
    let poetry: Int
    let notes: [String]

    var id: VerseKey { key }
    var displayText: String { text.isEmpty ? "See the source note for this verse." : text }

    static func numbers(_ label: String) -> ClosedRange<Int>? {
        let digits = label.split(whereSeparator: { !$0.isASCII || !$0.isNumber }).compactMap { Int($0) }
        guard let first = digits.first, let last = digits.last, first <= last else { return nil }
        return first...last
    }
}

@available(iOS 17.0, *)
struct DatabaseError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

@available(iOS 17.0, *)
final class Database {
    let handle: OpaquePointer

    init(_ url: URL, readOnly: Bool) throws {
        var connection: OpaquePointer?
        let flags = readOnly ? SQLITE_OPEN_READONLY : SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE
        let result = sqlite3_open_v2(url.path, &connection, flags, nil)
        guard result == SQLITE_OK, let connection else {
            if let connection { sqlite3_close(connection) }
            throw DatabaseError(message: "The database could not be opened.")
        }
        handle = connection
        sqlite3_busy_timeout(handle, 1000)
    }

    deinit { sqlite3_close(handle) }

    func exec(_ sql: String) throws {
        guard sqlite3_exec(handle, sql, nil, nil, nil) == SQLITE_OK else { throw error }
    }

    func query<T>(_ sql: String, _ values: [String] = [], read: (OpaquePointer) -> T) throws -> [T] {
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(handle, sql, -1, &statement, nil) == SQLITE_OK, let statement else {
            throw error
        }
        defer { sqlite3_finalize(statement) }
        for (index, value) in values.enumerated() {
            guard sqlite3_bind_text(statement, Int32(index + 1), value, -1, unsafeBitCast(-1, to: sqlite3_destructor_type.self)) == SQLITE_OK else {
                throw error
            }
        }
        var rows: [T] = []
        var code = sqlite3_step(statement)
        while code == SQLITE_ROW {
            rows.append(read(statement))
            code = sqlite3_step(statement)
        }
        guard code == SQLITE_DONE else { throw error }
        return rows
    }

    func write(_ sql: String, _ values: [String]) throws {
        _ = try query(sql, values) { _ in () }
    }

    func transaction(_ body: () throws -> Void) throws {
        try exec("BEGIN IMMEDIATE")
        do {
            try body()
            try exec("COMMIT")
        } catch {
            try? exec("ROLLBACK")
            throw error
        }
    }

    static func text(_ row: OpaquePointer, _ column: Int32) -> String {
        sqlite3_column_text(row, column).map { String(cString: $0) } ?? ""
    }

    static func int(_ row: OpaquePointer, _ column: Int32) -> Int {
        Int(sqlite3_column_int64(row, column))
    }

    private var error: DatabaseError { DatabaseError(message: String(cString: sqlite3_errmsg(handle))) }
}

@available(iOS 17.0, *)
struct Scripture: Sendable {
    let url: URL

    init(bundle: Bundle = .main) throws {
        guard let url = bundle.url(forResource: "Scripture", withExtension: "sqlite") else {
            throw DatabaseError(message: "The Scripture files are unavailable.")
        }
        self.url = url
    }

    func books(_ edition: Edition = .web) throws -> [Book] {
        try Database(url, readOnly: true).query(
            "SELECT code,name,sort,chapters FROM books WHERE version=? ORDER BY sort", [edition.rawValue]
        ) { row in
            Book(id: Database.text(row, 0), name: Database.text(row, 1),
                 order: Database.int(row, 2), chapters: Database.int(row, 3))
        }
    }

    func chapter(_ passage: Passage) throws -> [Verse] {
        try Database(url, readOnly: true).query(
            "SELECT \(Self.columns) FROM verses v WHERE v.version=? AND v.book=? AND v.chapter=? ORDER BY v.ordinal",
            [passage.edition.rawValue, passage.book, String(passage.chapter)], read: Self.verse
        )
    }

    func verse(_ key: VerseKey) throws -> Verse? {
        let passage = key.passage
        return try Database(url, readOnly: true).query(
            "SELECT \(Self.columns) FROM verses v WHERE v.version=? AND v.book=? AND v.chapter=? AND v.label=?",
            [passage.edition.rawValue, passage.book, String(passage.chapter), key.label], read: Self.verse
        ).first
    }

    func counterparts(_ passage: Passage) throws -> [Int: [Int]] {
        let rows = try Database(url, readOnly: true).query("""
            SELECT a.source, a.target FROM verses v JOIN alignment a ON v.rowid=a.source
            WHERE v.version=? AND v.book=? AND v.chapter=? ORDER BY a.source,a.target
            """, [passage.edition.rawValue, passage.book, String(passage.chapter)]
        ) { (Database.int($0, 0), Database.int($0, 1)) }
        return Dictionary(grouping: rows, by: \.0).mapValues { $0.map(\.1) }
    }

    func verse(row: Int) throws -> Verse? {
        try Database(url, readOnly: true).query(
            "SELECT \(Self.columns) FROM verses v WHERE v.rowid=?", [String(row)], read: Self.verse
        ).first
    }

    func search(_ expression: String, edition: Edition, offset: Int) throws -> [SearchHit] {
        try Task.checkCancellation()
        let db = try Database(url, readOnly: true)
        sqlite3_progress_handler(db.handle, 1000, { _ in Task.isCancelled ? 1 : 0 }, nil)
        return try db.query("""
            SELECT \(Self.columns), highlight(search, 0, char(1), char(2))
            FROM search JOIN verses v ON v.rowid=search.rowid
            WHERE search MATCH ? AND v.version=?
            ORDER BY rank, v.book_sort, v.ordinal LIMIT 51 OFFSET ?
            """, [expression, edition.rawValue, String(offset)]
        ) { row in SearchHit(verse: Self.verse(row), marked: Database.text(row, 11)) }
    }

    private static let columns = "v.rowid,v.version,v.book,v.chapter,v.label,v.text,v.heading,v.paragraph,v.poetry,v.notes,v.ordinal"

    private static func verse(_ row: OpaquePointer) -> Verse {
        let passage = Passage(edition: Edition(rawValue: Database.text(row, 1)) ?? .web,
                              book: Database.text(row, 2), chapter: Database.int(row, 3))
        let notes = (try? JSONDecoder().decode([String].self, from: Data(Database.text(row, 9).utf8))) ?? []
        return Verse(row: Database.int(row, 0), key: VerseKey(passage: passage, label: Database.text(row, 4)),
                     text: Database.text(row, 5), heading: Database.text(row, 6),
                     paragraph: Database.int(row, 7) != 0, poetry: Database.int(row, 8), notes: notes)
    }
}

@available(iOS 17.0, *)
struct SearchHit: Identifiable, Sendable {
    let verse: Verse
    let marked: String
    var id: VerseKey { verse.id }
}
