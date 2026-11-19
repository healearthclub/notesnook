// Generated from the standalone Scripture app by integrate_apps.py.
import AVFoundation
import MediaPlayer
import SwiftUI

@MainActor
@available(iOS 17.0, *)
final class ScriptureAudio: ObservableObject {
    @Published private(set) var passage: Passage?
    @Published private(set) var title = ""
    @Published private(set) var isPlaying = false
    @Published private(set) var isBuffering = false
    @Published private(set) var elapsed = 0.0
    @Published private(set) var duration = 0.0
    @Published private(set) var speed: Float = 1
    @Published private(set) var failed = false

    private let player = AVPlayer()
    private lazy var nowPlayingSession: MPNowPlayingSession = {
        let session = MPNowPlayingSession(players: [player])
        session.automaticallyPublishesNowPlayingInfo = false
        return session
    }()
    private let catalog: [String: [String: String]]
    private var currentURL: URL?
    private var periodicObserver: Any?
    private var interruptionObserver: Any?
    private var endObserver: Any?
    private var statusObservation: NSKeyValueObservation?
    private var playbackObservation: NSKeyValueObservation?
    private var bufferingTimeout: Task<Void, Never>?
    private var wantsPlayback = false
    private var pendingSeek: Double?
    private var seekID: UUID?
    private var lastStoredSecond = -1

    init() {
        if let bundleURL = Bundle.main.url(forResource: "AudioCatalog", withExtension: "json"),
           let data = try? Data(contentsOf: bundleURL),
           let entries = try? JSONDecoder().decode([String: [String: String]].self, from: data) {
            catalog = entries
        } else {
            catalog = [:]
        }

        periodicObserver = player.addPeriodicTimeObserver(forInterval: CMTime(seconds: 0.5, preferredTimescale: 600),
                                                          queue: .main) { [weak self] _ in
            Task { @MainActor in self?.refresh() }
        }
        playbackObservation = player.observe(\.timeControlStatus, options: [.new]) { [weak self] _, _ in
            Task { @MainActor in self?.refresh() }
        }
        interruptionObserver = NotificationCenter.default.addObserver(
            forName: AVAudioSession.interruptionNotification, object: nil, queue: .main
        ) { [weak self] notification in
            let type = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt
            if type == AVAudioSession.InterruptionType.began.rawValue {
                Task { @MainActor in self?.pause() }
            }
        }
        let remote = nowPlayingSession.remoteCommandCenter
        remote.playCommand.addTarget { [weak self] _ in
            Task { @MainActor in self?.resume() }
            return .success
        }
        remote.pauseCommand.addTarget { [weak self] _ in
            Task { @MainActor in self?.pause() }
            return .success
        }
        remote.togglePlayPauseCommand.addTarget { [weak self] _ in
            Task { @MainActor in self?.toggle() }
            return .success
        }
        remote.changePlaybackPositionCommand.addTarget { [weak self] event in
            guard let seek = event as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
            let position = seek.positionTime
            Task { @MainActor in self?.seek(position) }
            return .success
        }
    }

    deinit {
        bufferingTimeout?.cancel()
        if let periodicObserver { player.removeTimeObserver(periodicObserver) }
        if let interruptionObserver { NotificationCenter.default.removeObserver(interruptionObserver) }
        if let endObserver { NotificationCenter.default.removeObserver(endObserver) }
    }

    func canPlay(_ passage: Passage) -> Bool { audioURL(passage) != nil }

    var narration: String? {
        passage.map { "\($0.edition.title) · \($0.edition == .web ? "Basil Sands" : "Bob Souer")" }
    }

    func play(_ passage: Passage, title: String) {
        guard let url = audioURL(passage) else { return }
        if passage == self.passage && !failed {
            resume()
            return
        }
        savePosition()
        self.passage = passage
        self.title = title
        currentURL = url
        elapsed = positionKey.map { ScripturePreferences.defaults.double(forKey: $0) } ?? 0
        lastStoredSecond = -1
        load(url, at: elapsed)
    }

    func toggle() {
        if wantsPlayback { pause() } else { resume() }
    }

    func changeSpeed(_ speed: Float) {
        self.speed = speed
        if wantsPlayback && player.currentItem?.status == .readyToPlay { player.rate = speed }
        updateNowPlaying()
    }

    func seek(_ offset: Double) {
        guard player.currentItem?.status == .readyToPlay, offset.isFinite else { return }
        let position = min(max(offset, 0), duration)
        elapsed = position
        let id = UUID()
        seekID = id
        player.seek(to: CMTime(seconds: position, preferredTimescale: 600)) { [weak self] _ in
            Task { @MainActor in
                guard let self, self.seekID == id else { return }
                self.seekID = nil
                self.refresh()
            }
        }
        savePosition()
        updateNowPlaying()
    }

    func retry() {
        if let currentURL { load(currentURL, at: elapsed) }
    }

    func close() {
        let hadPlayback = passage != nil
        pause()
        statusObservation = nil
        if let endObserver { NotificationCenter.default.removeObserver(endObserver) }
        endObserver = nil
        player.replaceCurrentItem(with: nil)
        passage = nil
        currentURL = nil
        failed = false
        elapsed = 0
        duration = 0
        nowPlayingSession.nowPlayingInfoCenter.nowPlayingInfo = nil
        if hadPlayback { try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation) }
    }

    private func audioURL(_ passage: Passage) -> URL? {
        guard let file = catalog[passage.edition.rawValue]?["\(passage.book).\(passage.chapter)"] else { return nil }
        let directory = passage.edition == .web ? "https://ebible.org/engwebu/mp3/" : "https://openbible.com/audio/souer/"
        return URL(string: directory)?.appendingPathComponent(file)
    }

    private var positionKey: String? {
        passage.map { "audio-\($0.edition.rawValue)-\($0.book)-\($0.chapter)" }
    }

    private func load(_ url: URL, at time: Double) {
        bufferingTimeout?.cancel()
        bufferingTimeout = nil
        failed = false
        isPlaying = false
        isBuffering = true
        duration = 0
        pendingSeek = time
        seekID = nil
        let item = AVPlayerItem(url: url)
        if let endObserver { NotificationCenter.default.removeObserver(endObserver) }
        endObserver = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemDidPlayToEndTime, object: item, queue: .main
        ) { [weak self] _ in
            Task { @MainActor in
                self?.pause()
                self?.seek(0)
            }
        }
        statusObservation = item.observe(\.status, options: [.new]) { [weak self] _, _ in
            Task { @MainActor in self?.refresh() }
        }
        player.replaceCurrentItem(with: item)
        resume()
    }

    private func resume() {
        guard passage != nil else { return }
        if failed { retry(); return }
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playback, mode: .spokenAudio)
            try session.setActive(true)
            wantsPlayback = true
            player.play()
            refresh()
        } catch {
            failed = true
            wantsPlayback = false
            isBuffering = false
        }
    }

    private func pause() {
        wantsPlayback = false
        player.pause()
        refresh()
        savePosition()
    }

    private func refresh() {
        guard let item = player.currentItem else { return }
        if item.status == .failed {
            playbackFailed()
            return
        }
        if item.status == .readyToPlay {
            let total = item.duration.seconds
            if total.isFinite { duration = max(0, total) }
            if let position = pendingSeek, duration > 0 {
                pendingSeek = nil
                if position > 0 { seek(position) }
                if wantsPlayback { player.rate = speed }
            }
            let position = player.currentTime().seconds
            if position.isFinite, pendingSeek == nil, seekID == nil { elapsed = position }
        }
        isPlaying = player.timeControlStatus == .playing
        isBuffering = wantsPlayback && !isPlaying
        if isBuffering && bufferingTimeout == nil {
            bufferingTimeout = Task { [weak self] in
                try? await Task.sleep(for: .seconds(18))
                guard !Task.isCancelled else { return }
                self?.playbackFailed()
            }
        } else if !isBuffering {
            bufferingTimeout?.cancel()
            bufferingTimeout = nil
        }
        let seconds = Int(elapsed)
        if seconds != lastStoredSecond && seconds.isMultiple(of: 3) && pendingSeek == nil {
            lastStoredSecond = seconds
            savePosition()
        }
        updateNowPlaying()
    }

    private func playbackFailed() {
        bufferingTimeout?.cancel()
        bufferingTimeout = nil
        failed = true
        wantsPlayback = false
        player.pause()
        isPlaying = false
        isBuffering = false
        savePosition()
        updateNowPlaying()
    }

    private func savePosition() {
        if let positionKey { ScripturePreferences.defaults.set(elapsed, forKey: positionKey) }
    }

    private func updateNowPlaying() {
        guard let narration else { return }
        var info: [String: Any] = [
            MPMediaItemPropertyTitle: title,
            MPMediaItemPropertyArtist: narration,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: elapsed,
            MPNowPlayingInfoPropertyPlaybackRate: isPlaying ? speed : 0
        ]
        if duration > 0 { info[MPMediaItemPropertyPlaybackDuration] = duration }
        nowPlayingSession.nowPlayingInfoCenter.nowPlayingInfo = info
        if isPlaying && !nowPlayingSession.isActive && nowPlayingSession.canBecomeActive {
            nowPlayingSession.becomeActiveIfPossible(completion: nil)
        }
    }
}

@available(iOS 17.0, *)
struct AudioBar: View {
    @EnvironmentObject private var audio: ScriptureAudio
    @State private var expanded = false
    @State private var position: Double?

    var body: some View {
        if audio.passage != nil {
            HStack(spacing: 10) {
                Button { expanded = true } label: {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(audio.title).font(.subheadline.weight(.semibold))
                        Text(status).font(.caption).foregroundStyle(Color.mutedInk)
                    }
                    .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                }
                .accessibilityLabel("\(audio.title), audio controls")
                playButton
                    .accessibilityIdentifier("mini-playback-control")
                Button { audio.close() } label: {
                    Image(systemName: "xmark").frame(width: 44, height: 44)
                }
                .accessibilityLabel("Close audio player")
            }
            .padding(.horizontal, 16)
            .background(Color.panel)
            .sheet(isPresented: $expanded) {
                NavigationStack {
                    VStack(alignment: .leading, spacing: 18) {
                        Text(audio.title).font(.system(.largeTitle, design: .serif))
                        Text(status).foregroundStyle(Color.mutedInk)
                        if audio.duration > 0 {
                            Slider(value: Binding(get: { position ?? audio.elapsed }, set: { position = $0 }),
                                   in: 0...audio.duration) { editing in
                                if !editing, let position { audio.seek(position); self.position = nil }
                            }
                            .accessibilityLabel("Playback position")
                            .accessibilityValue(time(position ?? audio.elapsed))
                            HStack {
                                Text(time(position ?? audio.elapsed))
                                Spacer()
                                Text(time(audio.duration))
                            }
                            .font(.caption.monospacedDigit())
                        }
                        HStack {
                            playButton
                                .accessibilityIdentifier("expanded-playback-control")
                            Spacer()
                            Menu {
                                ForEach([0.75, 1, 1.25, 1.5, 2], id: \.self) { rate in
                                    Button("\(rate.formatted())×") { audio.changeSpeed(Float(rate)) }
                                }
                            } label: { Text("\(audio.speed.formatted())×") }
                            .accessibilityLabel("Playback speed")
                        }
                        Spacer()
                    }
                    .padding(24)
                    .background(Color.paper)
                    .navigationTitle("Scripture audio")
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { expanded = false } } }
                }
            }
        }
    }

    private var status: String {
        if audio.failed { return "Playback unavailable" }
        if audio.isBuffering { return "Buffering…" }
        return audio.narration ?? "Scripture audio"
    }

    private var playButton: some View {
        Button {
            if audio.failed { audio.retry() }
            else { audio.toggle() }
        } label: {
            Image(systemName: audio.failed ? "arrow.clockwise" : ((audio.isPlaying || audio.isBuffering) ? "pause.fill" : "play.fill"))
                .frame(width: 44, height: 44)
        }
        .accessibilityLabel(audio.failed ? "Retry audio" : ((audio.isPlaying || audio.isBuffering) ? "Pause" : "Play"))
    }

    private func time(_ seconds: Double) -> String {
        let total = Int(seconds)
        return String(format: "%d:%02d", total / 60, total % 60)
    }
}
