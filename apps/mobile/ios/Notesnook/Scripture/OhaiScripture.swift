import Foundation
import UIKit
import SwiftUI
import CryptoKit
import React

@available(iOS 17.0, *)
@MainActor
enum ScripturePreferences {
    static var defaults = UserDefaults.standard
    static func configure(_ scope: String) throws -> URL {
        let key = SHA256.hash(data: Data(scope.utf8)).map { String(format: "%02x", $0) }.joined()
        guard let preferences = UserDefaults(suiteName: "org.healearth.scripture." + key) else {
            throw DatabaseError(message: "Scripture preferences are unavailable.")
        }
        defaults = preferences
        let directory = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
            .appendingPathComponent("OhaiScripture", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory.appendingPathComponent(key + ".sqlite")
    }
}

@available(iOS 17.0, *)
struct EmbeddedScriptureRoot: View {
    let scripture: Scripture
    let study: StudyStore
    let audio: ScriptureAudio
    let close: () -> Void
    @AppStorage("appearance") private var appearance = "System"
    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("Bible").font(.headline)
                Spacer()
                Button("Done", action: close).accessibilityIdentifier("scripture-close")
            }
            .padding(.horizontal, 20).frame(minHeight: 44)
            ScriptureTabs(scripture: scripture)
        }
        .background(Color.paper.ignoresSafeArea())
        .tint(Color(red: 0.03, green: 0.52, blue: 0.25))
        .preferredColorScheme(appearance == "System" ? nil : appearance == "Dark" ? .dark : .light)
        .environmentObject(study).environmentObject(audio)
    }
}

@MainActor
@objc(OhaiScripture)
final class OhaiScripture: NSObject {
    private var controller: UIViewController?
    private var cleanup: (() -> Void)?
    @objc static func requiresMainQueueSetup() -> Bool { true }
    @objc var methodQueue: DispatchQueue { .main }

    @objc(open:resolver:rejecter:)
    func open(_ scope: String, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        guard #available(iOS 17.0, *) else { reject("scripture_os", "Scripture requires iOS 17 or later.", nil); return }
        guard scope.count > 0, scope.count <= 300, controller == nil else { reject("scripture_busy", "Close Scripture before opening it again.", nil); return }
        guard let scene = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).first(where: { $0.activationState == .foregroundActive }),
              let root = scene.windows.first(where: \.isKeyWindow)?.rootViewController else { reject("scripture_inactive", "Open the app before reading Scripture.", nil); return }
        var presenter = root
        while let presented = presenter.presentedViewController { presenter = presented }
        guard !presenter.isBeingDismissed else { reject("scripture_busy", "Please try again.", nil); return }
        do {
            let studyURL = try ScripturePreferences.configure(scope)
            let scripture = try Scripture()
            let study = StudyStore(url: studyURL)
            let audio = ScriptureAudio()
            let content = EmbeddedScriptureRoot(scripture: scripture, study: study, audio: audio) { [weak self] in self?.dismiss() }
                .defaultAppStorage(ScripturePreferences.defaults)
            let host = UIHostingController(rootView: content)
            host.modalPresentationStyle = .fullScreen
            controller = host
            cleanup = { audio.close() }
            presenter.present(host, animated: true) { resolve(nil) }
        } catch {
            reject("scripture_unavailable", "Scripture could not be opened. Your saved study items are unchanged.", error)
        }
    }

    @objc(close:rejecter:)
    func close(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        dismiss { resolve(nil) }
    }

    private func dismiss(completion: (() -> Void)? = nil) {
        guard let controller else { completion?(); return }
        cleanup?(); cleanup = nil
        self.controller = nil
        controller.dismiss(animated: true, completion: completion)
    }
}
