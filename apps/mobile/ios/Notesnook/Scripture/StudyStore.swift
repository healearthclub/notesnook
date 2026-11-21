// Generated from the standalone Scripture app by integrate_apps.py.
import Foundation
import SwiftUI

@available(iOS 17.0, *)
enum StudyKind: String, CaseIterable, Identifiable {
    case bookmark, highlight, note

    var id: String { rawValue }
    var title: String {
        switch self {
        case .bookmark: "Bookmarks"
        case .highlight: "Highlights"
        case .note: "Notes"
        }
    }
    var icon: String {
        switch self {
        case .bookmark: "bookmark"
        case .highlight: "highlighter"
        case .note: "note.text"
        }
    }
}

@available(iOS 17.0, *)
enum Highlight: String, CaseIterable, Identifiable {
    case amber, sage, sky, rose

    var id: String { rawValue }
    var title: String { rawValue.capitalized }
    var color: Color {
        switch self {
        case .amber: Color(red: 0.91, green: 0.67, blue: 0.22)
        case .sage: Color(red: 0.51, green: 0.69, blue: 0.40)
        case .sky: Color(red: 0.38, green: 0.67, blue: 0.86)
        case .rose: Color(red: 0.88, green: 0.49, blue: 0.59)
        }
    }
}

@available(iOS 17.0, *)
struct StudyItem: Identifiable {
    struct ID: Hashable {
        let key: VerseKey
        let kind: StudyKind
    }
    let key: VerseKey
    let kind: StudyKind
    let value: String
    let excerpt: String
    let reference: String
    var id: ID { ID(key: key, kind: kind) }
}

@MainActor
@available(iOS 17.0, *)
final class StudyStore: ObservableObject {
    @Published private(set) var items: [StudyItem] = []
    @Published var error: String?
    private var database: Database?

    init(url: URL? = nil) {
        do {
            let path: URL
            if let url {
                path = url
            } else {
                let directory = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask,
                                                            appropriateFor: nil, create: true)
                path = directory.appendingPathComponent("Study.sqlite")
            }
            let db = try Database(path, readOnly: false)
            let version = try db.query("PRAGMA user_version") { Database.int($0, 0) }.first ?? 0
            guard version <= 1 else { throw DatabaseError(message: "This study data requires a newer app version.") }
            if version == 0 {
                try db.transaction {
                    try db.exec("""
                        CREATE TABLE IF NOT EXISTS study (
                            edition TEXT, book TEXT, chapter INTEGER, label TEXT, kind TEXT,
                            value TEXT, excerpt TEXT, reference TEXT, updated REAL,
                            PRIMARY KEY(edition, book, chapter, label, kind)
                        );
                        PRAGMA user_version=1;
                        """)
                }
            }
            database = db
            try refresh()
        } catch {
            self.error = "Saved items could not be opened. Your original data is still on this device."
        }
    }

    func item(_ key: VerseKey, _ kind: StudyKind) -> StudyItem? {
        items.first { $0.key == key && $0.kind == kind }
    }

    @discardableResult
    func save(_ kind: StudyKind, value: String = "", verses: [Verse], reportError: Bool = true,
              reference: (VerseKey) -> String) -> Bool {
        perform(reportError: reportError) { db in
            for verse in verses {
                try db.write("""
                    INSERT INTO study VALUES (?,?,?,?,?,?,?,?,?)
                    ON CONFLICT(edition,book,chapter,label,kind) DO UPDATE SET
                    value=excluded.value, excerpt=excluded.excerpt, reference=excluded.reference, updated=excluded.updated
                    """, parameters(verse.key, kind) + [
                        value, verse.text, reference(verse.key), String(Date().timeIntervalSince1970)
                    ])
            }
        }
    }

    func remove(_ kind: StudyKind, keys: [VerseKey]) {
        perform { db in
            for key in keys {
                try db.write("DELETE FROM study WHERE edition=? AND book=? AND chapter=? AND label=? AND kind=?",
                             parameters(key, kind))
            }
        }
    }

    @discardableResult
    private func perform(reportError: Bool = true, _ operation: (Database) throws -> Void) -> Bool {
        do {
            guard let database else { throw DatabaseError(message: "Saved items are unavailable.") }
            try database.transaction { try operation(database) }
            try refresh()
            return true
        } catch {
            if reportError { self.error = "The change couldn’t be saved. Please try again." }
            return false
        }
    }

    private func refresh() throws {
        guard let database else { return }
        items = try database.query("""
            SELECT edition,book,chapter,label,kind,value,excerpt,reference
            FROM study ORDER BY updated DESC, edition, book, chapter, label, kind
            """) { row -> StudyItem? in
                guard let edition = Edition(rawValue: Database.text(row, 0)),
                      let kind = StudyKind(rawValue: Database.text(row, 4)) else { return nil }
                let passage = Passage(edition: edition, book: Database.text(row, 1), chapter: Database.int(row, 2))
                return StudyItem(key: VerseKey(passage: passage, label: Database.text(row, 3)), kind: kind,
                                 value: Database.text(row, 5), excerpt: Database.text(row, 6),
                                 reference: Database.text(row, 7))
            }.compactMap { $0 }
    }

    private func parameters(_ key: VerseKey, _ kind: StudyKind) -> [String] {
        [key.passage.edition.rawValue, key.passage.book, String(key.passage.chapter), key.label, kind.rawValue]
    }
}
